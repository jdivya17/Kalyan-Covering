"use strict";

const { onCall } = require("firebase-functions/v2/https");
const { db } = require("../lib/admin");
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

module.exports = {
    getAuditLogs
};
