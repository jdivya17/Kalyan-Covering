"use strict";
const express = require("express");
const { admin, db } = require("../lib/admin");
const { logAudit, sendError } = require("../lib/utils");
const { authMiddleware, requireAdmin } = require("../middleware/auth");
const { createShipmentForOrder, cancelShiprocketOrder } = require("../shipping/shippingService");

const router = express.Router();

function normalizeStatus(status) {
    if (!status || typeof status !== "string") return "pending";
    // First try a direct lowercase slug match
    const clean = status.trim().toLowerCase().replace(/[\s-]+/g, "_");
    // Human-readable legacy labels (admin dropdowns, old data)
    const legacyMap = {
        "order_placed": "pending",
        "placed": "pending",
        "order placed": "pending",
        "out for delivery": "out_for_delivery",
        "out_for_delivery": "out_for_delivery"
    };
    const slugMap = {
        "pending": "pending",
        "payment_pending": "payment_pending",
        "confirmed": "confirmed",
        "packed": "packed",
        "shipped": "shipped",
        "out_for_delivery": "out_for_delivery",
        "delivered": "delivered",
        "cancelled": "cancelled",
        "canceled": "cancelled",
        "cancel_requested": "cancelled",
        "returned": "returned",
        "return_requested": "returned",
        "action_required_oversold": "action_required_oversold",
        "oversold": "action_required_oversold"
    };
    // Check legacy map first (handles "Order Placed", "Out for Delivery" etc.)
    const lowerRaw = status.trim().toLowerCase();
    if (legacyMap[lowerRaw]) return legacyMap[lowerRaw];
    return slugMap[clean] || clean;
}

const ORDER_TRANSITIONS = {
    // Canonical flow
    "payment_pending": ["pending", "cancelled"],
    "pending":         ["confirmed", "cancelled"],
    "confirmed":       ["packed",   "cancelled"],
    "packed":          ["shipped",  "cancelled"],
    "shipped":         ["out_for_delivery", "returned"],
    "out_for_delivery":["delivered",        "returned"],
    "delivered":       ["returned"],
    // Special states — admin resolves manually
    "action_required_oversold": ["pending", "confirmed", "cancelled"],
    "cancelled": [],
    "returned":  []
};

/** Map canonical slug → human-readable UI label */
function statusLabel(slug) {
    return {
        payment_pending:           "Payment Pending",
        pending:                   "Order Placed",
        confirmed:                 "Confirmed",
        packed:                    "Packed",
        shipped:                   "Shipped",
        out_for_delivery:          "Out for Delivery",
        delivered:                 "Delivered",
        cancelled:                 "Cancelled",
        returned:                  "Returned",
        action_required_oversold:  "Action Required (Oversold)"
    }[slug] || (slug ? slug.replace(/_/g, " ") : slug);
}

/** Helper function to execute stock restoration within a Firestore transaction */
async function restoreOrderStockInTransaction(transaction, orderRef, oData, now) {
    if (oData.stockRestored) return false;

    // Restore stock ONLY if stock was deducted for this order (COD or paid, never payment_pending)
    const isPaidOrCod = oData.payment?.method === "cod" || oData.paymentStatus === "paid";
    if (!isPaidOrCod) {
        transaction.update(orderRef, { stockRestored: true });
        return false;
    }

    const currentStatus = normalizeStatus(oData.orderStatus || oData.status);
    const isOversold = currentStatus === "action_required_oversold";
    const validItems = (oData.items || []).filter(item => item && item.id && (item.qty > 0 || item.quantity > 0));

    const productReads = [];
    for (const item of validItems) {
        const productRef = db.collection("products").doc(item.id);
        const pDoc = await transaction.get(productRef);
        productReads.push({ item, productRef, pDoc });
    }

    for (const { item, productRef, pDoc } of productReads) {
        if (!pDoc.exists) continue;
        const pd = pDoc.data();
        const itemQty = item.qty || item.quantity || 0;
        let restoreQty = itemQty;

        if (isOversold) {
            // For action_required_oversold, restore min(item.qty, qty actually deducted)
            const qtyDeducted = typeof item.qtyDeducted === "number" ? item.qtyDeducted : (oData.qtyDeductedMap?.[item.id] ?? 0);
            restoreQty = Math.min(itemQty, qtyDeducted);
        }

        if (restoreQty > 0) {
            const currentStock = typeof pd.stock === "number" ? pd.stock : (parseInt(pd.stock, 10) || 0);
            const restoredStock = currentStock + restoreQty;
            const updatePayload = {
                stock: restoredStock,
                updatedAt: now
            };
            // Only reactivate product to "active" if its status is "out_of_stock", never if "archived"
            if (pd.status === "out_of_stock" && restoredStock > 0) {
                updatePayload.status = "active";
            }
            transaction.update(productRef, updatePayload);
        }
    }

    transaction.update(orderRef, { stockRestored: true });
    return true;
}

// ── POST /api/orders/update-status (Admin only) ─────────────────────────────
router.post("/update-status", authMiddleware, requireAdmin, async (req, res) => {
    try {
        const targetOrderId = req.body.id || req.body.orderId;
        const rawNewStatus = req.body.newStatus || req.body.orderStatus || req.body.status;
        const { note, shippingDetails } = req.body;

        if (!targetOrderId || !rawNewStatus) {
            return sendError(res, 400, "invalid-argument", "Order id and newStatus are required.");
        }

        const ref = db.collection("orders").doc(targetOrderId);
        const snap = await ref.get();
        if (!snap.exists) return sendError(res, 404, "not-found", "Order not found.");
        const order = snap.data();

        const currentStatus = normalizeStatus(order.orderStatus || order.status);
        const targetStatus = normalizeStatus(rawNewStatus);

        const allowed = ORDER_TRANSITIONS[currentStatus] || [];
        if (currentStatus !== targetStatus && !allowed.includes(targetStatus)) {
            return sendError(res, 400, "failed-precondition", `Cannot move order from "${currentStatus}" to "${targetStatus}".`);
        }

        const now = admin.firestore.FieldValue.serverTimestamp();
        let stockRestoredNow = false;

        // Stock restoration for cancelled or returned orders (runs in transaction, all reads before writes)
        if ((targetStatus === "cancelled" || targetStatus === "returned") && !order.stockRestored) {
            await db.runTransaction(async (transaction) => {
                const oDoc = await transaction.get(ref);
                if (!oDoc.exists) return;
                const oData = oDoc.data();
                stockRestoredNow = await restoreOrderStockInTransaction(transaction, ref, oData, now);
            });
        }

        const humanLabel = statusLabel(targetStatus);
        const historyEntry = {
            status: targetStatus,
            changedAt: now,
            changedBy: req.user.uid,
            note: note || `Status updated to ${humanLabel}`
        };

        const updates = {
            orderStatus: targetStatus,
            updatedAt: now,
            statusHistory: admin.firestore.FieldValue.arrayUnion(historyEntry)
        };

        if (targetStatus === "cancelled" && order.paymentStatus === "paid") {
            updates["cancellation.refundRequired"] = true;
            updates["cancellation.requestedAt"] = now;
        }

        if (shippingDetails) {
            if (shippingDetails.carrier) updates["shippingDetails.carrier"] = shippingDetails.carrier;
            if (shippingDetails.trackingNumber) updates["shippingDetails.trackingNumber"] = shippingDetails.trackingNumber;
            if (shippingDetails.estimatedDelivery) updates["shippingDetails.estimatedDelivery"] = shippingDetails.estimatedDelivery;
        }

        await ref.update(updates);

        if (targetStatus === "cancelled") {
            const srOrderId = order.shippingDetails?.shiprocketOrderId;
            if (srOrderId) {
                try {
                    await cancelShiprocketOrder(srOrderId);
                    await ref.update({
                        "shippingDetails.shiprocketCancelled": true,
                        "shippingDetails.shiprocketCancelPending": false,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                } catch (srErr) {
                    console.warn("[orders/update-status] Shiprocket cancel failed:", srErr.message);
                    await ref.update({
                        "shippingDetails.shiprocketCancelPending": true,
                        "shippingDetails.shiprocketCancelError": srErr.message,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                }
            }
        }

        await logAudit(req, "UPDATE_ORDER_STATUS", "orders", targetOrderId, { orderStatus: currentStatus }, { orderStatus: targetStatus, stockRestored: stockRestoredNow });

        if (order.customerId) {
            try {
                await db.collection("notifications").add({
                    userId: order.customerId,
                    type: "order_status",
                    orderId: targetOrderId,
                    orderNumber: order.orderNumber || targetOrderId,
                    title: `Order ${humanLabel}`,
                    message: note || `Your order #${order.orderNumber || targetOrderId} is now ${humanLabel}.`,
                    read: false,
                    createdAt: now
                });
            } catch (notifErr) {
                console.error("[orders/update-status] notification write failed:", notifErr.message);
            }
        }

        return res.json({
            success: true,
            orderId: targetOrderId,
            newStatus: targetStatus,
            stockRestored: stockRestoredNow || !!order.stockRestored
        });
    } catch (err) {
        console.error("[orders/update-status]", err);
        const statusCode = (err && err.code && Number.isInteger(err.code) && err.code >= 400 && err.code <= 599) ? err.code : 500;
        return sendError(res, statusCode, "internal", err.message || "Failed to update order status.");
    }
});

// ── POST /api/orders/cancel (Auth required — customer cancels own order) ─────
router.post("/cancel", authMiddleware, async (req, res) => {
    try {
        const { orderId, reason } = req.body;
        if (!orderId) {
            return sendError(res, 400, "invalid-argument", "orderId is required.");
        }

        const orderRef = db.collection("orders").doc(orderId);
        let stockRestoredNow = false;
        let isPaidOrder = false;

        await db.runTransaction(async (transaction) => {
            const snap = await transaction.get(orderRef);
            if (!snap.exists) throw { code: 404, message: "Order not found." };
            const order = snap.data();

            if (!req.isAdmin && order.customerId !== req.user.uid) {
                throw { code: 403, message: "You can only cancel your own orders." };
            }

            const currentStatus = normalizeStatus(order.orderStatus || order.status);
            const cancellableStatuses = ["pending", "confirmed"];
            if (!cancellableStatuses.includes(currentStatus)) {
                throw { code: 400, message: `Order cannot be cancelled in status "${currentStatus}". Only pending or confirmed orders can be cancelled.` };
            }

            const now = admin.firestore.FieldValue.serverTimestamp();
            isPaidOrder = order.paymentStatus === "paid";

            stockRestoredNow = await restoreOrderStockInTransaction(transaction, orderRef, order, now);

            const historyEntry = {
                status: "cancelled",
                changedAt: now,
                changedBy: req.user.uid,
                note: reason ? `Cancelled by customer: ${reason}` : "Cancelled by customer"
            };

            const orderUpdates = {
                orderStatus: "cancelled",
                updatedAt: now,
                statusHistory: admin.firestore.FieldValue.arrayUnion(historyEntry)
            };

            if (isPaidOrder) {
                orderUpdates.cancellation = {
                    refundRequired: true,
                    cancelledBy: req.isAdmin ? "admin" : "customer",
                    cancelReason: reason || null,
                    requestedAt: now
                };
            }

            transaction.update(orderRef, orderUpdates);
        });

        // Requirement 2: If Shiprocket shipment/order exists, attempt cancellation via Shiprocket API
        const freshSnap = await orderRef.get();
        const freshData = freshSnap.data() || {};
        const srOrderId = freshData.shippingDetails?.shiprocketOrderId;
        let srCancelPending = false;

        if (srOrderId) {
            try {
                await cancelShiprocketOrder(srOrderId);
                await orderRef.update({
                    "shippingDetails.shiprocketCancelled": true,
                    "shippingDetails.shiprocketCancelPending": false,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
            } catch (srErr) {
                console.warn("[orders/cancel] Shiprocket cancel failed:", srErr.message);
                srCancelPending = true;
                await orderRef.update({
                    "shippingDetails.shiprocketCancelPending": true,
                    "shippingDetails.shiprocketCancelError": srErr.message,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
            }
        }

        const message = isPaidOrder
            ? "Order cancelled successfully. Refund will be processed in 5-7 working days."
            : "Order cancelled successfully.";

        return res.json({
            success: true,
            orderId,
            newStatus: "cancelled",
            refundRequired: isPaidOrder,
            stockRestored: stockRestoredNow,
            shiprocketCancelPending: srCancelPending,
            message
        });

    } catch (err) {
        if (err.code && err.message) {
            const status = typeof err.code === "number" && err.code >= 400 && err.code <= 599 ? err.code : 400;
            return sendError(res, status, "failed-precondition", err.message);
        }
        console.error("[orders/cancel]", err);
        return sendError(res, 500, "internal", err.message || "Failed to cancel order.");
    }
});

// ── POST /api/orders/list (Admin only) — paginated order list for dashboard ──
router.post("/list", authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { limit = 50, status } = req.body;
        let q = db.collection("orders");
        if (status && status !== "all") {
            const targetStatus = normalizeStatus(status);
            q = q.where("orderStatus", "==", targetStatus);
        }
        q = q.orderBy("createdAt", "desc").limit(Math.min(limit, 200));
        const snap = await q.get();
        return res.json({ orders: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
    } catch (err) {
        console.error("[orders/list]", err);
        const statusCode = (err && err.code && Number.isInteger(err.code) && err.code >= 400 && err.code <= 599) ? err.code : 500;
        return sendError(res, statusCode, "internal", err.message || "Failed to fetch orders.");
    }
});

module.exports = router;
