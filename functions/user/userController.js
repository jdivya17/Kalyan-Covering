"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { admin, db } = require("../lib/admin");
const { verifyAdmin, verifyStaff } = require("../utils/auth");
const { logAuditEvent } = require("../utils/audit");
const { getAuditLogs } = require("../analytics/analyticsController");

async function logAudit(request, action, targetCollection, targetId, before, after) {
    await logAuditEvent({
        action,
        userId: request.auth ? request.auth.uid : 'system',
        userEmail: request.auth && request.auth.token ? request.auth.token.email : 'system',
        details: { targetCollection, targetId, before, after }
    });
}

const setUserRole = onCall(async (request) => {
  verifyAdmin(request);
  const { targetUid, role } = request.data;
  if (!targetUid || !role) {
    throw new HttpsError("invalid-argument", "targetUid and role are required.");
  }
  const allowedRoles = ["admin", "staff", "manager", "user"];
  if (!allowedRoles.includes(role)) {
    throw new HttpsError("invalid-argument", "Invalid role specified.");
  }

  await admin.auth().setCustomUserClaims(targetUid, { role });
  await db.collection("users").doc(targetUid).set({ role, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

  await logAudit(request, "SET_USER_ROLE", "users", targetUid, null, { role });

  return { success: true, message: `User role updated to ${role}.` };
});

const updateAccountStatus = onCall(async (request) => {
    verifyAdmin(request);
    const { userId, status, reason } = request.data;
    if (!userId || !['active', 'suspended', 'disabled'].includes(status)) {
        throw new HttpsError("invalid-argument", "Invalid account status.");
    }

    await db.collection("users").doc(userId).update({
        status,
        statusReason: reason || null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    if (status === 'disabled' || status === 'suspended') {
        try {
            await admin.auth().updateUser(userId, { disabled: true });
        } catch (e) {
            console.error('Failed to disable Auth user:', e);
        }
    } else if (status === 'active') {
        try {
            await admin.auth().updateUser(userId, { disabled: false });
        } catch (e) {
            console.error('Failed to enable Auth user:', e);
        }
    }

    await logAudit(request, 'UPDATE_ACCOUNT_STATUS', 'users', userId, null, { status, reason });
    return { success: true };
});

const manageCustomer = onCall(async (request) => {
    verifyStaff(request);
    const { action, userId, data } = request.data;
    if (!action || !userId) {
        throw new HttpsError("invalid-argument", "action and userId are required.");
    }

    if (action === 'update') {
        await db.collection("users").doc(userId).update({
            ...data,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        await logAudit(request, 'MANAGE_CUSTOMER_UPDATE', 'users', userId, null, data);
        return { success: true };
    }

    throw new HttpsError("invalid-argument", "Unsupported customer management action.");
});

const updateSettings = onCall(async (request) => {
    verifyAdmin(request);
    const { key, value } = request.data;
    if (!key) {
        throw new HttpsError("invalid-argument", "Settings key is required.");
    }

    await db.collection("settings").doc(key).set({
        value,
        updatedBy: request.auth.uid,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    await logAudit(request, 'UPDATE_SETTINGS', 'settings', key, null, { value });
    return { success: true };
});

module.exports = {
  setUserRole,
  updateAccountStatus,
  manageCustomer,
  updateSettings,
  getAuditLogs
};
