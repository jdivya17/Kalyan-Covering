/**
 * shippingService.js — Vercel/Express compatible
 * Uses Firebase Admin SDK via require('../lib/admin') instead of inline init.
 */
"use strict";

const { admin, db } = require("../lib/admin");
const { shiprocketRequest } = require("./shiprocketClient");
const { sanitizePincode, validateShippingAddress, formatAddressForShiprocket, calculateDimensions } = require("./shippingUtils");

function log(level, message, meta = {}) {
    const entry = { severity: level.toUpperCase(), component: "SHIPPING_SERVICE", message, timestamp: new Date().toISOString(), ...meta };
    if (level === "error") console.error(JSON.stringify(entry));
    else if (level === "warn") console.warn(JSON.stringify(entry));
    else console.log(JSON.stringify(entry));
}

async function checkServiceability({ pickupPincode, deliveryPincode, weight, isCOD = false }) {
    log("info", "Checking serviceability", { pickupPincode, deliveryPincode, weight, isCOD });
    const sanitizedPickup = sanitizePincode(pickupPincode);
    const sanitizedDelivery = sanitizePincode(deliveryPincode);
    if (typeof weight !== "number" || isNaN(weight) || weight <= 0) throw new Error(`Invalid weight: ${weight}.`);
    const params = { pickup_postcode: sanitizedPickup, delivery_postcode: sanitizedDelivery, weight, cod: isCOD ? 1 : 0 };
    try {
        const result = await shiprocketRequest("GET", "/courier/serviceability/", null, params);
        const couriers = result?.data?.available_courier_companies || [];
        return {
            isServiceable: couriers.length > 0,
            availableCouriers: couriers.map(c => ({
                courierId: c.courier_company_id, courierName: c.courier_name,
                estimatedDays: c.estimated_delivery_days, ratePerKg: c.rate,
                totalRate: c.freight_charge, cod: c.cod === 1, tracking: c.tracking,
                minWeight: c.min_weight, isRecommended: c.is_recommended === 1,
            })),
            rawResponse: result?.data || {},
        };
    } catch (err) {
        throw new Error(`Serviceability check failed: ${err.message}`);
    }
}

async function getAvailableCouriersForOrder(orderId, pickupPincode) {
    if (!orderId) throw new Error("orderId is required.");
    if (!pickupPincode) throw new Error("pickupPincode is required.");
    const orderSnap = await db.collection("orders").doc(orderId).get();
    if (!orderSnap.exists) throw new Error(`Order ${orderId} not found.`);
    const order = orderSnap.data();
    const shippingAddress = order.shippingAddress;
    if (!shippingAddress) throw new Error(`Order ${orderId} has no shipping address.`);
    try { validateShippingAddress(shippingAddress); } catch (e) { throw new Error(`Invalid address on order: ${e.message}`); }
    const dims = calculateDimensions(order.items || []);
    const result = await checkServiceability({ pickupPincode, deliveryPincode: shippingAddress.pin || shippingAddress.pincode, weight: dims.weight, isCOD: order.payment?.method === "cod" });
    try {
        await db.collection("orders").doc(orderId).update({
            "shippingDetails.serviceabilityChecked": true,
            "shippingDetails.serviceabilityCheckedAt": admin.firestore.FieldValue.serverTimestamp(),
            "shippingDetails.isServiceable": result.isServiceable,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
    } catch (e) { log("warn", "Cache serviceability failed", { error: e.message }); }
    return { orderId, orderNumber: order.orderNumber, customerPin: shippingAddress.pin || shippingAddress.pincode, packageWeight: dims.weight, ...result };
}

async function getTrackingByShipmentId(shipmentId) {
    if (!shipmentId) throw new Error("shipmentId is required.");
    try {
        const result = await shiprocketRequest("GET", `/courier/track/shipment/${shipmentId}`);
        const td = result?.tracking_data || result;
        return {
            shipmentId, currentStatus: td?.shipment_status || null,
            awbCode: td?.awb_code || null, courierName: td?.courier_name || null,
            activities: (td?.activities || []).map(a => ({ date: a.date, status: a.status, activity: a.activity, location: a.location })),
            expectedDeliveryDate: td?.etd || null, rawResponse: td,
        };
    } catch (err) { throw new Error(`Tracking failed for shipment ${shipmentId}: ${err.message}`); }
}

async function getTrackingByOrderId(orderId, updateOrder = true) {
    if (!orderId) throw new Error("orderId is required.");
    const orderSnap = await db.collection("orders").doc(orderId).get();
    if (!orderSnap.exists) throw new Error(`Order ${orderId} not found.`);
    const order = orderSnap.data();
    const shipmentId = order.shippingDetails?.shiprocketShipmentId;
    const awbCode = order.shippingDetails?.awbCode;
    if (!shipmentId && !awbCode) throw new Error(`Order ${orderId} has no Shiprocket shipment ID. Create a shipment first.`);
    let trackingResult;
    if (shipmentId) {
        trackingResult = await getTrackingByShipmentId(shipmentId);
    } else {
        const result = await shiprocketRequest("GET", "/courier/track", null, { awb: awbCode });
        trackingResult = { awbCode, currentStatus: result?.tracking_data?.shipment_status || null, activities: result?.tracking_data?.activities || [], rawResponse: result?.tracking_data || result };
    }
    if (updateOrder && trackingResult.currentStatus) {
        try {
            await db.collection("orders").doc(orderId).update({
                "shippingDetails.trackingLastChecked": admin.firestore.FieldValue.serverTimestamp(),
                "shippingDetails.latestTrackingStatus": trackingResult.currentStatus,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        } catch (e) { log("warn", "Failed to update tracking on order", { error: e.message }); }
    }
    return { orderId, orderNumber: order.orderNumber, ...trackingResult };
}

async function getPickupLocations() {
    const result = await shiprocketRequest("GET", "/settings/company/pickup");
    const locations = result?.data?.shipping_address || [];
    return locations.map(loc => ({
        id: loc.id, name: loc.pickup_location, address: loc.address, city: loc.city,
        state: loc.state, country: loc.country, pincode: loc.pin_code, phone: loc.phone, email: loc.email,
        isDefault: loc.is_first_kilometer === 1,
    }));
}

async function createShipmentForOrder(orderId, pickupLocation = "", courierId = null) {
    if (!orderId) throw new Error("orderId is required.");

    const orderRef = db.collection("orders").doc(orderId);
    let orderData = null;

    // Transaction lock for idempotency
    const lockResult = await db.runTransaction(async (transaction) => {
        const snap = await transaction.get(orderRef);
        if (!snap.exists) throw new Error(`Order ${orderId} not found.`);
        const data = snap.data();

        if (data.paymentStatus !== "paid" && data.payment?.method !== "cod") {
            throw new Error(`Order ${orderId} is not paid and is not COD.`);
        }
        if (data.shippingDetails?.shiprocketShipmentId) {
            return { alreadyCreated: true, data: data.shippingDetails };
        }
        if (data.shippingDetails?.creatingShipment) {
            throw new Error(`Shipment creation already in progress for order ${orderId}.`);
        }

        transaction.update(orderRef, {
            "shippingDetails.creatingShipment": true,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        return { alreadyCreated: false, data };
    });

    if (lockResult.alreadyCreated) {
        const sd = lockResult.data;
        return {
            success: true,
            orderId,
            shiprocketOrderId: sd.shiprocketOrderId || null,
            shiprocketShipmentId: sd.shiprocketShipmentId,
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
        // Check pickup locations
        const pickupLocations = await getPickupLocations();
        const availableNames = pickupLocations.map(l => l.name);
        const selectedPickup = pickupLocation || process.env.STORE_PICKUP_LOCATION || "";

        if (!selectedPickup || !availableNames.includes(selectedPickup)) {
            const locationList = availableNames.length > 0 ? availableNames.join(", ") : "none available";
            throw new Error(`STORE_PICKUP_LOCATION '${selectedPickup || "undefined"}' missing or not found in Shiprocket pickup locations. Available pickup locations: [${locationList}]`);
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
            units: item.qty || 1,
            selling_price: item.price || 0,
            discount: 0,
            tax: 0,
            hsn: 7113
        }));

        const dateObj = orderData.createdAt ? (orderData.createdAt.toDate ? orderData.createdAt.toDate() : new Date(orderData.createdAt)) : new Date();
        const orderDate = dateObj.toISOString().replace("T", " ").replace(/\.\d+Z$/, "").substring(0, 16);
        const isCod = orderData.payment?.method === "cod";

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
            sub_total: orderData.totalAmount,
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
                    pickupPincode: process.env.STORE_PICKUP_PINCODE || orderData.pickupPincode,
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
                changedAt: admin.firestore.FieldValue.serverTimestamp(),
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
        await orderRef.update({
            "shippingDetails.creatingShipment": false,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }).catch(() => {});
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

module.exports = { checkServiceability, getAvailableCouriersForOrder, getTrackingByShipmentId, getTrackingByOrderId, getPickupLocations, createShipmentForOrder, cancelShiprocketOrder };

