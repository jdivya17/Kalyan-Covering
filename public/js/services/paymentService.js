/**
 * paymentService.js — Kalyan Covering
 * Razorpay payment integration: calls createRazorpayOrder & verifyPayment Cloud Functions.
 * Also handles COD order placement via placeCODOrder.
 *
 * Cloud Functions called:
 *   - createRazorpayOrder(items, shippingAddress, promoCode)
 *   - verifyPayment(razorpay_order_id, razorpay_payment_id, razorpay_signature, orderId)
 *   - placeCODOrder(items, shippingAddress, promoCode)
 */

import { functions, httpsCallable } from '../firebase-config.js';
import { Toast } from '../components/Toast.js';
import { Cart } from './cartService.js';

const RZP_KEY_ID = 'rzp_live_Skw8XRBEaJDquK';

// ---- Razorpay ----

/**
 * Launch the Razorpay checkout modal for a given order
 * @param {Object} opts
 * @param {string} opts.orderId - Firestore order document ID
 * @param {string} opts.razorpayOrderId - Order ID from Razorpay
 * @param {number} opts.amount - Amount in paise (₹ * 100)
 * @param {string} opts.customerName
 * @param {string} opts.customerPhone
 * @param {string} opts.customerEmail
 * @param {Function} opts.onSuccess - Called with payment result {orderId, paymentId}
 * @param {Function} opts.onFailure - Called with error message string
 */
export function launchRazorpay({ orderId, razorpayOrderId, key, amount, customerName, customerPhone, customerEmail, onSuccess, onFailure }) {
    if (!window.Razorpay) {
        onFailure?.('Razorpay SDK is not loaded. Please refresh and try again.');
        return;
    }

    const rzp = new window.Razorpay({
        key: key || window.RAZORPAY_KEY_ID || 'rzp_test_default',
        amount,
        currency: 'INR',
        order_id: razorpayOrderId,
        name: 'Kalyan Covering',
        description: 'Premium Jewellery Order',
        image: '/assets/kalyan_logo.png',
        prefill: {
            name: customerName || '',
            contact: customerPhone || '',
            email: customerEmail || ''
        },
        theme: { color: '#D4AF37' },
        handler: async (response) => {
            try {
                const verifyFn = httpsCallable(functions, 'verifyPayment');
                const result = await verifyFn({
                    razorpay_order_id: response.razorpay_order_id,
                    razorpay_payment_id: response.razorpay_payment_id,
                    razorpay_signature: response.razorpay_signature,
                    orderId
                });
                if (result.data?.success) {
                    Cart.clear();
                    onSuccess?.({ orderId, paymentId: response.razorpay_payment_id });
                } else {
                    onFailure?.('Payment verification failed. Please contact support.');
                }
            } catch (e) {
                onFailure?.(e.message || 'Payment verification error.');
            }
        },
        modal: {
            ondismiss: () => {
                Toast.info('Payment Cancelled', 'Your order was not completed.');
                onFailure?.('Payment dismissed by user.');
            }
        }
    });
    rzp.open();
}

/**
 * Create a Razorpay order by calling the Cloud Function, then launch Razorpay modal
 * @param {Object} opts
 * @param {Array}  opts.items - Cart items [{id, qty}]
 * @param {Object} opts.shippingAddress
 * @param {string} [opts.promoCode]
 * @param {string} opts.customerName
 * @param {string} opts.customerPhone
 * @param {string} opts.customerEmail
 * @param {Function} opts.onSuccess
 * @param {Function} opts.onFailure
 * @param {Function} [opts.onLoading] - Called with (true|false) to show/hide loading state
 */
export async function initiatePayment({ items, shippingAddress, promoCode, customerName, customerPhone, customerEmail, onSuccess, onFailure, onLoading }) {
    onLoading?.(true);
    try {
        const createOrderFn = httpsCallable(functions, 'createRazorpayOrder');
        const result = await createOrderFn({ items, shippingAddress, promoCode });
        const data = result.data;
        if (!data?.success || !data?.razorpayOrderId) {
            throw new Error(data?.message || 'Failed to create payment order.');
        }
        onLoading?.(false);
        launchRazorpay({
            orderId: data.orderId,
            razorpayOrderId: data.razorpayOrderId,
            amount: data.amount,
            customerName,
            customerPhone,
            customerEmail,
            onSuccess,
            onFailure
        });
    } catch (e) {
        onLoading?.(false);
        const msg = e.message || 'Unable to initiate payment. Please try again.';
        Toast.error('Payment Error', msg);
        onFailure?.(msg);
    }
}

// ---- COD ----
/**
 * Place a Cash-on-Delivery order
 * @param {Object} opts
 * @param {Array}  opts.items
 * @param {Object} opts.shippingAddress
 * @param {string} [opts.promoCode]
 * @param {Function} opts.onSuccess
 * @param {Function} opts.onFailure
 * @param {Function} [opts.onLoading]
 */
export async function placeCOD({ items, shippingAddress, promoCode, onSuccess, onFailure, onLoading }) {
    onLoading?.(true);
    try {
        const codFn = httpsCallable(functions, 'placeCODOrder');
        const result = await codFn({ items, shippingAddress, promoCode });
        const data = result.data;
        if (!data?.success) throw new Error(data?.message || 'COD placement failed.');
        Cart.clear();
        onLoading?.(false);
        onSuccess?.({ orderId: data.orderId });
    } catch (e) {
        onLoading?.(false);
        const msg = e.message || 'Unable to place order. Please try again.';
        Toast.error('Order Failed', msg);
        onFailure?.(msg);
    }
}

// Bind to window for legacy HTML compatibility
window.initiatePayment = initiatePayment;
window.placeCOD = placeCOD;
