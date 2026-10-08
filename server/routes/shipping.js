"use strict";
const express = require("express");
const { admin, db } = require("../lib/admin");
const { logAudit, sendError } = require("../lib/utils");
const { authMiddleware, requireAdmin, requireOwnerOrManager } = require("../middleware/auth");
const { createShipmentForOrder, checkServiceability, getTrackingByOrderId, getPickupLocations, getAvailableCouriersForOrder, getTrackingByShipmentId } = require("../shipping/shippingService");

const router = express.Router();

// POST /api/shipping/create-shipment (Admin only)
router.post("/create-shipment", authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { orderId, pickupLocation } = req.body;
        if (!orderId) return sendError(res, 400, "invalid-argument", "orderId is required.");
        const result = await createShipmentForOrder(orderId, pickupLocation || "");
        await logAudit(req, "CREATE_SHIPMENT", "orders", orderId, null, { shipmentId: result.shipmentId, awbCode: result.awbCode });
        return res.json(result);
    } catch (err) {
        console.error("[shipping/create-shipment]", err);
        return sendError(res, 500, "internal", err.message || "Failed to create shipment.");
    }
});

// POST /api/shipping/pincode-check (Public endpoint for checkout & product detail)
router.post("/pincode-check", async (req, res) => {
    try {
        const { pincode, deliveryPincode, weight, isCOD } = req.body;
        const targetPin = pincode || deliveryPincode;
        if (!targetPin) return sendError(res, 400, "invalid-argument", "Pincode is required.");
        const pickupPincode = process.env.STORE_PICKUP_PINCODE || "638001";
        const packageWeight = typeof weight === "number" && weight > 0 ? weight : 0.5;
        const result = await checkServiceability({ pickupPincode, deliveryPincode: targetPin, weight: packageWeight, isCOD: isCOD === true });
        
        const fastestCourier = result.availableCouriers && result.availableCouriers.length > 0
            ? [...result.availableCouriers].sort((a, b) => (parseInt(a.estimatedDays) || 99) - (parseInt(b.estimatedDays) || 99))[0]
            : null;

        return res.json({
            success: true,
            pincode: targetPin,
            isServiceable: result.isServiceable,
            estimatedDays: fastestCourier ? fastestCourier.estimatedDays : null,
            courierName: fastestCourier ? fastestCourier.courierName : null,
            availableCouriersCount: (result.availableCouriers || []).length
        });
    } catch (err) {
        console.error("[shipping/pincode-check]", err);
        return sendError(res, 500, "internal", err.message);
    }
});


// POST /api/shipping/get-couriers (Admin only)
router.post("/get-couriers", authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { orderId } = req.body;
        if (!orderId) return sendError(res, 400, "invalid-argument", "orderId is required.");
        const pickupPincode = process.env.STORE_PICKUP_PINCODE;
        if (!pickupPincode) return sendError(res, 500, "internal", "STORE_PICKUP_PINCODE is not configured.");
        const result = await getAvailableCouriersForOrder(orderId, pickupPincode);
        return res.json({ success: true, ...result });
    } catch (err) {
        console.error("[shipping/get-couriers]", err);
        return sendError(res, 500, "internal", err.message);
    }
});

// POST /api/shipping/track (Auth required — customers can only track own orders)
router.post("/track", authMiddleware, async (req, res) => {
    try {
        const { orderId, shipmentId } = req.body;
        if (!orderId && !shipmentId) return sendError(res, 400, "invalid-argument", "Either orderId or shipmentId is required.");
        const isAdmin = req.isAdmin;

        if (orderId) {
            if (!isAdmin) {
                const orderSnap = await db.collection("orders").doc(orderId).get();
                if (!orderSnap.exists) return sendError(res, 404, "not-found", "Order not found.");
                if (orderSnap.data().customerId !== req.user.uid) return sendError(res, 403, "permission-denied", "You can only track your own orders.");
            }
            const result = await getTrackingByOrderId(orderId, true);
            return res.json({ success: true, ...result });
        }

        if (!isAdmin) return sendError(res, 403, "permission-denied", "Direct shipment tracking requires admin access.");
        const result = await getTrackingByShipmentId(shipmentId);
        return res.json({ success: true, ...result });
    } catch (err) {
        console.error("[shipping/track]", err);
        return sendError(res, 500, "internal", err.message);
    }
});

// GET /api/shipping/pickup-locations (Admin only)
router.get("/pickup-locations", authMiddleware, requireAdmin, async (req, res) => {
    try {
        const locations = await getPickupLocations();
        return res.json({ success: true, pickupLocations: locations });
    } catch (err) {
        console.error("[shipping/pickup-locations]", err);
        return sendError(res, 500, "internal", err.message);
    }
});

// POST /api/shipping/webhook (Shiprocket Webhook)
router.post("/webhook", async (req, res) => {
    try {
        const webhookToken = process.env.SHIPROCKET_WEBHOOK_TOKEN;
        if (webhookToken) {
            const apiKey = req.headers["x-api-key"] || req.headers["x-shiprocket-token"];
            if (apiKey !== webhookToken) {
                return sendError(res, 401, "unauthenticated", "Invalid or missing webhook token.");
            }
        }

        const payload = req.body || {};
        const shipmentId = payload.shipment_id ? String(payload.shipment_id) : null;
        const awbCode = payload.awb || payload.awb_code || null;
        const rawStatus = String(payload.current_status || payload.status || "").trim().toUpperCase();

        if (!shipmentId && !awbCode && !payload.order_id) {
            return res.status(200).json({ success: true, message: "Order not found or ignored." });
        }

        // Map Shiprocket status to canonical order status
        let targetStatus = null;
        if (["SHIPPED", "IN TRANSIT", "DISPATCHED", "PICKED UP", "IN-TRANSIT"].some(s => rawStatus.includes(s))) {
            targetStatus = "shipped";
        } else if (rawStatus.includes("OUT FOR DELIVERY")) {
            targetStatus = "out_for_delivery";
        } else if (rawStatus.includes("DELIVERED")) {
            targetStatus = "delivered";
        } else if (rawStatus.includes("CANCELED") || rawStatus.includes("CANCELLED")) {
            targetStatus = "cancelled";
        } else if (rawStatus.includes("RETURN") || rawStatus.includes("RTO")) {
            targetStatus = "returned";
        }

        let orderSnap = null;
        if (shipmentId) {
            const qSnap = await db.collection("orders").where("shippingDetails.shiprocketShipmentId", "==", shipmentId).limit(1).get();
            if (!qSnap.empty) orderSnap = qSnap.docs[0];
        }
        if (!orderSnap && awbCode) {
            let qSnap = await db.collection("orders").where("shippingDetails.awbCode", "==", awbCode).limit(1).get();
            if (qSnap.empty) qSnap = await db.collection("orders").where("shippingDetails.trackingNumber", "==", awbCode).limit(1).get();
            if (!qSnap.empty) orderSnap = qSnap.docs[0];
        }
        if (!orderSnap && payload.order_id) {
            const orderIdStr = String(payload.order_id);
            let qSnap = await db.collection("orders").where("orderNumber", "==", orderIdStr).limit(1).get();
            if (!qSnap.empty) orderSnap = qSnap.docs[0];
            else {
                const docSnap = await db.collection("orders").doc(orderIdStr).get();
                if (docSnap.exists) orderSnap = docSnap;
            }
        }

        if (!orderSnap) {
            return res.status(200).json({ success: true, message: "Order not found or ignored." });
        }

        const orderRef = orderSnap.ref;
        const currentStatus = String(orderSnap.data().orderStatus || orderSnap.data().status || "pending").toLowerCase();
        const now = admin.firestore.FieldValue.serverTimestamp();

        // State hierarchy rank: don't downgrade a higher state to a lower state
        const STATUS_RANK = {
            "payment_pending": 0,
            "pending": 1,
            "confirmed": 2,
            "packed": 3,
            "shipped": 4,
            "out_for_delivery": 5,
            "delivered": 6,
            "returned": 7,
            "cancelled": 7
        };

        const currentRank = STATUS_RANK[currentStatus] || 0;
        const targetRank = targetStatus ? (STATUS_RANK[targetStatus] || 0) : 0;

        const updatePayload = {
            "shippingDetails.latestTrackingStatus": rawStatus,
            updatedAt: now
        };

        // Only promote status if targetRank > currentRank
        if (targetStatus && targetRank > currentRank) {
            updatePayload.orderStatus = targetStatus;
            updatePayload.statusHistory = admin.firestore.FieldValue.arrayUnion({
                status: targetStatus,
                changedAt: now,
                changedBy: "shiprocket_webhook",
                note: `Status updated via Shiprocket webhook (${rawStatus})`
            });
        }

        await orderRef.update(updatePayload);

        return res.status(200).json({ success: true, message: "Webhook processed successfully." });
    } catch (err) {
        console.error("[shipping/webhook]", err);
        return sendError(res, 500, "internal", err.message || "Failed to process shipping webhook.");
    }
});


module.exports = router;
