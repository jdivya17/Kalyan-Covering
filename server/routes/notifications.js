"use strict";
const express = require("express");
const nodemailer = require("nodemailer");
const { db } = require("../lib/admin");
const { sendError } = require("../lib/utils");
const { authMiddleware } = require("../middleware/auth");

const router = express.Router();

// Transporter configuration (uses ENV SMTP credentials or fallback test account)
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
        user: process.env.SMTP_USER || process.env.EMAIL_USER || "kalyancoveringstore@gmail.com",
        pass: process.env.SMTP_PASS || process.env.EMAIL_PASS || ""
    }
});

/**
 * POST /api/notifications/send-order-email
 * Send Order Confirmation & Invoice PDF to customer
 */
router.post("/send-order-email", async (req, res) => {
    try {
        const { orderId, email, pdfBase64 } = req.body;
        if (!orderId || !email) {
            return sendError(res, 400, "invalid-argument", "orderId and email are required.");
        }

        let orderData = null;
        if (db) {
            const snap = await db.collection("orders").doc(orderId).get();
            if (snap.exists) {
                orderData = snap.data();
            }
        }

        const itemsHtml = (orderData && orderData.items) ? orderData.items.map(item => `
            <tr>
                <td style="padding:8px; border-bottom:1px solid #eee;">${item.name}</td>
                <td style="padding:8px; border-bottom:1px solid #eee; text-align:center;">${item.quantity || 1}</td>
                <td style="padding:8px; border-bottom:1px solid #eee; text-align:right;">₹${item.price}</td>
            </tr>
        `).join("") : "";

        const mailOptions = {
            from: `"Kalyan Covering" <${process.env.SMTP_USER || "kalyancoveringstore@gmail.com"}>`,
            to: email,
            subject: `✨ Order Confirmed #${orderId} - Kalyan Covering`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #fafafa; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
                    <div style="background: #111; color: #FFD700; padding: 20px; text-align: center;">
                        <h1 style="margin: 0; font-size: 24px;">KALYAN COVERING</h1>
                        <p style="margin: 5px 0 0; color: #fff; font-size: 14px;">Order Confirmation & Invoice</p>
                    </div>
                    <div style="padding: 24px; background: #ffffff;">
                        <h2 style="color: #333; margin-top: 0;">Thank you for your order! 🎉</h2>
                        <p style="color: #666; line-height: 1.6;">Hi there! We are delighted to inform you that your order <strong>#${orderId}</strong> has been confirmed.</p>
                        
                        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                            <thead>
                                <tr style="background: #f4f4f4; color: #333;">
                                    <th style="padding: 8px; text-align: left;">Item</th>
                                    <th style="padding: 8px; text-align: center;">Qty</th>
                                    <th style="padding: 8px; text-align: right;">Price</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${itemsHtml || '<tr><td colspan="3" style="padding:8px;">Order Details Attached</td></tr>'}
                            </tbody>
                        </table>

                        ${orderData && orderData.totalAmount ? `
                            <div style="text-align: right; font-size: 16px; font-weight: bold; color: #111; margin-top: 10px;">
                                Total Amount Paid: ₹${orderData.totalAmount}
                            </div>
                        ` : ''}

                        <p style="color: #888; font-size: 12px; margin-top: 30px; text-align: center;">
                            If you have any questions, reply directly to this email or contact support at Kalyan Covering.
                        </p>
                    </div>
                </div>
            `,
            attachments: pdfBase64 ? [
                {
                    filename: `Invoice-${orderId}.pdf`,
                    content: Buffer.from(pdfBase64, 'base64'),
                    contentType: 'application/pdf'
                }
            ] : []
        };

        // Send asynchronously
        transporter.sendMail(mailOptions, (err, info) => {
            if (err) {
                console.error("[notifications/send-order-email] Transporter error:", err);
            } else {
                console.log("[notifications/send-order-email] Email sent successfully:", info.messageId);
            }
        });

        return res.json({ success: true, message: "Order email notification dispatched." });
    } catch (err) {
        console.error("[notifications/send-order-email]", err);
        return sendError(res, 500, "internal", "Failed to dispatch email notification.");
    }
});

module.exports = router;
