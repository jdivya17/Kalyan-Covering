"use strict";
const express = require("express");
const { admin, db } = require("../lib/admin");
const { sendError } = require("../lib/utils");
const { authMiddleware, requireAdmin } = require("../middleware/auth");
const PDFDocument = require("pdfkit");
const nodemailer = require("nodemailer");

const router = express.Router();

function buildInvoicePDF(order, invoiceNumber, orderId) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 50, size: "A4" });
            const buffers = [];
            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', () => resolve(Buffer.concat(buffers).toString('base64')));

            doc.fontSize(20).text("TAX INVOICE", { align: "center" });
            doc.moveDown();
            doc.fontSize(12).text(`Invoice Number: ${invoiceNumber}`);
            doc.text(`Order ID: ${orderId}`);
            doc.end();
        } catch (e) {
            reject(e);
        }
    });
}

// POST /api/invoices/generate
router.post("/generate", authMiddleware, async (req, res) => {
    try {
        const { orderId } = req.body;
        if (!orderId) return sendError(res, 400, "invalid-argument", "orderId is required.");

        const orderSnap = await db.collection("orders").doc(orderId).get();
        if (!orderSnap.exists) return sendError(res, 404, "not-found", "Order not found.");
        const order = orderSnap.data();

        if (order.customerId !== req.user.uid && !req.isAdmin) {
            return sendError(res, 403, "permission-denied", "Access denied.");
        }

        const existing = await db.collection("invoices").where("orderId", "==", orderId).limit(1).get();
        if (!existing.empty) {
            const cached = existing.docs[0];
            return res.json({ success: true, invoiceId: cached.id, pdfBase64: cached.data().pdfBase64 });
        }

        const invoiceNumber = `INV-${Date.now()}`;
        const pdfBase64 = await buildInvoicePDF(order, invoiceNumber, orderId);

        const invoiceDoc = {
            invoiceNumber, orderId, pdfBase64,
            customerId: order.customerId,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        };
        const ref = await db.collection("invoices").add(invoiceDoc);
        await db.collection("orders").doc(orderId).update({ invoiceId: ref.id });

        return res.json({ success: true, invoiceId: ref.id, pdfBase64 });
    } catch (err) {
        console.error("[invoices/generate]", err);
        return sendError(res, 500, "internal", "Failed to generate invoice.");
    }
});

module.exports = router;
