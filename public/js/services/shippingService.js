/**
 * shippingService.js — Kalyan Covering (Frontend)
 * Calls Shiprocket-backed Cloud Functions for pincode serviceability and tracking.
 *
 * Cloud Functions called:
 *   - checkShippingServiceability(pincode, weight?)
 *   - getShipmentTracking(orderId)
 *   - getShippingCouriers(orderId)
 */

import { functions, httpsCallable } from '../firebase-config.js';
import { Toast } from '../components/Toast.js';

// ---- Pincode Serviceability ----
/**
 * Check if a pincode is serviceable via Shiprocket
 * @param {string} pincode - 6-digit PIN code
 * @param {number} [weight=0.5] - Shipment weight in kg
 * @returns {Promise<{serviceable:boolean, couriers?:Array, error?:string}>}
 */
export async function checkPincodeServiceability(pincode, weight = 0.5) {
    if (!pincode || !/^\d{6}$/.test(String(pincode))) {
        return { serviceable: false, error: 'Invalid PIN code.' };
    }
    try {
        const fn = httpsCallable(functions, 'checkShippingServiceability');
        const result = await fn({ pincode, weight });
        return result.data || { serviceable: false };
    } catch (e) {
        console.error('Serviceability check error:', e);
        return { serviceable: false, error: e.message || 'Could not check serviceability.' };
    }
}

// ---- Order Tracking ----
/**
 * Get tracking status for an order
 * @param {string} orderId - Firestore order ID
 * @returns {Promise<Object|null>}
 */
export async function getTracking(orderId) {
    if (!orderId) return null;
    try {
        const fn = httpsCallable(functions, 'getShipmentTracking');
        const result = await fn({ orderId });
        return result.data || null;
    } catch (e) {
        console.error('Tracking fetch error:', e);
        Toast.error('Tracking Error', 'Unable to fetch tracking information.');
        return null;
    }
}

// ---- Available Couriers ----
/**
 * Get available shipping couriers for an order
 * @param {string} orderId
 * @returns {Promise<Array>}
 */
export async function getAvailableCouriers(orderId) {
    if (!orderId) return [];
    try {
        const fn = httpsCallable(functions, 'getShippingCouriers');
        const result = await fn({ orderId });
        return result.data?.couriers || [];
    } catch (e) {
        console.error('Couriers fetch error:', e);
        return [];
    }
}

// Bind to window
window.checkPincodeServiceability = checkPincodeServiceability;
window.getTracking = getTracking;
