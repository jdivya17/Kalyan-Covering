"use strict";

const { onCall, HttpsError, onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const crypto = require("crypto");
const Razorpay = require("razorpay");
const { admin, db } = require("../lib/admin");
const { logAuditEvent } = require("../utils/audit");

const razorpayKeyId = defineSecret("RAZORPAY_KEY_ID");
const razorpayKeySecret = defineSecret("RAZORPAY_KEY_SECRET");

function getRazorpayClient() {
  return new Razorpay({
    key_id: razorpayKeyId.value(),
    key_secret: razorpayKeySecret.value(),
  });
}

const verifyPayment = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, orderId } = request.data;
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    throw new HttpsError("invalid-argument", "Missing payment verification parameters.");
  }

  const generatedSignature = crypto
    .createHmac("sha256", razorpayKeySecret.value())
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest("hex");

  if (generatedSignature !== razorpay_signature) {
    throw new HttpsError("invalid-argument", "Payment signature verification failed.");
  }

  if (orderId) {
    const orderRef = db.collection("orders").doc(orderId);
    await orderRef.update({
      paymentStatus: "paid",
      orderStatus: "processing",
      "payment.razorpayPaymentId": razorpay_payment_id,
      "payment.paidAt": admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await logAuditEvent({
      action: "VERIFY_PAYMENT_SUCCESS",
      userId: request.auth.uid,
      details: { orderId, razorpay_payment_id }
    });
  }

  return { success: true, message: "Payment verified successfully." };
});

const razorpayWebhook = onRequest(async (req, res) => {
  const secret = razorpayKeySecret.value();
  const signature = req.headers["x-razorpay-signature"];

  if (!signature) {
    return res.status(400).send("Missing signature.");
  }

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(JSON.stringify(req.body))
    .digest("hex");

  if (expectedSignature !== signature) {
    return res.status(400).send("Invalid webhook signature.");
  }

  const event = req.body;
  if (event.event === "payment.captured") {
    const payment = event.payload.payment.entity;
    console.log("Razorpay Payment Captured Webhook:", payment.id);
  }

  res.status(200).json({ status: "ok" });
});

module.exports = {
  verifyPayment,
  razorpayWebhook
};
