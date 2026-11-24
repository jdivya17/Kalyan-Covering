/**
 * shippingUtils.js — Copy for server/shipping/
 * Pure utility functions for shipping calculations and address normalization.
 */
"use strict";

const { config } = require("./config");

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
    // Take last 10 digits if longer
    if (cleaned.length > 10) cleaned = cleaned.slice(-10);
    if (!/^\d{10}$/.test(cleaned)) throw new Error(`Invalid phone number "${phone}". Must be 10 digits.`);
    return cleaned;
}

function validateShippingAddress(address) {
    if (!address || typeof address !== "object") throw new Error("Shipping address is required.");
    const missing = [];
    if (!address.fname && !address.lname && !address.name && !address.fullName) missing.push("customer name");
    if (!address.address && !address.line1 && !address.street) missing.push("address line");
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
        delivery_customer_name: (address.fname || address.name || address.fullName || "Customer").trim(),
        delivery_last_name: (address.lname || "").trim(),
        delivery_address: (address.address || address.line1 || address.street || "").trim(),
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
    const defaultWeight = typeof defaults.weight === "number" && defaults.weight > 0 ? defaults.weight : config.defaultWeightKg;
    const defaultLength = typeof defaults.length === "number" && defaults.length > 0 ? defaults.length : config.defaultLengthCm;
    const defaultBreadth = typeof defaults.breadth === "number" && defaults.breadth > 0 ? defaults.breadth : config.defaultBreadthCm;
    const defaultHeight = typeof defaults.height === "number" && defaults.height > 0 ? defaults.height : config.defaultHeightCm;

    if (!Array.isArray(items) || items.length === 0) {
        return { length: defaultLength, breadth: defaultBreadth, height: defaultHeight, weight: defaultWeight };
    }
    const totalQty = items.reduce((sum, item) => sum + (item.qty || item.quantity || 1), 0);
    const scaleFactor = Math.min(totalQty, 5);

    let totalWeight = items.reduce((sum, item) => {
        const itemWeight = parseFloat(item.weight || item.packageWeight) || defaultWeight;
        const qty = item.qty || item.quantity || 1;
        return sum + (itemWeight * qty);
    }, 0);

    return {
        length: Math.round(defaultLength * (1 + (scaleFactor - 1) * 0.2) * 10) / 10,
        breadth: Math.round(defaultBreadth * (1 + (scaleFactor - 1) * 0.15) * 10) / 10,
        height: Math.round(defaultHeight * (1 + (scaleFactor - 1) * 0.2) * 10) / 10,
        weight: Math.max(0.1, Math.round(totalWeight * 10) / 10)
    };
}

module.exports = {
    sanitizePincode,
    formatPhoneNumber,
    validateShippingAddress,
    formatAddressForShiprocket,
    calculateDimensions
};
