"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const crypto = require("crypto");
const { admin, db } = require("../lib/admin");
const { verifyStaff } = require("../utils/auth");
const { logAuditEvent } = require("../utils/audit");
const {
    generateInvoice,
    emailInvoice,
    getMyInvoices,
    getInvoices
} = require("../invoice/invoiceController");
const {
    onOrderStatusNotification
} = require("../notification/notificationController");

async function logAudit(request, action, targetCollection, targetId, before, after) {
    await logAuditEvent({
        action,
        userId: request.auth ? request.auth.uid : 'system',
        userEmail: request.auth && request.auth.token ? request.auth.token.email : 'system',
        details: { targetCollection, targetId, before, after }
    });
}

/**
 * Validates a coupon against all abuse-prevention rules and returns the
 * applicable discount amount. Throws HttpsError with a user-facing message
 * on any violation so the client can surface the exact reason.
 *
 * @param {object} promoData   - Firestore coupon document data
 * @param {number} subtotal    - Cart subtotal in INR (before discount)
 * @param {string} customerId  - Firebase UID of the ordering customer
 * @returns {number} discount  - Rupee discount to apply
 */
async function validateAndApplyCoupon(promoData, subtotal, customerId) {
    const now = new Date();

    // 1. Expiry check
    if (promoData.expiryDate && promoData.expiryDate.toDate() < now) {
        throw new HttpsError('failed-precondition', 'This coupon has expired.');
    }

    // 2. Minimum order value check
    if (promoData.minOrderValue != null && subtotal < promoData.minOrderValue) {
        throw new HttpsError('failed-precondition',
            `A minimum order value of \u20b9${promoData.minOrderValue} is required to use this coupon.`);
    }

    // 3. Total usage limit check (read usedCount from the same doc snapshot)
    if (promoData.usageLimit != null && (promoData.usedCount || 0) >= promoData.usageLimit) {
        throw new HttpsError('failed-precondition', 'This coupon has reached its usage limit.');
    }

    // 4. Per-user usage limit check
    //    Default perUserLimit = 1 (one-time use per customer).
    //    Set perUserLimit = 0 on the coupon doc to make it fully reusable.
    const perUserLimit = promoData.perUserLimit ?? 1;
    if (perUserLimit > 0 && customerId) {
        const userOrdersSnap = await db.collection('orders')
            .where('customerId', '==', customerId)
            .where('couponCode', '==', promoData.code)
            .get();
        // Exclude cancelled orders — filter client-side to avoid composite index requirement
        const validUsageCount = userOrdersSnap.docs.filter(
            d => d.data().orderStatus !== 'cancelled'
        ).length;
        if (validUsageCount >= perUserLimit) {
            throw new HttpsError('failed-precondition',
                'You have already used this coupon the maximum number of times.');
        }
    }

    // 5. Compute discount
    let discount = 0;
    if (promoData.discountType === 'percentage') {
        discount = Math.round(subtotal * ((promoData.discountValue || 0) / 100));
        discount = Math.min(discount, subtotal);
    } else {
        discount = Math.min(promoData.discountValue || 0, subtotal);
    }

    return discount;
}

async function calculateOrderTotals(items, promoCode, isCOD = false, customerId = null) {
    for (const item of items) {
        if (!item.id) throw new HttpsError('invalid-argument', 'Each cart item must have an id.');
        if (!Number.isInteger(item.qty) || item.qty < 1 || item.qty > 100) {
            throw new HttpsError('invalid-argument', `Invalid quantity for item ${item.id}.`);
        }
    }

    const productRefs = items.map(item => db.collection("products").doc(item.id));
    const productSnaps = await db.getAll(...productRefs);

    let subtotal = 0;
    const trustedItems = [];

    productSnaps.forEach((productSnap, index) => {
        const item = items[index];
        if (!productSnap.exists) {
            throw new HttpsError("not-found", `Product ${item.id} not found.`);
        }
        const productData = productSnap.data();
        if (productData.status === 'out_of_stock' || productData.status === 'archived') {
            throw new HttpsError('failed-precondition', `Product "${productData.productName || productData.name}" is unavailable.`);
        }
        if (item.qty > (productData.stock || 0)) {
            throw new HttpsError('failed-precondition', `Insufficient stock for product "${productData.productName || productData.name}".`);
        }

        const price = productData.price || 0;
        subtotal += (price * item.qty);
        trustedItems.push({ id: item.id, name: productData.productName || productData.name || item.id, price, qty: item.qty, sku: productData.sku || null });
    });

    let discount = 0;
    let couponDocRef = null; // kept for atomic usedCount increment in the order transaction
    if (promoCode) {
        const promoSnap = await db.collection("coupons")
            .where("code", "==", promoCode.trim().toUpperCase())
            .where("status", "==", 'active')
            .limit(1).get();
        if (promoSnap.empty) {
            throw new HttpsError('not-found', 'Coupon code not found or is no longer active.');
        }
        couponDocRef = promoSnap.docs[0].ref;
        const promoData = promoSnap.docs[0].data();
        discount = await validateAndApplyCoupon(promoData, subtotal, customerId);
    }

    const gst = Math.round((subtotal - discount) * 0.12);
    const deliveryCharge = subtotal > 999 ? 0 : 99;
    const codFee = isCOD ? 50 : 0;
    const totalAmount = (subtotal - discount) + gst + deliveryCharge + codFee;

    return { trustedItems, subtotal, discount, gst, deliveryCharge, codFee, totalAmount, couponDocRef };
}

const createCODOrder = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "User must be logged in to place an order.");
    }

    const { items, promoCode, shippingAddress, notes } = request.data;
    if (!items || !Array.isArray(items) || items.length === 0) {
        throw new HttpsError("invalid-argument", "Cart cannot be empty.");
    }
    if (!shippingAddress) {
        throw new HttpsError("invalid-argument", "Shipping address is required.");
    }

    try {
        const { trustedItems, subtotal, discount, gst, deliveryCharge, codFee, totalAmount, couponDocRef } =
            await calculateOrderTotals(items, promoCode, true, request.auth.uid);
        const orderNumber = `ORD-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        const now_ts = admin.firestore.FieldValue.serverTimestamp();

        let docRefId = null;
        await db.runTransaction(async (transaction) => {
            for (const item of trustedItems) {
                const productRef = db.collection("products").doc(item.id);
                const productDoc = await transaction.get(productRef);
                if (!productDoc.exists) throw new HttpsError("not-found", `Product ${item.id} not found.`);
                const pd = productDoc.data();
                const currentStock = typeof pd.stock === "number" ? pd.stock : (parseInt(pd.stock, 10) || 0);
                if (currentStock < item.qty) {
                    throw new HttpsError("failed-precondition", `Insufficient stock for "${pd.productName || pd.name || item.id}".`);
                }
                const newStock = Math.max(0, currentStock - item.qty);
                transaction.update(productRef, {
                    stock: newStock,
                    ...(newStock <= 0 ? { status: "out_of_stock" } : {}),
                    updatedAt: now_ts
                });
            }

            const codOrderRef = db.collection('orders').doc();
            docRefId = codOrderRef.id;
            const codOrder = {
                orderNumber,
                customerId: request.auth.uid,
                items: trustedItems,
                shippingAddress,
                orderStatus: 'pending',
                paymentStatus: 'pending',
                shippingStatus: 'not_shipped',
                payment: { method: 'cod', amount: totalAmount, currency: 'INR', paidAt: null },
                shippingDetails: { carrier: null, trackingNumber: null, shippedAt: null, deliveredAt: null },
                subtotal, discount, gst, deliveryCharge, codFee, totalAmount, couponCode: promoCode || null,
                statusHistory: [{ status: 'pending', changedAt: now_ts, changedBy: 'system', note: 'COD Order placed.' }],
                notes: notes || null,
                createdAt: now_ts,
                updatedAt: now_ts
            };
            transaction.set(codOrderRef, codOrder);

            // Atomically increment usedCount on the coupon so concurrent orders
            // don't race past the usage limit checked above.
            if (couponDocRef) {
                transaction.update(couponDocRef, {
                    usedCount: admin.firestore.FieldValue.increment(1)
                });
            }
        });

        await logAudit(request, 'CREATE_COD_ORDER', 'orders', docRefId, null, { orderNumber, totalAmount });

        return { success: true, orderId: docRefId, orderNumber };

    } catch (error) {
        console.error("Error creating COD order:", error);
        if (error instanceof HttpsError) throw error;
        throw new HttpsError("internal", "Unable to place COD order.");
    }
});

const updateOrderStatus = onCall(async (request) => {
    verifyStaff(request);
    const { orderId, orderStatus, trackingNumber, carrier, note } = request.data;

    if (!orderId || !orderStatus) {
        throw new HttpsError('invalid-argument', 'orderId and orderStatus are required.');
    }

    const orderRef = db.collection('orders').doc(orderId);
    const now_ts = admin.firestore.FieldValue.serverTimestamp();

    let autoTracking = trackingNumber || null;
    let autoCarrier = carrier || null;

    if (orderStatus === 'shipped' && (!trackingNumber || !carrier)) {
        try {
            const { createShipmentForOrder } = require("../shipping/shippingService");
            const shipmentRes = await createShipmentForOrder(orderId, "");
            if (shipmentRes && shipmentRes.awbCode) {
                autoTracking = shipmentRes.awbCode;
                autoCarrier = shipmentRes.courierName || "Shiprocket";
            }
        } catch (shipErr) {
            console.warn("Auto Shiprocket shipment creation warning:", shipErr.message);
        }
    }

    await db.runTransaction(async (transaction) => {
        const snap = await transaction.get(orderRef);
        if (!snap.exists) throw new HttpsError('not-found', 'Order not found.');

        const updates = {
            orderStatus,
            updatedAt: now_ts,
            statusHistory: admin.firestore.FieldValue.arrayUnion({
                status: orderStatus, changedAt: now_ts, changedBy: request.auth.uid, note: note || `Status changed to ${orderStatus}`
            })
        };

        if (autoTracking) updates['shippingDetails.trackingNumber'] = autoTracking;
        if (autoCarrier) updates['shippingDetails.carrier'] = autoCarrier;
        if (orderStatus === 'shipped') updates['shippingDetails.shippedAt'] = now_ts;

        transaction.update(orderRef, updates);
    });

    await logAudit(request, 'UPDATE_ORDER_STATUS', 'orders', orderId, null, { orderStatus, trackingNumber: autoTracking, carrier: autoCarrier });
    return { success: true, trackingNumber: autoTracking, carrier: autoCarrier };
});

const cancelOrder = onCall(async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in.');
    const { orderId, reason } = request.data;
    if (!orderId) throw new HttpsError('invalid-argument', 'orderId is required.');

    const orderRef = db.collection('orders').doc(orderId);
    const now_ts = admin.firestore.FieldValue.serverTimestamp();

    await db.runTransaction(async (transaction) => {
        const snap = await transaction.get(orderRef);
        if (!snap.exists) throw new HttpsError('not-found', 'Order not found.');

        const order = snap.data();
        const isAdmin = ['admin', 'owner', 'staff'].includes(request.auth.token.role);
        if (!isAdmin && order.customerId !== request.auth.uid) {
            throw new HttpsError('permission-denied', 'You can only cancel your own orders.');
        }

        if (['shipped', 'delivered', 'cancelled'].includes(order.orderStatus)) {
            throw new HttpsError('failed-precondition', `Order cannot be cancelled in status '${order.orderStatus}'.`);
        }

        // Restore product stock
        if (Array.isArray(order.items)) {
            for (const item of order.items) {
                if (!item.id || !item.qty) continue;
                const pRef = db.collection("products").doc(item.id);
                const pSnap = await transaction.get(pRef);
                if (pSnap.exists) {
                    const pd = pSnap.data();
                    const curStock = typeof pd.stock === "number" ? pd.stock : (parseInt(pd.stock, 10) || 0);
                    const restoredStock = curStock + item.qty;
                    transaction.update(pRef, {
                        stock: restoredStock,
                        status: restoredStock > 0 ? (pd.status === "out_of_stock" ? "active" : pd.status) : pd.status,
                        updatedAt: now_ts
                    });
                }
            }
        }

        transaction.update(orderRef, {
            orderStatus: 'cancelled',
            cancelReason: reason || 'Cancelled by user',
            updatedAt: now_ts,
            statusHistory: admin.firestore.FieldValue.arrayUnion({
                status: 'cancelled', changedAt: now_ts, changedBy: request.auth.uid, note: reason || 'Order cancelled'
            })
        });
    });

    await logAudit(request, 'CANCEL_ORDER', 'orders', orderId, null, { reason });
    return { success: true };
});

const initiateReturn = onCall(async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in.');
    const { orderId, reason, items } = request.data;
    if (!orderId || !reason) throw new HttpsError('invalid-argument', 'orderId and reason are required.');

    const orderRef = db.collection('orders').doc(orderId);
    const snap = await orderRef.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Order not found.');

    const order = snap.data();
    if (order.customerId !== request.auth.uid) {
        throw new HttpsError('permission-denied', 'You can only request returns for your own orders.');
    }
    if (order.orderStatus !== 'delivered') {
        throw new HttpsError('failed-precondition', 'Returns can only be requested for delivered orders.');
    }

    const returnDoc = {
        orderId,
        customerId: request.auth.uid,
        reason: String(reason).trim(),
        items: items || order.items,
        status: 'requested',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    const returnRef = await db.collection('returns').add(returnDoc);
    await orderRef.update({
        orderStatus: 'return_requested',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return { success: true, returnId: returnRef.id };
});

const onOrderCompleted = onDocumentWritten('orders/{orderId}', async (event) => {
    if (!event.data.after.exists) return;
    const orderData = event.data.after.data();
    if (orderData.orderStatus === 'delivered' && event.data.before.data()?.orderStatus !== 'delivered') {
        console.log(`Order ${event.params.orderId} delivered.`);
    }
});

module.exports = {
    createCODOrder,
    updateOrderStatus,
    cancelOrder,
    initiateReturn,
    generateInvoice,
    emailInvoice,
    getMyInvoices,
    getInvoices,
    onOrderCompleted,
    onOrderStatusNotification
};
