"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { admin, db } = require("../lib/admin");
const { verifyStaff } = require("../utils/auth");
const { logAuditEvent } = require("../utils/audit");

async function logAudit(request, action, targetCollection, targetId, before, after) {
    await logAuditEvent({
        action,
        userId: request.auth ? request.auth.uid : 'system',
        userEmail: request.auth && request.auth.token ? request.auth.token.email : 'system',
        details: { targetCollection, targetId, before, after }
    });
}

const adjustStock = onCall(async (request) => {
  verifyStaff(request);
  const { productId, quantityChange, reason } = request.data;
  if (!productId || typeof quantityChange !== 'number') {
    throw new HttpsError("invalid-argument", "productId and numerical quantityChange are required.");
  }

  const productRef = db.collection("products").doc(productId);
  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(productRef);
    if (!snap.exists) throw new HttpsError("not-found", "Product not found.");

    const currentStock = snap.data().stock || 0;
    const newStock = Math.max(0, currentStock + quantityChange);
    const updates = {
      stock: newStock,
      status: newStock === 0 ? 'out_of_stock' : 'active',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    transaction.update(productRef, updates);
  });

  await logAudit(request, "ADJUST_STOCK", "products", productId, null, { quantityChange, reason });

  return { success: true };
});

module.exports = {
  adjustStock
};
