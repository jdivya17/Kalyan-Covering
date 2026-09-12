"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { admin, db } = require("../lib/admin");
const { verifyStaff } = require("../utils/auth");
const { logAuditEvent } = require("../utils/audit");

async function logAudit(request, action, targetCollection, targetId, before, after) {
    await logAuditEvent({
        action,
        userId: request.auth ? request.auth.uid : 'system',
        userEmail: request.auth && request.auth.token ? request.auth.token.email : 'system',
        details: { targetCollection, targetId, before, after }
    });
}

const submitReview = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Must be logged in to submit a review.');
    }

    const { productId, rating, reviewText, reviewerName, images } = request.data;
    if (!productId || !rating || !reviewText) {
        throw new HttpsError('invalid-argument', 'Missing required review fields.');
    }

    const reviewDoc = {
        productId,
        rating: Number(rating),
        reviewText: String(reviewText).trim(),
        reviewerName: reviewerName ? String(reviewerName).trim() : (request.auth.token.name || 'Customer'),
        images: Array.isArray(images) ? images : [],
        userId: request.auth.uid,
        status: 'pending',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    const ref = await db.collection('reviews').add(reviewDoc);
    return { success: true, id: ref.id };
});

const moderateReview = onCall(async (request) => {
    verifyStaff(request);

    const { reviewId, status } = request.data;
    if (!reviewId || !['approved', 'rejected'].includes(status)) {
        throw new HttpsError('invalid-argument', 'Invalid review moderation status.');
    }

    await db.collection('reviews').doc(reviewId).update({
        status,
        moderatedBy: request.auth.uid,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    await logAudit(request, 'MODERATE_REVIEW', 'reviews', reviewId, null, { status });
    return { success: true };
});

const reportReview = onCall(async (request) => {
    const { reviewId, reason } = request.data;
    if (!reviewId) {
        throw new HttpsError('invalid-argument', 'reviewId is required.');
    }

    await db.collection('reviews').doc(reviewId).update({
        isReported: true,
        reportReason: reason ? String(reason).trim() : 'Flagged by user',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return { success: true };
});

module.exports = {
    submitReview,
    moderateReview,
    reportReview
};
