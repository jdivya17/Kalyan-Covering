/**
 * shiprocketClient.js
 * -------------------
 * Low-level HTTP client for the Shiprocket REST API.
 *
 * Features:
 *  - Authenticates using email/password from environment variables (NEVER from frontend)
 *  - Caches the JWT token in-memory with expiry tracking (Shiprocket tokens last 24h)
 *  - Auto-refreshes the token when it is about to expire (within 5-minute buffer)
 *  - Structured logging with [SHIPROCKET_CLIENT] prefix on every request/response
 *  - Normalises Shiprocket error responses into descriptive JS Errors
 *
 * Security:
 *  - Credentials: SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD from process.env only
 *  - Token is kept in Node.js module-level memory; never stored in Firestore or returned
 *    to the frontend
 *  - Never import this file from any frontend code
 */

"use strict";

const axios = require("axios");

// ─── Constants ────────────────────────────────────────────────────────────────

const SHIPROCKET_BASE_URL = "https://apiv2.shiprocket.in/v1/external";

/** Token refresh buffer: refresh when less than 5 minutes remain */
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

/** Shiprocket tokens are valid for 24 hours */
const TOKEN_VALID_DURATION_MS = 24 * 60 * 60 * 1000;

// ─── In-memory token cache (module-level, per Cloud Function instance) ────────

let _cachedToken = null;
let _tokenExpiresAt = 0; // Unix ms

// ─── Logger helper ────────────────────────────────────────────────────────────

function log(level, message, meta = {}) {
    const entry = {
        severity: level.toUpperCase(),
        component: "SHIPROCKET_CLIENT",
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

// ─── Token Management ─────────────────────────────────────────────────────────

/**
 * Returns a valid Shiprocket JWT token.
 * Uses the cached token if still valid; otherwise fetches a fresh one.
 *
 * @returns {Promise<string>} JWT token string
 * @throws {Error} If authentication fails
 */
async function getToken() {
    const now = Date.now();

    // Return cached token if not expired (with buffer)
    if (_cachedToken && now < _tokenExpiresAt - TOKEN_EXPIRY_BUFFER_MS) {
        log("info", "Using cached Shiprocket token", {
            expiresInMs: _tokenExpiresAt - now,
        });
        return _cachedToken;
    }

    log("info", "Fetching new Shiprocket token");

    const { defineSecret } = require('firebase-functions/params');
    const shiprocketEmail = defineSecret("SHIPROCKET_EMAIL");
    const shiprocketPassword = defineSecret("SHIPROCKET_PASSWORD");

    const email = shiprocketEmail.value();
    const password = shiprocketPassword.value();

    if (!email || !password) {
        const err = new Error(
            "Shiprocket credentials not configured. Set SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD environment variables."
        );
        log("error", err.message);
        throw err;
    }

    try {
        const response = await axios.post(
            `${SHIPROCKET_BASE_URL}/auth/login`,
            { email, password },
            {
                headers: { "Content-Type": "application/json" },
                timeout: 10000, // 10 second timeout for auth
            }
        );

        const token = response.data?.token;
        if (!token) {
            throw new Error("Shiprocket auth response missing token field.");
        }

        // Cache the token
        _cachedToken = token;
        _tokenExpiresAt = now + TOKEN_VALID_DURATION_MS;

        log("info", "Shiprocket token fetched and cached successfully", {
            expiresAt: new Date(_tokenExpiresAt).toISOString(),
        });

        return token;
    } catch (err) {
        _cachedToken = null;
        _tokenExpiresAt = 0;
        const message = extractErrorMessage(err, "Shiprocket authentication failed");
        log("error", message, { statusCode: err.response?.status });
        throw new Error(message);
    }
}

// ─── Error Extraction ─────────────────────────────────────────────────────────

/**
 * Extracts a human-readable error message from an axios error or Shiprocket
 * API error response.
 *
 * @param {Error} err - The caught error
 * @param {string} fallback - Fallback message if none found
 * @returns {string}
 */
function extractErrorMessage(err, fallback = "Shiprocket API error") {
    if (err.response?.data) {
        const data = err.response.data;
        // Shiprocket may return: { message: "..." } or { errors: { field: ["msg"] } }
        if (typeof data.message === "string" && data.message) {
            return data.message;
        }
        if (data.errors) {
            const firstKey = Object.keys(data.errors)[0];
            if (firstKey && Array.isArray(data.errors[firstKey])) {
                return data.errors[firstKey][0];
            }
        }
    }
    if (err.message) return err.message;
    return fallback;
}

// ─── Core Request Function ────────────────────────────────────────────────────

/**
 * Makes an authenticated request to the Shiprocket API.
 *
 * @param {"GET"|"POST"|"PUT"|"DELETE"|"PATCH"} method - HTTP method
 * @param {string} endpoint - API endpoint path (e.g. "/courier/serviceability/")
 * @param {object|null} data - Request body (for POST/PUT/PATCH) or null
 * @param {object} params - URL query parameters (for GET requests)
 * @returns {Promise<object>} Parsed response data
 * @throws {Error} Descriptive error from Shiprocket or network failure
 */
async function shiprocketRequest(method, endpoint, data = null, params = {}) {
    const requestId = Math.random().toString(36).substring(2, 9);
    const url = `${SHIPROCKET_BASE_URL}${endpoint}`;

    log("info", `[${requestId}] Shiprocket API request`, {
        method: method.toUpperCase(),
        endpoint,
        hasBody: !!data,
        params: Object.keys(params).length > 0 ? params : undefined,
    });

    try {
        const token = await getToken();

        const config = {
            method: method.toUpperCase(),
            url,
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            timeout: 30000, // 30 second timeout
            params: Object.keys(params).length > 0 ? params : undefined,
        };

        if (data && ["POST", "PUT", "PATCH"].includes(method.toUpperCase())) {
            config.data = data;
        }

        const response = await axios(config);

        log("info", `[${requestId}] Shiprocket API response received`, {
            method: method.toUpperCase(),
            endpoint,
            status: response.status,
        });

        return response.data;
    } catch (err) {
        const status = err.response?.status;
        const message = extractErrorMessage(err, `Shiprocket ${method.toUpperCase()} ${endpoint} failed`);

        log("error", `[${requestId}] Shiprocket API error`, {
            method: method.toUpperCase(),
            endpoint,
            statusCode: status,
            errorMessage: message,
        });

        // If token was rejected (401), invalidate cache so next call re-authenticates
        if (status === 401) {
            log("warn", "Shiprocket returned 401 — invalidating cached token");
            _cachedToken = null;
            _tokenExpiresAt = 0;
        }

        throw new Error(message);
    }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
    getToken,
    shiprocketRequest,
    SHIPROCKET_BASE_URL,
};
