"use strict";

const { admin, db } = require("../lib/admin");

async function logAuditEvent({ action, userId, userEmail, details = {}, ip = null }) {
  try {
    await db.collection("audit_logs").add({
      action,
      userId: userId || "system",
      userEmail: userEmail || "system",
      details,
      ip: ip || null,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (err) {
    console.error("Failed to log audit event:", err);
  }
}

module.exports = { logAuditEvent };
