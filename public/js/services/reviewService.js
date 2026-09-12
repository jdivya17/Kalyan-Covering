/**
 * reviewService.js — Kalyan Covering
 * Product review fetching and submission.
 * Reviews are stored in Firestore under the 'reviews' collection.
 */

import { db, collection, doc, getDocs, addDoc, query, where, orderBy, serverTimestamp } from '../firebase-config.js';
import { KC } from '../store/state.js';
import { Toast } from '../components/Toast.js';
import { escapeHtml } from '../utils/helpers.js';

// ---- Fetch Reviews ----
/**
 * Load reviews for a product
 * @param {string} productId
 * @returns {Promise<Array>}
 */
export async function getProductReviews(productId) {
    if (!productId) return [];
    try {
        const q = query(
            collection(db, 'reviews'),
            where('productId', '==', productId),
            where('status', '==', 'approved'),
            orderBy('createdAt', 'desc')
        );
        const snapshot = await getDocs(q);
        return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) {
        console.error('Error fetching reviews:', e);
        return [];
    }
}

// ---- Submit Review ----
/**
 * Submit a new review for a product
 * @param {Object} reviewData
 * @param {string} reviewData.productId
 * @param {string} reviewData.title
 * @param {string} reviewData.text
 * @param {number} reviewData.rating - 1 to 5
 * @param {string} [reviewData.reviewerName]
 * @returns {Promise<{success:boolean, error?:string}>}
 */
export async function submitReview({ productId, title, text, rating, reviewerName }) {
    if (!productId) return { success: false, error: 'Product ID is required.' };
    if (!rating || rating < 1 || rating > 5) return { success: false, error: 'Please select a rating (1-5).' };
    if (!text?.trim()) return { success: false, error: 'Review text is required.' };

    const user = KC.user || JSON.parse(localStorage.getItem('kc_user') || 'null');

    try {
        const { functions, httpsCallable } = await import('../firebase-config.js');
        if (functions) {
            const submitReviewFn = httpsCallable(functions, 'submitReview');
            await submitReviewFn({
                productId,
                title: escapeHtml(title || ''),
                reviewText: escapeHtml(text.trim()),
                rating: Number(rating),
                reviewerName: escapeHtml(reviewerName || user?.name || 'Customer')
            });
        } else {
            await addDoc(collection(db, 'reviews'), {
                productId,
                title: escapeHtml(title || ''),
                text: escapeHtml(text.trim()),
                reviewText: escapeHtml(text.trim()),
                rating: Number(rating),
                reviewerName: escapeHtml(reviewerName || user?.name || 'Anonymous'),
                userId: user?.uid || null,
                status: 'pending',
                helpful: 0,
                createdAt: serverTimestamp()
            });
        }
        Toast.success('Review Submitted!', 'Your review is pending approval.');
        return { success: true };
    } catch (e) {
        const msg = e.message || 'Failed to submit review.';
        Toast.error('Submission Failed', msg);
        return { success: false, error: msg };
    }
}

// Bind to window for HTML compatibility
window.getProductReviews = getProductReviews;
window.submitReview = submitReview;
