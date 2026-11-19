#!/usr/bin/env node
/**
 * shiprocket-check.js — Kalyan Covering
 * CLI Diagnostic tool to verify Shiprocket configuration and connectivity.
 *
 * READ-ONLY calls only:
 *   1. POST /auth/login
 *   2. GET /settings/company/pickup
 *   3. GET /courier/serviceability/ (if delivery pincode argument provided)
 *
 * NEVER creates orders, assigns couriers, schedules pickups, or logs secret values.
 * Run locally via: npm run check:shiprocket [deliveryPincode]
 */
"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");

// Simple .env / .env.local loader for local execution without external deps
function loadEnvFile(filename) {
    const filePath = path.resolve(process.cwd(), filename);
    if (!fs.existsSync(filePath)) return;
    try {
        const content = fs.readFileSync(filePath, "utf8");
        for (const line of content.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) continue;
            const eqIdx = trimmed.indexOf("=");
            if (eqIdx <= 0) continue;
            const key = trimmed.substring(0, eqIdx).trim();
            let val = trimmed.substring(eqIdx + 1).trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                val = val.slice(1, -1);
            }
            if (!process.env[key]) {
                process.env[key] = val;
            }
        }
    } catch (_) {}
}

loadEnvFile(".env.local");
loadEnvFile(".env");

function cleanVal(v) {
    if (typeof v !== "string") return "";
    let s = v.trim();
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
        s = s.slice(1, -1);
    }
    return s.trim();
}

const EMAIL = cleanVal(process.env.SHIPROCKET_EMAIL);
const PASSWORD = cleanVal(process.env.SHIPROCKET_PASSWORD);
const PICKUP_LOCATION = cleanVal(process.env.SHIPROCKET_PICKUP_LOCATION) || cleanVal(process.env.STORE_PICKUP_LOCATION);
const PICKUP_PINCODE = cleanVal(process.env.SHIPROCKET_PICKUP_PINCODE) || cleanVal(process.env.STORE_PICKUP_PINCODE);
const WEBHOOK_TOKEN = cleanVal(process.env.SHIPROCKET_WEBHOOK_TOKEN);

const BASE_URL = "https://apiv2.shiprocket.in/v1/external";

function makeRequest(method, endpoint, token = null, data = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(`${BASE_URL}${endpoint}`);
        const headers = {
            "Content-Type": "application/json",
            "User-Agent": "KalyanCovering-ShiprocketChecker/1.0"
        };
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const postBody = data ? JSON.stringify(data) : null;
        if (postBody) headers["Content-Length"] = Buffer.byteLength(postBody);

        const options = {
            hostname: url.hostname,
            path: url.pathname + url.search,
            method: method.toUpperCase(),
            headers,
            timeout: 15000
        };

        const req = https.request(options, (res) => {
            let body = "";
            res.on("data", chunk => { body += chunk; });
            res.on("end", () => {
                let parsed = null;
                try { parsed = JSON.parse(body); } catch (_) { parsed = body; }
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve({ status: res.statusCode, data: parsed });
                } else {
                    const msg = (parsed && parsed.message) || (typeof parsed === "string" ? parsed : `HTTP ${res.statusCode}`);
                    reject(new Error(msg));
                }
            });
        });

        req.on("error", err => reject(err));
        req.on("timeout", () => {
            req.destroy();
            reject(new Error("Request timed out (15s)"));
        });

        if (postBody) req.write(postBody);
        req.end();
    });
}

async function main() {
    console.log("=================================================");
    console.log("      Kalyan Covering — Shiprocket CLI Check     ");
    console.log("=================================================\n");

    let hasFailures = false;

    // 1. Check Env Vars presence (NEVER print values of email/password/tokens)
    console.log("1. Checking Environment Variables:");
    if (!EMAIL) {
        console.log("   [FAIL] SHIPROCKET_EMAIL is missing.");
        hasFailures = true;
    } else {
        console.log("   [OK]   SHIPROCKET_EMAIL is present.");
    }

    if (!PASSWORD) {
        console.log("   [FAIL] SHIPROCKET_PASSWORD is missing.");
        hasFailures = true;
    } else {
        console.log("   [OK]   SHIPROCKET_PASSWORD is present.");
    }

    if (!PICKUP_LOCATION) {
        console.log("   [FAIL] SHIPROCKET_PICKUP_LOCATION is missing.");
        hasFailures = true;
    } else {
        console.log(`   [OK]   SHIPROCKET_PICKUP_LOCATION is configured: '${PICKUP_LOCATION}'`);
    }

    if (!PICKUP_PINCODE) {
        console.log("   [FAIL] SHIPROCKET_PICKUP_PINCODE is missing.");
        hasFailures = true;
    } else {
        console.log(`   [OK]   SHIPROCKET_PICKUP_PINCODE is configured: '${PICKUP_PINCODE}'`);
    }

    if (!WEBHOOK_TOKEN) {
        console.log("   [WARN] SHIPROCKET_WEBHOOK_TOKEN is not configured (webhook updates will fail).");
    } else {
        console.log("   [OK]   SHIPROCKET_WEBHOOK_TOKEN is present.");
    }
    console.log();

    if (!EMAIL || !PASSWORD) {
        console.error("Cannot proceed with API checks: missing credentials.");
        console.error("Set SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD in your .env or environment.\n");
        process.exit(1);
    }

    // 2. Authentication Check
    console.log("2. Testing Shiprocket Authentication:");
    let token = null;
    try {
        const loginRes = await makeRequest("POST", "/auth/login", null, { email: EMAIL, password: PASSWORD });
        token = loginRes.data?.token;
        if (!token) throw new Error("No token returned in auth response.");
        console.log("   [OK]   Authentication successful (token obtained).");
    } catch (err) {
        console.log(`   [FAIL] Authentication failed: ${err.message}`);
        hasFailures = true;
        console.error("\nAuthentication failed. Exiting.");
        process.exit(1);
    }
    console.log();

    // 3. Pickup Locations Check
    console.log("3. Fetching Pickup Locations from Shiprocket:");
    let matchedLocation = null;
    try {
        const pickupRes = await makeRequest("GET", "/settings/company/pickup", token);
        const locations = pickupRes.data?.data?.shipping_address || [];

        if (locations.length === 0) {
            console.log("   [FAIL] No pickup locations found in your Shiprocket account.");
            console.log("          Please add a pickup address in Shiprocket Dashboard > Settings > Pickup Address.");
            hasFailures = true;
        } else {
            console.log(`   Found ${locations.length} pickup location(s):`);
            locations.forEach((loc, idx) => {
                const name = loc.pickup_location || "Unnamed";
                const pin = loc.pin_code || loc.pincode || "No PIN";
                const city = loc.city || "";
                const state = loc.state || "";
                console.log(`     ${idx + 1}. "${name}" — ${city}, ${state} (PIN: ${pin})`);
                if (name === PICKUP_LOCATION) {
                    matchedLocation = loc;
                }
            });

            console.log();
            if (matchedLocation) {
                console.log(`   [OK]   Configured pickup location '${PICKUP_LOCATION}' matches Shiprocket location.`);
                const srPin = String(matchedLocation.pin_code || matchedLocation.pincode || "").trim();
                if (PICKUP_PINCODE && srPin === PICKUP_PINCODE) {
                    console.log(`   [OK]   Pickup pincode matches Shiprocket: '${PICKUP_PINCODE}'.`);
                } else {
                    console.log(`   [FAIL] Pincode mismatch! Shiprocket has '${srPin}', but SHIPROCKET_PICKUP_PINCODE is '${PICKUP_PINCODE}'.`);
                    hasFailures = true;
                }
            } else {
                console.log(`   [FAIL] Configured location '${PICKUP_LOCATION}' NOT found in Shiprocket.`);
                console.log(`          Ensure SHIPROCKET_PICKUP_LOCATION matches the exact name and spelling above.`);
                hasFailures = true;
            }
        }
    } catch (err) {
        console.log(`   [FAIL] Failed to fetch pickup locations: ${err.message}`);
        hasFailures = true;
    }
    console.log();

    // 4. Optional Serviceability Check
    const deliveryPinArg = process.argv[2] ? String(process.argv[2]).trim() : null;
    if (deliveryPinArg && /^\d{6}$/.test(deliveryPinArg)) {
        console.log(`4. Testing Serviceability to PIN ${deliveryPinArg}:`);
        if (!PICKUP_PINCODE) {
            console.log("   [SKIP] Pickup pincode not configured.");
        } else {
            try {
                const sUrl = `/courier/serviceability/?pickup_postcode=${encodeURIComponent(PICKUP_PINCODE)}&delivery_postcode=${encodeURIComponent(deliveryPinArg)}&weight=0.3&cod=1`;
                const sRes = await makeRequest("GET", sUrl, token);
                const couriers = sRes.data?.data?.available_courier_companies || [];
                if (couriers.length > 0) {
                    console.log(`   [OK]   Deliverable! ${couriers.length} courier partner(s) available.`);
                    couriers.slice(0, 3).forEach(c => {
                        console.log(`          - ${c.courier_name}: ₹${c.rate} (Est. ${c.estimated_delivery_days} days)`);
                    });
                } else {
                    console.log(`   [FAIL] Not serviceable to PIN ${deliveryPinArg} from ${PICKUP_PINCODE}.`);
                }
            } catch (sErr) {
                console.log(`   [FAIL] Serviceability check error: ${sErr.message}`);
            }
        }
        console.log();
    } else {
        console.log("4. Serviceability Test: (Pass a 6-digit delivery pincode as an argument to test, e.g.: node scripts/shiprocket-check.js 600001)\n");
    }

    // Final Summary
    console.log("=================================================");
    if (hasFailures) {
        console.log("   RESULT: CHECKS COMPLETED WITH ISSUES          ");
        console.log("   Review the [FAIL] items above and fix in .env ");
        console.log("=================================================");
        process.exit(1);
    } else {
        console.log("   RESULT: ALL READ-ONLY SHIPROCKET CHECKS PASSED ");
        console.log("   Shiprocket integration is properly configured. ");
        console.log("=================================================");
        process.exit(0);
    }
}

main().catch(err => {
    console.error("Unexpected error:", err.message);
    process.exit(1);
});
