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

module.exports = router;
