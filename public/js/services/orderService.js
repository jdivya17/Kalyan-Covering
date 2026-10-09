/**
 * orderService.js — Kalyan Covering
 * Customer order retrieval, cancellation, and return request.
 * Cloud Functions called: cancelOrder, initiateReturn
 * Firestore collections: orders
 */

import { db, functions, httpsCallable, collection, doc, getDoc, getDocs, query, where, orderBy, callVercelApi } from '../firebase-config.js';
import { KC } from '../store/state.js';
import { Toast } from '../components/Toast.js';

// ---- Get Customer Orders ----
/**
 * Fetch all orders for the current user
 * @returns {Promise<Array>}
 */
export async function getMyOrders() {
    const user = KC.user || JSON.parse(localStorage.getItem('kc_user') || 'null');
    if (!user?.uid) return [];
    try {
        const q = query(
            collection(db, 'orders'),
            where('customerId', '==', user.uid),
            orderBy('createdAt', 'desc')
        );
        const snapshot = await getDocs(q);
        return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) {
        console.error('Error fetching orders:', e);
        return [];
    }
}

// ---- Get Single Order ----
/**
 * Fetch a single order by ID
 * @param {string} orderId
 * @returns {Promise<Object|null>}
 */
export async function getOrder(orderId) {
    if (!orderId) return null;
    try {
        const snap = await getDoc(doc(db, 'orders', orderId));
        if (!snap.exists()) return null;
        return { id: snap.id, ...snap.data() };
    } catch (e) {
        console.error('Error fetching order:', e);
        return null;
    }
}

// ---- Cancel Order ----
/**
 * Request cancellation of an order
 * @param {string} orderId
 * @param {string} [reason]
 * @returns {Promise<{success:boolean, error?:string}>}
 */
export async function cancelOrder(orderId, reason = 'Customer requested cancellation') {
    try {
        const data = await callVercelApi('/api/orders/cancel', { orderId, reason });
        if (!data || !data.success) {
            throw new Error((data && (data.message || data.error)) || 'Failed to cancel order.');
        }

        const msg = data.message || 'Order cancelled successfully.';
        Toast.success('Order Cancelled', msg);
        return { success: true, message: msg };
    } catch (e) {
        const msg = e.message || 'Unable to cancel order. Please contact support.';
        Toast.error('Cancellation Failed', msg);
        return { success: false, error: msg };
    }
}

// ---- Initiate Return ----
/**
 * Request a return for a delivered order
 * @param {string} orderId
 * @param {string} reason
 * @returns {Promise<{success:boolean, error?:string}>}
 */
export async function initiateReturn(orderId, reason) {
    if (!reason || !reason.trim()) {
        Toast.error('Reason Required', 'Please provide a reason for the return.');
        return { success: false, error: 'Reason is required.' };
    }
    try {
        const orderRef = doc(db, 'orders', orderId);
        const snap = await getDoc(orderRef);
        if (!snap.exists()) {
            throw new Error('Order not found.');
        }
        const currentStatus = (snap.data().status || '').toLowerCase();
        if (currentStatus !== 'delivered') {
            throw new Error('Return requests are only allowed for delivered orders.');
        }

        try {
            const returnFn = httpsCallable(functions, 'initiateReturn');
            const result = await returnFn({ orderId, reason });
            if (result.data?.success) {
                Toast.success('Return Initiated', 'We will process your return request within 2-3 business days.');
                return { success: true };
            }
        } catch (fnErr) {
            console.warn('[orderService] Cloud Function initiateReturn unavailable, attempting direct Firestore update:', fnErr.message);
        }

        // Direct Firestore update
        const { updateDoc, serverTimestamp } = await import('../firebase-config.js');
        await updateDoc(orderRef, {
            status: 'return_requested',
            returnReason: reason,
            returnRequestedAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });

        Toast.success('Return Initiated', 'We will process your return request within 2-3 business days.');
        return { success: true };
    } catch (e) {
        const msg = e.message || 'Unable to initiate return. Please contact support.';
        Toast.error('Return Failed', msg);
        return { success: false, error: msg };
    }
}

// ---- Order Status Label ----
/**
 * Get a display label and CSS class for an order status
 * @param {string} status
 * @returns {{label:string, cls:string}}
 */
export function getOrderStatusDisplay(status) {
    const map = {
        'pending': { label: 'Pending', cls: 'status-pending' },
        'confirmed': { label: 'Confirmed', cls: 'status-confirmed' },
        'processing': { label: 'Processing', cls: 'status-processing' },
        'shipped': { label: 'Shipped', cls: 'status-shipped' },
        'out_for_delivery': { label: 'Out for Delivery', cls: 'status-shipped' },
        'delivered': { label: 'Delivered', cls: 'status-delivered' },
        'cancelled': { label: 'Cancelled', cls: 'status-cancelled' },
        'return_requested': { label: 'Return Requested', cls: 'status-return' },
        'returned': { label: 'Returned', cls: 'status-cancelled' },
        'paid': { label: 'Paid', cls: 'status-confirmed' }
    };
    return map[status] || { label: status || 'Unknown', cls: '' };
}

// Bind to window for HTML compatibility
window.getMyOrders = getMyOrders;
window.getOrder = getOrder;
window.cancelOrder = cancelOrder;
window.initiateReturn = initiateReturn;
