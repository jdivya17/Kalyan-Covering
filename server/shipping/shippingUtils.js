/**
 * shippingUtils.js — Copy for server/shipping/
 * Pure utility functions for shipping calculations.
 */
"use strict";

function sanitizePincode(pincode) {
    if (pincode === null || pincode === undefined) throw new Error("Pincode is required.");
    const cleaned = String(pincode).replace(/[\s\-]/g, "").trim();
    if (!/^\d{6}$/.test(cleaned)) throw new Error(`Invalid pincode "${pincode}". Must be exactly 6 digits.`);
    return cleaned;
}

function formatPhoneNumber(phone) {
    if (!phone) throw new Error("Phone number is required.");
    let cleaned = String(phone).replace(/[\s\-\(\)]/g, "").trim();
    if (cleaned.startsWith("+91")) cleaned = cleaned.slice(3);
    else if (cleaned.startsWith("91") && cleaned.length === 12) cleaned = cleaned.slice(2);
    if (!/^\d{10}$/.test(cleaned)) throw new Error(`Invalid phone number "${phone}".`);
    return cleaned;
}

function validateShippingAddress(address) {
    if (!address || typeof address !== "object") throw new Error("Shipping address is required.");
    const missing = [];
    if (!address.fname && !address.lname && !address.name) missing.push("customer name");
    if (!address.address && !address.line1) missing.push("address line");
    if (!address.city) missing.push("city");
    if (!address.state) missing.push("state");
    if (!address.pin && !address.pincode) missing.push("pincode");
    if (!address.phone && !address.mobile) missing.push("phone");
    if (missing.length > 0) throw new Error(`Missing address fields: ${missing.join(", ")}.`);
    sanitizePincode(address.pin || address.pincode);
    formatPhoneNumber(address.phone || address.mobile);
}

function formatAddressForShiprocket(address) {
    validateShippingAddress(address);
    const pincode = sanitizePincode(address.pin || address.pincode);
    const phone = formatPhoneNumber(address.phone || address.mobile);
    return {
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
}

function calculateDimensions(items, defaults = {}) {
    if (!Array.isArray(items) || items.length === 0) {
        return { length: defaults.length || 15, breadth: defaults.breadth || 12, height: defaults.height || 10, weight: defaults.weight || 0.5 };
    }
    const totalQty = items.reduce((sum, item) => sum + (item.qty || 1), 0);
    const scaleFactor = Math.min(totalQty, 5);
    return {
        length: Math.round(15 * (1 + (scaleFactor - 1) * 0.2) * 10) / 10,
        breadth: Math.round(12 * (1 + (scaleFactor - 1) * 0.15) * 10) / 10,
        height: Math.round(10 * (1 + (scaleFactor - 1) * 0.2) * 10) / 10,
        weight: Math.round(0.3 * totalQty * 10) / 10,
    };
}

module.exports = { sanitizePincode, formatPhoneNumber, validateShippingAddress, formatAddressForShiprocket, calculateDimensions };
