"use strict";

/**
 * Best-effort in-memory rate limiter middleware for Vercel/Express API.
 * Note: In serverless environments, this provides per-instance rate limiting.
 * For production edge protection, combine with Vercel Firewall rules.
 */
const hits = new Map();

function rateLimit({ windowMs, max }) {
    return (req, res, next) => {
        const ip = String(req.headers["x-forwarded-for"] || req.ip || "").split(",")[0].trim();
        const now = Date.now();
        const rec = hits.get(ip) || { n: 0, t: now };
        if (now - rec.t > windowMs) { rec.n = 0; rec.t = now; }
        rec.n++;
        hits.set(ip, rec);
        if (hits.size > 5000) {
            for (const [k, v] of hits) {
                if (now - v.t > windowMs) hits.delete(k);
            }
        }
        if (rec.n > max) {
            return res.status(429).json({ error: "resource-exhausted", message: "Too many requests. Try again shortly." });
        }
        next();
    };
}

module.exports = { rateLimit };
