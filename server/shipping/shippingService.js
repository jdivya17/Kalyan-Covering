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

async function createShipmentForOrder(orderId, pickupLocation = "") {
    if (!orderId) throw new Error("orderId is required.");
    const orderRef = db.collection("orders").doc(orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) throw new Error(`Order ${orderId} not found.`);
    const order = orderSnap.data();
    if (order.paymentStatus !== "paid" && order.payment?.method !== "cod") throw new Error(`Order ${orderId} is not paid.`);
    if (order.shippingDetails?.shiprocketShipmentId) throw new Error(`Order ${orderId} already has a shipment.`);

    let deliveryAddress;
    try { deliveryAddress = formatAddressForShiprocket(order.shippingAddress); }
    catch (err) { throw new Error(`Invalid shipping address: ${err.message}`); }

    const dims = calculateDimensions(order.items || []);
    const orderItems = (order.items || []).map(item => ({
        name: item.name || "Jewellery Item", sku: item.sku || item.id || "SKU-UNKNOWN",
        units: item.qty || 1, selling_price: item.price || 0, discount: 0, tax: 0, hsn: 7113
    }));

    const dateObj = order.createdAt ? (order.createdAt.toDate ? order.createdAt.toDate() : new Date(order.createdAt)) : new Date();
    const orderDate = dateObj.toISOString().replace("T", " ").replace(/\.\d+Z$/, "").substring(0, 16);
    const isCod = order.payment?.method === "cod";

    const payload = {
        order_id: order.orderNumber, order_date: orderDate,
        pickup_location: pickupLocation || process.env.STORE_PICKUP_LOCATION || "",
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
        shipping_is_billing: true, order_items: orderItems,
        payment_method: isCod ? "COD" : "Prepaid",
        sub_total: order.totalAmount, length: dims.length, breadth: dims.breadth, height: dims.height, weight: dims.weight
    };

    let result;
    const stagingRef = db.collection("shipment_staging").doc(orderId);
    const stagingDoc = await stagingRef.get();
    if (stagingDoc.exists && stagingDoc.data().shipmentId) {
        result = { shipment_id: stagingDoc.data().shipmentId, order_id: stagingDoc.data().sOrderId, awb_code: stagingDoc.data().awbCode };
    } else {
        await stagingRef.set({ status: "pending", createdAt: admin.firestore.FieldValue.serverTimestamp() });
        try {
            result = await shiprocketRequest("POST", "/orders/create/adhoc", payload);
            await stagingRef.update({ status: "api_success", shipmentId: result.shipment_id, awbCode: result.awb_code || null });
        } catch (err) {
            await stagingRef.update({ status: "api_failed", error: err.message });
            throw new Error(`Shiprocket API failed: ${err.message}`);
        }
    }

    const shipmentId = result.shipment_id;
    const awbCode = result.awb_code || null;
    if (!shipmentId) throw new Error("Shiprocket returned no shipment_id.");

    await orderRef.update({
        "shippingDetails.shiprocketShipmentId": String(shipmentId),
        "shippingDetails.awbCode": awbCode,
        orderStatus: "packed", shippingStatus: "not_shipped",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        statusHistory: admin.firestore.FieldValue.arrayUnion({
            status: "packed", changedAt: admin.firestore.FieldValue.serverTimestamp(),
            changedBy: "system_shiprocket", note: `Shipment created. ID: ${shipmentId}${awbCode ? `, AWB: ${awbCode}` : ""}`
        })
    });

    return { success: true, orderId, shipmentId, awbCode, message: `Shipment created. ID: ${shipmentId}` };
}

module.exports = { checkServiceability, getAvailableCouriersForOrder, getTrackingByShipmentId, getTrackingByOrderId, getPickupLocations, createShipmentForOrder };
