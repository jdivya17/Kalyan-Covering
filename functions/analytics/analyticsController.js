"use strict";

const { onCall } = require("firebase-functions/v2/https");
const { admin, db } = require("../lib/admin");
const { verifyAdmin } = require("../utils/auth");

const getAuditLogs = onCall(async (request) => {
    verifyAdmin(request);
    const limitNum = request.data && request.data.limit ? Math.min(request.data.limit, 100) : 50;

    const snap = await db.collection("audit_logs")
        .orderBy("timestamp", "desc")
        .limit(limitNum)
        .get();

    const logs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    return { success: true, logs };
});

const logAuditEvent = onCall(async (request) => {
    verifyAdmin(request);
    const { action, collection, documentId, newValue, oldValue } = request.data || {};
    const rawReq = request.rawRequest;
    const ip = (rawReq && rawReq.headers && rawReq.headers["x-forwarded-for"])
        ? rawReq.headers["x-forwarded-for"].split(",")[0].trim()
        : (rawReq && rawReq.socket ? rawReq.socket.remoteAddress : "Unknown");
    const adminId = request.auth ? (request.auth.token.email || request.auth.uid) : "Admin";
    const device = (rawReq && rawReq.headers && rawReq.headers["user-agent"]) ? rawReq.headers["user-agent"] : "Web Browser";

    await db.collection("audit_logs").add({
        adminId,
        action: action || "UPDATE",
        collection: collection || "products",
        documentId: documentId || null,
        oldValue: oldValue || null,
        newValue: newValue || null,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        ip,
        device
    });

    return { success: true };
});

module.exports = {
    getAuditLogs,
    logAuditEvent
};

