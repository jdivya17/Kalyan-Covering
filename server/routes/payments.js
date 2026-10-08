"use strict";

const express = require("express");
const crypto = require("crypto");
const Razorpay = require("razorpay");
const { admin, db } = require("../lib/admin");
const { logAudit, sendError } = require("../lib/utils");
const { authMiddleware, requireOwnerOrManager } = require("../middleware/auth");

const router = express.Router();

// ── Razorpay client (reads env vars at request time) ──────────────────────────
function getRazorpayClient() {
    return new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function validateAddress(address) {
    if (!address || typeof address !== "object") throw { code: 400, message: "Shipping address must be an object." };
    if (!address.fname && address.name) {
        const parts = address.name.trim().split(' ');
        address.fname = parts[0] || address.name;
        address.lname = parts.slice(1).join(' ') || address.fname;
    }
    if (!address.address && address.line) {
        address.address = address.line;
    }
    const req = (val, field, max) => {
        if (typeof val !== "string" || !val.trim()) throw { code: 400, message: `${field} is required.` };
        if (val.length > max) throw { code: 400, message: `${field} exceeds max length of ${max}.` };
    };
    req(address.fname || "", "First Name", 50);
    req(address.lname || "", "Last Name", 50);
    req(address.address || "", "Street Address", 255);
    req(address.city || "", "City", 100);
    req(address.state || "", "State", 100);
    if (!/^\d{10}$/.test(address.phone || "")) throw { code: 400, message: "Phone number must be exactly 10 digits." };
    if (!/^\d{6}$/.test(address.pin || "")) throw { code: 400, message: "PIN code must be exactly 6 digits." };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address.email || "")) throw { code: 400, message: "Invalid email address format." };
}

async function calculateOrderTotals(items, promoCode, isCOD = false) {
    let subtotal = 0;
    const trustedItems = [];

    for (const item of items) {
        if (!item.id) throw { code: 400, message: "Each cart item must have an id." };
        if (!Number.isInteger(item.qty) || item.qty < 1 || item.qty > 100) throw { code: 400, message: `Invalid quantity for item ${item.id}.` };
        const snap = await db.collection("products").doc(item.id).get();
        if (!snap.exists) throw { code: 404, message: `Product ${item.id} not found.` };
        const p = snap.data();
        if (p.status === "out_of_stock" || p.status === "archived") throw { code: 400, message: `Product "${p.productName || p.name}" is no longer available.` };
        if (item.qty > (p.stock || 0)) throw { code: 400, message: `Insufficient stock for "${p.productName || p.name}".` };
        const price = p.price || 0;
        subtotal += price * item.qty;
        trustedItems.push({ id: item.id, name: p.productName || p.name || item.id, price, qty: item.qty, sku: p.sku || null });
    }

    let discount = 0;
    if (promoCode) {
        const promoSnap = await db.collection("coupons").where("code", "==", promoCode.trim().toUpperCase()).where("status", "==", "active").limit(1).get();
        if (!promoSnap.empty) {
            const pd = promoSnap.docs[0].data();
            const isExpired = pd.expiryDate && new Date(pd.expiryDate) < new Date();
            const meetsMin = !pd.minPurchase || subtotal >= pd.minPurchase;
            if (!isExpired && meetsMin) {
                discount = pd.discountType === "percentage"
                    ? Math.min(Math.round(subtotal * (pd.discountValue / 100)), subtotal)
                    : Math.min(pd.discountValue || 0, subtotal);
            }
        }
    }

    const gst = Math.round((subtotal - discount) * 0.12);
    const deliveryCharge = subtotal > 999 ? 0 : 99;
    const codFee = isCOD ? 50 : 0;
    const totalAmount = (subtotal - discount) + gst + deliveryCharge + codFee;
    return { trustedItems, subtotal, discount, gst, deliveryCharge, codFee, totalAmount };
}

async function fulfillOrder(orderId, paymentId, paymentAmount, paymentCurrency, transaction) {
    const orderRef = db.collection("orders").doc(orderId);
    const orderDoc = await transaction.get(orderRef);
    if (!orderDoc.exists) {
        console.warn("[fulfillOrder] Order not found:", orderId);
        const dummyReq = { user: { uid: "system" }, ip: "webhook", headers: {} };
        await logAudit(dummyReq, "PAYMENT_FULFILL_FAILED_NOT_FOUND", "orders", orderId, null, { paymentId, paymentAmount });
        return { success: false, notFound: true, alreadyPaid: false };
    }
    const data = orderDoc.data();
    if (data.paymentStatus === "paid") return { success: true, alreadyPaid: true, orderId, orderNumber: data.orderNumber };

    const expectedAmountPaise = Math.round((data.totalAmount || 0) * 100);
    const expectedCurrency = data.payment?.currency || "INR";

    if (expectedAmountPaise !== paymentAmount || expectedCurrency !== paymentCurrency) {
        console.warn("[fulfillOrder] Amount or currency mismatch for order:", orderId, { expectedAmountPaise, paymentAmount, expectedCurrency, paymentCurrency });
        const dummyReq = { user: { uid: "system" }, ip: "webhook", headers: {} };
        await logAudit(dummyReq, "PAYMENT_FULFILL_FAILED_MISMATCH", "orders", orderId, null, { expectedAmountPaise, paymentAmount, expectedCurrency, paymentCurrency });
        return { success: false, mismatch: true, alreadyPaid: false };
    }

    // REQUIREMENT 1: If order is cancelled, do NOT mark paid or deduct stock!
    const currentOrderStatus = String(data.orderStatus || data.status || "").toLowerCase();
    if (currentOrderStatus === "cancelled") {
        const now = admin.firestore.FieldValue.serverTimestamp();
        transaction.update(orderRef, {
            paymentStatus: "paid_after_cancel",
            "cancellation.refundRequired": true,
            "payment.razorpay_payment_id": paymentId,
            "payment.paidAt": now,
            updatedAt: now,
            statusHistory: admin.firestore.FieldValue.arrayUnion({
                status: "cancelled",
                changedAt: now,
                changedBy: "system",
                note: "Payment received after order was already cancelled. Refund required."
            })
        });
        return { success: true, alreadyPaid: false, orderId, orderNumber: data.orderNumber, cancelledAfterPayment: true };
    }

    // Perform ALL reads first before any writes
    const validItems = (data.items || []).filter(item => item && item.id && item.qty);
    const productDocs = [];
    for (const item of validItems) {
        const productRef = db.collection("products").doc(item.id);
        const productDoc = await transaction.get(productRef);
        productDocs.push({ item, productRef, productDoc });
    }

    // Now perform ALL writes
    const now = admin.firestore.FieldValue.serverTimestamp();
    let isOversold = false, oversoldNotes = "";

    for (const { item, productRef, productDoc } of productDocs) {
        if (!productDoc.exists) continue;
        const pd = productDoc.data();
        const currentStock = typeof pd.stock === "number" ? pd.stock : (parseInt(pd.stock, 10) || 0);
        if (currentStock < item.qty) { isOversold = true; oversoldNotes += `Product ${item.id} oversold. `; }
        const newStock = Math.max(0, currentStock - item.qty);
        transaction.update(productRef, { stock: newStock, ...(newStock <= 0 ? { status: "out_of_stock" } : {}), updatedAt: now });
    }

    // REQUIREMENT 1: Save deductedQty on each item for exact restore tracking
    const updatedItems = (data.items || []).map(item => ({
        ...item,
        deductedQty: item.qty || item.quantity || 1
    }));

    transaction.update(orderRef, {
        items: updatedItems,
        orderStatus: isOversold ? "action_required_oversold" : "pending",
        paymentStatus: "paid",
        updatedAt: now,
        "payment.razorpay_payment_id": paymentId,
        "payment.paidAt": now,
        statusHistory: admin.firestore.FieldValue.arrayUnion({
            status: isOversold ? "action_required_oversold" : "pending",
            changedAt: now, changedBy: "system",
            note: isOversold ? "Payment verified, oversold: " + oversoldNotes : "Payment verified."
        })
    });
    return { success: true, alreadyPaid: false, orderId, orderNumber: data.orderNumber };
}

// ── POST /api/payments/create-order ──────────────────────────────────────────
router.post("/create-order", authMiddleware, async (req, res) => {
    try {
        const { items, promoCode, couponCode, shippingAddress, notes, paymentMethod } = req.body;
        const activeCoupon = promoCode || couponCode;
        if (!items || !Array.isArray(items) || items.length === 0) return sendError(res, 400, "invalid-argument", "Cart cannot be empty.");
        if (items.length > 50) return sendError(res, 400, "invalid-argument", "Cart exceeds maximum item limit.");
        if (!shippingAddress) return sendError(res, 400, "invalid-argument", "Shipping address is required.");
        validateAddress(shippingAddress);

        const { trustedItems, subtotal, discount, gst, deliveryCharge, codFee, totalAmount } = await calculateOrderTotals(items, activeCoupon, false);
        const amountPaise = Math.round(totalAmount * 100);
        const receipt = `rc_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;
        const order = await getRazorpayClient().orders.create({ amount: amountPaise, currency: "INR", receipt });
        const orderNumber = `ORD-${new Date().toISOString().slice(0,10).replace(/-/g,"")}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
        const now = admin.firestore.FieldValue.serverTimestamp();

        await db.collection("orders").doc(order.id).set({
            orderNumber, customerId: req.user.uid, items: trustedItems, shippingAddress,
            orderStatus: "payment_pending", paymentStatus: "pending", shippingStatus: "not_shipped",
            payment: { razorpay_order_id: order.id, method: paymentMethod || "razorpay", amount: totalAmount, currency: "INR", paidAt: null },
            shippingDetails: { carrier: null, trackingNumber: null, estimatedDelivery: null, shippedAt: null, deliveredAt: null },
            subtotal, discount, gst, deliveryCharge, codFee, totalAmount, couponCode: activeCoupon || null,
            statusHistory: [{ status: "payment_pending", changedAt: now, changedBy: "system", note: "Order created, pending payment." }],
            notes: notes || null, createdAt: now, updatedAt: now
        });

        return res.json({
            id: order.id,
            orderId: order.id,
            razorpayOrderId: order.id,
            currency: order.currency,
            amount: order.amount,
            key: process.env.RAZORPAY_KEY_ID
        });
    } catch (err) {
        console.error("[payments/create-order]", err);
        const statusCode = (err && err.code && Number.isInteger(err.code) && err.code >= 400 && err.code <= 599) ? err.code : 500;
        return sendError(res, statusCode, "invalid-argument", err.message || "Unable to create order.");
    }
});

// ── POST /api/payments/verify ─────────────────────────────────────────────────
const handlePaymentVerification = async (req, res) => {
    try {
        const razorpay_order_id = req.body.razorpay_order_id || req.body.razorpayOrderId;
        const razorpay_payment_id = req.body.razorpay_payment_id || req.body.razorpayPaymentId;
        const razorpay_signature = req.body.razorpay_signature || req.body.razorpaySignature;
        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            return sendError(res, 400, "invalid-argument", "Missing payment verification fields.");
        }

        // Verify order ownership (must belong to req.user.uid or admin)
        const orderSnap = await db.collection("orders").doc(razorpay_order_id).get();
        if (!orderSnap.exists) return sendError(res, 404, "not-found", "Order not found.");
        const orderData = orderSnap.data();
        if (orderData.customerId !== req.user.uid && !req.isAdmin) {
            return sendError(res, 403, "permission-denied", "Access denied: order belongs to another customer.");
        }

        const keySecret = process.env.RAZORPAY_KEY_SECRET;
        if (!keySecret) {
            console.error("[payments/verify] Error: RAZORPAY_KEY_SECRET environment variable is missing.");
            return sendError(res, 500, "internal", "Payment gateway configuration error.");
        }

        const body = razorpay_order_id + "|" + razorpay_payment_id;
        const expectedSig = crypto.createHmac("sha256", keySecret).update(body).digest("hex");
        const sigBuf = Buffer.from(razorpay_signature, "hex");
        const expBuf = Buffer.from(expectedSig, "hex");
        if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
            await logAudit(req, "PAYMENT_VERIFICATION_FAILED", "orders", razorpay_order_id, null, { reason: "Invalid signature" });
            return sendError(res, 403, "permission-denied", "Invalid payment signature.");
        }

        const paymentDetails = await getRazorpayClient().payments.fetch(razorpay_payment_id);
        if (paymentDetails.status !== "captured") return sendError(res, 400, "failed-precondition", "Payment is not captured.");

        const result = await db.runTransaction(t => fulfillOrder(razorpay_order_id, razorpay_payment_id, paymentDetails.amount, paymentDetails.currency, t));

        if (!result.success && (result.notFound || result.mismatch)) {
            return sendError(res, 400, "failed-precondition", "Payment verification failed: invalid order or amount mismatch.");
        }

        if (!result.alreadyPaid) await logAudit(req, "PAYMENT_VERIFIED", "orders", result.orderId, { paymentStatus: "pending" }, { paymentStatus: "paid" });
        return res.json({ success: true, orderId: result.orderId || razorpay_order_id, orderNumber: result.orderNumber || orderData.orderNumber });
    } catch (err) {
        console.error("[payments/verify]", err);
        const statusCode = (err && err.code && Number.isInteger(err.code) && err.code >= 400 && err.code <= 599) ? err.code : 500;
        return sendError(res, statusCode, "internal", err.message || "Payment verification failed.");
    }
};

router.post("/verify", authMiddleware, handlePaymentVerification);
router.post("/verify-payment", authMiddleware, handlePaymentVerification);

// ── POST /api/payments/webhook (Razorpay webhook — no auth) ──────────────────
router.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
    try {
        const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
        if (!secret) {
            console.error("[Webhook] Error: RAZORPAY_WEBHOOK_SECRET environment variable is not configured.");
            return res.status(500).send("Webhook secret not configured");
        }

        const signature = req.headers["x-razorpay-signature"];
        if (!signature) return res.status(400).send("Missing signature");

        const rawBody = req.rawBody || req.body;
        const payloadBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody));
        const expectedSig = crypto.createHmac("sha256", secret).update(payloadBuffer).digest("hex");
        const sigBuf = Buffer.from(signature, "hex");
        const expBuf = Buffer.from(expectedSig, "hex");
        if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
            console.warn("[Webhook] Invalid signature");
            return res.status(400).send("Invalid signature");
        }

        const parsed = typeof rawBody === "object" && !Buffer.isBuffer(rawBody) ? rawBody : JSON.parse(payloadBuffer.toString());
        const event = parsed.event;
        const paymentData = parsed.payload?.payment?.entity;
        const eventId = req.headers["x-razorpay-event-id"];

        if (!event || !paymentData || !eventId) return res.status(400).send("Invalid payload structure");

        let actionLog = null;
        await db.runTransaction(async (transaction) => {
            const eventRef = db.collection("webhook_events").doc(eventId);
            const eventDoc = await transaction.get(eventRef);
            if (eventDoc.exists) return; // Already processed (idempotency)

            if (event === "payment.captured") {
                const result = await fulfillOrder(paymentData.order_id, paymentData.id, paymentData.amount, paymentData.currency, transaction);
                if (result.success && !result.alreadyPaid) actionLog = { id: result.orderId, status: "PAYMENT_VERIFIED_WEBHOOK" };
            }
            transaction.set(eventRef, { processedAt: admin.firestore.FieldValue.serverTimestamp(), event });
        });

        if (actionLog) {
            const dummyReq = { user: { uid: "system" }, ip: req.ip, headers: req.headers };
            await logAudit(dummyReq, actionLog.status, "orders", actionLog.id, { paymentStatus: "pending" }, { paymentStatus: "paid" });
        }

        return res.status(200).send("OK");
    } catch (err) {
        console.error("[Webhook] Error:", err);
        return res.status(500).send("Webhook Error");
    }
});

// ── POST /api/payments/create-cod-order ──────────────────────────────────────
router.post("/create-cod-order", authMiddleware, async (req, res) => {
    try {
        const { items, promoCode, shippingAddress, notes } = req.body;
        if (!items || !Array.isArray(items) || items.length === 0) return sendError(res, 400, "invalid-argument", "Cart cannot be empty.");
        if (items.length > 50) return sendError(res, 400, "invalid-argument", "Cart exceeds maximum item limit.");
        if (!shippingAddress) return sendError(res, 400, "invalid-argument", "Shipping address is required.");
        validateAddress(shippingAddress);

        const { trustedItems, subtotal, discount, gst, deliveryCharge, codFee, totalAmount } = await calculateOrderTotals(items, promoCode, true);
        const orderNumber = `ORD-${new Date().toISOString().slice(0,10).replace(/-/g,"")}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
        const now = admin.firestore.FieldValue.serverTimestamp();

        // REQUIREMENT 1: Save deductedQty on items for COD orders
        const itemsWithDeducted = trustedItems.map(item => ({
            ...item,
            deductedQty: item.qty
        }));

        let docRefId = null;
        await db.runTransaction(async (transaction) => {
            // Read phase: fetch all product docs first
            const productDocs = [];
            for (const item of itemsWithDeducted) {
                const productRef = db.collection("products").doc(item.id);
                const productDoc = await transaction.get(productRef);
                productDocs.push({ item, productRef, productDoc });
            }

            // Write phase: update stock for each item
            for (const { item, productRef, productDoc } of productDocs) {
                if (!productDoc.exists) throw { code: 404, message: `Product ${item.id} not found.` };
                const pd = productDoc.data();
                const currentStock = typeof pd.stock === "number" ? pd.stock : (parseInt(pd.stock, 10) || 0);
                if (currentStock < item.qty) {
                    throw { code: 400, message: `Insufficient stock for "${pd.productName || pd.name || item.id}".` };
                }
                const newStock = Math.max(0, currentStock - item.qty);
                transaction.update(productRef, {
                    stock: newStock,
                    ...(newStock <= 0 ? { status: "out_of_stock" } : {}),
                    updatedAt: now
                });
            }

            const codOrderRef = db.collection("orders").doc();
            docRefId = codOrderRef.id;
            const codOrder = {
                orderNumber, customerId: req.user.uid, items: itemsWithDeducted, shippingAddress,
                orderStatus: "pending", paymentStatus: "pending", shippingStatus: "not_shipped",
                payment: { method: "cod", amount: totalAmount, currency: "INR", paidAt: null },
                shippingDetails: { carrier: null, trackingNumber: null, shippedAt: null, deliveredAt: null },
                subtotal, discount, gst, deliveryCharge, codFee, totalAmount, couponCode: promoCode || null,
                statusHistory: [{ status: "pending", changedAt: now, changedBy: "system", note: "COD Order placed." }],
                notes: notes || null, createdAt: now, updatedAt: now
            };
            transaction.set(codOrderRef, codOrder);
        });

        await logAudit(req, "CREATE_COD_ORDER", "orders", docRefId, null, { orderNumber, totalAmount });
        return res.json({ success: true, orderId: docRefId, orderNumber });
    } catch (err) {
        console.error("[payments/create-cod-order]", err);
        const statusCode = (err && err.code && Number.isInteger(err.code) && err.code >= 400 && err.code <= 599) ? err.code : 500;
        return sendError(res, statusCode, "invalid-argument", err.message || "Unable to place COD order.");
    }
});

// ── POST /api/payments/refund (Owner / Manager only) ──────────────────────────
router.post("/refund", authMiddleware, requireOwnerOrManager, async (req, res) => {
    let targetOrderId = null;
    try {
        const { orderId, amount, notes } = req.body;
        targetOrderId = orderId;
        if (!targetOrderId) return sendError(res, 400, "invalid-argument", "orderId is required.");

        const orderRef = db.collection("orders").doc(targetOrderId);

        // Transaction lock for idempotency against double-click
        let paymentIdToRefund = null;
        let originalTotal = 0;

        await db.runTransaction(async (transaction) => {
            const snap = await transaction.get(orderRef);
            if (!snap.exists) throw { code: 404, message: "Order not found." };
            const data = snap.data();

            paymentIdToRefund = data.payment?.razorpay_payment_id || data.paymentId;
            originalTotal = data.totalAmount || data.amount || 0;

            if (data.refundStatus === "processed" || data.refundId) {
                throw { code: 400, message: "Refund has already been processed for this order." };
            }
            if (data.refunding === true) {
                throw { code: 400, message: "A refund is currently in progress for this order. Please wait." };
            }

            transaction.update(orderRef, {
                refunding: true,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        });

        if (!paymentIdToRefund) {
            await orderRef.update({ refunding: false }).catch(() => {});
            return sendError(res, 400, "failed-precondition", "Order has no associated Razorpay payment ID to refund.");
        }

        // Call Razorpay API to issue refund
        const refundOptions = {};
        if (typeof amount === "number" && amount > 0) {
            refundOptions.amount = Math.round(amount * 100);
        }
        if (notes) {
            refundOptions.notes = typeof notes === "object" ? notes : { note: String(notes) };
        }

        const refundRes = await getRazorpayClient().payments.refund(paymentIdToRefund, refundOptions);

        const now = admin.firestore.FieldValue.serverTimestamp();
        const finalRefundAmount = refundRes.amount ? (refundRes.amount / 100) : (amount || originalTotal);

        await orderRef.update({
            refunding: false,
            refundId: refundRes.id,
            refundStatus: "processed",
            refundedAt: now,
            refundAmount: finalRefundAmount,
            "cancellation.refundRequired": false,
            updatedAt: now,
            statusHistory: admin.firestore.FieldValue.arrayUnion({
                status: "refund_processed",
                changedAt: now,
                changedBy: req.user.uid,
                note: `Refund processed (₹${finalRefundAmount}). Refund ID: ${refundRes.id}`
            })
        });

        await logAudit(req, "PAYMENT_REFUND", "orders", targetOrderId, null, { refundId: refundRes.id, amount: finalRefundAmount });

        return res.json({
            success: true,
            orderId: targetOrderId,
            refundId: refundRes.id,
            refundStatus: "processed",
            refundAmount: finalRefundAmount,
            message: "Refund processed successfully."
        });
    } catch (err) {
        if (targetOrderId) {
            await db.collection("orders").doc(targetOrderId).update({ refunding: false }).catch(() => {});
        }
        console.error("[payments/refund]", err);
        const statusCode = (err && err.code && Number.isInteger(err.code) && err.code >= 400 && err.code <= 599) ? err.code : 500;
        return sendError(res, statusCode, "internal", err.message || "Failed to process refund.");
    }
});

module.exports = router;

