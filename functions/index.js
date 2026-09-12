"use strict";

const { setGlobalOptions } = require("firebase-functions/v2");
const { defineSecret } = require("firebase-functions/params");

const razorpayKeyId = defineSecret("RAZORPAY_KEY_ID");
const razorpayKeySecret = defineSecret("RAZORPAY_KEY_SECRET");
const shiprocketEmail = defineSecret("SHIPROCKET_EMAIL");
const shiprocketPassword = defineSecret("SHIPROCKET_PASSWORD");
const smtpUser = defineSecret("SMTP_USER");
const smtpPass = defineSecret("SMTP_PASS");

setGlobalOptions({
    secrets: [razorpayKeyId, razorpayKeySecret, shiprocketEmail, shiprocketPassword, smtpUser, smtpPass]
});

// Import domain modules
const razorpayModule = require("./payment/razorpay");
const orderModule = require("./order/orderController");
const productModule = require("./product/productController");
const userModule = require("./user/userController");
const contentModule = require("./content/contentController");
const shippingModule = require("./shipping/shiprocket");
const inventoryModule = require("./inventory/inventoryController");
const reviewModule = require("./review/reviewController");
const invoiceModule = require("./invoice/invoiceController");
const notificationModule = require("./notification/notificationController");
const analyticsModule = require("./analytics/analyticsController");

module.exports = {
    ...razorpayModule,
    ...orderModule,
    ...productModule,
    ...userModule,
    ...contentModule,
    ...shippingModule,
    ...inventoryModule,
    ...reviewModule,
    ...invoiceModule,
    ...notificationModule,
    ...analyticsModule
};
