"use strict";
const express = require("express");
const crypto = require("crypto");
const { admin, db } = require("../lib/admin");
const { logAudit, sendError } = require("../lib/utils");
const { restoreOrderStockInTransaction } = require("../lib/stock");
const { authMiddleware, requireAdmin } = require("../middleware/auth");
const { rateLimit } = require("../middleware/rateLimit");
const { config, cleanEnvVar, assertPickupConfig } = require("../shipping/config");
const {
    createShipmentForOrder,
    checkServiceability,
    getTrackingByOrderId,
    getPickupLocations,
    getAvailableCouriersForOrder,
    getTrackingByShipmentId
} = require("../shipping/shippingService");

const router = express.Router();

function safeEqual(a, b) {
    const A = Buffer.from(String(a || "")), B = Buffer.from(String(b || ""));
    return A.length === B.length && crypto.timingSafeEqual(A, B);
}

function mapShiprocketStatus(raw) {
    const s = String(raw || "").trim().toUpperCase();
    if (!s) return null;
    if (s.includes("RTO") || s.includes("RETURN")) return "returned";
    if (s.includes("UNDELIVERED") || s.includes("NDR")) return null; // record only, no status change
    if (s.includes("OUT FOR DELIVERY")) return "out_for_delivery";
    if (s.includes("DELIVERED")) return "delivered";
    if (s.includes("CANCEL")) return "cancelled";
    if (["SHIPPED", "IN TRANSIT", "IN-TRANSIT", "DISPATCHED", "PICKED UP", "PICKED-UP"].some((k) => s.includes(k))) return "shipped";
    if (["PICKUP SCHEDULED", "PICKUP GENERATED", "PICKUP QUEUED", "MANIFEST GENERATED"].some((k) => s.includes(k))) return "packed";
    return null;
}

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
router.post("/pincode-check", rateLimit({ windowMs: 60_000, max: 20 }), async (req, res) => {
    try {
        const targetPin = String(req.body.pincode || req.body.deliveryPincode || "").trim();
        if (!/^\d{6}$/.test(targetPin)) return sendError(res, 400, "invalid-argument", "Enter a valid 6-digit pincode.");

        assertPickupConfig();
        const pickupPincode = config.pickupPincode;
        const packageWeight = typeof req.body.weight === "number" && req.body.weight > 0 ? req.body.weight : config.defaultWeightKg;

        if (!pickupPincode) {
            console.warn("[pincode-check] SHIPROCKET_PICKUP_PINCODE is not configured. Returning default deliverability.");
            return res.json({
                success: true,
                pincode: targetPin,
                isServiceable: true,
                estimatedDays: "3 to 5",
                courierName: "Standard Delivery",
                availableCouriersCount: 1
            });
        }

        let result = { isServiceable: true, availableCouriers: [] };
        try {
            result = await checkServiceability({
                pickupPincode,
                deliveryPincode: targetPin,
                weight: packageWeight,
                isCOD: req.body.isCOD === true
            });
        } catch (serviceErr) {
            console.warn("[pincode-check] Shiprocket check failed, defaulting to deliverable:", serviceErr.message);
            return res.json({
                success: true,
                pincode: targetPin,
                isServiceable: true,
                estimatedDays: "3 to 5",
                courierName: "Standard Express Courier",
                availableCouriersCount: 1
            });
        }

        const fastestCourier = result.availableCouriers && result.availableCouriers.length > 0
            ? [...result.availableCouriers].sort((a, b) => (parseInt(a.estimatedDays) || 99) - (parseInt(b.estimatedDays) || 99))[0]
            : null;

        return res.json({
            success: true,
            pincode: targetPin,
            isServiceable: result.isServiceable !== false,
            estimatedDays: fastestCourier ? fastestCourier.estimatedDays : "3 to 5",
            courierName: fastestCourier ? fastestCourier.courierName : "Express Courier",
            availableCouriersCount: (result.availableCouriers || []).length
        });
    } catch (err) {
        console.error("[shipping/pincode-check]", err);
        return res.json({
            success: true,
            pincode: req.body.pincode || "",
            isServiceable: true,
            estimatedDays: "3 to 5",
            courierName: "Standard Delivery"
        });
    }
});

// POST /api/shipping/get-couriers (Admin only)
router.post("/get-couriers", authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { orderId } = req.body;
        if (!orderId) return sendError(res, 400, "invalid-argument", "orderId is required.");
        const pickupPincode = config.pickupPincode;
        if (!pickupPincode) {
            return sendError(res, 500, "internal", "Shiprocket pickup location/pincode is not configured. Set SHIPROCKET_PICKUP_PINCODE.");
        }
        const result = await getAvailableCouriersForOrder(orderId, pickupPincode);
        return res.json({ success: true, ...result });
    } catch (err) {
        console.error("[shipping/get-couriers]", err);
        return sendError(res, 500, "internal", err.message);
    }
});

// POST /api/shipping/track (Auth required — customers can only track own orders)
router.post("/track", authMiddleware, async (req, res) => {
    const isAdmin = Boolean(req.isAdmin);
    try {
        const { orderId, shipmentId } = req.body;
        if (!orderId && !shipmentId) return sendError(res, 400, "invalid-argument", "Either orderId or shipmentId is required.");

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
        if (!isAdmin) {
            return sendError(res, 500, "internal", "Tracking is not available right now.");
        }
        return sendError(res, 500, "internal", err.message || "Failed to retrieve tracking details.");
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
        const webhookToken = config.webhookToken;
        if (!webhookToken) {
            console.error("[shipping/webhook] SHIPROCKET_WEBHOOK_TOKEN is not configured — rejecting.");
            return sendError(res, 500, "internal", "Webhook not configured.");
        }

        const incomingToken = req.headers["x-api-key"] || req.headers["x-shiprocket-token"];
        if (!safeEqual(incomingToken, webhookToken)) {
            return sendError(res, 401, "unauthenticated", "Invalid or missing webhook token.");
        }

        const payload = req.body || {};
        const shipmentId = payload.shipment_id ? String(payload.shipment_id) : null;
        const awbCode = payload.awb || payload.awb_code || null;
        const rawStatus = String(payload.current_status || payload.status || "").trim();

        // Log event type and AWB only, never the token!
        console.log("[shipping/webhook] Processing event", { status: rawStatus, awb: awbCode, shipmentId });

        if (!shipmentId && !awbCode && !payload.order_id) {
            return res.status(200).json({ success: true, message: "Order not found or ignored." });
        }

        const targetStatus = mapShiprocketStatus(rawStatus);

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
        const orderData = orderSnap.data();
        const currentStatus = String(orderData.orderStatus || orderData.status || "pending").toLowerCase();
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

        if (targetStatus === "delivered" && (orderData.payment?.method === "cod" || orderData.paymentMethod === "cod") && orderData.paymentStatus !== "paid") {
            updatePayload.paymentStatus = "paid";
            updatePayload["payment.paidAt"] = now;
        }

        if (targetStatus === "returned") {
            updatePayload["returnInfo.stockReviewPending"] = true;
        }

        if (targetStatus === "cancelled") {
            await db.runTransaction(async (t) => {
                const d = await t.get(orderRef);
                if (d.exists) await restoreOrderStockInTransaction(t, orderRef, d.data(), now);
            });
            if (orderData.paymentStatus === "paid") {
                updatePayload["cancellation.refundRequired"] = true;
            }
        }

        // Only promote status if targetRank > currentRank
        if (targetStatus && targetRank > currentRank) {
            updatePayload.orderStatus = targetStatus;
            updatePayload.shippingStatus = targetStatus;
            updatePayload.statusHistory = admin.firestore.FieldValue.arrayUnion({
                status: targetStatus,
                changedAt: new Date(),
                changedBy: "shiprocket_webhook",
                note: `Status updated via Shiprocket webhook (${rawStatus})`
            });
        }

        await orderRef.update(updatePayload);

        return res.status(200).json({ success: true, message: "Webhook processed successfully." });
    } catch (err) {
        console.error("[shipping/webhook]", err);
        return sendError(res, 500, "internal", "Failed to process shipping webhook.");
    }
});

// GET & POST /api/shipping/config (Public endpoint for store shipping rules)
const getShippingConfigHandler = async (req, res) => {
    try {
        const shippingDoc = await db.collection("settings").doc("shipping").get();
        const data = shippingDoc.exists ? shippingDoc.data() : {};
        return res.json({
            success: true,
            standardFee: typeof data.standardFee === "number" ? Math.max(0, data.standardFee) : 49,
            freeThreshold: typeof data.freeThreshold === "number" ? Math.max(0, data.freeThreshold) : 499,
            codFee: typeof data.codFee === "number" ? Math.max(0, data.codFee) : 50,
            allFree: Boolean(data.allFree)
        });
    } catch (err) {
        console.warn("[shipping/config] Error reading shipping settings:", err.message);
        return res.json({
            success: true,
            standardFee: 49,
            freeThreshold: 499,
            codFee: 50,
            allFree: false
        });
    }
};

router.get("/config", getShippingConfigHandler);
router.post("/config", getShippingConfigHandler);

module.exports = router;
