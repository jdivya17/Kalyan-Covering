"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { admin, db } = require("../lib/admin");
const { verifyStaff, verifyAdmin } = require("../utils/auth");
const { logAuditEvent } = require("../utils/audit");
const { adjustStock } = require("../inventory/inventoryController");

async function logAudit(request, action, targetCollection, targetId, before, after) {
    await logAuditEvent({
        action,
        userId: request.auth ? request.auth.uid : 'system',
        userEmail: request.auth && request.auth.token ? request.auth.token.email : 'system',
        details: { targetCollection, targetId, before, after }
    });
}

const createProduct = onCall(async (request) => {
  verifyStaff(request);
  const productData = request.data;
  if (!productData || (!productData.productName && !productData.name) || !productData.price) {
    throw new HttpsError("invalid-argument", "productName/name and price are required.");
  }

  const docRef = await db.collection("products").add({
    ...productData,
    status: productData.status || "active",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  await logAudit(request, "CREATE_PRODUCT", "products", docRef.id, null, { productName: productData.productName || productData.name });

  return { success: true, id: docRef.id };
});

const updateProduct = onCall(async (request) => {
  verifyStaff(request);
  const { productId, ...updates } = request.data;
  if (!productId) {
    throw new HttpsError("invalid-argument", "productId is required.");
  }

  await db.collection("products").doc(productId).update({
    ...updates,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  await logAudit(request, "UPDATE_PRODUCT", "products", productId, null, updates);

  return { success: true };
});

const deleteProduct = onCall(async (request) => {
  verifyAdmin(request);
  const { productId } = request.data;
  if (!productId) {
    throw new HttpsError("invalid-argument", "productId is required.");
  }

  await db.collection("products").doc(productId).update({
    status: 'archived',
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  await logAudit(request, "DELETE_PRODUCT", "products", productId, null, { status: 'archived' });

  return { success: true };
});

const manageCategory = onCall(async (request) => {
  verifyStaff(request);
  const { action, categoryData, categoryId } = request.data;

  if (action === 'create') {
    const ref = await db.collection("categories").add({
      ...categoryData,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return { success: true, id: ref.id };
  }
  if (action === 'delete' && categoryId) {
    await db.collection("categories").doc(categoryId).delete();
    return { success: true };
  }

  throw new HttpsError("invalid-argument", "Invalid category action.");
});

const manageBrand = onCall(async (request) => {
  verifyStaff(request);
  const { action, brandData, brandId } = request.data;

  if (action === 'create') {
    const ref = await db.collection("brands").add({
      ...brandData,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return { success: true, id: ref.id };
  }
  if (action === 'delete' && brandId) {
    await db.collection("brands").doc(brandId).delete();
    return { success: true };
  }

  throw new HttpsError("invalid-argument", "Invalid brand action.");
});

const createCoupon = onCall(async (request) => {
  verifyAdmin(request);
  const { code, discountType, discountValue, expiryDate, minPurchase } = request.data;

  if (!code || !discountType || !discountValue) {
    throw new HttpsError("invalid-argument", "code, discountType, and discountValue are required.");
  }

  const couponDoc = {
    code: String(code).trim().toUpperCase(),
    discountType,
    discountValue: Number(discountValue),
    expiryDate: expiryDate || null,
    minPurchase: Number(minPurchase) || 0,
    status: 'active',
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  };

  const ref = await db.collection("coupons").add(couponDoc);
  await logAudit(request, "CREATE_COUPON", "coupons", ref.id, null, couponDoc);

  return { success: true, id: ref.id };
});

const updateCoupon = onCall(async (request) => {
  verifyAdmin(request);
  const { couponId, ...updates } = request.data;
  if (!couponId) {
    throw new HttpsError("invalid-argument", "couponId is required.");
  }

  await db.collection("coupons").doc(couponId).update({
    ...updates,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  await logAudit(request, "UPDATE_COUPON", "coupons", couponId, null, updates);
  return { success: true };
});

const deleteCoupon = onCall(async (request) => {
  verifyAdmin(request);
  const { couponId } = request.data;
  if (!couponId) {
    throw new HttpsError("invalid-argument", "couponId is required.");
  }

  await db.collection("coupons").doc(couponId).delete();
  await logAudit(request, "DELETE_COUPON", "coupons", couponId, null, {});
  return { success: true };
});

const validateCoupon = onCall(async (request) => {
  // Accept both field names: 'cartAmount' (legacy) and 'orderTotal' (checkout page)
  const { code } = request.data;
  const cartAmount = request.data.cartAmount ?? request.data.orderTotal ?? 0;
  if (!code) {
    throw new HttpsError("invalid-argument", "Coupon code is required.");
  }

  const snap = await db.collection("coupons")
    .where("code", "==", String(code).trim().toUpperCase())
    .where("status", "==", "active")
    .limit(1)
    .get();

  if (snap.empty) {
    return { valid: false, message: "Invalid or expired coupon code." };
  }

  const coupon = snap.docs[0].data();

  // Expiry check
  if (coupon.expiryDate && new Date(coupon.expiryDate) < new Date()) {
    return { valid: false, message: "This coupon has expired." };
  }

  // Minimum purchase check
  if (coupon.minPurchase && cartAmount < coupon.minPurchase) {
    return {
      valid: false,
      message: `Minimum cart value of ₹${coupon.minPurchase} is required for this coupon.`
    };
  }

  // Compute actual discount amount
  let discountAmount = 0;
  if (coupon.discountType === "percentage") {
    discountAmount = Math.min(
      Math.round(cartAmount * ((coupon.discountValue || 0) / 100)),
      cartAmount
    );
  } else {
    discountAmount = Math.min(coupon.discountValue || 0, cartAmount);
  }

  return {
    valid: true,
    success: true,
    code: coupon.code,
    discountType: coupon.discountType,
    discountValue: coupon.discountValue,
    discountAmount,
    minPurchase: coupon.minPurchase || 0
  };
});

module.exports = {
  createProduct,
  updateProduct,
  deleteProduct,
  adjustStock,
  manageCategory,
  manageBrand,
  createCoupon,
  updateCoupon,
  deleteCoupon,
  validateCoupon
};
