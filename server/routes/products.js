"use strict";
const express = require("express");
const { admin, db } = require("../lib/admin");
const { logAudit, sendError } = require("../lib/utils");
const { authMiddleware, requireAdmin, requireOwnerOrManager } = require("../middleware/auth");

const router = express.Router();

function validateProductData(data, isUpdate = false) {
    const reqStr = (val, field) => { if (!isUpdate || data.hasOwnProperty(field)) { if (typeof val !== "string" || !val.trim()) throw { code: 400, message: `${field} is required.` }; } };
    const reqNum = (val, field) => { if (!isUpdate || data.hasOwnProperty(field)) { if (typeof val !== "number" || isNaN(val)) throw { code: 400, message: `${field} must be a number.` }; } };
    reqStr(data.productName, "productName"); reqStr(data.description, "description");
    reqStr(data.sku, "sku"); reqStr(data.category, "category");
    reqNum(data.price, "price"); reqNum(data.stock, "stock"); reqStr(data.status, "status");
    if (data.hasOwnProperty("sku") && !/^[A-Z0-9-]+$/.test(data.sku)) throw { code: 400, message: "SKU must be uppercase alphanumeric with hyphens." };
    if (data.hasOwnProperty("price") && data.price < 0) throw { code: 400, message: "Price cannot be negative." };
    if (data.hasOwnProperty("stock") && (!Number.isInteger(data.stock) || data.stock < 0)) throw { code: 400, message: "Stock must be a non-negative integer." };
    if (data.hasOwnProperty("status") && !["active", "draft", "archived", "out_of_stock"].includes(data.status)) throw { code: 400, message: "Invalid status." };
}

async function checkDuplicateSKU(sku, excludeId = null) {
    if (!sku) return;
    const snap = await db.collection("products").where("sku", "==", sku).limit(excludeId ? 2 : 1).get();
    if (!snap.empty) {
        if (!excludeId) throw { code: 409, message: `Product with SKU ${sku} already exists.` };
        if (snap.docs.some(d => d.id !== excludeId)) throw { code: 409, message: `Another product with SKU ${sku} exists.` };
    }
}

// POST /api/products/create (Admin)
router.post("/create", authMiddleware, requireAdmin, async (req, res) => {
    try {
        const data = req.body;
        validateProductData(data, false);
        await checkDuplicateSKU(data.sku, null);
        data.createdAt = admin.firestore.FieldValue.serverTimestamp();
        data.updatedAt = admin.firestore.FieldValue.serverTimestamp();
        const docRef = await db.collection("products").add(data);
        await logAudit(req, "CREATE", "products", docRef.id, null, data);
        return res.json({ success: true, id: docRef.id });
    } catch (err) {
        if (err.code) return sendError(res, err.code, "invalid-argument", err.message);
        console.error("[products/create]", err); return sendError(res, 500, "internal", "Failed to create product.");
    }
});

// POST /api/products/update (Admin)
router.post("/update", authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { id, ...updateData } = req.body;
        if (!id) return sendError(res, 400, "invalid-argument", "Product ID is required.");
        validateProductData(updateData, true);
        if (updateData.sku) await checkDuplicateSKU(updateData.sku, id);
        const docRef = db.collection("products").doc(id);
        const snap = await docRef.get();
        if (!snap.exists) return sendError(res, 404, "not-found", "Product not found.");
        updateData.updatedAt = admin.firestore.FieldValue.serverTimestamp();
        await docRef.update(updateData);
        await logAudit(req, "UPDATE", "products", id, snap.data(), updateData);
        return res.json({ success: true });
    } catch (err) {
        if (err.code) return sendError(res, err.code, "invalid-argument", err.message);
        console.error("[products/update]", err); return sendError(res, 500, "internal", "Failed to update product.");
    }
});

// POST /api/products/delete (Admin)
router.post("/delete", authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { id } = req.body;
        if (!id) return sendError(res, 400, "invalid-argument", "Product ID is required.");
        const docRef = db.collection("products").doc(id);
        const snap = await docRef.get();
        if (!snap.exists) return sendError(res, 404, "not-found", "Product not found.");
        await docRef.delete();
        await logAudit(req, "DELETE", "products", id, snap.data(), null);
        return res.json({ success: true });
    } catch (err) { console.error("[products/delete]", err); return sendError(res, 500, "internal", "Failed to delete product."); }
});

// POST /api/products/adjust-stock (Admin)
router.post("/adjust-stock", authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { productId, adjustment, reason } = req.body;
        const ALLOWED_REASONS = ["manual_adjustment", "restock", "damage", "return", "order_fulfillment"];
        if (!productId || typeof adjustment !== "number" || !reason) return sendError(res, 400, "invalid-argument", "productId, adjustment, and reason are required.");
        if (!ALLOWED_REASONS.includes(reason)) return sendError(res, 400, "invalid-argument", `reason must be one of: ${ALLOWED_REASONS.join(", ")}.`);
        if (!Number.isInteger(adjustment) || adjustment === 0) return sendError(res, 400, "invalid-argument", "adjustment must be a non-zero integer.");

        const docRef = db.collection("products").doc(productId);
        const result = await db.runTransaction(async (t) => {
            const snap = await t.get(docRef);
            if (!snap.exists) throw { status: 404, code: "not-found", message: "Product not found." };
            const currentStock = snap.data().stock || 0;
            const newStock = currentStock + adjustment;
            if (newStock < 0) throw { status: 400, code: "failed-precondition", message: "Cannot adjust stock below zero." };
            const now = admin.firestore.FieldValue.serverTimestamp();
            t.update(docRef, { stock: newStock, status: newStock === 0 ? "out_of_stock" : snap.data().status, updatedAt: now });
            const histRef = db.collection("inventory_history").doc();
            t.set(histRef, { productId, previousStock: currentStock, adjustment, newStock, reason, referenceId: req.user.uid, createdAt: now });
            return { success: true, newStock };
        });
        return res.json(result);
    } catch (err) {
        if (err.status) return sendError(res, err.status, err.code, err.message);
        console.error("[products/adjust-stock]", err); return sendError(res, 500, "internal", "Failed to adjust stock.");
    }
});

// POST /api/products/manage-category (Admin)
router.post("/manage-category", authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { action, id, data } = req.body;
        if (action === "CREATE") { data.createdAt = data.updatedAt = admin.firestore.FieldValue.serverTimestamp(); const ref = await db.collection("categories").add(data); return res.json({ success: true, id: ref.id }); }
        else if (action === "UPDATE") { data.updatedAt = admin.firestore.FieldValue.serverTimestamp(); await db.collection("categories").doc(id).update(data); return res.json({ success: true }); }
        else if (action === "DELETE") { await db.collection("categories").doc(id).delete(); return res.json({ success: true }); }
        return sendError(res, 400, "invalid-argument", "Invalid action.");
    } catch (err) { console.error("[products/manage-category]", err); return sendError(res, 500, "internal", "Failed."); }
});

// POST /api/products/manage-brand (Admin)
router.post("/manage-brand", authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { action, id, data } = req.body;
        if (action === "CREATE") { data.createdAt = data.updatedAt = admin.firestore.FieldValue.serverTimestamp(); const ref = await db.collection("brands").add(data); return res.json({ success: true, id: ref.id }); }
        else if (action === "UPDATE") { data.updatedAt = admin.firestore.FieldValue.serverTimestamp(); await db.collection("brands").doc(id).update(data); return res.json({ success: true }); }
        else if (action === "DELETE") { await db.collection("brands").doc(id).delete(); return res.json({ success: true }); }
        return sendError(res, 400, "invalid-argument", "Invalid action.");
    } catch (err) { console.error("[products/manage-brand]", err); return sendError(res, 500, "internal", "Failed."); }
});

module.exports = router;
