"use strict";
const express = require("express");
const { admin, db } = require("../lib/admin");
const { logAudit, sendError } = require("../lib/utils");
const { authMiddleware, requireAdmin } = require("../middleware/auth");

const router = express.Router();

// ── Helpers ───────────────────────────────────────────────────────────────
function validateProductData(data, { partial = false } = {}) {
    const req = (val, field) => {
        if (!partial && (val === undefined || val === null || val === "")) {
            throw { code: 400, message: `${field} is required.` };
        }
    };
    req(data.name, "name");
    req(data.category, "category");
    if (data.price !== undefined && (typeof data.price !== "number" || data.price < 0)) {
        throw { code: 400, message: "price must be a non-negative number." };
    }
    if (data.mrp !== undefined && (typeof data.mrp !== "number" || data.mrp < 0)) {
        throw { code: 400, message: "mrp must be a non-negative number." };
    }
    if (data.stock !== undefined && (!Number.isInteger(data.stock) || data.stock < 0)) {
        throw { code: 400, message: "stock must be a non-negative integer." };
    }
}

async function checkDuplicateSKU(sku, excludeId = null) {
    if (!sku) return;
    const snap = await db.collection("products").where("sku", "==", sku).limit(2).get();
    const clash = snap.docs.find(d => d.id !== excludeId);
    if (clash) throw { code: 409, message: `SKU "${sku}" is already in use.` };
}

// ── POST /api/products/create (Admin only) ─────────────────────────────────
router.post("/create", authMiddleware, requireAdmin, async (req, res) => {
    try {
        const data = req.body;
        validateProductData(data);
        if (data.sku) await checkDuplicateSKU(data.sku);

        const now = admin.firestore.FieldValue.serverTimestamp();
        const stock = Number.isInteger(data.stock) ? data.stock : 0;
        const docRef = await db.collection("products").add({
            ...data,
            stock,
            status: stock > 0 ? "active" : "out_of_stock",
            createdAt: now,
            lastUpdated: now
        });

        await logAudit(req, "CREATE", "products", docRef.id, null, data);
        return res.json({ success: true, id: docRef.id });
    } catch (err) {
        if (err.code && err.message) return sendError(res, err.code, "invalid-argument", err.message);
        console.error("[products/create]", err);
        return sendError(res, 500, "internal", "Failed to create product.");
    }
});

// ── POST /api/products/update (Admin only) ──────────────────────────────────
router.post("/update", authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { id, ...data } = req.body;
        if (!id) return sendError(res, 400, "invalid-argument", "Product id is required.");
        validateProductData(data, { partial: true });
        if (data.sku) await checkDuplicateSKU(data.sku, id);

        const ref = db.collection("products").doc(id);
        const before = await ref.get();
        if (!before.exists) return sendError(res, 404, "not-found", "Product not found.");

        await ref.update({ ...data, lastUpdated: admin.firestore.FieldValue.serverTimestamp() });
        await logAudit(req, "UPDATE", "products", id, before.data(), data);
        return res.json({ success: true });
    } catch (err) {
        if (err.code && err.message) return sendError(res, err.code, "invalid-argument", err.message);
        console.error("[products/update]", err);
        return sendError(res, 500, "internal", "Failed to update product.");
    }
});

// ── POST /api/products/delete (Admin only) ──────────────────────────────────
router.post("/delete", authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { id } = req.body;
        if (!id) return sendError(res, 400, "invalid-argument", "Product id is required.");

        const ref = db.collection("products").doc(id);
        const before = await ref.get();
        if (!before.exists) return sendError(res, 404, "not-found", "Product not found.");

        await ref.delete();
        await logAudit(req, "DELETE", "products", id, before.data(), null);
        return res.json({ success: true });
    } catch (err) {
        console.error("[products/delete]", err);
        return sendError(res, 500, "internal", "Failed to delete product.");
    }
});

// ── POST /api/products/adjust-stock (Admin only) ────────────────────────────
router.post("/adjust-stock", authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { id, delta, reason } = req.body;
        if (!id || !Number.isInteger(delta)) {
            return sendError(res, 400, "invalid-argument", "id and integer delta are required.");
        }

        const ref = db.collection("products").doc(id);
        const result = await db.runTransaction(async (t) => {
            const snap = await t.get(ref);
            if (!snap.exists) throw { code: 404, message: "Product not found." };
            const current = snap.data().stock || 0;
            const newStock = Math.max(0, current + delta);
            const now = admin.firestore.FieldValue.serverTimestamp();
            t.update(ref, {
                stock: newStock,
                status: newStock > 0 ? "active" : "out_of_stock",
                lastUpdated: now
            });
            t.set(db.collection("inventory_history").doc(), {
                productId: id, delta, before: current, after: newStock,
                reason: reason || null, changedBy: req.user.uid, changedAt: now
            });
            return { before: current, after: newStock };
        });

        // Also written to audit_logs so this shows up alongside other admin actions
        await logAudit(req, "ADJUST_STOCK", "products", id, { stock: result.before }, { stock: result.after, reason: reason || null });
        return res.json({ success: true, ...result });
    } catch (err) {
        if (err.code && err.message) return sendError(res, err.code, "invalid-argument", err.message);
        console.error("[products/adjust-stock]", err);
        return sendError(res, 500, "internal", "Failed to adjust stock.");
    }
});

module.exports = router;
