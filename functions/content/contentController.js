"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { admin, db } = require("../lib/admin");
const {
    submitReview,
    moderateReview,
    reportReview
} = require("../review/reviewController");
const {
    sendNotification,
    markNotificationRead
} = require("../notification/notificationController");

const submitVideoReview = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Must be logged in to submit a video.');
    }

    const { productId, videoUrl, title, description, tags, isPublic, duration } = request.data;

    if (!productId || typeof productId !== 'string' || !productId.trim()) {
        throw new HttpsError('invalid-argument', 'productId is required.');
    }
    if (!videoUrl || typeof videoUrl !== 'string' || !videoUrl.trim()) {
        throw new HttpsError('invalid-argument', 'videoUrl is required.');
    }

    const ALLOWED_VIDEO_HOSTS = ['res.cloudinary.com', 'firebasestorage.googleapis.com'];
    let parsedUrl;
    try {
        parsedUrl = new URL(videoUrl);
    } catch {
        throw new HttpsError('invalid-argument', 'videoUrl is not a valid URL.');
    }
    if (!ALLOWED_VIDEO_HOSTS.some(host => parsedUrl.hostname === host || parsedUrl.hostname.endsWith('.' + host))) {
        throw new HttpsError('invalid-argument', 'videoUrl must point to an approved video host.');
    }

    const productSnap = await db.collection('products').doc(productId.trim()).get();
    if (!productSnap.exists) {
        throw new HttpsError('not-found', 'The referenced product does not exist.');
    }

    const videoDoc = {
        productId: productId.trim(),
        videoUrl: videoUrl.trim(),
        title: (title || '').trim(),
        description: (description || '').trim(),
        tags: Array.isArray(tags) ? tags.map(t => String(t).trim()).filter(Boolean) : [],
        isPublic: isPublic === true,
        duration: typeof duration === 'number' ? duration : null,
        authorId: request.auth.uid,
        authorName: request.auth.token.name || 'Customer',
        status: 'pending',
        likes: 0,
        views: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    const ref = await db.collection('videos').add(videoDoc);
    return { success: true, id: ref.id };
});

module.exports = {
    submitReview,
    moderateReview,
    reportReview,
    submitVideoReview,
    sendNotification,
    markNotificationRead
};
