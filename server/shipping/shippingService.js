/**
 * shippingService.js — Vercel/Express compatible
 * Uses Firebase Admin SDK via require('../lib/admin').
 * Uses centralized config from ./config.
 */
"use strict";

const { admin, db } = require("../lib/admin");
const { shiprocketRequest } = require("./shiprocketClient");
const { config, assertPickupConfig } = require("./config");
const {
    sanitizePincode,
    validateShippingAddress,
    formatAddressForShiprocket,
    calculateDimensions
} = require("./shippingUtils");

function log(level, message, meta = {}) {
    const entry = { severity: level.toUpperCase(), component: "SHIPPING_SERVICE", message, timestamp: new Date().toISOString(), ...meta };
    if (level === "error") console.error(JSON.stringify(entry));
    else if (level === "warn") console.warn(JSON.stringify(entry));
    else console.log(JSON.stringify(entry));
}

async function checkServiceability({ pickupPincode, deliveryPincode, weight, isCOD = false }) {
    const targetPickup = pickupPincode || config.pickupPincode;
    if (!targetPickup) {
        throw new Error("Shiprocket pickup location/pincode is not configured. Set SHIPROCKET_PICKUP_PINCODE.");
    }

    const sanitizedPickup = sanitizePincode(targetPickup);
    const sanitizedDelivery = sanitizePincode(deliveryPincode);
    const packageWeight = typeof weight === "number" && !isNaN(weight) && weight > 0 ? weight : config.defaultWeightKg;

    log("info", "Checking serviceability", { sanitizedPickup, sanitizedDelivery, packageWeight, isCOD });

    const params = {
        pickup_postcode: sanitizedPickup,
        delivery_postcode: sanitizedDelivery,
        weight: packageWeight,
        cod: isCOD ? 1 : 0
    };

    try {
        const result = await shiprocketRequest("GET", "/courier/serviceability/", null, params);
        const couriers = result?.data?.available_courier_companies || [];
        return {
            isServiceable: couriers.length > 0,
            availableCouriers: couriers.map(c => ({
                courierId: c.courier_company_id,
                courierName: c.courier_name,
                estimatedDays: c.estimated_delivery_days,
                ratePerKg: c.rate,
                totalRate: c.freight_charge,
                cod: c.cod === 1,
                tracking: c.tracking,
                minWeight: c.min_weight,
                isRecommended: c.is_recommended === 1,
            })),
            rawResponse: result?.data || {},
        };
    } catch (err) {
        log("error", "Serviceability check failed", { error: err.message });
        throw new Error(`Serviceability check failed: ${err.message}`);
    }
}

async function getAvailableCouriersForOrder(orderId, pickupPincode) {
    if (!orderId) throw new Error("orderId is required.");
    const activePickupPincode = pickupPincode || config.pickupPincode;
    if (!activePickupPincode) {
        throw new Error("Shiprocket pickup location/pincode is not configured. Set SHIPROCKET_PICKUP_PINCODE.");
    }

    const orderSnap = await db.collection("orders").doc(orderId).get();
    if (!orderSnap.exists) throw new Error(`Order ${orderId} not found.`);
    const order = orderSnap.data();
    const shippingAddress = order.shippingAddress;
    if (!shippingAddress) throw new Error(`Order ${orderId} has no shipping address.`);

    try {
        validateShippingAddress(shippingAddress);
    } catch (e) {
        throw new Error(`Invalid address on order: ${e.message}`);
    }

    const dims = calculateDimensions(order.items || []);
    const isCod = (order.payment?.method === "cod" || order.paymentMethod === "cod");
    const deliveryPin = shippingAddress.pin || shippingAddress.pincode;

    const result = await checkServiceability({
        pickupPincode: activePickupPincode,
        deliveryPincode: deliveryPin,
        weight: dims.weight,
        isCOD: isCod
    });

    try {
        await db.collection("orders").doc(orderId).update({
            "shippingDetails.serviceabilityChecked": true,
            "shippingDetails.serviceabilityCheckedAt": admin.firestore.FieldValue.serverTimestamp(),
            "shippingDetails.isServiceable": result.isServiceable,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
    } catch (e) {
        log("warn", "Cache serviceability failed", { error: e.message });
    }

    return {
        orderId,
        orderNumber: order.orderNumber || orderId,
        customerPin: deliveryPin,
        packageWeight: dims.weight,
        ...result
    };
}

async function getTrackingByShipmentId(shipmentId) {
    if (!shipmentId) throw new Error("shipmentId is required.");
    try {
        const result = await shiprocketRequest("GET", `/courier/track/shipment/${shipmentId}`);
        const td = result?.tracking_data || result;
        return {
            shipmentId,
            currentStatus: td?.shipment_status || null,
            awbCode: td?.awb_code || null,
            courierName: td?.courier_name || null,
            activities: (td?.activities || []).map(a => ({
                date: a.date,
                status: a.status,
                activity: a.activity,
                location: a.location
            })),
            expectedDeliveryDate: td?.etd || null,
            rawResponse: td,
        };
    } catch (err) {
        log("error", "Tracking by shipmentId failed", { shipmentId, error: err.message });
        throw err;
    }
}

async function getTrackingByOrderId(orderId, updateOrder = true) {
    if (!orderId) throw new Error("orderId is required.");
    const orderSnap = await db.collection("orders").doc(orderId).get();
    if (!orderSnap.exists) throw new Error(`Order ${orderId} not found.`);
    const order = orderSnap.data();
    const shipmentId = order.shippingDetails?.shiprocketShipmentId;
    const awbCode = order.shippingDetails?.awbCode || order.shippingDetails?.trackingNumber;

    if (!shipmentId && !awbCode) {
        throw new Error(`Order ${orderId} has no Shiprocket shipment ID. Create a shipment first.`);
    }

    let trackingResult;
    if (shipmentId) {
        trackingResult = await getTrackingByShipmentId(shipmentId);
    } else {
        const result = await shiprocketRequest("GET", "/courier/track", null, { awb: awbCode });
        trackingResult = {
            awbCode,
            currentStatus: result?.tracking_data?.shipment_status || null,
            activities: result?.tracking_data?.activities || [],
            rawResponse: result?.tracking_data || result
        };
    }

    if (updateOrder && trackingResult.currentStatus) {
        try {
            await db.collection("orders").doc(orderId).update({
                "shippingDetails.trackingLastChecked": admin.firestore.FieldValue.serverTimestamp(),
                "shippingDetails.latestTrackingStatus": trackingResult.currentStatus,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        } catch (e) {
            log("warn", "Failed to update tracking on order", { error: e.message });
        }
    }
    return { orderId, orderNumber: order.orderNumber || orderId, ...trackingResult };
}

async function getPickupLocations() {
    const result = await shiprocketRequest("GET", "/settings/company/pickup");
    const locations = result?.data?.shipping_address || [];
    return locations.map(loc => ({
        id: loc.id,
        name: loc.pickup_location,
        address: loc.address,
        city: loc.city,
        state: loc.state,
        country: loc.country,
        pincode: loc.pin_code,
        phone: loc.phone,
        email: loc.email,
        isDefault: loc.is_first_kilometer === 1,
    }));
}

async function createShipmentForOrder(orderId, pickupLocation = "", courierId = null) {
    if (!orderId) throw new Error("orderId is required.");

    const orderRef = db.collection("orders").doc(orderId);
    let orderData = null;

    // Transaction lock for idempotency and order guard checks
    const lockResult = await db.runTransaction(async (transaction) => {
        const snap = await transaction.get(orderRef);
        if (!snap.exists) throw new Error(`Order ${orderId} not found.`);
        const data = snap.data();

        // 1. Guard checks on order status
        const orderStatus = String(data.orderStatus || data.status || "pending").toLowerCase();
        const isRefundRequired = Boolean(data.refundRequired || data.cancellation?.refundRequired);

        if (["cancelled", "canceled"].includes(orderStatus)) {
            throw new Error(`Cannot create shipment: Order ${orderId} is cancelled.`);
        }
        if (["returned", "return_requested"].includes(orderStatus)) {
            throw new Error(`Cannot create shipment: Order ${orderId} has been returned.`);
        }
        if (orderStatus === "action_required_oversold" || orderStatus === "oversold") {
            throw new Error(`Cannot create shipment: Order ${orderId} is in oversold review state.`);
        }
        if (orderStatus === "payment_pending") {
            throw new Error(`Cannot create shipment: Order ${orderId} payment is still pending.`);
        }
        if (isRefundRequired) {
            throw new Error(`Cannot create shipment: Order ${orderId} has a pending refund request.`);
        }

        const isCod = (data.payment?.method === "cod" || data.paymentMethod === "cod");
        const isPaid = data.paymentStatus === "paid";

        if (!isPaid && !isCod) {
            throw new Error(`Cannot create shipment: Online order ${orderId} is not marked as paid.`);
        }

        const allowedStatuses = ["pending", "confirmed", "packed", "placed", "order_placed"];
        if (!allowedStatuses.includes(orderStatus)) {
            throw new Error(`Cannot create shipment: Order status is "${orderStatus}". Shipments can only be created for pending, confirmed, or packed orders.`);
        }

        // 2. Check if shipment already created (idempotency)
        if (data.shippingDetails?.shiprocketShipmentId || data.shippingDetails?.shiprocketOrderId || data.shippingDetails?.shiprocket_order_id) {
            return { alreadyCreated: true, data: data.shippingDetails };
        }

        // 3. Check lock flag
        if (data.shippingDetails?.creatingShipment) {
            const creatingAt = data.shippingDetails?.creatingShipmentAt;
            let isStale = false;
            if (creatingAt) {
                const creatingMs = creatingAt.toDate ? creatingAt.toDate().getTime() : new Date(creatingAt).getTime();
                if (Date.now() - creatingMs > 5 * 60 * 1000) {
                    isStale = true;
                }
            }
            if (!isStale) {
                throw new Error(`Shipment creation already in progress for order ${orderId}. Please wait.`);
            }
        }

        transaction.update(orderRef, {
            "shippingDetails.creatingShipment": true,
            "shippingDetails.creatingShipmentAt": admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return { alreadyCreated: false, data };
    });

    if (lockResult.alreadyCreated) {
        const sd = lockResult.data;
        return {
            success: true,
            orderId,
            shiprocketOrderId: sd.shiprocketOrderId || sd.shiprocket_order_id || null,
            shiprocketShipmentId: sd.shiprocketShipmentId || null,
            awbCode: sd.awbCode || sd.trackingNumber || null,
            courierName: sd.courierName || sd.carrier || null,
            trackingUrl: sd.trackingUrl || null,
            trackingNumber: sd.awbCode || sd.trackingNumber || null,
            carrier: sd.courierName || sd.carrier || null,
            message: "Shipment already exists."
        };
    }

    orderData = lockResult.data;

    try {
        // Assert pickup config
        assertPickupConfig();

        const pickupLocations = await getPickupLocations();
        const availableNames = pickupLocations.map(l => l.name);
        const selectedPickup = pickupLocation || config.pickupLocation;

        if (!selectedPickup || !availableNames.includes(selectedPickup)) {
            const locationList = availableNames.length > 0 ? availableNames.join(", ") : "none found in Shiprocket account";
            throw new Error(`Shiprocket pickup location not found. Ensure configured pickup location '${selectedPickup || ""}' matches Shiprocket exactly. Available: [${locationList}]`);
        }

        let deliveryAddress;
        try {
            deliveryAddress = formatAddressForShiprocket(orderData.shippingAddress);
        } catch (err) {
            throw new Error(`Invalid shipping address: ${err.message}`);
        }

        const dims = calculateDimensions(orderData.items || []);
        const orderItems = (orderData.items || []).map(item => ({
            name: item.name || "Jewellery Item",
            sku: item.sku || item.id || "SKU-UNKNOWN",
            units: item.qty || item.quantity || 1,
            selling_price: item.price || 0,
            discount: 0,
            tax: 0,
            hsn: 7113
        }));

        const dateObj = orderData.createdAt
            ? (orderData.createdAt.toDate ? orderData.createdAt.toDate() : new Date(orderData.createdAt))
            : new Date();
        const orderDate = dateObj.toISOString().replace("T", " ").replace(/\.\d+Z$/, "").substring(0, 16);
        const isCod = (orderData.payment?.method === "cod" || orderData.paymentMethod === "cod");

        const adhocPayload = {
            order_id: orderData.orderNumber || orderId,
            order_date: orderDate,
            pickup_location: selectedPickup,
            ...deliveryAddress,
            billing_customer_name: deliveryAddress.delivery_customer_name,
            billing_last_name: deliveryAddress.delivery_last_name,
            billing_address: deliveryAddress.delivery_address,
            billing_city: deliveryAddress.delivery_city,
            billing_pincode: deliveryAddress.delivery_pincode,
            billing_state: deliveryAddress.delivery_state,
            billing_country: deliveryAddress.delivery_country,
            billing_email: deliveryAddress.delivery_email,
            billing_phone: deliveryAddress.delivery_phone,
            shipping_is_billing: true,
            order_items: orderItems,
            payment_method: isCod ? "COD" : "Prepaid",
            sub_total: orderData.totalAmount || 0,
            length: dims.length,
            breadth: dims.breadth,
            height: dims.height,
            weight: dims.weight
        };

        // 1. Create order on Shiprocket
        const adhocRes = await shiprocketRequest("POST", "/orders/create/adhoc", adhocPayload);
        const shipmentId = adhocRes.shipment_id;
        const shiprocketOrderId = adhocRes.order_id;
        if (!shipmentId) throw new Error("Shiprocket returned no shipment_id.");

        // 2. Assign courier / AWB
        let selectedCourierId = courierId;
        if (!selectedCourierId) {
            try {
                const serviceability = await checkServiceability({
                    pickupPincode: config.pickupPincode,
                    deliveryPincode: orderData.shippingAddress?.pin || orderData.shippingAddress?.pincode,
                    weight: dims.weight,
                    isCOD: isCod
                });
                if (serviceability.availableCouriers && serviceability.availableCouriers.length > 0) {
                    const rec = serviceability.availableCouriers.find(c => c.isRecommended) || serviceability.availableCouriers[0];
                    selectedCourierId = rec.courierId;
                }
            } catch (sErr) {
                log("warn", "Serviceability check during AWB assignment skipped", { error: sErr.message });
            }
        }

        const awbPayload = { shipment_id: shipmentId };
        if (selectedCourierId) awbPayload.courier_id = selectedCourierId;

        let awbCode = null;
        let courierName = null;
        let trackingUrl = null;
        try {
            const awbRes = await shiprocketRequest("POST", "/courier/assign/awb", awbPayload);
            const awbData = awbRes?.response?.data || awbRes;
            awbCode = awbData?.awb_code || awbRes?.awb_code || null;
            courierName = awbData?.courier_name || awbRes?.courier_name || null;
            trackingUrl = awbData?.tracking_url || (awbCode ? `https://shiprocket.co/tracking/${awbCode}` : null);
        } catch (awbErr) {
            log("warn", "AWB assignment deferred", { error: awbErr.message });
        }

        // 3. Generate pickup
        try {
            await shiprocketRequest("POST", "/courier/generate/pickup", { shipment_id: [shipmentId] });
        } catch (pickErr) {
            log("warn", "Pickup generation notice", { error: pickErr.message });
        }

        const updates = {
            "shippingDetails.shiprocketOrderId": shiprocketOrderId ? String(shiprocketOrderId) : null,
            "shippingDetails.shiprocketShipmentId": String(shipmentId),
            "shippingDetails.awbCode": awbCode,
            "shippingDetails.courierName": courierName,
            "shippingDetails.trackingUrl": trackingUrl,
            "shippingDetails.trackingNumber": awbCode,
            "shippingDetails.carrier": courierName,
            "shippingDetails.creatingShipment": false,
            orderStatus: "packed",
            shippingStatus: "packed",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            statusHistory: admin.firestore.FieldValue.arrayUnion({
                status: "packed",
                changedAt: new Date(),
                changedBy: "system_shiprocket",
                note: `Shipment created. ID: ${shipmentId}${awbCode ? `, AWB: ${awbCode}` : ""}`
            })
        };

        await orderRef.update(updates);

        return {
            success: true,
            orderId,
            shiprocketOrderId: shiprocketOrderId ? String(shiprocketOrderId) : null,
            shiprocketShipmentId: String(shipmentId),
            awbCode,
            courierName,
            trackingUrl,
            trackingNumber: awbCode,
            carrier: courierName,
            message: `Shipment created. ID: ${shipmentId}`
        };
    } catch (err) {
        // Clear creatingShipment flag on failure
        await orderRef.update({
            "shippingDetails.creatingShipment": false,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }).catch(() => {});

        log("error", "Shipment creation failed", { orderId, error: err.message });
        throw err;
    }
}

async function cancelShiprocketOrder(shiprocketOrderId) {
    if (!shiprocketOrderId) return { success: false, message: "No shiprocketOrderId provided." };
    try {
        const res = await shiprocketRequest("POST", "/orders/cancel", { ids: [shiprocketOrderId] });
        return { success: true, response: res };
    } catch (err) {
        log("warn", "Shiprocket cancellation failed", { shiprocketOrderId, error: err.message });
        throw err;
    }
}

module.exports = {
    checkServiceability,
    getAvailableCouriersForOrder,
    getTrackingByShipmentId,
    getTrackingByOrderId,
    getPickupLocations,
    createShipmentForOrder,
    cancelShiprocketOrder
};
