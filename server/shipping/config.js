/**
 * config.js — Central Shiprocket Configuration
 * Reads from process.env (Vercel / .env).
 * Trims surrounding quotes and whitespace like cleanEnvVar in payments.js.
 * Never prints or logs secrets.
 */
"use strict";

function cleanEnvVar(val) {
    if (typeof val !== "string") return "";
    let s = val.trim();
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
        s = s.slice(1, -1);
    }
    return s.trim();
}

function parseNumber(val, defaultVal) {
    const cleaned = cleanEnvVar(val);
    if (!cleaned) return defaultVal;
    const n = parseFloat(cleaned);
    return isNaN(n) || n <= 0 ? defaultVal : n;
}

const config = {
    // Auth credentials
    email: cleanEnvVar(process.env.SHIPROCKET_EMAIL),
    password: cleanEnvVar(process.env.SHIPROCKET_PASSWORD),

    // Pickup details with legacy fallback
    pickupLocation: cleanEnvVar(process.env.SHIPROCKET_PICKUP_LOCATION) || cleanEnvVar(process.env.STORE_PICKUP_LOCATION),
    pickupPincode: cleanEnvVar(process.env.SHIPROCKET_PICKUP_PINCODE) || cleanEnvVar(process.env.STORE_PICKUP_PINCODE),

    // Webhook token
    webhookToken: cleanEnvVar(process.env.SHIPROCKET_WEBHOOK_TOKEN),

    // Defaults for weight & dimensions
    defaultWeightKg: parseNumber(process.env.SHIPROCKET_DEFAULT_WEIGHT_KG, 0.3),
    defaultLengthCm: parseNumber(process.env.SHIPROCKET_DEFAULT_LENGTH, 15),
    defaultBreadthCm: parseNumber(process.env.SHIPROCKET_DEFAULT_BREADTH, 12),
    defaultHeightCm: parseNumber(process.env.SHIPROCKET_DEFAULT_HEIGHT, 10),

    // Base API URL
    baseUrl: "https://apiv2.shiprocket.in/v1/external"
};

function assertAuthConfig() {
    if (!config.email || !config.password) {
        throw new Error("Shiprocket credentials not configured. Set SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD.");
    }
}

function assertPickupConfig() {
    if (!config.pickupLocation || !config.pickupPincode) {
        throw new Error("Shiprocket pickup location/pincode is not configured. Set SHIPROCKET_PICKUP_LOCATION and SHIPROCKET_PICKUP_PINCODE.");
    }
}

module.exports = {
    config,
    cleanEnvVar,
    assertAuthConfig,
    assertPickupConfig
};
