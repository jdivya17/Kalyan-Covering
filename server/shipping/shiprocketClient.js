/**
 * shiprocketClient.js — Vercel/Express compatible
 * Reads credentials from process.env (set in Vercel dashboard or .env)
 */
"use strict";

const axios = require("axios");

const SHIPROCKET_BASE_URL = "https://apiv2.shiprocket.in/v1/external";
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

async function getToken() {
    const now = Date.now();
    if (_cachedToken && now < _tokenExpiresAt - TOKEN_EXPIRY_BUFFER_MS) {
        log("info", "Using cached Shiprocket token", { expiresInMs: _tokenExpiresAt - now });
        return _cachedToken;
    }

    log("info", "Fetching new Shiprocket token");
    const email = process.env.SHIPROCKET_EMAIL;
    const password = process.env.SHIPROCKET_PASSWORD;

    if (!email || !password) {
        const err = new Error("Shiprocket credentials not configured. Set SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD.");
        log("error", err.message);
        throw err;
    }

    try {
        const response = await axios.post(
            `${SHIPROCKET_BASE_URL}/auth/login`,
            { email, password },
            { headers: { "Content-Type": "application/json" }, timeout: 10000 }
        );
        const token = response.data?.token;
        if (!token) throw new Error("Shiprocket auth response missing token field.");
        _cachedToken = token;
        _tokenExpiresAt = now + TOKEN_VALID_DURATION_MS;
        log("info", "Shiprocket token fetched and cached", { expiresAt: new Date(_tokenExpiresAt).toISOString() });
        return token;
    } catch (err) {
        _cachedToken = null;
        _tokenExpiresAt = 0;
        const message = extractErrorMessage(err, "Shiprocket authentication failed");
        log("error", message, { statusCode: err.response?.status });
        throw new Error(message);
    }
}

function extractErrorMessage(err, fallback = "Shiprocket API error") {
    if (err.response?.data) {
        const data = err.response.data;
        if (typeof data.message === "string" && data.message) return data.message;
        if (data.errors) {
            const firstKey = Object.keys(data.errors)[0];
            if (firstKey && Array.isArray(data.errors[firstKey])) return data.errors[firstKey][0];
        }
    }
    if (err.message) return err.message;
    return fallback;
}

async function shiprocketRequest(method, endpoint, data = null, params = {}) {
    const requestId = Math.random().toString(36).substring(2, 9);
    const url = `${SHIPROCKET_BASE_URL}${endpoint}`;
    log("info", `[${requestId}] Shiprocket API request`, { method: method.toUpperCase(), endpoint });

    try {
        const token = await getToken();
        const config = {
            method: method.toUpperCase(), url,
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            timeout: 30000,
            params: Object.keys(params).length > 0 ? params : undefined,
        };
        if (data && ["POST", "PUT", "PATCH"].includes(method.toUpperCase())) config.data = data;
        const response = await axios(config);
        log("info", `[${requestId}] Response received`, { status: response.status });
        return response.data;
    } catch (err) {
        const status = err.response?.status;
        const message = extractErrorMessage(err, `Shiprocket ${method.toUpperCase()} ${endpoint} failed`);
        log("error", `[${requestId}] API error`, { statusCode: status, errorMessage: message });
        if (status === 401) { _cachedToken = null; _tokenExpiresAt = 0; }
        throw new Error(message);
    }
}

module.exports = { getToken, shiprocketRequest, SHIPROCKET_BASE_URL };
