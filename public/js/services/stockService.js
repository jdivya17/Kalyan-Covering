/**
 * stockService.js — Kalyan Covering
 * Stock status management and back-in-stock alert notifications.
 */

import {
    db,
    collection,
    addDoc,
    serverTimestamp
} from '../firebase-config.js';
import { STORE_CONFIG } from '../config/storeConfig.js';

/**
 * Get formatted stock status information
 * @param {Object} product
 * @returns {{status: 'in'|'low'|'out', label: string, badgeClass: string, isOutOfStock: boolean}}
 */
export function getStockInfo(product) {
    if (!product) {
        return { status: 'in', label: 'In Stock', badgeClass: 'in-stock', isOutOfStock: false };
    }

    const stockQty = typeof product.stockQuantity === 'number'
        ? product.stockQuantity
        : (typeof product.stock === 'number' ? product.stock : null);

    if (stockQty === 0 || product.stock === 'out' || product.inStock === false) {
        return {
            status: 'out',
            label: 'Out of Stock',
            badgeClass: 'out-of-stock',
            isOutOfStock: true
        };
    }

    if ((typeof stockQty === 'number' && stockQty > 0 && stockQty <= 5) || product.stock === 'low') {
        const count = typeof stockQty === 'number' ? stockQty : 3;
        return {
            status: 'low',
            label: `Only ${count} left in stock — Order soon`,
            badgeClass: 'low-stock',
            isOutOfStock: false
        };
    }

    const dispatchText = STORE_CONFIG.shipping?.showShipsIn24Hours
        ? `In Stock — ${STORE_CONFIG.shipping.dispatchTimeText || 'Ships in 24 hrs'}`
        : 'In Stock';

    return {
        status: 'in',
        label: dispatchText,
        badgeClass: 'in-stock',
        isOutOfStock: false
    };
}

/**
 * Register a customer for a Back In Stock alert
 * @param {Object} data
 * @param {string} data.productId
 * @param {string} data.productName
 * @param {string} data.email
 * @param {string} [data.phone]
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function subscribeBackInStock({ productId, productName, email, phone = '' }) {
    if (!productId) return { success: false, error: 'Product ID is required.' };
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return { success: false, error: 'Valid email address is required.' };
    }

    try {
        await addDoc(collection(db, 'stockAlerts'), {
            productId,
            productName: productName || 'Jewellery',
            email: email.trim().toLowerCase(),
            phone: phone.trim(),
            createdAt: serverTimestamp(),
            notified: false
        });

        return { success: true };
    } catch (e) {
        console.error('Error subscribing to back-in-stock alert:', e);
        return { success: false, error: e.message || 'Failed to save alert request.' };
    }
}

window.getStockInfo = getStockInfo;
window.subscribeBackInStock = subscribeBackInStock;
