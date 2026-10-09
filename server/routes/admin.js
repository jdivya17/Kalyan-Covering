"use strict";
const express = require("express");
const { admin, db } = require("../lib/admin");
const { logAudit, sendError } = require("../lib/utils");
const { authMiddleware, requireAdmin, requireOwnerOrManager } = require("../middleware/auth");

const router = express.Router();

const ROLE_RANK = { staff: 1, manager: 2, admin: 3, owner: 4 };
const rankOf = (r) => ROLE_RANK[r] || 0;

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

// POST /api/admin/log-audit
router.post("/log-audit", authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { action, collection: col, documentId, oldValue, newValue } = req.body;
        await logAudit(req, action || "UPDATE", col || "products", documentId || null, oldValue || null, newValue || null);
        return res.json({ success: true });
    } catch (err) {
        console.error("[admin/log-audit]", err);
        return sendError(res, 500, "internal", "Failed to log audit event.");
    }
});

// POST /api/admin/set-user-role (Owner or Manager with rank constraints)
router.post("/set-user-role", authMiddleware, requireOwnerOrManager, async (req, res) => {
    try {
        const { targetUid, role } = req.body;
        const allowedRoles = ["owner", "manager", "staff"];
        if (!targetUid || !role) return sendError(res, 400, "invalid-argument", "targetUid and role are required.");
        if (!allowedRoles.includes(role)) return sendError(res, 400, "invalid-argument", `role must be one of: ${allowedRoles.join(", ")}`);
        if (targetUid === req.user.uid) return sendError(res, 403, "permission-denied", "You cannot change your own role.");

        const callerRole = req.user.role;
        const target = await admin.auth().getUser(targetUid);
        const targetRole = (target.customClaims && target.customClaims.role) || null;

        if (callerRole !== "owner") {
            // managers: can only manage staff / plain customers, and can only grant "staff"
            if (rankOf(targetRole) >= rankOf(callerRole)) {
                return sendError(res, 403, "permission-denied", "You cannot modify a user with an equal or higher role.");
            }
            if (role !== "staff") {
                return sendError(res, 403, "permission-denied", "Managers can only assign the staff role.");
            }
        }

        await admin.auth().setCustomUserClaims(targetUid, { ...(target.customClaims || {}), role });
        await admin.auth().revokeRefreshTokens(targetUid); // force new token with new claims
        await db.collection("users").doc(targetUid).set(
            { role, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
            { merge: true }
        );

        await logAudit(req, "SET_USER_ROLE", "users", targetUid, { role: targetRole }, { role });
        return res.json({ success: true, message: `User role updated to ${role}.` });
    } catch (err) {
        console.error("[admin/set-user-role]", err);
        return sendError(res, 500, "internal", "Failed to update user role.");
    }
});

// POST /api/admin/update-account-status (Admin only with rank constraints)
router.post("/update-account-status", authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { userId, status, reason } = req.body;
        if (!userId || !["active", "suspended", "disabled"].includes(status)) {
            return sendError(res, 400, "invalid-argument", "Invalid account status.");
        }
        if (userId === req.user.uid) return sendError(res, 403, "permission-denied", "You cannot change your own account status.");

        const target = await admin.auth().getUser(userId);
        const targetRole = (target.customClaims && target.customClaims.role) || null;
        if (targetRole && rankOf(targetRole) >= rankOf(req.user.role)) {
            return sendError(res, 403, "permission-denied", "You cannot change the status of a user with an equal or higher role.");
        }

        const now = admin.firestore.FieldValue.serverTimestamp();
        await db.collection("users").doc(userId).update({ status, statusReason: reason || null, updatedAt: now });
        await admin.auth().updateUser(userId, { disabled: status !== "active" });
        if (status !== "active") await admin.auth().revokeRefreshTokens(userId);

        await logAudit(req, "UPDATE_ACCOUNT_STATUS", "users", userId, null, { status, reason });
        return res.json({ success: true });
    } catch (err) {
        console.error("[admin/update-account-status]", err);
        return sendError(res, 500, "internal", "Failed to update account status.");
    }
});

module.exports = router;
