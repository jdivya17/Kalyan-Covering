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

// POST /api/shipping/check-serviceability (Admin only)
router.post("/check-serviceability", authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { deliveryPincode, weight, isCOD } = req.body;
        if (!deliveryPincode) return sendError(res, 400, "invalid-argument", "deliveryPincode is required.");
        const pickupPincode = process.env.STORE_PICKUP_PINCODE;
        if (!pickupPincode) return sendError(res, 500, "internal", "STORE_PICKUP_PINCODE is not configured.");
        const packageWeight = typeof weight === "number" && weight > 0 ? weight : 0.5;
        const result = await checkServiceability({ pickupPincode, deliveryPincode, weight: packageWeight, isCOD: isCOD === true });
        return res.json({ success: true, pickupPincode, deliveryPincode, ...result });
    } catch (err) {
        console.error("[shipping/check-serviceability]", err);
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

module.exports = router;
