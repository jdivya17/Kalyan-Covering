"use strict";
const express = require("express");
const { admin, db } = require("../lib/admin");
const { sendError } = require("../lib/utils");
const { authMiddleware } = require("../middleware/auth");

const router = express.Router();

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function sendMail({ to, subject, html, attachments }) {
    const key = process.env.RESEND_API_KEY;
    const from = process.env.MAIL_FROM; // e.g. 'Kalyan Covering <orders@yourdomain.com>'
    if (!key || !from) throw new Error("Mail provider is not configured.");
    const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [to], subject, html, ...(attachments?.length ? { attachments } : {}) })
    });
    if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
    return r.json();
}

// POST /api/notifications/send-order-email   body: { orderId }  — NOTHING else is trusted from the client
router.post("/send-order-email", authMiddleware, async (req, res) => {
    try {
        const { orderId } = req.body;
        if (!orderId || typeof orderId !== "string") return sendError(res, 400, "invalid-argument", "orderId is required.");

        const ref = db.collection("orders").doc(orderId);
        const snap = await ref.get();
        if (!snap.exists) return sendError(res, 404, "not-found", "Order not found.");
        const order = snap.data();

        if (order.customerId !== req.user.uid && !req.isAdmin) {
            return sendError(res, 403, "permission-denied", "Access denied.");
        }
        const isCod = order.payment?.method === "cod";
        if (order.paymentStatus !== "paid" && !isCod) {
            return sendError(res, 400, "failed-precondition", "Order is not confirmed yet.");
        }
        // customers get ONE confirmation mail per order (prevents spam); admins may resend
        if (order.confirmationEmailSentAt && !req.isAdmin) {
            return res.json({ success: true, alreadySent: true });
        }

        const to = order.shippingAddress?.email;
        if (!to) return sendError(res, 400, "failed-precondition", "No email on order.");

        const rows = (order.items || []).map((i) => `
            <tr>
              <td style="padding:8px;border-bottom:1px solid #eee">${esc(i.name)}</td>
              <td style="padding:8px;border-bottom:1px solid #eee;text-align:center">${esc(i.qty ?? i.quantity ?? 1)}</td>
              <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">₹${esc(i.price)}</td>
            </tr>`).join("");

        const html = `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e0e0e0;border-radius:8px;overflow:hidden">
            <div style="background:#111;color:#FFD700;padding:20px;text-align:center"><h1 style="margin:0;font-size:22px">KALYAN COVERING</h1></div>
            <div style="padding:24px">
              <h2 style="margin-top:0">Thank you for your order!</h2>
              <p>Your order <strong>#${esc(order.orderNumber || orderId)}</strong> is confirmed.</p>
              <table style="width:100%;border-collapse:collapse;margin:16px 0">
                <thead><tr style="background:#f4f4f4"><th style="padding:8px;text-align:left">Item</th><th style="padding:8px">Qty</th><th style="padding:8px;text-align:right">Price</th></tr></thead>
                <tbody>${rows}</tbody>
              </table>
              <p style="text-align:right">Subtotal: ₹${esc(order.subtotal)}<br>
                 ${order.discount ? `Discount: -₹${esc(order.discount)}<br>` : ""}
                 GST: ₹${esc(order.gst)}<br>
                 Delivery: ₹${esc(order.deliveryCharge)}<br>
                 ${order.codFee ? `COD fee: ₹${esc(order.codFee)}<br>` : ""}
                 <strong>Total: ₹${esc(order.totalAmount)}</strong>${isCod ? " (Cash on Delivery)" : " (Paid)"}</p>
            </div>
          </div>`;

        // Attach invoice only if it already exists server-side (never accept a PDF from the client)
        let attachments = [];
        const inv = await db.collection("invoices").where("orderId", "==", orderId).limit(1).get();
        if (!inv.empty && inv.docs[0].data().pdfBase64) {
            attachments = [{ filename: `Invoice-${inv.docs[0].data().invoiceNumber || orderId}.pdf`, content: inv.docs[0].data().pdfBase64 }];
        }

        await sendMail({
            to,
            subject: `Order Confirmed #${order.orderNumber || orderId} - Kalyan Covering`,
            html,
            attachments
        });

        await ref.update({ confirmationEmailSentAt: admin.firestore.FieldValue.serverTimestamp() });
        return res.json({ success: true });
    } catch (err) {
        console.error("[notifications/send-order-email]", err);
        return sendError(res, 502, "unavailable", "Failed to send email.");
    }
});

module.exports = router;
