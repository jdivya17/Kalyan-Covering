"use strict";

const express = require("express");
const crypto = require("crypto");
const { sendError } = require("../lib/utils");
const { authMiddleware } = require("../middleware/auth");

const router = express.Router();

// ── POST /api/uploads/sign ────────────────────────────────────────────────────
router.post("/sign", authMiddleware, async (req, res) => {
    try {
        const apiKey = process.env.CLOUDINARY_API_KEY;
        const apiSecret = process.env.CLOUDINARY_API_SECRET;
        const cloudName = process.env.CLOUDINARY_CLOUD_NAME;

        if (!apiKey || !apiSecret || !cloudName) {
            console.error("[uploads/sign] Error: Missing Cloudinary configuration environment variables.");
            return sendError(res, 500, "internal", "Cloudinary configuration is missing on server.");
        }

        const { uploadType } = req.body;
        let folder = "kalyan_products";

        if (uploadType === "review") {
            // Any logged-in user can sign review uploads (image only, size limit checked on client)
            folder = "kalyan_reviews";
        } else if (uploadType === "product_video") {
            if (!req.isAdmin) return sendError(res, 403, "permission-denied", "Admin role required for product video uploads.");
            folder = "kalyan_videos";
        } else {
            // Default product images / store assets - Admin only
            if (!req.isAdmin) return sendError(res, 403, "permission-denied", "Admin role required for product image uploads.");
            folder = "kalyan_products";
        }

        const timestamp = Math.floor(Date.now() / 1000);
        const paramsToSign = `folder=${folder}&timestamp=${timestamp}${apiSecret}`;
        const signature = crypto.createHash("sha1").update(paramsToSign).digest("hex");

        return res.json({
            signature,
            timestamp,
            api_key: apiKey,
            cloud_name: cloudName,
            folder
        });
    } catch (err) {
        console.error("[uploads/sign]", err);
        return sendError(res, 500, "internal", "Failed to generate Cloudinary upload signature.");
    }
});

module.exports = router;
