"use strict";

const express = require("express");
const crypto = require("crypto");
const Razorpay = require("razorpay");
const { admin, db } = require("../lib/admin");
const { logAudit, sendError } = require("../lib/utils");
const { authMiddleware } = require("../middleware/auth");

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
    const req = (val, field, max) => {
        if (typeof val !== "string" || !val.trim()) throw { code: 400, message: `${field} is required.` };
        if (val.length > max) throw { code: 400, message: `${field} exceeds max length of ${max}.` };
    };
    req(address.fname, "First Name", 50);
    req(address.lname, "Last Name", 50);
    req(address.address, "Street Address", 255);
    req(address.city, "City", 100);
    req(address.state, "State", 100);
    if (!/^\d{10}$/.test(address.phone)) throw { code: 400, message: "Phone number must be exactly 10 digits." };
    if (!/^\d{6}$/.test(address.pin)) throw { code: 400, message: "PIN code must be exactly 6 digits." };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address.email)) throw { code: 400, message: "Invalid email address format." };
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
        if (p.status === "out_of_stock" || p.status === "archived") throw { code: 400, message: `Product "${p.productName}" is no longer available.` };
        if (item.qty > (p.stock || 0)) throw { code: 400, message: `Insufficient stock for "${p.productName}".` };
        const price = p.price || 0;
        subtotal += price * item.qty;
        trustedItems.push({ id: item.id, name: p.productName || item.id, price, qty: item.qty, sku: p.sku || null });
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
    if (!orderDoc.exists) throw new Error("Order not found.");
    const data = orderDoc.data();
    if (data.paymentStatus === "paid") return { success: true, alreadyPaid: true, orderId, orderNumber: data.orderNumber };
    if (data.totalAmount * 100 !== paymentAmount || (data.payment.currency || "INR") !== paymentCurrency) throw new Error("Payment amount or currency mismatch.");

    const now = admin.firestore.FieldValue.serverTimestamp();
    let isOversold = false, oversoldNotes = "";

    for (const item of (data.items || [])) {
        if (!item.id || !item.qty) continue;
        const productRef = db.collection("products").doc(item.id);
        const productDoc = await transaction.get(productRef);
        if (!productDoc.exists) continue;
        const pd = productDoc.data();
        const currentStock = pd.stock || 0;
        if (currentStock < item.qty) { isOversold = true; oversoldNotes += `Product ${item.id} oversold. `; }
        const newStock = Math.max(0, currentStock - item.qty);
        transaction.update(productRef, { stock: newStock, ...(newStock <= 0 ? { status: "out_of_stock" } : {}), updatedAt: now });
    }

    transaction.update(orderRef, {
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
        const { items, promoCode, shippingAddress, notes, paymentMethod } = req.body;
        if (!items || !Array.isArray(items) || items.length === 0) return sendError(res, 400, "invalid-argument", "Cart cannot be empty.");
        if (items.length > 50) return sendError(res, 400, "invalid-argument", "Cart exceeds maximum item limit.");
        if (!shippingAddress) return sendError(res, 400, "invalid-argument", "Shipping address is required.");
        validateAddress(shippingAddress);

        const { trustedItems, subtotal, discount, gst, deliveryCharge, codFee, totalAmount } = await calculateOrderTotals(items, promoCode, false);
        const order = await getRazorpayClient().orders.create({ amount: totalAmount * 100, currency: "INR", receipt: `rcpt_${req.user.uid}_${Date.now()}` });
        const orderNumber = `ORD-${new Date().toISOString().slice(0,10).replace(/-/g,"")}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
        const now = admin.firestore.FieldValue.serverTimestamp();

        await db.collection("orders").doc(order.id).set({
            orderNumber, customerId: req.user.uid, items: trustedItems, shippingAddress,
            orderStatus: "payment_pending", paymentStatus: "pending", shippingStatus: "not_shipped",
            payment: { razorpay_order_id: order.id, method: paymentMethod || "razorpay", amount: totalAmount, currency: "INR", paidAt: null },
            shippingDetails: { carrier: null, trackingNumber: null, estimatedDelivery: null, shippedAt: null, deliveredAt: null },
            subtotal, discount, gst, deliveryCharge, codFee, totalAmount, couponCode: promoCode || null,
            statusHistory: [{ status: "payment_pending", changedAt: now, changedBy: "system", note: "Order created, pending payment." }],
            notes: notes || null, createdAt: now, updatedAt: now
        });

        return res.json({ id: order.id, currency: order.currency, amount: order.amount, key: process.env.RAZORPAY_KEY_ID });
    } catch (err) {
        if (err.code && err.message) return sendError(res, err.code, "invalid-argument", err.message);
        console.error("[payments/create-order]", err);
        return sendError(res, 500, "internal", "Unable to create order.");
    }
});

// ── POST /api/payments/verify ─────────────────────────────────────────────────
router.post("/verify", authMiddleware, async (req, res) => {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) return sendError(res, 400, "invalid-argument", "Missing payment verification fields.");

        const body = razorpay_order_id + "|" + razorpay_payment_id;
        const expectedSig = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET).update(body).digest("hex");
        const sigBuf = Buffer.from(razorpay_signature, "hex");
        const expBuf = Buffer.from(expectedSig, "hex");
        if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
            await logAudit(req, "PAYMENT_VERIFICATION_FAILED", "orders", razorpay_order_id, null, { reason: "Invalid signature" });
            return sendError(res, 403, "permission-denied", "Invalid payment signature.");
        }

        const paymentDetails = await getRazorpayClient().payments.fetch(razorpay_payment_id);
        if (paymentDetails.status !== "captured") return sendError(res, 400, "failed-precondition", "Payment is not captured.");

        const result = await db.runTransaction(t => fulfillOrder(razorpay_order_id, razorpay_payment_id, paymentDetails.amount, paymentDetails.currency, t));
        if (!result.alreadyPaid) await logAudit(req, "PAYMENT_VERIFIED", "orders", result.orderId, { paymentStatus: "pending" }, { paymentStatus: "paid" });
        return res.json({ success: true, orderId: result.orderId, orderNumber: result.orderNumber });
    } catch (err) {
        console.error("[payments/verify]", err);
        return sendError(res, 500, "internal", "Payment verification failed.");
    }
});

// ── POST /api/payments/webhook (Razorpay webhook — no auth) ──────────────────
router.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
    try {
        const rawBody = req.rawBody || req.body;
        const signature = req.headers["x-razorpay-signature"];
        const secret = process.env.RAZORPAY_KEY_SECRET;
        if (!signature || !secret) return res.status(400).send("Missing signature or configuration");

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
        const eventCreatedAt = parsed.created_at;

        if (!event || !paymentData || !eventId) return res.status(400).send("Invalid payload structure");

        if (eventCreatedAt) {
            const ageMin = (Date.now() / 1000 - eventCreatedAt) / 60;
            if (ageMin > 15) return res.status(400).send("Event expired");
        }

        let actionLog = null;
        await db.runTransaction(async (transaction) => {
            const eventRef = db.collection("webhook_events").doc(eventId);
            const eventDoc = await transaction.get(eventRef);
            if (eventDoc.exists) return; // Already processed (idempotency)

            if (event === "payment.captured") {
                try {
                    const result = await fulfillOrder(paymentData.order_id, paymentData.id, paymentData.amount, paymentData.currency, transaction);
                    if (!result.alreadyPaid) actionLog = { id: result.orderId, status: "PAYMENT_VERIFIED_WEBHOOK" };
                } catch (e) { console.error("[Webhook] fulfillOrder error:", e.message); }
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

        let docRefId = null;
        await db.runTransaction(async (transaction) => {
            // Verify stock and deduct for each item
            for (const item of trustedItems) {
                const productRef = db.collection("products").doc(item.id);
                const productDoc = await transaction.get(productRef);
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
                orderNumber, customerId: req.user.uid, items: trustedItems, shippingAddress,
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
        if (err.code && err.message) return sendError(res, err.code, "invalid-argument", err.message);
        console.error("[payments/create-cod-order]", err);
        return sendError(res, 500, "internal", "Unable to place COD order.");
    }
});

module.exports = router;
