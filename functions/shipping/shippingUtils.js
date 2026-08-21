/**
 * shippingUtils.js
 * ----------------
 * Reusable, pure utility functions for the shipping module.
 *
 * No external dependencies — safe to unit-test in isolation.
 * All functions throw descriptive errors on invalid input so the caller
 * can convert them to HttpsError with the appropriate error code.
 */

"use strict";

// ─── Logger helper ────────────────────────────────────────────────────────────

function log(level, message, meta = {}) {
    const entry = {
        severity: level.toUpperCase(),
        component: "SHIPPING_UTILS",
        message,
        timestamp: new Date().toISOString(),
        ...meta,
    };
    if (level === "error") {
        console.error(JSON.stringify(entry));
    } else {
        console.log(JSON.stringify(entry));
    }
}

// ─── Pincode Utilities ────────────────────────────────────────────────────────

/**
 * Sanitises and validates an Indian pincode.
 * Strips spaces and dashes, ensures it is exactly 6 numeric digits.
 *
 * @param {string|number} pincode - Raw pincode value
 * @returns {string} Sanitised 6-digit pincode string
 * @throws {Error} If the pincode is invalid
 */
function sanitizePincode(pincode) {
    if (pincode === null || pincode === undefined) {
        throw new Error("Pincode is required.");
    }
    const cleaned = String(pincode).replace(/[\s\-]/g, "").trim();
    if (!/^\d{6}$/.test(cleaned)) {
        throw new Error(`Invalid pincode "${pincode}". Must be exactly 6 digits.`);
    }
    return cleaned;
}

// ─── Phone Number Utilities ───────────────────────────────────────────────────

/**
 * Formats a phone number for Shiprocket: strips country code (+91 or 91 prefix),
 * returns a clean 10-digit number.
 *
 * @param {string|number} phone - Raw phone number
 * @returns {string} 10-digit mobile number
 * @throws {Error} If the phone number is invalid
 */
function formatPhoneNumber(phone) {
    if (!phone) throw new Error("Phone number is required.");
    let cleaned = String(phone).replace(/[\s\-\(\)]/g, "").trim();

    // Remove +91 or 91 country prefix if present
    if (cleaned.startsWith("+91")) cleaned = cleaned.slice(3);
    else if (cleaned.startsWith("91") && cleaned.length === 12) cleaned = cleaned.slice(2);

    if (!/^\d{10}$/.test(cleaned)) {
        throw new Error(`Invalid phone number "${phone}". Must be 10 digits after removing country code.`);
    }
    return cleaned;
}

// ─── Address Utilities ────────────────────────────────────────────────────────

/**
 * Validates that all required shipping address fields are present.
 * Throws a descriptive error listing missing fields.
 *
 * Required fields (matching our Firestore order schema):
 *   fname OR lname (at least one), address, city, state, pin, phone
 *
 * @param {object} address - Address object from the order document
 * @throws {Error} If any required field is missing or invalid
 */
function validateShippingAddress(address) {
    if (!address || typeof address !== "object") {
        throw new Error("Shipping address is required and must be an object.");
    }

    const missing = [];

    // Name: at least fname or lname must be present
    if (!address.fname && !address.lname && !address.name) {
        missing.push("customer name (fname or lname)");
    }

    if (!address.address && !address.line1) missing.push("address (street line)");
    if (!address.city) missing.push("city");
    if (!address.state) missing.push("state");
    if (!address.pin && !address.pincode) missing.push("pincode (pin)");
    if (!address.phone && !address.mobile) missing.push("phone");

    if (missing.length > 0) {
        throw new Error(`Shipping address is missing required fields: ${missing.join(", ")}.`);
    }

    // Validate pincode format
    const rawPin = address.pin || address.pincode;
    sanitizePincode(rawPin); // will throw if invalid

    // Validate phone format
    const rawPhone = address.phone || address.mobile;
    formatPhoneNumber(rawPhone); // will throw if invalid

    log("info", "Shipping address validated successfully", {
        city: address.city,
        state: address.state,
    });
}

/**
 * Maps our internal order address schema to the Shiprocket address schema.
 *
 * Our schema fields:
 *   { fname, lname, address, city, state, pin, phone, email }
 *
 * Shiprocket delivery address fields:
 *   { delivery_customer_name, delivery_last_name, delivery_address,
 *     delivery_city, delivery_state, delivery_pincode, delivery_country,
 *     delivery_phone, delivery_email }
 *
 * @param {object} address - Address object from order.shippingAddress
 * @returns {object} Shiprocket-formatted delivery address fields
 */
function formatAddressForShiprocket(address) {
    validateShippingAddress(address);

    const pincode = sanitizePincode(address.pin || address.pincode);
    const phone = formatPhoneNumber(address.phone || address.mobile);

    const formatted = {
        delivery_customer_name: (address.fname || address.name || "Customer").trim(),
        delivery_last_name: (address.lname || "").trim(),
        delivery_address: (address.address || address.line1 || "").trim(),
        delivery_address_2: (address.address2 || address.line2 || "").trim(),
        delivery_city: (address.city || "").trim(),
        delivery_state: (address.state || "").trim(),
        delivery_country: (address.country || "India").trim(),
        delivery_pincode: pincode,
        delivery_phone: phone,
        delivery_email: (address.email || "").trim(),
    };

    log("info", "Address formatted for Shiprocket", {
        city: formatted.delivery_city,
        state: formatted.delivery_state,
        pincode: formatted.delivery_pincode,
    });

    return formatted;
}

// ─── Dimension & Weight Utilities ─────────────────────────────────────────────

/**
 * Estimates package dimensions from a list of order items.
 * Uses a simple heuristic: base dimensions scaled by total item count.
 * Override with actual product dimensions if stored in Firestore.
 *
 * Shiprocket requires: length (cm), breadth (cm), height (cm), weight (kg)
 *
 * @param {Array<object>} items - Order items array from Firestore
 * @param {object} [defaults] - Override defaults
 * @returns {{ length: number, breadth: number, height: number, weight: number }}
 */
function calculateDimensions(items, defaults = {}) {
    if (!Array.isArray(items) || items.length === 0) {
        log("warn", "No items provided for dimension calculation — using defaults");
        return {
            length: defaults.length || 15,
            breadth: defaults.breadth || 12,
            height: defaults.height || 10,
            weight: defaults.weight || 0.5,
        };
    }

    const totalQty = items.reduce((sum, item) => sum + (item.qty || 1), 0);

    // Base dimensions for a single-item package (jewellery/covering store context)
    const baseLength = defaults.length || 15;    // cm
    const baseWidth  = defaults.breadth || 12;   // cm
    const baseHeight = defaults.height || 10;    // cm
    const baseWeight = defaults.weight || 0.3;   // kg per item

    // Scale dimensions proportionally with total quantity (capped)
    const scaleFactor = Math.min(totalQty, 5); // cap at 5x to avoid unrealistic sizes
    const dims = {
        length: Math.round(baseLength * (1 + (scaleFactor - 1) * 0.2) * 10) / 10,
        breadth: Math.round(baseWidth * (1 + (scaleFactor - 1) * 0.15) * 10) / 10,
        height: Math.round(baseHeight * (1 + (scaleFactor - 1) * 0.2) * 10) / 10,
        weight: Math.round(baseWeight * totalQty * 10) / 10,
    };

    log("info", "Package dimensions calculated", {
        totalQty,
        ...dims,
    });

    return dims;
}

// ─── Order Value Utilities ────────────────────────────────────────────────────

/**
 * Calculates the declared value for insurance purposes.
 * Uses the order's totalAmount, capped at a maximum for safety.
 *
 * @param {number} orderTotal - Order total in INR
 * @returns {number} Declared value in INR
 */
function getCollectableAmount(orderTotal) {
    if (typeof orderTotal !== "number" || isNaN(orderTotal) || orderTotal < 0) {
        throw new Error(`Invalid order total: ${orderTotal}. Must be a positive number.`);
    }
    // For prepaid orders, collectable amount is 0 (already paid via Razorpay)
    // This function is here for future COD support
    return 0;
}

/**
 * Determines if an order qualifies for COD (Cash on Delivery).
 * Currently always returns false since we use Razorpay prepaid.
 * Extend this when COD is added.
 *
 * @param {object} order - Order document data
 * @returns {boolean}
 */
function isCODOrder(order) {
    return order?.payment?.method === "cod";
}

// ─── State Code Mapping ───────────────────────────────────────────────────────

/** Maps full Indian state names to 2-letter codes expected by some courier APIs */
const STATE_CODE_MAP = {
    "Andhra Pradesh": "AP",
    "Arunachal Pradesh": "AR",
    "Assam": "AS",
    "Bihar": "BR",
    "Chhattisgarh": "CG",
    "Goa": "GA",
    "Gujarat": "GJ",
    "Haryana": "HR",
    "Himachal Pradesh": "HP",
    "Jharkhand": "JH",
    "Karnataka": "KA",
    "Kerala": "KL",
    "Madhya Pradesh": "MP",
    "Maharashtra": "MH",
    "Manipur": "MN",
    "Meghalaya": "ML",
    "Mizoram": "MZ",
    "Nagaland": "NL",
    "Odisha": "OD",
    "Punjab": "PB",
    "Rajasthan": "RJ",
    "Sikkim": "SK",
    "Tamil Nadu": "TN",
    "Telangana": "TG",
    "Tripura": "TR",
    "Uttar Pradesh": "UP",
    "Uttarakhand": "UK",
    "West Bengal": "WB",
    "Delhi": "DL",
    "Jammu and Kashmir": "JK",
    "Ladakh": "LA",
    "Chandigarh": "CH",
    "Dadra and Nagar Haveli and Daman and Diu": "DN",
    "Lakshadweep": "LD",
    "Puducherry": "PY",
    "Andaman and Nicobar Islands": "AN",
};

/**
 * Returns the 2-letter state code for a given state name.
 * Returns the original value if not found (graceful fallback).
 *
 * @param {string} stateName
 * @returns {string}
 */
function getStateCode(stateName) {
    if (!stateName) return "";
    return STATE_CODE_MAP[stateName] || stateName;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
    sanitizePincode,
    formatPhoneNumber,
    validateShippingAddress,
    formatAddressForShiprocket,
    calculateDimensions,
    getCollectableAmount,
    isCODOrder,
    getStateCode,
};
