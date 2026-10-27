#!/usr/bin/env node
"use strict";

const https = require("https");
const readline = require("readline");

function askVisible(question) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        rl.question(question, (answer) => {
            rl.close();
            process.stdin.resume();
            resolve(answer);
        });
    });
}

function askHidden(question) {
    return new Promise((resolve) => {
        process.stdout.write(question);

        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.setEncoding("utf8");

        let input = "";
        const onData = (chunk) => {
            for (let i = 0; i < chunk.length; i++) {
                const char = chunk[i];
                if (char === "\u0003") { // Ctrl+C
                    process.stdin.setRawMode(false);
                    process.stdin.pause();
                    process.exit(1);
                } else if (char === "\r" || char === "\n") {
                    process.stdin.setRawMode(false);
                    process.stdin.removeListener("data", onData);
                    process.stdin.pause();
                    process.stdout.write("\n");
                    resolve(input);
                    return;
                } else if (char === "\u0008" || char === "\x7f") { // Backspace
                    if (input.length > 0) {
                        input = input.slice(0, -1);
                    }
                } else if (char >= " " || char === "\t") {
                    input += char;
                }
            }
        };

        process.stdin.on("data", onData);
    });
}

function cleanInput(val) {
    if (typeof val !== "string") return "";
    let s = val.trim();
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
        s = s.slice(1, -1);
    }
    return s.trim();
}

async function getInputs() {
    if (!process.stdin.isTTY) {
        const lines = [];
        const rl = readline.createInterface({ input: process.stdin });
        for await (const line of rl) {
            lines.push(line);
        }
        return {
            keyId: cleanInput(lines[0] || ""),
            keySecret: cleanInput(lines[1] || "")
        };
    }

    const rawKeyId = await askVisible("Enter Razorpay Key ID: ");
    const rawKeySecret = await askHidden("Enter Razorpay Key Secret: ");
    return {
        keyId: cleanInput(rawKeyId),
        keySecret: cleanInput(rawKeySecret)
    };
}

async function main() {
    const { keyId, keySecret } = await getInputs();

    if (!keyId || !keySecret) {
        console.error("Error: Key ID and Key Secret must both be provided.");
        process.exit(1);
    }

    let mode = "unknown (check key id)";
    if (keyId.startsWith("rzp_live_")) {
        mode = "live";
    } else if (keyId.startsWith("rzp_test_")) {
        mode = "test";
    }

    console.log(`Key Mode: ${mode}`);

    const authHeader = "Basic " + Buffer.from(`${keyId}:${keySecret}`).toString("base64");

    const req = https.request({
        hostname: "api.razorpay.com",
        port: 443,
        path: "/v1/payments?count=1",
        method: "GET",
        headers: {
            "Authorization": authHeader,
            "User-Agent": "KalyanCovering-KeyChecker/1.0"
        }
    }, (res) => {
        let body = "";
        res.on("data", (chunk) => {
            body += chunk;
        });

        res.on("end", () => {
            console.log(`HTTP Status: ${res.statusCode} ${res.statusMessage || ""}`.trim());

            try {
                const parsed = JSON.parse(body);
                if (parsed && parsed.error && parsed.error.description) {
                    console.log(`Error Description: ${parsed.error.description}`);
                }
            } catch (_) {
                // Not JSON or empty body
            }
        });
    });

    req.on("error", (err) => {
        console.log(`HTTP Status: Network Error (${err.message})`);
    });

    req.end();
}

main();
