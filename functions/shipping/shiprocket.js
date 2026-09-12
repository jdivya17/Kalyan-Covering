"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { admin, db } = require("../lib/admin");
const { verifyAdmin } = require("../utils/auth");
const { logAuditEvent } = require("../utils/audit");
const {
    createShipmentForOrder,
    checkServiceability,
    getTrackingByOrderId,
    getPickupLocations: fetchPickupLocationsFromService,
    getAvailableCouriersForOrder,
    getTrackingByShipmentId,
} = require('./shippingService');

async function logAudit(request, action, targetCollection, targetId, before, after) {
    await logAuditEvent({
        action,
        userId: request.auth ? request.auth.uid : 'system',
        userEmail: request.auth && request.auth.token ? request.auth.token.email : 'system',
        details: { targetCollection, targetId, before, after }
    });
}

const createShipment = onCall(async (request) => {
    verifyAdmin(request);

    const { orderId, pickupLocation } = request.data;
    if (!orderId) {
        throw new HttpsError('invalid-argument', 'orderId is required.');
    }

    try {
        const result = await createShipmentForOrder(orderId, pickupLocation || '');
        await logAudit(
            request,
            'CREATE_SHIPMENT',
            'orders',
            orderId,
            null,
            { shipmentId: result.shipmentId, awbCode: result.awbCode }
        );
        return result;
    } catch (error) {
        console.error('createShipment error:', error);
        if (error instanceof HttpsError) throw error;
        throw new HttpsError('internal', error.message || 'Failed to create shipment.');
    }
});

const checkShippingServiceability = onCall(async (request) => {
    verifyAdmin(request);

    const { deliveryPincode, weight, isCOD } = request.data || {};

    if (!deliveryPincode) {
        throw new HttpsError("invalid-argument", "deliveryPincode is required.");
    }

    const pickupPincode = process.env.STORE_PICKUP_PINCODE || "638001";
    const packageWeight = typeof weight === "number" && weight > 0 ? weight : 0.5;

    try {
        const result = await checkServiceability({
            pickupPincode,
            deliveryPincode,
            weight: packageWeight,
            isCOD: isCOD === true,
        });

        await logAudit(
            request,
            "CHECK_SHIPPING_SERVICEABILITY",
            "shipping",
            deliveryPincode,
            null,
            { isServiceable: result.isServiceable, courierCount: result.availableCouriers ? result.availableCouriers.length : 0 }
        );

        return {
            success: true,
            pickupPincode,
            deliveryPincode,
            ...result,
        };
    } catch (err) {
        console.error("checkShippingServiceability error:", err);
        throw new HttpsError("internal", `Serviceability check failed: ${err.message}`);
    }
});

const getShippingCouriers = onCall(async (request) => {
    verifyAdmin(request);

    const { orderId } = request.data || {};
    if (!orderId) {
        throw new HttpsError("invalid-argument", "orderId is required.");
    }

    const pickupPincode = process.env.STORE_PICKUP_PINCODE || "638001";

    try {
        const result = await getAvailableCouriersForOrder(orderId, pickupPincode);

        await logAudit(
            request,
            "GET_SHIPPING_COURIERS",
            "orders",
            orderId,
            null,
            { isServiceable: result.isServiceable, courierCount: result.availableCouriers ? result.availableCouriers.length : 0 }
        );

        return { success: true, ...result };
    } catch (err) {
        console.error("getShippingCouriers error:", err);
        if (err.message.includes("not found")) {
            throw new HttpsError("not-found", err.message);
        }
        if (err.message.includes("shipping address")) {
            throw new HttpsError("failed-precondition", err.message);
        }
        throw new HttpsError("internal", `Failed to get couriers: ${err.message}`);
    }
});

const getShipmentTracking = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "User must be logged in.");
    }

    const { orderId, shipmentId } = request.data || {};

    if (!orderId && !shipmentId) {
        throw new HttpsError("invalid-argument", "Either orderId or shipmentId is required.");
    }

    const isAdminRole = ["owner", "manager", "staff"].includes(request.auth.token.role);

    try {
        if (orderId) {
            if (!isAdminRole) {
                const orderSnap = await db.collection("orders").doc(orderId).get();
                if (!orderSnap.exists) {
                    throw new HttpsError("not-found", "Order not found.");
                }
                if (orderSnap.data().customerId !== request.auth.uid) {
                    throw new HttpsError("permission-denied", "You can only track your own orders.");
                }
            }

            const result = await getTrackingByOrderId(orderId, true);
            return { success: true, ...result };
        }

        if (!isAdminRole) {
            throw new HttpsError(
                "permission-denied",
                "Direct shipment ID tracking requires admin access. Use orderId instead."
            );
        }

        const result = await getTrackingByShipmentId(shipmentId);
        return { success: true, ...result };

    } catch (err) {
        console.error("getShipmentTracking error:", err);
        if (err instanceof HttpsError) throw err;
        if (err.message.includes("not found")) {
            throw new HttpsError("not-found", err.message);
        }
        if (err.message.includes("no Shiprocket shipment")) {
            throw new HttpsError("failed-precondition", err.message);
        }
        throw new HttpsError("internal", `Tracking failed: ${err.message}`);
    }
});

const getShiprocketPickupLocations = onCall(async (request) => {
    verifyAdmin(request);

    try {
        const locations = await fetchPickupLocationsFromService();
        return { success: true, pickupLocations: locations };
    } catch (err) {
        console.error("getShiprocketPickupLocations error:", err);
        throw new HttpsError("internal", `Failed to fetch pickup locations: ${err.message}`);
    }
});

const getOrderTracking = getShipmentTracking;
const getPickupLocations = getShiprocketPickupLocations;

module.exports = {
    createShipment,
    checkShippingServiceability,
    getShippingCouriers,
    getShipmentTracking,
    getShiprocketPickupLocations,
    getOrderTracking,
    getPickupLocations
};
