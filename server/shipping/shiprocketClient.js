/**
 * shiprocketClient.js — Vercel/Express compatible
 * Reads credentials from server/shipping/config.js.
 * Never prints or logs secrets.
 */
"use strict";

const axios = require("axios");
const { config, assertAuthConfig } = require("./config");

const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;
const TOKEN_VALID_DURATION_MS = 24 * 60 * 60 * 1000;

let _cachedToken = null;
let _tokenExpiresAt = 0;

function log(level, message, meta = {}) {
    const entry = { severity: level.toUpperCase(), component: "SHIPROCKET_CLIENT", message, timestamp: new Date().toISOString(), ...meta };
    if (level === "error") console.error(JSON.stringify(entry));
    else if (level === "warn") console.warn(JSON.stringify(entry));
    else console.log(JSON.stringify(entry));
}

function extractRawErrorMessage(err, fallback = "Shiprocket API error") {
    if (err.response?.data) {
        const data = err.response.data;
        if (typeof data.message === "string" && data.message) return data.message;
        if (data.errors) {
            const firstKey = Object.keys(data.errors)[0];
            if (firstKey && Array.isArray(data.errors[firstKey])) return data.errors[firstKey][0];
            if (firstKey && typeof data.errors[firstKey] === "string") return data.errors[firstKey];
        }
    }
    if (err.message) return err.message;
    return fallback;
}

function mapToFriendlyError(rawMessage, statusCode) {
    const lower = String(rawMessage || "").toLowerCase();
    if (statusCode === 401 || lower.includes("unauthenticated") || lower.includes("invalid credentials") || lower.includes("login failed")) {
        return "Shiprocket login failed, check API user";
    }
    if (lower.includes("insufficient") || lower.includes("recharge") || lower.includes("wallet") || lower.includes("balance")) {
        return "Shiprocket wallet balance is low, recharge and retry";
    }
    if (lower.includes("pincode") || lower.includes("postcode") || lower.includes("not serviceable") || lower.includes("unserviceable")) {
        return "Delivery pincode is invalid or unserviceable in Shiprocket";
    }
    if (lower.includes("pickup") && (lower.includes("location") || lower.includes("address") || lower.includes("found"))) {
        return `Shiprocket pickup location not found. Ensure '${config.pickupLocation || ""}' matches Shiprocket exactly.`;
    }
    return rawMessage;
}

async function getToken() {
    const now = Date.now();
    if (_cachedToken && now < _tokenExpiresAt - TOKEN_EXPIRY_BUFFER_MS) {
        log("info", "Using cached Shiprocket token");
        return _cachedToken;
    }

    log("info", "Fetching new Shiprocket token");
    assertAuthConfig();

    try {
        const response = await axios.post(
            `${config.baseUrl}/auth/login`,
            { email: config.email, password: config.password },
            { headers: { "Content-Type": "application/json" }, timeout: 10000 }
        );
        const token = response.data?.token;
        if (!token) throw new Error("Shiprocket auth response missing token field.");
        _cachedToken = token;
        _tokenExpiresAt = now + TOKEN_VALID_DURATION_MS;
        log("info", "Shiprocket token fetched and cached");
        return token;
    } catch (err) {
        _cachedToken = null;
        _tokenExpiresAt = 0;
        const rawMessage = extractRawErrorMessage(err, "Shiprocket authentication failed");
        log("error", "Shiprocket authentication failed", { statusCode: err.response?.status, rawError: rawMessage });
        const friendlyMessage = mapToFriendlyError(rawMessage, err.response?.status || 401);
        throw new Error(friendlyMessage);
    }
}

async function shiprocketRequest(method, endpoint, data = null, params = {}, isRetry = false) {
    const requestId = Math.random().toString(36).substring(2, 9);
    const url = `${config.baseUrl}${endpoint}`;
    log("info", `[${requestId}] Shiprocket API request`, { method: method.toUpperCase(), endpoint });

    try {
        const token = await getToken();
        const reqConfig = {
            method: method.toUpperCase(),
            url,
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            timeout: 30000,
            params: Object.keys(params).length > 0 ? params : undefined,
        };
        if (data && ["POST", "PUT", "PATCH"].includes(method.toUpperCase())) reqConfig.data = data;
        const response = await axios(reqConfig);
        log("info", `[${requestId}] Response received`, { status: response.status });
        return response.data;
    } catch (err) {
        const status = err.response?.status;
        const rawMessage = extractRawErrorMessage(err, `Shiprocket ${method.toUpperCase()} ${endpoint} failed`);
        log("error", `[${requestId}] API error`, { statusCode: status, rawError: rawMessage });

        if (status === 401 && !isRetry) {
            log("warn", `[${requestId}] 401 Unauthorized received. Invalidating token and retrying once...`);
            _cachedToken = null;
            _tokenExpiresAt = 0;
            return shiprocketRequest(method, endpoint, data, params, true);
        }
        if (status === 401) {
            _cachedToken = null;
            _tokenExpiresAt = 0;
        }

        const friendlyMessage = mapToFriendlyError(rawMessage, status);
        throw new Error(friendlyMessage);
    }
}

module.exports = {
    getToken,
    shiprocketRequest,
    extractRawErrorMessage,
    mapToFriendlyError,
    SHIPROCKET_BASE_URL: config.baseUrl
};
