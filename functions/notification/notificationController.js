"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { admin, db } = require("../lib/admin");
const { verifyStaff } = require("../utils/auth");

const sendNotification = onCall(async (request) => {
    verifyStaff(request);

    const { userId, title, message, type } = request.data;
    if (!userId || !title || !message) {
        throw new HttpsError('invalid-argument', 'Missing notification payload fields.');
    }

    const notificationDoc = {
        userId,
        title: String(title).trim(),
        message: String(message).trim(),
        type: type || 'general',
        read: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    const ref = await db.collection('notifications').add(notificationDoc);
    return { success: true, id: ref.id };
});

const markNotificationRead = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'User must be logged in.');
    }

    const { notificationId } = request.data;
    if (!notificationId) {
        throw new HttpsError('invalid-argument', 'notificationId is required.');
    }

    await db.collection('notifications').doc(notificationId).update({
        read: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return { success: true };
});

const onOrderStatusNotification = onDocumentWritten('orders/{orderId}', async (event) => {
    if (!event.data.after.exists) return;
    const after = event.data.after.data();
    const before = event.data.before ? event.data.before.data() : null;

    if (!before || before.orderStatus !== after.orderStatus) {
        console.log(`Order status updated for ${event.params.orderId}: ${after.orderStatus}`);
        if (after.customerId) {
            const statusTitles = {
                confirmed: 'Order Confirmed! 🎉',
                shipped: 'Order Shipped! 🚚',
                out_for_delivery: 'Out for Delivery! 📦',
                delivered: 'Order Delivered! 🎁',
                cancelled: 'Order Cancelled ❌'
            };
            const title = statusTitles[after.orderStatus] || `Order Status: ${after.orderStatus.toUpperCase()}`;
            const message = `Your order #${after.orderNumber || event.params.orderId} status has been updated to ${after.orderStatus.replace(/_/g, ' ')}.`;
            
            try {
                await db.collection('notifications').add({
                    userId: after.customerId,
                    orderId: event.params.orderId,
                    title,
                    message,
                    type: 'order',
                    read: false,
                    createdAt: admin.firestore.FieldValue.serverTimestamp()
                });
            } catch (nErr) {
                console.error('Failed to create customer notification:', nErr);
            }
        }
    }
});

module.exports = {
    sendNotification,
    markNotificationRead,
    onOrderStatusNotification
};
