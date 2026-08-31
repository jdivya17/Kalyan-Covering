"use strict";

const { admin, db } = require("../lib/admin");

/**
 * Write a structured audit log entry to Firestore.
 * Failures are swallowed — never crash the parent call.
 */
async function logAudit(req, action, collectionName, documentId, oldValue, newValue) {
    try {
        await db.collection("audit_logs").add({
            adminId: req.user ? req.user.uid : "Unknown",
            action,
            collection: collectionName,
            documentId: documentId || null,
            oldValue: oldValue || null,
            newValue: newValue || null,
            ip: req.ip || "Unknown",
            device: req.headers["user-agent"] || "Unknown",
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
    } catch (err) {
        console.error("[AUDIT LOG FAILED]", action, collectionName, documentId, err.message);
    }
}

/**
 * Send a structured error JSON response.
 */
function sendError(res, status, code, message) {
    return res.status(status).json({ error: code, message });
}

module.exports = { logAudit, sendError };
