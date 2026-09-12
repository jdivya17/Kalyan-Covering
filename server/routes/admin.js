"use strict";
const express = require("express");
const { admin, db } = require("../lib/admin");
const { logAudit, sendError } = require("../lib/utils");
const { authMiddleware, requireAdmin, requireOwnerOrManager } = require("../middleware/auth");

const router = express.Router();

// POST /api/admin/update-settings
router.post("/update-settings", authMiddleware, requireOwnerOrManager, async (req, res) => {
    try {
        const { section, data } = req.body;
        if (!section || !data) return sendError(res, 400, "invalid-argument", "Section and data are required.");

        await db.collection("settings").doc(section).set(data, { merge: true });
        await logAudit(req, "UPDATE_SETTINGS", "settings", section, null, data);

        return res.json({ success: true });
    } catch (err) {
        console.error("[admin/update-settings]", err);
        return sendError(res, 500, "internal", "Failed to update settings.");
    }
});

// POST /api/admin/get-audit-logs
router.post("/get-audit-logs", authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { limit = 50, startAfter } = req.body;
        let query = db.collection("audit_logs").orderBy("timestamp", "desc").limit(limit);

        if (startAfter) {
            const docSnap = await db.collection("audit_logs").doc(startAfter).get();
            if (docSnap.exists) query = query.startAfter(docSnap);
        }

        const snap = await query.get();
        const logs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        return res.json({ logs });
    } catch (err) {
        console.error("[admin/get-audit-logs]", err);
        return sendError(res, 500, "internal", "Failed to fetch audit logs.");
    }
});

// ── NEW: POST /api/admin/set-user-role (Owner only) ─────────────────────────
// Migrated from the old Cloud Function `setUserRole`. This is the ONLY
// place (besides the CLI script scripts/setRole.js used to create the very
// first owner) that should ever call setCustomUserClaims. Restricted to
// owner/manager via requireOwnerOrManager, and role list is standardized
// to owner/manager/staff to match authMiddleware, firestore.rules and
// scripts/setRole.js (the old userController.js accepted a different,
// mismatched list — do not reuse that list).
router.post("/set-user-role", authMiddleware, requireOwnerOrManager, async (req, res) => {
    try {
        const { targetUid, role } = req.body;
        const allowedRoles = ["owner", "manager", "staff"];
        if (!targetUid || !role) return sendError(res, 400, "invalid-argument", "targetUid and role are required.");
        if (!allowedRoles.includes(role)) return sendError(res, 400, "invalid-argument", `role must be one of: ${allowedRoles.join(", ")}`);
        // Only an owner may grant the owner role
        if (role === "owner" && req.user.role !== "owner") {
            return sendError(res, 403, "permission-denied", "Only an existing owner can grant the owner role.");
        }

        await admin.auth().setCustomUserClaims(targetUid, { role });
        await db.collection("users").doc(targetUid).set(
            { role, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
            { merge: true }
        );

        await logAudit(req, "SET_USER_ROLE", "users", targetUid, null, { role });
        return res.json({ success: true, message: `User role updated to ${role}.` });
    } catch (err) {
        console.error("[admin/set-user-role]", err);
        return sendError(res, 500, "internal", "Failed to update user role.");
    }
});

// ── NEW: POST /api/admin/update-account-status (Admin only) ─────────────────
router.post("/update-account-status", authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { userId, status, reason } = req.body;
        if (!userId || !["active", "suspended", "disabled"].includes(status)) {
            return sendError(res, 400, "invalid-argument", "Invalid account status.");
        }

        const now = admin.firestore.FieldValue.serverTimestamp();
        await db.collection("users").doc(userId).update({ status, statusReason: reason || null, updatedAt: now });

        try {
            await admin.auth().updateUser(userId, { disabled: status !== "active" });
        } catch (e) {
            console.error("[admin/update-account-status] Auth user update failed:", e.message);
        }

        await logAudit(req, "UPDATE_ACCOUNT_STATUS", "users", userId, null, { status, reason });
        return res.json({ success: true });
    } catch (err) {
        console.error("[admin/update-account-status]", err);
        return sendError(res, 500, "internal", "Failed to update account status.");
    }
});

module.exports = router;
