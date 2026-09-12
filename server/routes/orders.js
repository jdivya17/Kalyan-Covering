"use strict";
const express = require("express");
const { admin, db } = require("../lib/admin");
const { logAudit, sendError } = require("../lib/utils");
const { authMiddleware, requireAdmin } = require("../middleware/auth");
const { createShipmentForOrder } = require("../shipping/shippingService");

const router = express.Router();

const ORDER_TRANSITIONS = {
    "Order Placed": ["Confirmed", "Cancelled"],
    "Confirmed": ["Packed", "Cancelled"],
    "Packed": ["Shipped", "Cancelled"],
    "Shipped": ["Out for Delivery", "Returned"],
    "Out for Delivery": ["Delivered", "Returned"],
    "Delivered": ["Returned"],
    "Cancelled": [],
    "Returned": []
};

// ── POST /api/orders/update-status (Admin only) ─────────────────────────────
router.post("/update-status", authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { id, newStatus, note, shippingDetails } = req.body;
        if (!id || !newStatus) return sendError(res, 400, "invalid-argument", "id and newStatus are required.");

        const ref = db.collection("orders").doc(id);
        const snap = await ref.get();
        if (!snap.exists) return sendError(res, 404, "not-found", "Order not found.");
        const order = snap.data();
        const currentStatus = order.orderStatus || "Order Placed";

        const allowed = ORDER_TRANSITIONS[currentStatus] || [];
        if (currentStatus !== newStatus && !allowed.includes(newStatus)) {
            return sendError(res, 400, "failed-precondition", `Cannot move order from "${currentStatus}" to "${newStatus}".`);
        }

        const now = admin.firestore.FieldValue.serverTimestamp();
        const historyEntry = {
            status: newStatus,
            changedAt: now,
            changedBy: req.user.uid,
            note: note || `Status updated to ${newStatus}`
        };

        const updates = {
            orderStatus: newStatus,
            updatedAt: now,
            statusHistory: admin.firestore.FieldValue.arrayUnion(historyEntry)
        };
        if (shippingDetails) {
            if (shippingDetails.carrier) updates["shippingDetails.carrier"] = shippingDetails.carrier;
            if (shippingDetails.trackingNumber) updates["shippingDetails.trackingNumber"] = shippingDetails.trackingNumber;
            if (shippingDetails.estimatedDelivery) updates["shippingDetails.estimatedDelivery"] = shippingDetails.estimatedDelivery;
        }

        // ── FIX (from audit finding #4): marking an order "Shipped" now
        // automatically books the Shiprocket shipment instead of relying
        // on the admin to remember a separate manual step. If a shipment
        // already exists, or Shiprocket creation fails, we still record
        // the status change but flag it so the admin can retry manually.
        let shipmentResult = null;
        let shipmentError = null;
        if (newStatus === "Shipped" && !order.shippingDetails?.trackingNumber) {
            try {
                shipmentResult = await createShipmentForOrder(id, req.body.pickupLocation || "");
                if (shipmentResult?.trackingNumber) updates["shippingDetails.trackingNumber"] = shipmentResult.trackingNumber;
                if (shipmentResult?.carrier) updates["shippingDetails.carrier"] = shipmentResult.carrier;
            } catch (shipErr) {
                console.error("[orders/update-status] auto-shipment failed:", shipErr.message);
                shipmentError = shipErr.message;
            }
        }

        await ref.update(updates);
        await logAudit(req, "UPDATE_ORDER_STATUS", "orders", id, { orderStatus: currentStatus }, { orderStatus: newStatus, shipmentError });

        // ── Notification hook (audit finding: no notification on status change) ──
        // Writes a notification doc the storefront can read from
        // /notifications/{uid}. Actual email/SMS/push delivery can be
        // wired in here later (e.g. via nodemailer, already a dependency).
        try {
            await db.collection("notifications").add({
                userId: order.customerId,
                type: "order_status",
                orderId: id,
                orderNumber: order.orderNumber || id,
                title: `Order ${newStatus}`,
                message: note || `Your order is now ${newStatus}.`,
                read: false,
                createdAt: now
            });
        } catch (notifErr) {
            console.error("[orders/update-status] notification write failed:", notifErr.message);
        }

        return res.json({
            success: true,
            orderId: id,
            newStatus,
            shipmentCreated: !!shipmentResult,
            shipmentError
        });
    } catch (err) {
        console.error("[orders/update-status]", err);
        return sendError(res, 500, "internal", "Failed to update order status.");
    }
});

// ── POST /api/orders/list (Admin only) — paginated order list for dashboard ──
router.post("/list", authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { limit = 50, status } = req.body;
        let q = db.collection("orders");
        if (status && status !== "all") q = q.where("orderStatus", "==", status);
        q = q.orderBy("createdAt", "desc").limit(Math.min(limit, 200));
        const snap = await q.get();
        return res.json({ orders: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
    } catch (err) {
        console.error("[orders/list]", err);
        return sendError(res, 500, "internal", "Failed to fetch orders.");
    }
});

module.exports = router;
