/**
 * reviewService.js — Kalyan Covering
 * Product review fetching, photo compression, storage upload, and submission.
 * Reviews are stored in Firestore under the 'reviews' collection.
 * Status workflow: All new reviews are saved with status "pending" and only displayed when "approved".
 * Images are uploaded to Cloudinary (not Firebase Storage).
 */

import {
    db,
    collection,
    getDocs,
    addDoc,
    query,
    where,
    orderBy,
    serverTimestamp
} from '../firebase-config.js';
import { uploadToCloudinary } from '../utils/cloudinaryUtils.js';
import { compressImage } from '../utils/imageCompressor.js';
import { escapeHtml } from '../utils/helpers.js';

/**
 * Load approved reviews for a product (strictly status === 'approved')
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
        const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        return list;
    } catch (e) {
        console.warn('Compound index notice or fallback on getProductReviews:', e.message);
        try {
            // Fallback query without compound where/orderBy index requirement
            const fallbackQ = query(
                collection(db, 'reviews'),
                where('productId', '==', productId)
            );
            const snap = await getDocs(fallbackQ);
            return snap.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .filter(r => r.status === 'approved') // Strictly approved only
                .sort((a, b) => {
                    const tA = a.createdAt?.seconds || 0;
                    const tB = b.createdAt?.seconds || 0;
                    return tB - tA;
                });
        } catch (err) {
            console.error('Failed to fetch reviews:', err);
            return [];
        }
    }
}

/**
 * Check if the current user is a verified buyer of this product
 * @param {string} uid
 * @param {string} productId
 * @returns {Promise<boolean>}
 */
export async function isVerifiedBuyer(uid, productId) {
    if (!uid || !productId) return false;
    try {
        const q = query(
            collection(db, 'orders'),
            where('userId', '==', uid)
        );
        const snap = await getDocs(q);
        for (const doc of snap.docs) {
            const data = doc.data();
            if (Array.isArray(data.items)) {
                if (data.items.some(item => item.id === productId || item.productId === productId)) {
                    return true;
                }
            }
        }
    } catch (e) {
        console.warn('Could not verify purchase status:', e.message);
    }
    return false;
}

/**
 * Upload a customer review photo with client-side compression (max 800px, JPEG 0.75, < 500KB)
 * Uploads to Cloudinary (cloud name: ddw2whxh7, preset: kalyan_covering_upload)
 * @param {File} file
 * @param {string} productId
 * @returns {Promise<string>} Cloudinary secure URL
 */
export async function uploadReviewPhoto(file, productId) {
    if (!file) return '';
    try {
        // Compress image to max 800px, 0.75 JPEG quality before uploading
        const compressedBlob = await compressImage(file, { maxWidth: 800, maxHeight: 800, quality: 0.75 });

        // Convert blob to File so Cloudinary can detect the filename
        const uploadFile = new File(
            [compressedBlob],
            `review_${productId}_${Date.now()}.jpg`,
            { type: 'image/jpeg' }
        );

        const result = await uploadToCloudinary(uploadFile, 'image');
        if (!result || !result.url) throw new Error('Cloudinary returned no URL.');
        return result.url;
    } catch (e) {
        console.error('Error compressing/uploading review photo:', e);
        throw new Error('Photo upload failed. Please ensure photo is an image under 5MB.');
    }
}

/**
 * Submit a new review for a product (always saved with status 'pending')
 * @param {Object} reviewData
 * @param {string} reviewData.productId
 * @param {string} [reviewData.title]
 * @param {string} reviewData.text
 * @param {number} reviewData.rating - 1 to 5
 * @param {string} [reviewData.reviewerName]
 * @param {File[]} [reviewData.photos] - Optional photos
 * @returns {Promise<{success:boolean, error?:string}>}
 */
export async function submitReview({ productId, title = '', text, rating, reviewerName, photos = [] }) {
    if (!productId) return { success: false, error: 'Product ID is required.' };
    if (!rating || rating < 1 || rating > 5) return { success: false, error: 'Please select a star rating (1-5).' };
    if (!text?.trim()) return { success: false, error: 'Review comments cannot be empty.' };

    const user = JSON.parse(localStorage.getItem('kc_user') || 'null');
    const name = reviewerName?.trim() || user?.name || 'Kalyan Customer';

    try {
        // Upload any attached photos
        const photoUrls = [];
        if (Array.isArray(photos) && photos.length > 0) {
            for (const file of photos) {
                if (file && file.type?.startsWith('image/')) {
                    try {
                        const url = await uploadReviewPhoto(file, productId);
                        if (url) photoUrls.push(url);
                    } catch (photoErr) {
                        console.warn('[reviewService] Photo upload skipped:', photoErr.message);
                        if (typeof window.Toast !== 'undefined') {
                            window.Toast.warning('Photo Upload Notice', 'Photo could not be uploaded, submitting your text review.');
                        }
                    }
                }
            }
        }

        // Check verified buyer
        let verified = false;
        if (user?.uid) {
            verified = await isVerifiedBuyer(user.uid, productId);
        }

        const reviewDoc = {
            productId,
            title: escapeHtml(title.trim()),
            text: escapeHtml(text.trim()),
            reviewText: escapeHtml(text.trim()),
            rating: Number(rating),
            reviewerName: escapeHtml(name),
            userId: user?.uid || null,
            userEmail: user?.email || '',
            verifiedBuyer: verified,
            photos: photoUrls,
            photoUrl: photoUrls[0] || '',
            status: 'pending', // REQUIRED: All reviews are saved with status 'pending'
            helpful: 0,
            createdAt: serverTimestamp()
        };

        const docRef = await addDoc(collection(db, 'reviews'), reviewDoc);

        return {
            success: true,
            reviewId: docRef.id,
            status: 'pending',
            message: 'Your review has been submitted and will appear once approved by our moderation team.'
        };
    } catch (e) {
        console.error('Submit review error:', e);
        return { success: false, error: e.message || 'Failed to submit review.' };
    }
}

// Bind to window for global access
window.getProductReviews = getProductReviews;
window.submitReview = submitReview;
window.uploadReviewPhoto = uploadReviewPhoto;
