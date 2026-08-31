"use strict";
const express = require("express");
const { admin, db } = require("../lib/admin");
const { logAudit, sendError } = require("../lib/utils");
const { authMiddleware, requireAdmin, requireOwnerOrManager } = require("../middleware/auth");

const router = express.Router();

const ORDER_TRANSITIONS = {
    pending: ["confirmed", "cancelled"], confirmed: ["packed", "cancelled"],
    packed: ["shipped", "cancelled"], shipped: ["out_for_delivery"],
    out_for_delivery: ["delivered"], delivered: ["returned"], returned: ["refunded"],
    cancelled: [], refunded: []
};
const SHIPPING_STATUS_MAP = {
    pending: "not_shipped", confirmed: "not_shipped", packed: "not_shipped",
    shipped: "shipped", out_for_delivery: "out_for_delivery", delivered: "delivered",
    returned: "return_in_transit", refunded: "returned", cancelled: "not_shipped"
};

// POST /api/orders/update-status (Admin)
router.post("/update-status", authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { id, newStatus, note, shippingDetails } = req.body;
        if (!id || !newStatus) return sendError(res, 400, "invalid-argument", "Order ID and newStatus are required.");
        const validStatuses = Object.keys(ORDER_TRANSITIONS);
        if (!validStatuses.includes(newStatus)) return sendError(res, 400, "invalid-argument", `Invalid status: ${newStatus}.`);

        const docRef = db.collection("orders").doc(id);
        const snap = await docRef.get();
        if (!snap.exists) return sendError(res, 404, "not-found", "Order not found.");

        const order = snap.data();
        const currentStatus = order.orderStatus;
        const allowed = ORDER_TRANSITIONS[currentStatus] || [];
        if (!allowed.includes(newStatus)) return sendError(res, 400, "failed-precondition", `Cannot move from '${currentStatus}' to '${newStatus}'. Allowed: [${allowed.join(", ")}]`);

        const now = admin.firestore.FieldValue.serverTimestamp();
        const historyEntry = { status: newStatus, changedAt: now, changedBy: req.user.uid, note: note || null };
        const updatePayload = {
            orderStatus: newStatus, shippingStatus: SHIPPING_STATUS_MAP[newStatus] || "unknown",
            updatedAt: now, statusHistory: admin.firestore.FieldValue.arrayUnion(historyEntry)
        };
        if (newStatus === "shipped") {
            if (!shippingDetails?.carrier || !shippingDetails?.trackingNumber) return sendError(res, 400, "failed-precondition", "Shipping carrier and tracking number are required.");
            updatePayload["shippingDetails.carrier"] = shippingDetails.carrier;
            updatePayload["shippingDetails.trackingNumber"] = shippingDetails.trackingNumber;
            updatePayload["shippingDetails.estimatedDelivery"] = shippingDetails.estimatedDelivery || null;
            updatePayload["shippingDetails.shippedAt"] = now;
        }
        if (newStatus === "delivered") updatePayload["shippingDetails.deliveredAt"] = now;

        await docRef.update(updatePayload);
        await logAudit(req, "UPDATE_ORDER_STATUS", "orders", id, { orderStatus: currentStatus }, { orderStatus: newStatus });
        return res.json({ success: true, orderStatus: newStatus });
    } catch (err) { console.error("[orders/update-status]", err); return sendError(res, 500, "internal", "Failed to update order status."); }
});

// POST /api/orders/cancel (Customer or Admin)
router.post("/cancel", authMiddleware, async (req, res) => {
    try {
        const { orderId, reason } = req.body;
        if (!orderId) return sendError(res, 400, "invalid-argument", "orderId is required.");
        if (!reason || !reason.trim()) return sendError(res, 400, "invalid-argument", "A cancellation reason is required.");
        const CANCELLABLE = ["payment_pending", "pending", "confirmed", "packed"];

        const result = await db.runTransaction(async (t) => {
            const orderRef = db.collection("orders").doc(orderId);
            const snap = await t.get(orderRef);
            if (!snap.exists) throw { status: 404, code: "not-found", message: "Order not found." };
            const data = snap.data();
            if (data.customerId !== req.user.uid && !req.isAdmin) throw { status: 403, code: "permission-denied", message: "Not authorized." };
            const current = (data.orderStatus || "").toLowerCase().replace(/\s+/g, "_");
            if (!CANCELLABLE.some(s => current.includes(s))) throw { status: 400, code: "failed-precondition", message: `Cannot cancel order with status "${data.orderStatus}".` };
            const now = admin.firestore.FieldValue.serverTimestamp();
            t.update(orderRef, {
                orderStatus: "cancelled", cancellationReason: reason.trim(),
                statusHistory: admin.firestore.FieldValue.arrayUnion({ status: "Cancelled", timestamp: new Date().toISOString(), changedBy: "customer", note: `Cancelled. Reason: ${reason.trim()}` }),
                updatedAt: now
            });
            return { orderNumber: data.orderNumber };
        });

        await logAudit(req, "ORDER_CANCELLED_BY_CUSTOMER", "orders", orderId, null, { reason: reason.trim() });
        return res.json({ success: true, orderNumber: result.orderNumber });
    } catch (err) {
        if (err.status) return sendError(res, err.status, err.code, err.message);
        console.error("[orders/cancel]", err);
        return sendError(res, 500, "internal", "Failed to cancel order.");
    }
});

// POST /api/orders/return (Customer)
router.post("/return", authMiddleware, async (req, res) => {
    try {
        const { orderId, reason } = req.body;
        if (!orderId) return sendError(res, 400, "invalid-argument", "orderId is required.");
        if (!reason || !reason.trim()) return sendError(res, 400, "invalid-argument", "A return reason is required.");

        const orderRef = db.collection("orders").doc(orderId);
        const snap = await orderRef.get();
        if (!snap.exists) return sendError(res, 404, "not-found", "Order not found.");
        const data = snap.data();
        if (data.customerId !== req.user.uid) return sendError(res, 403, "permission-denied", "Not authorized.");
        if (!(data.orderStatus || "").toLowerCase().includes("deliver")) return sendError(res, 400, "failed-precondition", "Returns can only be requested for delivered orders.");

        if (data.shippingDetails?.deliveredAt) {
            const deliveredAt = data.shippingDetails.deliveredAt.toDate ? data.shippingDetails.deliveredAt.toDate() : new Date(data.shippingDetails.deliveredAt);
            const days = (new Date() - deliveredAt) / (1000 * 60 * 60 * 24);
            if (days > 7) return sendError(res, 400, "failed-precondition", "Return window has expired. Returns must be within 7 days of delivery.");
        }

        const now = admin.firestore.FieldValue.serverTimestamp();
        await orderRef.update({
            orderStatus: "returned", returnReason: reason.trim(),
            statusHistory: admin.firestore.FieldValue.arrayUnion({ status: "Return Requested", timestamp: new Date().toISOString(), changedBy: "customer", note: `Return requested. Reason: ${reason.trim()}` }),
            updatedAt: now
        });
        await logAudit(req, "RETURN_REQUESTED_BY_CUSTOMER", "orders", orderId, null, { reason: reason.trim() });
        return res.json({ success: true, orderNumber: data.orderNumber });
    } catch (err) { console.error("[orders/return]", err); return sendError(res, 500, "internal", "Failed to submit return request."); }
});

module.exports = router;
