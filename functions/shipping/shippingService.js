/**
 * shippingService.js
 * ------------------
 * Business logic service layer for the Shiprocket shipping integration.
 *
 * This module orchestrates:
 *   - shiprocketClient  → raw API calls (authentication, HTTP)
 *   - shippingUtils     → address formatting, validation, dimension calculation
 *   - Firestore (admin) → reading order data, writing tracking info back
 *
 * Design principles:
 *   1. Each function validates inputs BEFORE calling Shiprocket API
 *   2. Every operation is logged with [SHIPPING_SERVICE] prefix
 *   3. Errors are caught, logged, and re-thrown with descriptive messages
 *   4. Firestore writes are atomic where possible
 *   5. Functions are idempotent where applicable
 *
 * NOTE: Shipment creation functions will be added in the NEXT phase (when API
 * credentials are provided). This file contains READ-ONLY operations.
 */

"use strict";

const admin = require("firebase-admin");
const { shiprocketRequest } = require("./shiprocketClient");
const {
    sanitizePincode,
    validateShippingAddress,
    formatAddressForShiprocket,
    calculateDimensions,
} = require("./shippingUtils");

const db = admin.firestore();

// ─── Logger helper ────────────────────────────────────────────────────────────

function log(level, message, meta = {}) {
    const entry = {
        severity: level.toUpperCase(),
        component: "SHIPPING_SERVICE",
        message,
        timestamp: new Date().toISOString(),
        ...meta,
    };
    if (level === "error") {
        console.error(JSON.stringify(entry));
    } else if (level === "warn") {
        console.warn(JSON.stringify(entry));
    } else {
        console.log(JSON.stringify(entry));
    }
}

// ─── Service Functions ────────────────────────────────────────────────────────

/**
 * Checks whether Shiprocket can deliver between two pincodes.
 *
 * Calls: GET /courier/serviceability/
 * Parameters:
 *   - pickup_postcode   — Store's pickup pincode
 *   - delivery_postcode — Customer's delivery pincode
 *   - weight            — Package weight in kg
 *   - cod               — 0 = prepaid, 1 = COD
 *
 * @param {object} params
 * @param {string|number} params.pickupPincode  - Seller/warehouse pincode
 * @param {string|number} params.deliveryPincode - Customer's pincode
 * @param {number}        params.weight          - Weight in kg
 * @param {boolean}       [params.isCOD=false]   - Whether it's a COD order
 * @returns {Promise<object>} Serviceability result with available couriers
 * @throws {Error} On validation failure or Shiprocket API error
 */
async function checkServiceability({ pickupPincode, deliveryPincode, weight, isCOD = false }) {
    log("info", "Checking shipping serviceability", {
        pickupPincode,
        deliveryPincode,
        weight,
        isCOD,
    });

    // Validate pincodes
    const sanitizedPickup = sanitizePincode(pickupPincode);
    const sanitizedDelivery = sanitizePincode(deliveryPincode);

    if (typeof weight !== "number" || isNaN(weight) || weight <= 0) {
        throw new Error(`Invalid weight: ${weight}. Must be a positive number in kg.`);
    }

    const params = {
        pickup_postcode: sanitizedPickup,
        delivery_postcode: sanitizedDelivery,
        weight: weight,
        cod: isCOD ? 1 : 0,
    };

    try {
        const result = await shiprocketRequest("GET", "/courier/serviceability/", null, params);

        const couriers = result?.data?.available_courier_companies || [];
        log("info", "Serviceability check completed", {
            pickupPincode: sanitizedPickup,
            deliveryPincode: sanitizedDelivery,
            availableCourierCount: couriers.length,
        });

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
        log("error", "Serviceability check failed", {
            pickupPincode: sanitizedPickup,
            deliveryPincode: sanitizedDelivery,
            error: err.message,
        });
        throw new Error(`Serviceability check failed: ${err.message}`);
    }
}

/**
 * Fetches available couriers for a specific order by reading its Firestore data
 * and calling the serviceability API.
 *
 * Stores serviceability result back into the order document as a cache.
 *
 * @param {string} orderId - Firestore order document ID
 * @param {string} pickupPincode - Store's warehouse/pickup pincode
 * @returns {Promise<object>} Serviceability result
 * @throws {Error} If order not found, address invalid, or API error
 */
async function getAvailableCouriersForOrder(orderId, pickupPincode) {
    log("info", "Getting available couriers for order", { orderId });

    if (!orderId) throw new Error("orderId is required.");
    if (!pickupPincode) throw new Error("pickupPincode (store's pincode) is required.");

    // Fetch order from Firestore
    const orderSnap = await db.collection("orders").doc(orderId).get();
    if (!orderSnap.exists) {
        throw new Error(`Order ${orderId} not found.`);
    }

    const order = orderSnap.data();

    // Validate order has a shipping address
    const shippingAddress = order.shippingAddress;
    if (!shippingAddress) {
        throw new Error(`Order ${orderId} does not have a shipping address.`);
    }

    try {
        validateShippingAddress(shippingAddress);
    } catch (addrErr) {
        throw new Error(`Invalid shipping address on order ${orderId}: ${addrErr.message}`);
    }

    // Calculate dimensions from items
    const dims = calculateDimensions(order.items || []);

    // Run serviceability check
    const result = await checkServiceability({
        pickupPincode: pickupPincode,
        deliveryPincode: shippingAddress.pin || shippingAddress.pincode,
        weight: dims.weight,
        isCOD: false, // currently all orders are prepaid via Razorpay
    });

    // Cache result on the order document for reference
    try {
        await db.collection("orders").doc(orderId).update({
            "shippingDetails.serviceabilityChecked": true,
            "shippingDetails.serviceabilityCheckedAt": admin.firestore.FieldValue.serverTimestamp(),
            "shippingDetails.availableCourierCount": result.availableCouriers.length,
            "shippingDetails.isServiceable": result.isServiceable,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        log("info", "Serviceability result cached on order", { orderId });
    } catch (cacheErr) {
        // Non-fatal: log but don't throw — the caller still gets valid data
        log("warn", "Failed to cache serviceability result on order", {
            orderId,
            error: cacheErr.message,
        });
    }

    return {
        orderId,
        orderNumber: order.orderNumber,
        customerPin: shippingAddress.pin || shippingAddress.pincode,
        packageWeight: dims.weight,
        ...result,
    };
}

/**
 * Fetches live tracking information for a Shiprocket shipment by shipment ID.
 *
 * Calls: GET /courier/track/shipment/{shipment_id}
 *
 * @param {string|number} shipmentId - Shiprocket shipment ID
 * @returns {Promise<object>} Tracking data
 * @throws {Error} On invalid input or API error
 */
async function getTrackingByShipmentId(shipmentId) {
    log("info", "Fetching tracking by shipment ID", { shipmentId });

    if (!shipmentId) throw new Error("shipmentId is required.");

    try {
        const result = await shiprocketRequest(
            "GET",
            `/courier/track/shipment/${shipmentId}`
        );

        const trackingData = result?.tracking_data || result;
        log("info", "Tracking data fetched successfully", {
            shipmentId,
            currentStatus: trackingData?.shipment_status || "unknown",
        });

        return {
            shipmentId,
            currentStatus: trackingData?.shipment_status || null,
            currentStatusCode: trackingData?.shipment_status_id || null,
            awbCode: trackingData?.awb_code || null,
            courierName: trackingData?.courier_name || null,
            activities: (trackingData?.activities || []).map(a => ({
                date: a.date,
                status: a.status,
                activity: a.activity,
                location: a.location,
            })),
            expectedDeliveryDate: trackingData?.etd || null,
            rawResponse: trackingData,
        };
    } catch (err) {
        log("error", "Tracking by shipment ID failed", {
            shipmentId,
            error: err.message,
        });
        throw new Error(`Tracking failed for shipment ${shipmentId}: ${err.message}`);
    }
}

/**
 * Fetches live tracking info for a Shiprocket shipment using our Firestore order ID.
 * Reads the shipmentId from the order's shippingDetails.
 * Optionally updates the order's shippingDetails with the latest tracking status.
 *
 * @param {string} orderId - Firestore order document ID
 * @param {boolean} [updateOrder=true] - Whether to write latest status back to Firestore
 * @returns {Promise<object>} Tracking data + orderId
 * @throws {Error} If order not found or has no shipment
 */
async function getTrackingByOrderId(orderId, updateOrder = true) {
    log("info", "Fetching tracking by order ID", { orderId });

    if (!orderId) throw new Error("orderId is required.");

    // Fetch order
    const orderSnap = await db.collection("orders").doc(orderId).get();
    if (!orderSnap.exists) {
        throw new Error(`Order ${orderId} not found.`);
    }

    const order = orderSnap.data();
    const shipmentId = order.shippingDetails?.shiprocketShipmentId;
    const awbCode = order.shippingDetails?.awbCode;

    if (!shipmentId && !awbCode) {
        throw new Error(
            `Order ${orderId} has no Shiprocket shipment ID. Create a shipment first.`
        );
    }

    let trackingResult;

    if (shipmentId) {
        trackingResult = await getTrackingByShipmentId(shipmentId);
    } else {
        // Fallback: track by AWB code
        try {
            const result = await shiprocketRequest(
                "GET",
                `/courier/track`,
                null,
                { awb: awbCode }
            );
            trackingResult = {
                awbCode,
                currentStatus: result?.tracking_data?.shipment_status || null,
                activities: result?.tracking_data?.activities || [],
                rawResponse: result?.tracking_data || result,
            };
        } catch (err) {
            throw new Error(`Tracking by AWB ${awbCode} failed: ${err.message}`);
        }
    }

    // Optionally persist latest tracking status back to Firestore
    if (updateOrder && trackingResult.currentStatus) {
        try {
            await db.collection("orders").doc(orderId).update({
                "shippingDetails.trackingLastChecked": admin.firestore.FieldValue.serverTimestamp(),
                "shippingDetails.latestTrackingStatus": trackingResult.currentStatus,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            log("info", "Tracking status updated on order", {
                orderId,
                status: trackingResult.currentStatus,
            });
        } catch (updateErr) {
            // Non-fatal
            log("warn", "Failed to update tracking status on order", {
                orderId,
                error: updateErr.message,
            });
        }
    }

    return {
        orderId,
        orderNumber: order.orderNumber,
        ...trackingResult,
    };
}

/**
 * Fetches the list of Shiprocket pickup locations configured on the account.
 * Used by admin to select the correct pickup address when creating shipments.
 *
 * Calls: GET /settings/company/pickup
 *
 * @returns {Promise<Array<object>>} List of pickup locations
 */
async function getPickupLocations() {
    log("info", "Fetching Shiprocket pickup locations");

    try {
        const result = await shiprocketRequest("GET", "/settings/company/pickup");
        const locations = result?.data?.shipping_address || [];

        log("info", "Pickup locations fetched", { count: locations.length });

        return locations.map(loc => ({
            id: loc.id,
            name: loc.pickup_location,
            address: loc.address,
            address2: loc.address_2,
            city: loc.city,
            state: loc.state,
            country: loc.country,
            pincode: loc.pin_code,
            phone: loc.phone,
            email: loc.email,
            isDefault: loc.is_first_kilometer === 1,
        }));
    } catch (err) {
        log("error", "Failed to fetch pickup locations", { error: err.message });
        throw new Error(`Failed to fetch pickup locations: ${err.message}`);
    }
}

/**
 * Creates a Shiprocket shipment for a given order securely.
 * Validates order details, calculates dimensions, formats the payload,
 * calls the Shiprocket API, and updates Firestore atomically.
 *
 * @param {string} orderId - Firestore order document ID
 * @param {string} [pickupLocation=""] - Optional override for pickup location. If empty, uses primary.
 * @returns {Promise<object>} Result containing shipmentId and awbCode
 * @throws {Error} If validation fails or API errors occur.
 */
async function createShipmentForOrder(orderId, pickupLocation = "") {
    log("info", "Initiating shipment creation", { orderId, pickupLocation });

    if (!orderId) throw new Error("orderId is required.");

    // 1. Fetch order from Firestore
    const orderRef = db.collection("orders").doc(orderId);
    const orderSnap = await orderRef.get();
    
    if (!orderSnap.exists) {
        throw new Error(`Order ${orderId} not found.`);
    }

    const order = orderSnap.data();

    // 2. Validate Order State
    if (order.paymentStatus !== "paid" && order.payment?.method !== "cod") {
        throw new Error(`Order ${orderId} is not paid and is not COD. Cannot create shipment.`);
    }

    if (order.shippingDetails?.shiprocketShipmentId) {
        throw new Error(`Order ${orderId} already has a shipment (ID: ${order.shippingDetails.shiprocketShipmentId}). Duplicate prevented.`);
    }

    // 3. Format Address & Dimensions
    let deliveryAddress;
    try {
        deliveryAddress = formatAddressForShiprocket(order.shippingAddress);
    } catch (err) {
        throw new Error(`Invalid shipping address on order ${orderId}: ${err.message}`);
    }

    const dims = calculateDimensions(order.items || []);
    
    // Map items to Shiprocket format
    const orderItems = (order.items || []).map(item => ({
        name: item.name || "Jewellery Item",
        sku: item.sku || item.id || "SKU-UNKNOWN",
        units: item.qty || 1,
        selling_price: item.price || 0,
        discount: 0,
        tax: 0,
        hsn: 7113 // standard HSN for imitation jewellery
    }));

    // 4. Construct Payload
    const dateObj = order.createdAt ? (order.createdAt.toDate ? order.createdAt.toDate() : new Date(order.createdAt)) : new Date();
    // format date as "YYYY-MM-DD HH:mm"
    const orderDate = dateObj.toISOString().replace(/T/, ' ').replace(/\.\d+Z$/, '').substring(0, 16);

    const isCod = order.payment?.method === "cod";

    const payload = {
        order_id: order.orderNumber, // Use our unique order number
        order_date: orderDate,
        pickup_location: pickupLocation || process.env.STORE_PICKUP_LOCATION || "", // Empty uses default
        billing_customer_name: deliveryAddress.delivery_customer_name,
        billing_last_name: deliveryAddress.delivery_last_name,
        billing_address: deliveryAddress.delivery_address,
        billing_address_2: deliveryAddress.delivery_address_2,
        billing_city: deliveryAddress.delivery_city,
        billing_pincode: deliveryAddress.delivery_pincode,
        billing_state: deliveryAddress.delivery_state,
        billing_country: deliveryAddress.delivery_country,
        billing_email: deliveryAddress.delivery_email,
        billing_phone: deliveryAddress.delivery_phone,
        shipping_is_billing: true,
        order_items: orderItems,
        payment_method: isCod ? "COD" : "Prepaid",
        sub_total: order.totalAmount, // Grand total
        length: dims.length,
        breadth: dims.breadth,
        height: dims.height,
        weight: dims.weight
    };

    // 5. API Call
    log("info", "Calling Shiprocket Create Order API", { orderNumber: order.orderNumber });
    let result;
    try {
        result = await shiprocketRequest("POST", "/orders/create/adhoc", payload);
    } catch (err) {
        throw new Error(`Shiprocket API failed: ${err.message}`);
    }

    const shipmentId = result.shipment_id;
    const sOrderId = result.order_id; // Shiprocket internal order ID
    const awbCode = result.awb_code || null;
    const courierCompanyId = result.courier_company_id || null;

    if (!shipmentId) {
         throw new Error("Shiprocket API returned success but no shipment_id was found.");
    }

    log("info", "Shipment created successfully via API", { shipmentId, awbCode });

    // 6. Update Firestore
    const updatePayload = {
        "shippingDetails.shiprocketShipmentId": String(shipmentId),
        "shippingDetails.shiprocketOrderId": String(sOrderId),
        "shippingDetails.awbCode": awbCode,
        "shippingDetails.courierCompanyId": courierCompanyId,
        "shippingDetails.trackingLastChecked": admin.firestore.FieldValue.serverTimestamp(),
        orderStatus: "packed", // Move from confirmed to packed
        shippingStatus: "not_shipped", // Still not shipped until courier picks it up
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        statusHistory: admin.firestore.FieldValue.arrayUnion({
            status: "packed",
            changedAt: admin.firestore.FieldValue.serverTimestamp(),
            changedBy: "system_shiprocket",
            note: `Shipment created. ID: ${shipmentId}${awbCode ? `, AWB: ${awbCode}` : ''}`
        })
    };

    try {
        await orderRef.update(updatePayload);
        log("info", "Order updated with shipment details", { orderId });
    } catch (dbErr) {
        // Critical error: API succeeded but DB failed. We must log this aggressively.
        log("error", "CRITICAL: Failed to update order with shipment details! Manual intervention required.", {
            orderId,
            shipmentId,
            error: dbErr.message
        });
        throw new Error(`Shipment created (ID: ${shipmentId}) but failed to save to database. Please note this ID! Error: ${dbErr.message}`);
    }

    return {
        success: true,
        orderId,
        shipmentId,
        awbCode,
        message: `Shipment created successfully. ID: ${shipmentId}`
    };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
    checkServiceability,
    getAvailableCouriersForOrder,
    getTrackingByShipmentId,
    getTrackingByOrderId,
    getPickupLocations,
    createShipmentForOrder,
};
