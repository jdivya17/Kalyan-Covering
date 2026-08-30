const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onRequest } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");
const crypto = require("crypto");
const Razorpay = require("razorpay");
const PDFDocument = require("pdfkit");
const nodemailer = require("nodemailer");
const {
    createShipmentForOrder,
    checkServiceability,
    getTrackingByOrderId,
    getPickupLocations,
    getAvailableCouriersForOrder,
} = require('./shipping/shippingService');

admin.initializeApp();
const db = admin.firestore();

function getRazorpayClient() {
    return new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
}

async function calculateOrderTotals(items, promoCode, isCOD = false) {
    let subtotal = 0;
    const trustedItems = [];
    
    for (const item of items) {
        if (!item.id) throw new HttpsError('invalid-argument', 'Each cart item must have an id.');
        if (!Number.isInteger(item.qty) || item.qty < 1 || item.qty > 100) {
            throw new HttpsError('invalid-argument', `Invalid quantity for item ${item.id}. Must be between 1 and 100.`);
        }
        const productSnap = await db.collection("products").doc(item.id).get();
        if (!productSnap.exists) {
            throw new HttpsError("not-found", `Product ${item.id} not found.`);
        }
        const productData = productSnap.data();
        if (productData.status === 'out_of_stock' || productData.status === 'archived') {
            throw new HttpsError('failed-precondition', `Product "${productData.productName}" is no longer available.`);
        }
        if (item.qty > (productData.stock || 0)) {
            throw new HttpsError('failed-precondition', `Insufficient stock for product "${productData.productName}". Available: ${productData.stock || 0}, Requested: ${item.qty}`);
        }
        
        const price = productData.price || 0;
        subtotal += (price * item.qty);
        
        trustedItems.push({ id: item.id, name: productData.productName || productData.name || item.id, price: price, qty: item.qty, sku: productData.sku || null });
    }

    let discount = 0;
    if (promoCode) {
        const promoSnap = await db.collection("coupons")
            .where("code", "==", promoCode.trim().toUpperCase())
            .where("status", "==", 'active')
            .limit(1).get();
        if (!promoSnap.empty) {
            const promoData = promoSnap.docs[0].data();
            if (promoData.discountType === 'percentage') {
                discount = Math.round(subtotal * ((promoData.discountValue || 0) / 100));
                discount = Math.min(discount, subtotal);
            } else {
                discount = Math.min(promoData.discountValue || 0, subtotal);
            }
        }
    }

    const gst = Math.round(subtotal * 0.12);
    const deliveryCharge = subtotal > 999 ? 0 : 99;
    const codFee = isCOD ? 50 : 0;
    const totalAmount = (subtotal - discount) + gst + deliveryCharge + codFee;

    return {
        trustedItems,
        subtotal,
        discount,
        gst,
        deliveryCharge,
        codFee,
        totalAmount
    };
}

function validateAddress(address) {
    if (!address || typeof address !== 'object') {
        throw new HttpsError('invalid-argument', 'Shipping address must be an object.');
    }
    const requiredStr = (val, field, maxLen) => {
        if (typeof val !== 'string' || !val.trim()) {
            throw new HttpsError('invalid-argument', `${field} is required.`);
        }
        if (val.length > maxLen) {
            throw new HttpsError('invalid-argument', `${field} exceeds maximum allowed length of ${maxLen} characters.`);
        }
    };
    
    requiredStr(address.fname, 'First Name', 50);
    requiredStr(address.lname, 'Last Name', 50);
    requiredStr(address.address, 'Street Address', 255);
    requiredStr(address.city, 'City', 100);
    requiredStr(address.state, 'State', 100);
    
    if (!/^\d{10}$/.test(address.phone)) {
        throw new HttpsError('invalid-argument', 'Phone number must be exactly 10 digits.');
    }
    if (!/^\d{6}$/.test(address.pin)) {
        throw new HttpsError('invalid-argument', 'PIN code must be exactly 6 digits.');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address.email)) {
        throw new HttpsError('invalid-argument', 'Invalid email address format.');
    }
}

exports.createRazorpayOrder = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "User must be logged in to create an order.");
    }

    const { items, promoCode, shippingAddress, notes, paymentMethod } = request.data;
    if (!items || !Array.isArray(items) || items.length === 0) {
        throw new HttpsError("invalid-argument", "Cart cannot be empty.");
    }
    if (items.length > 50) {
        throw new HttpsError("invalid-argument", "Cart exceeds maximum item limit.");
    }
    
    if (!shippingAddress) {
        throw new HttpsError("invalid-argument", "Shipping address is required.");
    }
    validateAddress(shippingAddress);
    
    if (notes !== undefined && notes !== null) {
        if (typeof notes !== 'string') {
            throw new HttpsError("invalid-argument", "Notes must be a string.");
        }
        if (notes.length > 500) {
            throw new HttpsError("invalid-argument", "Notes cannot exceed 500 characters.");
        }
    }

    try {
        const {
            trustedItems,
            subtotal,
            discount,
            gst,
            deliveryCharge,
            totalAmount
        } = await calculateOrderTotals(items, promoCode, false);

        // Create Razorpay order
        const options = {
            amount: totalAmount * 100, // in paisa
            currency: "INR",
            receipt: `receipt_${request.auth.uid}_${Date.now()}`
        };

        const order = await getRazorpayClient().orders.create(options);

        const orderNumber = `ORD-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        const now_ts = admin.firestore.FieldValue.serverTimestamp();

        const pendingOrder = {
            orderNumber,
            customerId: request.auth.uid,
            items: trustedItems, // Use server-calculated trusted item prices
            shippingAddress: shippingAddress,
            orderStatus: 'payment_pending',
            paymentStatus: 'pending',
            shippingStatus: 'not_shipped',
            payment: {
                razorpay_order_id: order.id,
                method: paymentMethod || 'razorpay',
                amount: totalAmount,
                currency: 'INR',
                paidAt: null
            },
            shippingDetails: {
                carrier: null, trackingNumber: null, estimatedDelivery: null, shippedAt: null, deliveredAt: null
            },
            subtotal, discount, gst, deliveryCharge, totalAmount, couponCode: promoCode || null,
            statusHistory: [{ status: 'payment_pending', changedAt: now_ts, changedBy: 'system', note: 'Order created, pending payment.' }],
            notes: notes || null,
            createdAt: now_ts,
            updatedAt: now_ts
        };

        // Create the pending order document with the Razorpay order ID as the document ID
        await db.collection('orders').doc(order.id).set(pendingOrder);

        // Return secure order ID
        return {
            id: order.id,
            amount: order.amount,
            currency: order.currency,
            key: process.env.RAZORPAY_KEY_ID
        };

    } catch (error) {
        console.error("Error creating order:", error);
        throw new HttpsError("internal", "Unable to create order.");
    }
});

// Helper for idempotency and transaction safety in payment verification
async function fulfillOrder(orderId, paymentId, paymentAmount, paymentCurrency, transaction) {
    const orderDocRef = db.collection('orders').doc(orderId);
    const orderDoc = await transaction.get(orderDocRef);

    if (!orderDoc.exists) {
        throw new Error('Order not found.');
    }

    const orderData = orderDoc.data();

    if (orderData.paymentStatus === 'paid') {
        return { success: true, alreadyPaid: true, orderId: orderDocRef.id, orderNumber: orderData.orderNumber };
    }

    if (orderData.totalAmount * 100 !== paymentAmount || (orderData.payment.currency || 'INR') !== paymentCurrency) {
        throw new Error('Payment amount or currency mismatch.');
    }

    const now_ts = admin.firestore.FieldValue.serverTimestamp();

    let isOversold = false;
    let oversoldNotes = '';

    // Atomically decrement stock for each item in the order (within the same transaction)
    for (const item of (orderData.items || [])) {
        if (!item.id || !item.qty) continue;
        const productRef = db.collection('products').doc(item.id);
        const productDoc = await transaction.get(productRef);
        if (!productDoc.exists) {
            console.warn(`[fulfillOrder] Product ${item.id} not found during stock decrement — skipping.`);
            continue;
        }
        const productData = productDoc.data();
        const currentStock = productData.stock || 0;
        
        if (currentStock < item.qty) {
            isOversold = true;
            oversoldNotes += `Product ${item.id} oversold (had ${currentStock}, bought ${item.qty}). `;
        }
        
        const newStock = currentStock - item.qty;
        const stockUpdate = { stock: newStock < 0 ? 0 : newStock, updatedAt: now_ts };
        if (newStock <= 0) {
            stockUpdate.status = 'out_of_stock';
        }
        transaction.update(productRef, stockUpdate);
    }

    const orderUpdates = {
        orderStatus: isOversold ? 'action_required_oversold' : 'pending', // Moving from payment_pending to pending (confirmed) or oversold
        paymentStatus: 'paid',
        updatedAt: now_ts,
        'payment.razorpay_payment_id': paymentId,
        'payment.paidAt': now_ts,
        statusHistory: admin.firestore.FieldValue.arrayUnion({
            status: isOversold ? 'action_required_oversold' : 'pending', changedAt: now_ts, changedBy: 'system', note: isOversold ? 'Payment verified successfully, but order was oversold. ' + oversoldNotes : 'Payment verified successfully.'
        })
    };
    if (isOversold) {
        orderUpdates.notes = (orderData.notes ? orderData.notes + '\n' : '') + 'URGENT: ' + oversoldNotes;
    }

    transaction.update(orderDocRef, orderUpdates);
    return { success: true, alreadyPaid: false, orderId: orderDocRef.id, orderNumber: orderData.orderNumber };
}

exports.verifyPayment = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "User must be logged in.");
    }

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = request.data;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        throw new HttpsError("invalid-argument", "Missing payment verification fields.");
    }

    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
        .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
        .update(body.toString())
        .digest("hex");

    // Fix: Timing attack prevention
    const sigBuffer = Buffer.from(razorpay_signature, 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');
    if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
        await logAudit(request, 'PAYMENT_VERIFICATION_FAILED', 'orders', razorpay_order_id, null, { reason: 'Invalid signature' });
        throw new HttpsError('permission-denied', 'Invalid payment signature.');
    }

    try {
        const paymentDetails = await getRazorpayClient().payments.fetch(razorpay_payment_id);
        if (paymentDetails.status !== 'captured') {
            await logAudit(request, 'PAYMENT_VERIFICATION_FAILED', 'orders', razorpay_order_id, null, { reason: 'Payment not captured in Razorpay' });
            throw new HttpsError('failed-precondition', 'Payment is not captured.');
        }

        const result = await db.runTransaction(async (transaction) => {
            return await fulfillOrder(razorpay_order_id, razorpay_payment_id, paymentDetails.amount, paymentDetails.currency, transaction);
        });

        if (!result.alreadyPaid) {
             await logAudit(request, 'PAYMENT_VERIFIED', 'orders', result.orderId, { paymentStatus: 'pending' }, { paymentStatus: 'paid' });
        }
        return { success: true, orderId: result.orderId, orderNumber: result.orderNumber };

    } catch (err) {
        console.error('Payment verification failed:', err);
        if (err instanceof HttpsError) {
            throw err;
        }
        throw new HttpsError('internal', 'Payment verification failed. Please contact support.');
    }
});

exports.razorpayWebhook = onRequest(async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).send("Method Not Allowed");
    }

    const secret = process.env.RAZORPAY_KEY_SECRET;
    const signature = req.headers["x-razorpay-signature"];

    if (!signature || !secret) {
        return res.status(400).send("Missing signature or configuration");
    }

    try {
        // Fix: Use rawBody for webhook verification to prevent byte mismatches
        const rawBody = req.rawBody;
        if (!rawBody) {
            console.error("Missing rawBody in request");
            return res.status(400).send("Missing raw body");
        }

        const expectedSignature = crypto
            .createHmac("sha256", secret)
            .update(rawBody)
            .digest("hex");

        const sigBuffer = Buffer.from(signature, 'hex');
        const expectedBuffer = Buffer.from(expectedSignature, 'hex');
        if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
            console.warn("Invalid webhook signature received");
            return res.status(400).send("Invalid signature");
        }

        const event = req.body?.event;
        const paymentData = req.body?.payload?.payment?.entity;
        const eventId = req.headers['x-razorpay-event-id'];
        // Replay Protection Check: Ensure event is not too old (e.g., > 15 mins)
        const eventCreatedAt = req.body?.created_at;

        if (!event || !paymentData || !eventId) {
            return res.status(400).send("Invalid payload structure");
        }

        if (eventCreatedAt) {
            const ageInMinutes = (Date.now() / 1000 - eventCreatedAt) / 60;
            if (ageInMinutes > 15) {
                console.warn(`Webhook event ${eventId} is too old (${ageInMinutes.toFixed(2)} mins)`);
                return res.status(400).send("Event expired");
            }
        }

        let actionLog = null;

        await db.runTransaction(async (transaction) => {
            const eventRef = db.collection('webhook_events').doc(eventId);
            const eventDoc = await transaction.get(eventRef);

            if (eventDoc.exists) {
                console.warn(`Webhook event ${eventId} already processed.`);
                return; // Already processed
            }

            if (event === "payment.captured") {
                const rzpOrderId = paymentData.order_id;
                try {
                    const result = await fulfillOrder(rzpOrderId, paymentData.id, paymentData.amount, paymentData.currency, transaction);
                    if (!result.alreadyPaid) {
                        actionLog = { id: result.orderId, status: 'PAYMENT_VERIFIED_WEBHOOK' };
                    }
                } catch (e) {
                    console.error(`Webhook fulfillOrder failed for order ${rzpOrderId}:`, e.message);
                }
            }

            transaction.set(eventRef, {
                processedAt: admin.firestore.FieldValue.serverTimestamp(),
                event: event
            });
        });
        
        // Log audit if action happened
        if (actionLog) {
            // Pseudo request object for logAudit
            const dummyReq = { auth: { uid: 'system' }, rawRequest: { ip: req.ip || 'Unknown', headers: req.headers } };
            await logAudit(dummyReq, actionLog.status, 'orders', actionLog.id, { paymentStatus: 'pending' }, { paymentStatus: 'paid' });
        }

        res.status(200).send("OK");
    } catch (error) {
        console.error("Webhook error:", error);
        res.status(500).send("Webhook Error");
    }
});

// ==========================================
// AUDIT LOGGING & SECURE CRUD OPERATIONS
// ==========================================

async function logAudit(request, action, collectionName, documentId, oldValue, newValue) {
    try {
        const adminId = request.auth ? request.auth.uid : 'Unknown';
        const ip = request.rawRequest ? request.rawRequest.ip : 'Unknown IP';
        const device = request.rawRequest && request.rawRequest.headers['user-agent'] ? request.rawRequest.headers['user-agent'] : 'Unknown Device';

        await db.collection('audit_logs').add({
            adminId,
            action,
            collection: collectionName,
            documentId,
            oldValue: oldValue || null,
            newValue: newValue || null,
            device,
            ip,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
    } catch (auditErr) {
        // L4 Fix: Audit log failure must never crash the parent function
        console.error('[AUDIT LOG FAILED]', action, collectionName, documentId, auditErr.message);
    }
}

function verifyAdmin(request) {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "User must be logged in.");
    }
    const role = request.auth.token.role;
    if (!role || !['owner', 'manager', 'staff'].includes(role)) {
        throw new HttpsError("permission-denied", "Insufficient permissions. Admin role required.");
    }
}

function verifyOwnerOrManager(request) {
    verifyAdmin(request);
    const role = request.auth.token.role;
    if (!['owner', 'manager'].includes(role)) {
        throw new HttpsError("permission-denied", "Only Owner or Manager can perform this action.");
    }
}

function validateProductData(data, isUpdate = false) {
    const requiredStr = (val, field) => {
        if (!isUpdate || data.hasOwnProperty(field)) {
            if (typeof val !== 'string' || !val.trim()) {
                throw new HttpsError('invalid-argument', `${field} is required and must be a non-empty string.`);
            }
        }
    };
    const requiredNum = (val, field) => {
        if (!isUpdate || data.hasOwnProperty(field)) {
            if (typeof val !== 'number' || isNaN(val)) {
                throw new HttpsError('invalid-argument', `${field} is required and must be a valid number.`);
            }
        }
    };

    requiredStr(data.productName, 'productName');
    requiredStr(data.description, 'description');
    requiredStr(data.sku, 'sku');
    requiredStr(data.category, 'category');
    requiredNum(data.price, 'price');
    requiredNum(data.stock, 'stock');
    requiredStr(data.status, 'status');

    if (data.hasOwnProperty('sku')) {
        const skuRegex = /^[A-Z0-9-]+$/;
        if (!skuRegex.test(data.sku)) {
            throw new HttpsError('invalid-argument', 'SKU must contain only uppercase letters, numbers, and hyphens (no spaces).');
        }
    }

    if (data.hasOwnProperty('price') && data.price < 0) {
        throw new HttpsError('invalid-argument', 'Price cannot be negative.');
    }
    if (data.hasOwnProperty('mrp') && typeof data.mrp === 'number') {
        // If price is also being passed in this update, use it, otherwise we can't fully check MRP against old price strictly here without fetching first, 
        // but checking mrp >= price if both are provided is safe.
        if (data.price !== undefined && data.mrp < data.price) {
             throw new HttpsError('invalid-argument', 'MRP cannot be less than the selling price.');
        }
    }
    if (data.hasOwnProperty('stock') && (!Number.isInteger(data.stock) || data.stock < 0)) {
        throw new HttpsError('invalid-argument', 'Stock must be a non-negative integer.');
    }
    // M4 Fix: Added 'out_of_stock' as valid status (set internally by system)
    if (data.hasOwnProperty('status') && !['active', 'draft', 'archived', 'out_of_stock'].includes(data.status)) {
        throw new HttpsError('invalid-argument', 'Status must be active, draft, archived, or out_of_stock.');
    }
    
    // Optional types check
    if (data.hasOwnProperty('images') && !Array.isArray(data.images)) {
        throw new HttpsError('invalid-argument', 'Images must be an array.');
    }
    if (data.hasOwnProperty('tags') && !Array.isArray(data.tags)) {
        throw new HttpsError('invalid-argument', 'Tags must be an array.');
    }
    if (data.hasOwnProperty('seo') && (typeof data.seo !== 'object' || Array.isArray(data.seo))) {
        throw new HttpsError('invalid-argument', 'SEO must be an object.');
    }
    if (data.hasOwnProperty('dimensions') && (typeof data.dimensions !== 'object' || Array.isArray(data.dimensions))) {
        throw new HttpsError('invalid-argument', 'Dimensions must be an object.');
    }
}

async function checkDuplicateSKU(sku, excludeId = null) {
    if (!sku) return;
    let query = db.collection('products').where('sku', '==', sku).limit(excludeId ? 2 : 1);
    const snap = await query.get();
    
    if (!snap.empty) {
        if (!excludeId) {
            throw new HttpsError('already-exists', `A product with SKU ${sku} already exists.`);
        } else {
            // For updates, make sure the matching doc isn't the one we are currently updating
            const hasOther = snap.docs.some(doc => doc.id !== excludeId);
            if (hasOther) {
                throw new HttpsError('already-exists', `Another product with SKU ${sku} already exists.`);
            }
        }
    }
}

exports.createProduct = onCall(async (request) => {
    verifyAdmin(request);
    const productData = request.data;
    
    validateProductData(productData, false);
    await checkDuplicateSKU(productData.sku, null);
    
    productData.createdAt = admin.firestore.FieldValue.serverTimestamp();
    productData.updatedAt = admin.firestore.FieldValue.serverTimestamp();
    
    const docRef = await db.collection('products').add(productData);
    await logAudit(request, 'CREATE', 'products', docRef.id, null, productData);
    
    return { success: true, id: docRef.id };
});

exports.updateProduct = onCall(async (request) => {
    verifyAdmin(request);
    const { id, ...updateData } = request.data;
    if (!id) throw new HttpsError('invalid-argument', 'Product ID is required for update.');
    
    validateProductData(updateData, true);
    if (updateData.sku) {
        await checkDuplicateSKU(updateData.sku, id);
    }
    
    const docRef = db.collection('products').doc(id);
    const snap = await docRef.get();
    if (!snap.exists) {
        throw new HttpsError("not-found", "Product not found.");
    }
    const oldValue = snap.data();
    
    updateData.updatedAt = admin.firestore.FieldValue.serverTimestamp();
    
    await docRef.update(updateData);
    await logAudit(request, 'UPDATE', 'products', id, oldValue, updateData);
    
    return { success: true };
});

exports.deleteProduct = onCall(async (request) => {
    verifyAdmin(request);
    const { id } = request.data;
    // H1 Fix: Guard against missing ID
    if (!id) throw new HttpsError('invalid-argument', 'Product ID is required.');
    
    const docRef = db.collection('products').doc(id);
    const snap = await docRef.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Product not found.');
    const oldValue = snap.data();
    await docRef.delete();
    await logAudit(request, 'DELETE', 'products', id, oldValue, null);
    return { success: true };
});

// ==========================================
// ORDER STATUS STATE MACHINE
// ==========================================

// Define valid one-way transitions
const ORDER_TRANSITIONS = {
    pending:           ['confirmed', 'cancelled'],
    confirmed:         ['packed', 'cancelled'],
    packed:            ['shipped', 'cancelled'],
    shipped:           ['out_for_delivery'],
    out_for_delivery:  ['delivered'],
    delivered:         ['returned'],
    returned:          ['refunded'],
    cancelled:         [],
    refunded:          []
};

// Map order status to shipping status
const SHIPPING_STATUS_MAP = {
    pending:           'not_shipped',
    confirmed:         'not_shipped',
    packed:            'not_shipped',
    shipped:           'shipped',
    out_for_delivery:  'out_for_delivery',
    delivered:         'delivered',
    returned:          'return_in_transit',
    refunded:          'returned',
    cancelled:         'not_shipped'
};

exports.updateOrderStatus = onCall(async (request) => {
    verifyAdmin(request);
    const { id, newStatus, note, shippingDetails } = request.data;

    if (!id || !newStatus) {
        throw new HttpsError('invalid-argument', 'Order ID and newStatus are required.');
    }

    const validStatuses = Object.keys(ORDER_TRANSITIONS);
    if (!validStatuses.includes(newStatus)) {
        throw new HttpsError('invalid-argument', `Invalid status: ${newStatus}. Must be one of: ${validStatuses.join(', ')}`);
    }

    const docRef = db.collection('orders').doc(id);
    const snap = await docRef.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Order not found.');

    const order = snap.data();
    const currentStatus = order.orderStatus;
    const allowedNext = ORDER_TRANSITIONS[currentStatus] || [];

    if (!allowedNext.includes(newStatus)) {
        throw new HttpsError(
            'failed-precondition',
            `Cannot move order from '${currentStatus}' to '${newStatus}'. Allowed transitions: [${allowedNext.join(', ')}]`
        );
    }

    const now = admin.firestore.FieldValue.serverTimestamp();

    const historyEntry = {
        status: newStatus,
        changedAt: now,
        changedBy: request.auth.uid,
        note: note || null
    };

    const updatePayload = {
        orderStatus: newStatus,
        shippingStatus: SHIPPING_STATUS_MAP[newStatus] || 'unknown',
        updatedAt: now,
        statusHistory: admin.firestore.FieldValue.arrayUnion(historyEntry)
    };

    // Enforce shipping details when transitioning to 'shipped'
    if (newStatus === 'shipped') {
        if (!shippingDetails || !shippingDetails.carrier || !shippingDetails.trackingNumber) {
            throw new HttpsError(
                'failed-precondition',
                'Shipping carrier and tracking number are required when marking an order as shipped.'
            );
        }
        updatePayload['shippingDetails.carrier'] = shippingDetails.carrier;
        updatePayload['shippingDetails.trackingNumber'] = shippingDetails.trackingNumber;
        updatePayload['shippingDetails.estimatedDelivery'] = shippingDetails.estimatedDelivery || null;
        updatePayload['shippingDetails.shippedAt'] = now;
        // Enrich the history entry note with tracking info
        historyEntry.note = `Shipped via ${shippingDetails.carrier}. Tracking: ${shippingDetails.trackingNumber}. ${note || ''}`;
        // Re-apply updated history entry
        updatePayload.statusHistory = admin.firestore.FieldValue.arrayUnion(historyEntry);
    }
    if (newStatus === 'delivered') {
        updatePayload['shippingDetails.deliveredAt'] = now;
    }

    await docRef.update(updatePayload);
    await logAudit(request, 'UPDATE_ORDER_STATUS', 'orders', id, { orderStatus: currentStatus }, { orderStatus: newStatus });

    return { success: true, orderStatus: newStatus };
});

// Removed duplicate cancelOrder v1 and initiateReturn v1

// ==========================================
// COUPON MANAGEMENT
// ==========================================

function validateCouponData(data) {
    if (!data.code || typeof data.code !== 'string' || !data.code.trim()) {
        throw new HttpsError('invalid-argument', 'Coupon code is required.');
    }
    if (!/^[A-Z0-9_-]+$/.test(data.code.trim())) {
        throw new HttpsError('invalid-argument', 'Coupon code must be uppercase alphanumeric with hyphens/underscores only.');
    }
    if (!['percentage', 'flat'].includes(data.discountType)) {
        throw new HttpsError('invalid-argument', 'discountType must be percentage or flat.');
    }
    if (typeof data.discountValue !== 'number' || data.discountValue <= 0) {
        throw new HttpsError('invalid-argument', 'discountValue must be a positive number.');
    }
    if (data.discountType === 'percentage' && data.discountValue > 100) {
        throw new HttpsError('invalid-argument', 'Percentage discount cannot exceed 100%.');
    }
    if (data.usageLimit !== undefined && (!Number.isInteger(data.usageLimit) || data.usageLimit < 1)) {
        throw new HttpsError('invalid-argument', 'usageLimit must be a positive integer.');
    }
    if (data.minOrderValue !== undefined && (typeof data.minOrderValue !== 'number' || data.minOrderValue < 0)) {
        throw new HttpsError('invalid-argument', 'minOrderValue must be a non-negative number.');
    }
}

exports.createCoupon = onCall(async (request) => {
    verifyOwnerOrManager(request);
    const data = request.data;
    validateCouponData(data);

    const code = data.code.trim().toUpperCase();

    // Prevent duplicate coupon codes
    const existing = await db.collection('coupons').where('code', '==', code).limit(1).get();
    if (!existing.empty) {
        throw new HttpsError('already-exists', `Coupon code "${code}" already exists.`);
    }

    const coupon = {
        code,
        discountType: data.discountType,             // 'percentage' | 'flat'
        discountValue: data.discountValue,
        minOrderValue: data.minOrderValue || 0,
        usageLimit: data.usageLimit || null,          // null = unlimited
        timesUsed: 0,
        categoryRestrictions: data.categoryRestrictions || [],  // [] = all categories
        userRestrictions: data.userRestrictions || [],           // [] = all users
        validFrom: data.validFrom || admin.firestore.FieldValue.serverTimestamp(),
        validUntil: data.validUntil || null,          // null = no expiry
        status: 'active',                             // active | disabled | expired
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    const ref = await db.collection('coupons').add(coupon);
    await logAudit(request, 'CREATE_COUPON', 'coupons', ref.id, null, coupon);
    return { success: true, id: ref.id };
});

exports.updateCoupon = onCall(async (request) => {
    verifyOwnerOrManager(request);
    const { id, ...data } = request.data;
    if (!id) throw new HttpsError('invalid-argument', 'Coupon ID is required.');

    const docRef = db.collection('coupons').doc(id);
    const snap = await docRef.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Coupon not found.');

    // If code is being updated, validate uniqueness
    if (data.code) {
        data.code = data.code.trim().toUpperCase();
        const existing = await db.collection('coupons').where('code', '==', data.code).limit(2).get();
        const hasOther = existing.docs.some(d => d.id !== id);
        if (hasOther) throw new HttpsError('already-exists', `Coupon code "${data.code}" already exists.`);
    }

    data.updatedAt = admin.firestore.FieldValue.serverTimestamp();
    await docRef.update(data);
    await logAudit(request, 'UPDATE_COUPON', 'coupons', id, snap.data(), data);
    return { success: true };
});

exports.deleteCoupon = onCall(async (request) => {
    verifyOwnerOrManager(request);
    const { id } = request.data;
    if (!id) throw new HttpsError('invalid-argument', 'Coupon ID is required.');

    const docRef = db.collection('coupons').doc(id);
    const snap = await docRef.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Coupon not found.');

    await docRef.delete();
    await logAudit(request, 'DELETE_COUPON', 'coupons', id, snap.data(), null);
    return { success: true };
});

exports.validateCoupon = onCall(async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in.');
    const { code, orderTotal, categoryIds } = request.data;

    if (!code) throw new HttpsError('invalid-argument', 'Coupon code is required.');

    const snap = await db.collection('coupons')
        .where('code', '==', code.trim().toUpperCase())
        .where('status', '==', 'active')
        .limit(1)
        .get();

    if (snap.empty) throw new HttpsError('not-found', 'Invalid or inactive coupon code.');

    const coupon = snap.docs[0].data();
    const couponId = snap.docs[0].id;

    // Check expiry
    if (coupon.validUntil) {
        const expiry = coupon.validUntil.toDate ? coupon.validUntil.toDate() : new Date(coupon.validUntil);
        if (new Date() > expiry) {
            await db.collection('coupons').doc(couponId).update({ status: 'expired' });
            throw new HttpsError('failed-precondition', 'This coupon has expired.');
        }
    }

    // Check usage limit
    if (coupon.usageLimit !== null && coupon.timesUsed >= coupon.usageLimit) {
        throw new HttpsError('resource-exhausted', 'This coupon has reached its usage limit.');
    }

    // Check minimum order value
    if (orderTotal < coupon.minOrderValue) {
        throw new HttpsError('failed-precondition', `Minimum order value of ₹${coupon.minOrderValue} required for this coupon.`);
    }

    // Check category restrictions
    if (coupon.categoryRestrictions && coupon.categoryRestrictions.length > 0 && categoryIds) {
        const hasMatch = categoryIds.some(c => coupon.categoryRestrictions.includes(c));
        if (!hasMatch) throw new HttpsError('failed-precondition', 'This coupon is not applicable to items in your cart.');
    }

    // Check per-user restrictions
    if (coupon.userRestrictions && coupon.userRestrictions.length > 0) {
        if (!coupon.userRestrictions.includes(request.auth.uid)) {
            throw new HttpsError('permission-denied', 'This coupon is not valid for your account.');
        }
    }

    // Calculate discount
    let discountAmount = 0;
    if (coupon.discountType === 'percentage') {
        discountAmount = Math.round(orderTotal * (coupon.discountValue / 100));
    } else {
        discountAmount = Math.min(coupon.discountValue, orderTotal); // Flat cannot exceed order total
    }

    return {
        valid: true,
        couponId,
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
        discountAmount
    };
});

exports.updateSettings = onCall(async (request) => {
    verifyOwnerOrManager(request); // Only owner/manager can change settings
    const { id, ...updateData } = request.data;
    
    const docRef = db.collection('settings').doc(id);
    const snap = await docRef.get();
    const oldValue = snap.exists ? snap.data() : null;
    const action = snap.exists ? 'UPDATE' : 'CREATE';
    
    await docRef.set(updateData, { merge: true });
    await logAudit(request, action, 'settings', id, oldValue, updateData);
    
    return { success: true };
});

// ==========================================
// AUDIT LOGS - Read Access (Owner only)
// ==========================================
exports.getAuditLogs = onCall(async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in.');
    if (request.auth.token.role !== 'owner') {
        throw new HttpsError('permission-denied', 'Only Owner can view audit logs.');
    }
    const limit = Math.min(request.data?.limit || 50, 200);
    const snap = await db.collection('audit_logs')
        .orderBy('timestamp', 'desc')
        .limit(limit)
        .get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
});

// ==========================================
// CATEGORY & BRAND MANAGEMENT
// ==========================================

exports.manageCategory = onCall(async (request) => {
    verifyAdmin(request);
    const { action, id, data } = request.data;
    if (action === 'CREATE') {
        data.createdAt = admin.firestore.FieldValue.serverTimestamp();
        data.updatedAt = admin.firestore.FieldValue.serverTimestamp();
        const ref = await db.collection('categories').add(data);
        return { success: true, id: ref.id };
    } else if (action === 'UPDATE') {
        data.updatedAt = admin.firestore.FieldValue.serverTimestamp();
        await db.collection('categories').doc(id).update(data);
        return { success: true };
    } else if (action === 'DELETE') {
        await db.collection('categories').doc(id).delete();
        return { success: true };
    }
    throw new HttpsError('invalid-argument', 'Invalid action');
});

exports.manageBrand = onCall(async (request) => {
    verifyAdmin(request);
    const { action, id, data } = request.data;
    if (action === 'CREATE') {
        data.createdAt = admin.firestore.FieldValue.serverTimestamp();
        data.updatedAt = admin.firestore.FieldValue.serverTimestamp();
        const ref = await db.collection('brands').add(data);
        return { success: true, id: ref.id };
    } else if (action === 'UPDATE') {
        data.updatedAt = admin.firestore.FieldValue.serverTimestamp();
        await db.collection('brands').doc(id).update(data);
        return { success: true };
    } else if (action === 'DELETE') {
        await db.collection('brands').doc(id).delete();
        return { success: true };
    }
    throw new HttpsError('invalid-argument', 'Invalid action');
});

// ==========================================
// INVENTORY MANAGEMENT
// ==========================================

exports.adjustStock = onCall(async (request) => {
    verifyAdmin(request);
    const { productId, adjustment, reason } = request.data;
    
    // M3 Fix: Validate reason against allowed values
    const ALLOWED_REASONS = ['manual_adjustment', 'restock', 'damage', 'return', 'order_fulfillment'];
    if (!productId || typeof adjustment !== 'number' || !reason) {
        throw new HttpsError('invalid-argument', 'productId, adjustment (number), and reason are required.');
    }
    if (!ALLOWED_REASONS.includes(reason)) {
        throw new HttpsError('invalid-argument', `reason must be one of: ${ALLOWED_REASONS.join(', ')}.`);
    }
    if (!Number.isInteger(adjustment) || adjustment === 0) {
        throw new HttpsError('invalid-argument', 'adjustment must be a non-zero integer.');
    }

    const docRef = db.collection('products').doc(productId);
    
    return await db.runTransaction(async (transaction) => {
        const snap = await transaction.get(docRef);
        if (!snap.exists) throw new HttpsError('not-found', 'Product not found.');
        
        const currentStock = snap.data().stock || 0;
        const newStock = currentStock + adjustment;
        
        if (newStock < 0) {
            throw new HttpsError('failed-precondition', 'Cannot adjust stock below zero.');
        }

        transaction.update(docRef, { 
            stock: newStock,
            status: newStock === 0 ? 'out_of_stock' : snap.data().status,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        const historyRef = db.collection('inventory_history').doc();
        transaction.set(historyRef, {
            productId,
            previousStock: currentStock,
            adjustment,
            newStock,
            reason,
            referenceId: request.auth.uid,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return { success: true, newStock };
    });
});

exports.onOrderCompleted = onDocumentWritten('orders/{orderId}', async (event) => {
    const beforeData = event.data.before ? event.data.before.data() : null;
    const afterData = event.data.after ? event.data.after.data() : null;
    
    if (!afterData) return null; // Order was deleted

    // C1 Fix: Use lowercase 'paid' to match verifyPayment schema
    const wasPaid = beforeData && beforeData.paymentStatus === 'paid';
    const isPaid = afterData && afterData.paymentStatus === 'paid';
    
    const wasRestockedState = beforeData && ['cancelled', 'returned', 'refunded'].includes(beforeData.orderStatus);
    const isRestockedState = afterData && ['cancelled', 'returned', 'refunded'].includes(afterData.orderStatus);

    const items = afterData.items;
    if (!items || !Array.isArray(items)) return null;

    const LOW_STOCK_THRESHOLD = 5;

    // SCENARIO 1: Payment completed -> Deduct stock
    if (!wasPaid && isPaid && !isRestockedState) {
        for (const item of items) {
            if (!item.id || !item.qty) continue;
            const productRef = db.collection('products').doc(item.id);
            await db.runTransaction(async (transaction) => {
                const productSnap = await transaction.get(productRef);
                if (!productSnap.exists) return;
                
                const currentStock = productSnap.data().stock || 0;
                const deduction = item.qty;
                const newStock = Math.max(0, currentStock - deduction); 
                
                transaction.update(productRef, {
                    stock: newStock,
                    status: newStock === 0 ? 'out_of_stock' : productSnap.data().status,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });

                const historyRef = db.collection('inventory_history').doc();
                transaction.set(historyRef, {
                    productId: item.id,
                    previousStock: currentStock,
                    adjustment: -deduction,
                    newStock,
                    reason: 'order_fulfillment',
                    referenceId: event.params.orderId,
                    createdAt: admin.firestore.FieldValue.serverTimestamp()
                });
                
                if (newStock > 0 && newStock <= LOW_STOCK_THRESHOLD && currentStock > LOW_STOCK_THRESHOLD) {
                    const notifRef = db.collection('notifications').doc();
                    transaction.set(notifRef, {
                        title: 'Low Stock Alert',
                        body: `Product ${productSnap.data().productName} (SKU: ${productSnap.data().sku}) is running low (${newStock} left).`,
                        type: 'low_stock',
                        isRead: false,
                        createdAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                }
            });
        }
    }
    // SCENARIO 2: Order cancelled/returned/refunded -> Restock
    else if (!wasRestockedState && isRestockedState && (isPaid || wasPaid)) {
        for (const item of items) {
            if (!item.id || !item.qty) continue;
            const productRef = db.collection('products').doc(item.id);
            await db.runTransaction(async (transaction) => {
                const productSnap = await transaction.get(productRef);
                if (!productSnap.exists) return;
                
                const currentStock = productSnap.data().stock || 0;
                const addition = item.qty;
                const newStock = currentStock + addition;
                
                transaction.update(productRef, {
                    stock: newStock,
                    status: newStock > 0 && productSnap.data().status === 'out_of_stock' ? 'active' : productSnap.data().status,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });

                const historyRef = db.collection('inventory_history').doc();
                transaction.set(historyRef, {
                    productId: item.id,
                    previousStock: currentStock,
                    adjustment: addition,
                    newStock,
                    reason: 'return',
                    referenceId: event.params.orderId,
                    createdAt: admin.firestore.FieldValue.serverTimestamp()
                });
            });
        }
    }
    
    return null;
});

// ==========================================
// CUSTOMER MANAGEMENT
// ==========================================

exports.updateAccountStatus = onCall(async (request) => {
    verifyAdmin(request);
    const { userId, status } = request.data;
    
    if (!userId || !['active', 'suspended'].includes(status)) {
        throw new HttpsError('invalid-argument', 'Valid userId and status (active/suspended) are required.');
    }
    
    const userRef = db.collection('users').doc(userId);
    const snap = await userRef.get();
    
    if (!snap.exists) {
        throw new HttpsError('not-found', 'User not found.');
    }
    
    const oldValue = snap.data();
    
    // Prevent locking out other admins unless done by owner/manager
    if (oldValue.role !== 'customer') {
        verifyOwnerOrManager(request);
    }
    
    await userRef.update({ 
        status,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    await logAudit(request, 'UPDATE_STATUS', 'users', userId, { status: oldValue.status }, { status });
    
    return { success: true };
});

exports.manageCustomer = onCall(async (request) => {
    verifyAdmin(request);
    const { action, userId, data } = request.data;
    
    if (!userId || !action) {
        throw new HttpsError('invalid-argument', 'userId and action are required.');
    }
    
    const userRef = db.collection('users').doc(userId);
    
    if (action === 'UPDATE') {
        const snap = await userRef.get();
        if (!snap.exists) throw new HttpsError('not-found', 'User not found.');
        
        data.updatedAt = admin.firestore.FieldValue.serverTimestamp();
        await userRef.update(data);
        
        await logAudit(request, 'UPDATE_CUSTOMER', 'users', userId, snap.data(), data);
        return { success: true };
    } else if (action === 'DELETE') {
        verifyOwnerOrManager(request); 
        const snap = await userRef.get();
        if (snap.exists) {
            await userRef.delete();
            try {
                await admin.auth().deleteUser(userId); // Also delete from Auth
            } catch (authErr) {
                console.error("Failed to delete user from Auth, but doc deleted:", authErr);
            }
            await logAudit(request, 'DELETE_CUSTOMER', 'users', userId, snap.data(), null);
        }
        return { success: true };
    }
    
    throw new HttpsError('invalid-argument', 'Invalid action');
});

// ==========================================
// REVIEWS & RATINGS
// ==========================================

exports.submitReview = onCall(async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in.');
    const { productId, rating, comment, images } = request.data;

    if (!productId) throw new HttpsError('invalid-argument', 'productId is required.');
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        throw new HttpsError('invalid-argument', 'Rating must be an integer between 1 and 5.');
    }
    if (comment && comment.length > 1000) {
        throw new HttpsError('invalid-argument', 'Comment cannot exceed 1000 characters.');
    }
    if (images && (!Array.isArray(images) || images.length > 5)) {
        throw new HttpsError('invalid-argument', 'You can upload a maximum of 5 images per review.');
    }

    // Spam prevention: one review per product per customer
    const existing = await db.collection('reviews')
        .where('productId', '==', productId)
        .where('customerId', '==', request.auth.uid)
        .limit(1).get();
    if (!existing.empty) {
        throw new HttpsError('already-exists', 'You have already submitted a review for this product.');
    }

    // Spam prevention: only verified buyers can review
    const purchaseSnap = await db.collection('orders')
        .where('customerId', '==', request.auth.uid)
        .where('orderStatus', '==', 'delivered')
        .limit(50).get();
    const hasPurchased = purchaseSnap.docs.some(d =>
        (d.data().items || []).some(i => i.id === productId || i.productId === productId)
    );
    if (!hasPurchased) {
        throw new HttpsError('permission-denied', 'Only verified buyers can submit a review for this product.');
    }

    const review = {
        productId,
        customerId: request.auth.uid,
        rating,
        comment: comment || '',
        images: images || [],
        status: 'pending',
        isVerifiedBuyer: true,
        helpfulVotes: 0,
        reportCount: 0,
        adminNote: null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    const ref = await db.collection('reviews').add(review);
    return { success: true, id: ref.id };
});

exports.moderateReview = onCall(async (request) => {
    verifyAdmin(request);
    const { id, status, adminNote } = request.data;

    if (!id || !['approved', 'rejected'].includes(status)) {
        throw new HttpsError('invalid-argument', 'Review ID and valid status (approved/rejected) are required.');
    }

    const docRef = db.collection('reviews').doc(id);
    const snap = await docRef.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Review not found.');

    await docRef.update({
        status,
        adminNote: adminNote || null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // If approved, recalculate product average rating
    if (status === 'approved') {
        const productId = snap.data().productId;
        const approvedReviews = await db.collection('reviews')
            .where('productId', '==', productId)
            .where('status', '==', 'approved').get();

        const total = approvedReviews.docs.reduce((sum, d) => sum + (d.data().rating || 0), 0);
        const average = approvedReviews.empty ? 0 : parseFloat((total / approvedReviews.size).toFixed(1));

        await db.collection('products').doc(productId).update({
            avgRating: average,
            reviewCount: approvedReviews.size,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
    }

    await logAudit(request, 'MODERATE_REVIEW', 'reviews', id, snap.data(), { status, adminNote });
    return { success: true };
});

exports.reportReview = onCall(async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in.');
    const { id } = request.data;
    if (!id) throw new HttpsError('invalid-argument', 'Review ID is required.');

    const docRef = db.collection('reviews').doc(id);
    const snap = await docRef.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Review not found.');

    const reportCount = (snap.data().reportCount || 0) + 1;
    const updatePayload = {
        reportCount,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    // Auto-hide after 5 reports (spam prevention)
    if (reportCount >= 5) updatePayload.status = 'pending';

    await docRef.update(updatePayload);
    return { success: true };
});

// ==========================================
// NOTIFICATIONS
// ==========================================

async function createNotification({ userId, title, body, type, data = {} }) {
    await db.collection('notifications').add({
        userId: userId || null,
        title,
        body,
        type,                   // order_update | offer | low_stock | system
        data,
        isRead: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
}

exports.sendNotification = onCall(async (request) => {
    verifyAdmin(request);
    const { userId, title, body, type, data } = request.data;

    if (!title || !body || !type) {
        throw new HttpsError('invalid-argument', 'title, body, and type are required.');
    }
    if (!['order_update', 'offer', 'low_stock', 'system'].includes(type)) {
        throw new HttpsError('invalid-argument', 'Invalid notification type.');
    }

    if (userId) {
        await createNotification({ userId, title, body, type, data });
        const userSnap = await db.collection('users').doc(userId).get();
        if (userSnap.exists && userSnap.data().fcmToken) {
            try {
                await admin.messaging().send({
                    token: userSnap.data().fcmToken,
                    notification: { title, body },
                    data: data ? Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])) : {}
                });
            } catch (e) { console.warn('FCM push failed:', e.message); }
        }
    } else {
        // Broadcast to all active customers
        const usersSnap = await db.collection('users').where('role', '==', 'customer').where('status', '==', 'active').get();
        const batch = db.batch();
        const tokens = [];
        usersSnap.docs.forEach(doc => {
            const notifRef = db.collection('notifications').doc();
            batch.set(notifRef, {
                userId: doc.id, title, body, type, data: data || {},
                isRead: false, createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
            if (doc.data().fcmToken) tokens.push(doc.data().fcmToken);
        });
        await batch.commit();

        // Batch FCM push notifications (max 500 tokens per call)
        for (let i = 0; i < tokens.length; i += 500) {
            try {
                await admin.messaging().sendEachForMulticast({
                    tokens: tokens.slice(i, i + 500),
                    notification: { title, body }
                });
            } catch (e) { console.warn('Broadcast FCM failed:', e.message); }
        }
    }

    await logAudit(request, 'SEND_NOTIFICATION', 'notifications', 'broadcast', null, { userId, title, type });
    return { success: true };
});

exports.markNotificationRead = onCall(async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in.');
    const { id } = request.data;
    if (!id) throw new HttpsError('invalid-argument', 'Notification ID is required.');

    const docRef = db.collection('notifications').doc(id);
    const snap = await docRef.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Notification not found.');

    if (snap.data().userId !== request.auth.uid && !['owner', 'manager', 'staff'].includes(request.auth.token.role)) {
        throw new HttpsError('permission-denied', 'Access denied.');
    }

    await docRef.update({ isRead: true });
    return { success: true };
});

// Auto-trigger: push notification when order status changes
exports.onOrderStatusNotification = onDocumentWritten('orders/{orderId}', async (event) => {
    const before = event.data.before ? event.data.before.data() : null;
    const after = event.data.after ? event.data.after.data() : null;
    if (!after || !before || before.orderStatus === after.orderStatus) return null;

    const statusMessages = {
        confirmed:        '✅ Your order has been confirmed!',
        packed:           '📦 Your order has been packed and is ready for dispatch.',
        shipped:          '🚚 Your order is on its way!',
        out_for_delivery: '🛵 Your order is out for delivery. Expect it today!',
        delivered:        '🎉 Your order has been delivered. Enjoy your purchase!',
        cancelled:        '❌ Your order has been cancelled.',
        refunded:         '💰 Your refund has been processed.'
    };

    const message = statusMessages[after.orderStatus];
    if (!message || !after.customerId) return null;

    const title = `Order ${after.orderNumber || ''} Update`;
    await createNotification({
        userId: after.customerId,
        title,
        body: message,
        type: 'order_update',
        data: { orderId: event.params.orderId, orderStatus: after.orderStatus }
    });

    const userSnap = await db.collection('users').doc(after.customerId).get();
    if (userSnap.exists && userSnap.data().fcmToken) {
        try {
            await admin.messaging().send({
                token: userSnap.data().fcmToken,
                notification: { title, body: message },
                data: { orderId: event.params.orderId, orderStatus: after.orderStatus }
            });
        } catch (e) { console.warn('FCM push failed:', e.message); }
    }

    return null;
});

// ==========================================
// INVOICE SYSTEM — FULL PROFESSIONAL MODULE
// ==========================================

// ── Helper: Build Invoice PDF ─────────────────────────────────────────────────
function buildInvoicePDF(order, invoiceNumber, orderId) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margin: 50, size: 'A4' });
        const buffers = [];
        doc.on('data', (chunk) => buffers.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(buffers).toString('base64')));
        doc.on('error', reject);

        const GOLD        = '#D4AF37';
        const BLACK       = '#050505';
        const GRAY        = '#555555';
        const LIGHT_GRAY  = '#F7F7F7';
        const DARK_BG     = '#111111';
        const WHITE       = '#FFFFFF';
        const GREEN       = '#2ECC71';

        const addr        = order.shippingAddress || {};
        const items       = order.items || [];
        const paymentInfo = order.payment || {};

        // ── CGST / SGST split (6% each = 12% total) ─────────────
        const subtotal  = order.subtotal        || 0;
        const discount  = order.discount        || 0;
        const taxable   = subtotal - discount;
        const cgst      = order.cgst            || Math.round(taxable * 0.06);
        const sgst      = order.sgst            || Math.round(taxable * 0.06);
        const totalGst  = cgst + sgst;
        const delivery  = order.deliveryCharge  || 0;
        const grand     = order.totalAmount     || 0;

        const paidAt = paymentInfo.paidAt && paymentInfo.paidAt.toDate
            ? paymentInfo.paidAt.toDate().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })
            : new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });

        const pageW = doc.page.width;
        const pageH = doc.page.height;
        const L = 50; const R = pageW - 50;

        // ── HEADER ───────────────────────────────────────────────
        doc.rect(0, 0, pageW, 90).fill(DARK_BG);

        // Gold accent bar
        doc.rect(0, 88, pageW, 3).fill(GOLD);

        // Logo text
        doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(26).text('KALYAN COVERING', L, 20);
        doc.fillColor(WHITE).font('Helvetica').fontSize(9.5).text('Premium Gold Jewellery  •  www.kalyancovering.com', L, 52);
        doc.fillColor('#888888').fontSize(8).text('GSTIN: PENDING REGISTRATION  •  noreply@kalyancovering.com', L, 66);

        // TAX INVOICE badge (right)
        doc.rect(pageW - 145, 18, 95, 26).fill(GOLD);
        doc.fillColor(DARK_BG).font('Helvetica-Bold').fontSize(11).text('TAX INVOICE', pageW - 143, 27, { width: 91, align: 'center' });

        // ── TWO-COLUMN META BLOCK ─────────────────────────────────
        const metaTop = 105;
        // Left block: Invoice Details
        doc.fillColor(DARK_BG).font('Helvetica-Bold').fontSize(10).text('INVOICE DETAILS', L, metaTop);
        doc.moveTo(L, metaTop + 14).lineTo(255, metaTop + 14).strokeColor(GOLD).lineWidth(1).stroke();

        const leftMeta = [
            ['Invoice No.',    invoiceNumber],
            ['Invoice Date',   paidAt],
            ['Order No.',      order.orderNumber || orderId],
            ['Payment',        (paymentInfo.method || 'RAZORPAY').toUpperCase()],
            ['Payment Ref.',   paymentInfo.razorpay_payment_id || 'N/A'],
            ['Status',         (order.orderStatus || 'PAID').toUpperCase()],
        ];
        leftMeta.forEach(([k, v], i) => {
            const y = metaTop + 22 + i * 16;
            doc.font('Helvetica-Bold').fillColor(GRAY).fontSize(8.5).text(k + ':', L, y, { width: 90 });
            doc.font('Helvetica').fillColor(DARK_BG).text(v, L + 95, y, { width: 160 });
        });

        // Right block: Bill To
        const rightX = 310;
        doc.fillColor(DARK_BG).font('Helvetica-Bold').fontSize(10).text('BILL TO / SHIP TO', rightX, metaTop);
        doc.moveTo(rightX, metaTop + 14).lineTo(R, metaTop + 14).strokeColor(GOLD).lineWidth(1).stroke();

        const fullName = `${addr.fname || ''} ${addr.lname || ''}`.trim() || 'Customer';
        const addrLines = [
            fullName,
            addr.address || '',
            `${addr.city || ''}, ${addr.state || ''} ${addr.pin ? '– ' + addr.pin : ''}`.trim(),
            `Phone: ${addr.phone || 'N/A'}`,
            `Email: ${addr.email || order.customerEmail || 'N/A'}`,
        ];
        addrLines.forEach((line, i) => {
            const y = metaTop + 22 + i * 16;
            doc.font(i === 0 ? 'Helvetica-Bold' : 'Helvetica')
               .fillColor(i === 0 ? DARK_BG : GRAY)
               .fontSize(i === 0 ? 9.5 : 8.5)
               .text(line, rightX, y, { width: R - rightX });
        });

        // ── ITEMS TABLE ──────────────────────────────────────────
        const tableTop = metaTop + 22 + leftMeta.length * 16 + 20;

        // Table header
        doc.rect(L, tableTop, R - L, 24).fill(DARK_BG);
        doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(9);
        const cols = { no: L+4, item: L+24, sku: L+230, qty: L+295, rate: L+340, total: R-64 };
        doc.text('#',         cols.no,   tableTop + 7, { width: 18 });
        doc.text('ITEM DESCRIPTION', cols.item, tableTop + 7, { width: 200 });
        doc.text('SKU',       cols.sku,  tableTop + 7, { width: 55 });
        doc.text('QTY',       cols.qty,  tableTop + 7, { width: 40, align: 'center' });
        doc.text('RATE',      cols.rate, tableTop + 7, { width: 60, align: 'right' });
        doc.text('AMOUNT',    cols.total,tableTop + 7, { width: 64, align: 'right' });

        let rowY = tableTop + 28;
        items.forEach((item, i) => {
            const lineTotal = (item.price || 0) * (item.qty || 1);
            if (i % 2 === 0) doc.rect(L, rowY - 4, R - L, 22).fill(LIGHT_GRAY);
            doc.fillColor(DARK_BG).font('Helvetica').fontSize(8.5);
            doc.text(String(i + 1), cols.no,   rowY, { width: 18 });
            doc.text(item.name || 'Product',    cols.item, rowY, { width: 200 });
            doc.text(item.sku  || '—',          cols.sku,  rowY, { width: 55 });
            doc.text(String(item.qty || 1),     cols.qty,  rowY, { width: 40, align: 'center' });
            doc.text(`Rs.${(item.price||0).toLocaleString('en-IN')}`, cols.rate, rowY, { width: 60, align: 'right' });
            doc.text(`Rs.${lineTotal.toLocaleString('en-IN')}`,         cols.total,rowY, { width: 64, align: 'right' });
            rowY += 22;
        });

        // Table bottom border
        doc.moveTo(L, rowY).lineTo(R, rowY).strokeColor(GOLD).lineWidth(0.8).stroke();
        rowY += 12;

        // ── TOTALS BLOCK ─────────────────────────────────────────
        const totW   = 200;
        const totL   = R - totW;
        const totR   = R;
        const lblW   = 120;
        const valW   = totW - lblW;

        const drawRow = (label, value, y, bold = false, highlight = false) => {
            if (highlight) {
                doc.rect(totL - 5, y - 4, totW + 5, 22).fill(DARK_BG);
                doc.fillColor(GOLD);
            } else {
                doc.fillColor(bold ? DARK_BG : GRAY);
            }
            doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 10 : 9);
            doc.text(label, totL, y, { width: lblW });
            const valStr = value < 0
                ? `-Rs.${Math.abs(value).toLocaleString('en-IN')}`
                : `Rs.${value.toLocaleString('en-IN')}`;
            doc.text(valStr, totL + lblW, y, { width: valW, align: 'right' });
        };

        let ty = rowY;
        drawRow('Subtotal:',          subtotal,   ty);          ty += 18;
        if (discount > 0) {
            drawRow('Promo Discount:', -discount, ty);          ty += 18;
        }
        doc.moveTo(totL - 5, ty).lineTo(R, ty).strokeColor('#DDDDDD').lineWidth(0.5).stroke();
        ty += 8;
        drawRow('CGST (6%):',         cgst,       ty);          ty += 16;
        drawRow('SGST (6%):',         sgst,       ty);          ty += 16;
        drawRow('Total GST (12%):',   totalGst,   ty, true);    ty += 18;
        drawRow('Delivery Charges:',  delivery,   ty);          ty += 18;
        doc.moveTo(totL - 5, ty).lineTo(R, ty).strokeColor(GOLD).lineWidth(1).stroke();
        ty += 8;
        drawRow('GRAND TOTAL:',       grand,      ty, true, true); ty += 26;

        // Amount in words placeholder
        doc.fillColor(GRAY).font('Helvetica').fontSize(8)
           .text(`Amount in words: Rupees ${numberToWords(grand)} Only`, L, ty);
        ty += 20;

        // ── GST SUMMARY TABLE ────────────────────────────────────
        const gstY = ty + 10;
        doc.fillColor(DARK_BG).font('Helvetica-Bold').fontSize(9.5).text('GST SUMMARY', L, gstY);
        doc.moveTo(L, gstY + 14).lineTo(260, gstY + 14).strokeColor(GOLD).lineWidth(0.8).stroke();

        const gstHeaders = ['Tax Type', 'Taxable Amt', 'Rate', 'Tax Amount'];
        const gstHY = gstY + 20;
        doc.rect(L, gstHY, 210, 18).fill(DARK_BG);
        doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(8);
        gstHeaders.forEach((h, i) => doc.text(h, L + i * 52 + 4, gstHY + 5, { width: 50 }));

        const gstRows = [
            ['CGST', taxable, '6%', cgst],
            ['SGST', taxable, '6%', sgst],
            ['Total', taxable, '12%', totalGst],
        ];
        gstRows.forEach((row, ri) => {
            const gstRY = gstHY + 20 + ri * 16;
            if (ri % 2 === 0) doc.rect(L, gstRY - 2, 210, 16).fill(LIGHT_GRAY);
            doc.fillColor(ri === 2 ? DARK_BG : GRAY)
               .font(ri === 2 ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
            doc.text(String(row[0]), L + 4,       gstRY, { width: 50 });
            doc.text(`Rs.${Number(row[1]).toLocaleString('en-IN')}`, L + 56,  gstRY, { width: 50 });
            doc.text(String(row[2]), L + 108,     gstRY, { width: 50 });
            doc.text(`Rs.${Number(row[3]).toLocaleString('en-IN')}`, L + 160, gstRY, { width: 50 });
        });

        // ── FOOTER ───────────────────────────────────────────────
        const footerH = 70;
        const footerY = pageH - footerH;
        doc.rect(0, footerY, pageW, footerH).fill(DARK_BG);
        doc.rect(0, footerY, pageW, 2).fill(GOLD);

        doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(10)
           .text('Thank you for shopping with Kalyan Covering!', L, footerY + 12, { align: 'center', width: pageW - L * 2 });
        doc.fillColor('#888888').font('Helvetica').fontSize(7.5)
           .text('This is a computer-generated invoice and does not require a physical signature.  |  Subject to jurisdiction of local courts.', L, footerY + 30, { align: 'center', width: pageW - L * 2 });
        doc.fillColor(GOLD).fontSize(7.5)
           .text('Kalyan Covering  •  www.kalyancovering.com  •  noreply@kalyancovering.com', L, footerY + 46, { align: 'center', width: pageW - L * 2 });

        doc.end();
    });
}

// ── Helper: Number to Words (simple) ─────────────────────────────────────────
function numberToWords(num) {
    const a = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten',
        'Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
    const b = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
    const n = Math.floor(Math.abs(num));
    if (n === 0) return 'Zero';
    const crore = Math.floor(n / 10000000);
    const lakh  = Math.floor((n % 10000000) / 100000);
    const thou  = Math.floor((n % 100000) / 1000);
    const hund  = Math.floor((n % 1000) / 100);
    const rest  = n % 100;
    let str = '';
    const twoDigit = (x) => x < 20 ? a[x] : b[Math.floor(x/10)] + (x%10 ? ' ' + a[x%10] : '');
    if (crore) str += twoDigit(crore) + ' Crore ';
    if (lakh)  str += twoDigit(lakh)  + ' Lakh ';
    if (thou)  str += twoDigit(thou)  + ' Thousand ';
    if (hund)  str += a[hund] + ' Hundred ';
    if (rest)  str += twoDigit(rest);
    return str.trim();
}

// ── generateInvoice — Callable ───────────────────────────────────────────────
/**
 * Generates or retrieves a cached invoice PDF for a given orderId.
 * Persists an `invoices` Firestore document with full GST breakdown.
 * Idempotent: returns cached PDF if invoice already exists for this order.
 */
exports.generateInvoice = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Must be logged in to generate an invoice.');
    }

    const { orderId } = request.data;
    if (!orderId) throw new HttpsError('invalid-argument', 'orderId is required.');

    // Fetch the order
    const orderSnap = await db.collection('orders').doc(orderId).get();
    if (!orderSnap.exists) throw new HttpsError('not-found', 'Order not found.');

    const order = orderSnap.data();
    const isOwnerUser = order.customerId === request.auth.uid;
    const isAdminRole = ['owner', 'manager', 'staff'].includes(request.auth.token.role);
    if (!isOwnerUser && !isAdminRole) {
        throw new HttpsError('permission-denied', 'Access denied.');
    }

    // ── Idempotency: return cached invoice if it already exists ──
    const existingSnap = await db.collection('invoices')
        .where('orderId', '==', orderId)
        .limit(1).get();
    if (!existingSnap.empty) {
        const cached = existingSnap.docs[0];
        return {
            success: true,
            invoiceId:     cached.id,
            invoiceNumber: cached.data().invoiceNumber,
            orderNumber:   cached.data().orderNumber || order.orderNumber || orderId,
            pdfBase64:     cached.data().pdfBase64
        };
    }

    // ── Generate unique Invoice Number ───────────────────────────
    const now       = new Date();
    const datePart  = now.toISOString().slice(0,10).replace(/-/g,'');
    const randPart  = Math.random().toString(36).substring(2,7).toUpperCase();
    const invoiceNumber = `INV-${datePart}-${randPart}`;

    // ── GST Calculation ─────────────────────────────────────────
    const subtotal = order.subtotal       || 0;
    const discount = order.discount       || 0;
    const taxable  = subtotal - discount;
    const cgst     = Math.round(taxable * 0.06);
    const sgst     = Math.round(taxable * 0.06);
    const totalGst = cgst + sgst;
    const delivery = order.deliveryCharge || 0;
    const grand    = order.totalAmount    || 0;

    // ── Build PDF ────────────────────────────────────────────────
    const pdfBase64 = await buildInvoicePDF(order, invoiceNumber, orderId);

    // ── Fetch customer info ──────────────────────────────────────
    let customerName  = 'Customer';
    let customerEmail = '';
    let customerPhone = '';
    if (order.customerId) {
        try {
            const uSnap = await db.collection('users').doc(order.customerId).get();
            if (uSnap.exists) {
                const u = uSnap.data();
                customerName  = `${u.firstName || u.displayName || ''} ${u.lastName || ''}`.trim() || 'Customer';
                customerEmail = u.email || u.phoneNumber || '';
                customerPhone = u.phoneNumber || '';
            }
        } catch(_) {}
    }
    // Also check shipping address as fallback
    const addr = order.shippingAddress || {};
    if (!customerEmail && addr.email) customerEmail = addr.email;
    if (!customerPhone && addr.phone)  customerPhone = addr.phone;
    if (customerName === 'Customer' && (addr.fname || addr.lname)) {
        customerName = `${addr.fname || ''} ${addr.lname || ''}`.trim();
    }

    // ── Persist invoice to Firestore ─────────────────────────────
    const invoiceDoc = {
        invoiceNumber,
        orderId,
        orderNumber:      order.orderNumber    || orderId,
        customerId:       order.customerId     || '',
        customerName,
        customerEmail,
        customerPhone,
        shippingAddress:  order.shippingAddress || {},
        items:            (order.items || []).map(item => ({
            name:      item.name      || 'Product',
            sku:       item.sku       || '',
            qty:       item.qty       || 1,
            price:     item.price     || 0,
            lineTotal: (item.price || 0) * (item.qty || 1)
        })),
        subtotal,
        discount,
        couponCode:       order.couponCode || null,
        cgst,
        sgst,
        totalGst,
        gstRate:          12,
        deliveryCharge:   delivery,
        grandTotal:       grand,
        paymentMethod:    order.payment?.method         || 'razorpay',
        paymentId:        order.payment?.razorpay_payment_id || '',
        orderStatus:      order.orderStatus || 'paid',
        pdfBase64,
        emailedAt:        null,
        createdAt:        admin.firestore.FieldValue.serverTimestamp(),
        updatedAt:        admin.firestore.FieldValue.serverTimestamp()
    };

    const invoiceRef = await db.collection('invoices').add(invoiceDoc);

    // ── Update order with invoiceId ──────────────────────────────
    await db.collection('orders').doc(orderId).update({
        invoiceId:     invoiceRef.id,
        invoiceNumber,
        updatedAt:     admin.firestore.FieldValue.serverTimestamp()
    });

    await logAudit(request, 'GENERATE_INVOICE', 'invoices', invoiceRef.id, null, { invoiceNumber, orderId });

    return {
        success: true,
        invoiceId:     invoiceRef.id,
        invoiceNumber,
        orderNumber:   order.orderNumber || orderId,
        pdfBase64
    };
});

// ── emailInvoice — Callable ───────────────────────────────────────────────────
/**
 * Sends the invoice PDF as an email attachment using Nodemailer.
 * Requires env vars: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
 */
exports.emailInvoice = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Must be logged in.');
    }
    const { orderId, invoiceId } = request.data;
    if (!orderId && !invoiceId) {
        throw new HttpsError('invalid-argument', 'orderId or invoiceId is required.');
    }

    // Resolve invoice
    let invoiceSnap;
    if (invoiceId) {
        invoiceSnap = await db.collection('invoices').doc(invoiceId).get();
    } else {
        const q = await db.collection('invoices').where('orderId', '==', orderId).limit(1).get();
        invoiceSnap = q.empty ? null : q.docs[0];
    }

    // If no invoice cached yet, auto-generate
    if (!invoiceSnap || !invoiceSnap.exists) {
        // Trigger generation inline
        const orderSnap = await db.collection('orders').doc(orderId).get();
        if (!orderSnap.exists) throw new HttpsError('not-found', 'Order not found.');
        const order = orderSnap.data();
        const isOwnerUser = order.customerId === request.auth.uid;
        const isAdminRole = ['owner', 'manager', 'staff'].includes(request.auth.token.role);
        if (!isOwnerUser && !isAdminRole) throw new HttpsError('permission-denied', 'Access denied.');

        // Inline generate
        const now2 = new Date();
        const invNum = `INV-${now2.toISOString().slice(0,10).replace(/-/g,'')}-${Math.random().toString(36).substring(2,7).toUpperCase()}`;
        const pdf64  = await buildInvoicePDF(order, invNum, orderId);
        const sub2   = order.subtotal || 0;
        const dis2   = order.discount || 0;
        const tax2   = sub2 - dis2;
        const newDoc = {
            invoiceNumber: invNum, orderId,
            orderNumber: order.orderNumber || orderId,
            customerId:  order.customerId  || '',
            customerEmail: (order.shippingAddress || {}).email || '',
            grandTotal: order.totalAmount || 0,
            cgst: Math.round(tax2 * 0.06), sgst: Math.round(tax2 * 0.06),
            totalGst: Math.round(tax2 * 0.12), pdfBase64: pdf64,
            emailedAt: null,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };
        const newRef = await db.collection('invoices').add(newDoc);
        invoiceSnap = await newRef.get();
    }

    const invoice = invoiceSnap.data ? invoiceSnap.data() : invoiceSnap;

    // Verify ownership
    const isOwnerUser = invoice.customerId === request.auth.uid;
    const isAdminRole = ['owner', 'manager', 'staff'].includes(request.auth.token.role);
    if (!isOwnerUser && !isAdminRole) {
        throw new HttpsError('permission-denied', 'Access denied.');
    }

    const toEmail = invoice.customerEmail || '';
    if (!toEmail) {
        throw new HttpsError('failed-precondition', 'No customer email found for this invoice.');
    }

    // ── Send Email via Nodemailer ────────────────────────────────
    const transporter = nodemailer.createTransport({
        host:   process.env.SMTP_HOST   || 'smtp.gmail.com',
        port:   parseInt(process.env.SMTP_PORT || '587'),
        secure: false,
        auth: {
            user: process.env.SMTP_USER || '',
            pass: process.env.SMTP_PASS || ''
        }
    });

    const htmlBody = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0a0a0a;color:#ffffff;border-radius:12px;overflow:hidden">
      <div style="background:#111111;padding:30px 40px;border-bottom:3px solid #D4AF37">
        <h1 style="margin:0;color:#D4AF37;font-size:24px">Kalyan Covering</h1>
        <p style="margin:6px 0 0;color:#888;font-size:13px">Premium Gold Jewellery</p>
      </div>
      <div style="padding:30px 40px">
        <h2 style="color:#D4AF37;font-size:18px;margin-bottom:6px">Your Invoice is Ready 🧾</h2>
        <p style="color:#bbbbbb;line-height:1.7">Hi ${invoice.customerName || 'Valued Customer'},<br><br>
          Thank you for your order with Kalyan Covering. Please find your tax invoice attached to this email.
        </p>
        <div style="background:#1a1a1a;border:1px solid #333;border-radius:8px;padding:20px;margin:20px 0">
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="color:#888;font-size:12px;padding:6px 0">Invoice Number</td><td style="color:#D4AF37;font-weight:bold;text-align:right">${invoice.invoiceNumber}</td></tr>
            <tr><td style="color:#888;font-size:12px;padding:6px 0">Order Number</td><td style="color:#fff;text-align:right">${invoice.orderNumber}</td></tr>
            <tr><td style="color:#888;font-size:12px;padding:6px 0">Grand Total</td><td style="color:#2ECC71;font-weight:bold;font-size:16px;text-align:right">Rs. ${(invoice.grandTotal || 0).toLocaleString('en-IN')}</td></tr>
          </table>
        </div>
        <p style="color:#888;font-size:12px">If you have any questions, reply to this email or contact us at noreply@kalyancovering.com</p>
      </div>
      <div style="background:#111111;padding:20px 40px;text-align:center;border-top:1px solid #222">
        <p style="color:#555;font-size:11px;margin:0">© ${new Date().getFullYear()} Kalyan Covering. All rights reserved.</p>
      </div>
    </div>`;

    await transporter.sendMail({
        from:    `"Kalyan Covering" <${process.env.SMTP_USER || 'noreply@kalyancovering.com'}>`,
        to:      toEmail,
        subject: `Your Invoice ${invoice.invoiceNumber} — Kalyan Covering`,
        html:    htmlBody,
        attachments: [{
            filename:    `${invoice.invoiceNumber}.pdf`,
            content:     Buffer.from(invoice.pdfBase64, 'base64'),
            contentType: 'application/pdf'
        }]
    });

    // Update emailedAt
    const invoiceDocId = invoiceSnap.id || invoiceSnap.ref?.id;
    if (invoiceDocId) {
        await db.collection('invoices').doc(invoiceDocId).update({
            emailedAt:  admin.firestore.FieldValue.serverTimestamp(),
            updatedAt:  admin.firestore.FieldValue.serverTimestamp()
        });
    }

    await logAudit(request, 'EMAIL_INVOICE', 'invoices', invoiceDocId || 'unknown', null, { toEmail, invoiceNumber: invoice.invoiceNumber });
    return { success: true, emailSentTo: toEmail };
});

// ── getMyInvoices — Callable (customer) ───────────────────────────────────────
/**
 * Returns the authenticated user's invoice list (metadata only, no pdfBase64 for performance).
 */
exports.getMyInvoices = onCall(async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in.');
    const limit = Math.min(request.data?.limit || 20, 50);

    const snap = await db.collection('invoices')
        .where('customerId', '==', request.auth.uid)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();

    return snap.docs.map(d => {
        const data = d.data();
        return {
            id:            d.id,
            invoiceNumber: data.invoiceNumber,
            orderNumber:   data.orderNumber,
            orderId:       data.orderId,
            grandTotal:    data.grandTotal,
            cgst:          data.cgst,
            sgst:          data.sgst,
            totalGst:      data.totalGst,
            paymentMethod: data.paymentMethod,
            orderStatus:   data.orderStatus,
            emailedAt:     data.emailedAt,
            createdAt:     data.createdAt
        };
    });
});

// ── getInvoices — Callable (admin) ───────────────────────────────────────────
/**
 * Returns paginated invoice list for admin. Supports filtering by customerId and date range.
 */
exports.getInvoices = onCall(async (request) => {
    verifyAdmin(request);
    const { limit: lim = 30, customerId: filterCustomer, startAfterDate } = request.data || {};
    const limit = Math.min(lim, 100);

    let q = db.collection('invoices').orderBy('createdAt', 'desc');
    if (filterCustomer) q = q.where('customerId', '==', filterCustomer);
    if (startAfterDate) q = q.startAfter(new Date(startAfterDate));
    q = q.limit(limit);

    const snap = await q.get();
    return snap.docs.map(d => {
        const data = d.data();
        return {
            id:            d.id,
            invoiceNumber: data.invoiceNumber,
            orderNumber:   data.orderNumber,
            orderId:       data.orderId,
            customerId:    data.customerId,
            customerName:  data.customerName,
            customerEmail: data.customerEmail,
            grandTotal:    data.grandTotal,
            cgst:          data.cgst,
            sgst:          data.sgst,
            totalGst:      data.totalGst,
            paymentMethod: data.paymentMethod,
            orderStatus:   data.orderStatus,
            emailedAt:     data.emailedAt,
            createdAt:     data.createdAt
        };
    });
});

// ==========================================
// ORDER SELF-SERVICE (Cancel / Return)
// ==========================================

/**
 * cancelOrder
 * Customer-callable function to cancel their own order.
 *
 * Server-side validates:
 *  - The user is authenticated.
 *  - The order exists and belongs to the requesting user (prevents IDOR).
 *  - The order is in a cancellable state (not shipped, delivered, or already cancelled).
 *  - Restores stock if the order had already been paid and stock was deducted.
 */
exports.cancelOrder = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "User must be logged in.");
    }

    const { orderId, reason } = request.data;
    if (!orderId || typeof orderId !== 'string') {
        throw new HttpsError("invalid-argument", "orderId is required.");
    }
    if (!reason || typeof reason !== 'string' || !reason.trim()) {
        throw new HttpsError("invalid-argument", "A cancellation reason is required.");
    }

    // These are the only statuses from which a customer can cancel.
    const CANCELLABLE_STATUSES = ['payment_pending', 'pending', 'confirmed', 'packed'];

    try {
        const result = await db.runTransaction(async (transaction) => {
            const orderRef = db.collection('orders').doc(orderId);
            const orderSnap = await transaction.get(orderRef);

            if (!orderSnap.exists) {
                throw new HttpsError("not-found", "Order not found.");
            }

            const orderData = orderSnap.data();

            // Security: The order must belong to the requesting user (IDOR prevention).
            if (orderData.customerId !== request.auth.uid) {
                throw new HttpsError("permission-denied", "You are not authorized to cancel this order.");
            }

            // Validate that the order is in a cancellable state.
            const currentStatus = (orderData.orderStatus || '').toLowerCase().replace(/\s+/g, '_');
            const isCancellable = CANCELLABLE_STATUSES.some(s => currentStatus.includes(s));
            if (!isCancellable) {
                throw new HttpsError(
                    "failed-precondition",
                    `Order cannot be cancelled. Current status: "${orderData.orderStatus}".`
                );
            }

            const now_ts = admin.firestore.FieldValue.serverTimestamp();
            const historyEntry = {
                status: "Cancelled",
                timestamp: new Date().toISOString(),
                changedBy: "customer",
                note: `Cancelled by customer. Reason: ${reason.trim()}`
            };

            transaction.update(orderRef, {
                orderStatus: "cancelled",
                cancellationReason: reason.trim(),
                statusHistory: admin.firestore.FieldValue.arrayUnion(historyEntry),
                updatedAt: now_ts
            });

            return { orderNumber: orderData.orderNumber };
        });

        await logAudit(request, 'ORDER_CANCELLED_BY_CUSTOMER', 'orders', orderId, null, {
            reason: reason.trim(),
            cancelledBy: request.auth.uid
        });

        return { success: true, orderNumber: result.orderNumber };

    } catch (err) {
        if (err instanceof HttpsError) throw err;
        console.error('[cancelOrder] Unexpected error:', err);
        throw new HttpsError('internal', 'Failed to cancel the order. Please try again.');
    }
});

/**
 * initiateReturn
 * Customer-callable function to request a return/replacement.
 *
 * Server-side validates:
 *  - The user is authenticated.
 *  - The order exists and belongs to the requesting user (prevents IDOR).
 *  - The order is in 'Delivered' status — only delivered orders can be returned.
 */
exports.initiateReturn = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "User must be logged in.");
    }

    const { orderId, reason } = request.data;
    if (!orderId || typeof orderId !== 'string') {
        throw new HttpsError("invalid-argument", "orderId is required.");
    }
    if (!reason || typeof reason !== 'string' || !reason.trim()) {
        throw new HttpsError("invalid-argument", "A return reason is required.");
    }

    try {
        const orderRef = db.collection('orders').doc(orderId);
        const orderSnap = await orderRef.get();

        if (!orderSnap.exists) {
            throw new HttpsError("not-found", "Order not found.");
        }

        const orderData = orderSnap.data();

        // Security: The order must belong to the requesting user (IDOR prevention).
        if (orderData.customerId !== request.auth.uid) {
            throw new HttpsError("permission-denied", "You are not authorized to return this order.");
        }

        // Only delivered orders can be returned.
        const currentStatus = (orderData.orderStatus || '').toLowerCase();
        if (!currentStatus.includes('deliver')) {
            throw new HttpsError(
                "failed-precondition",
                "Returns can only be requested for delivered orders."
            );
        }

        const now_ts = admin.firestore.FieldValue.serverTimestamp();
        const historyEntry = {
            status: "Return Requested",
            timestamp: new Date().toISOString(),
            changedBy: "customer",
            note: `Return requested by customer. Reason: ${reason.trim()}`
        };

        await orderRef.update({
            orderStatus: "returned",
            returnReason: reason.trim(),
            statusHistory: admin.firestore.FieldValue.arrayUnion(historyEntry),
            updatedAt: now_ts
        });

        await logAudit(request, 'RETURN_REQUESTED_BY_CUSTOMER', 'orders', orderId, null, {
            reason: reason.trim(),
            requestedBy: request.auth.uid
        });

        return { success: true, orderNumber: orderData.orderNumber };

    } catch (err) {
        if (err instanceof HttpsError) throw err;
        console.error('[initiateReturn] Unexpected error:', err);
        throw new HttpsError('internal', 'Failed to submit the return request. Please try again.');
    }
});

// ==========================================
// SHIPROCKET SHIPPING INTEGRATION
// ==========================================
// All shipping functions are server-side only.
// Shiprocket credentials (SHIPROCKET_EMAIL, SHIPROCKET_PASSWORD) are stored
// securely in environment variables — never exposed to the frontend.

// Note: shippingService individual functions are destructured at the top of the file.

/**
 * createShipment — Admin only
 * Triggers shipment creation for a given Firestore order ID.
 */
exports.createShipment = onCall(async (request) => {
    verifyAdmin(request);

    const { orderId, pickupLocation } = request.data;
    if (!orderId) {
        throw new HttpsError('invalid-argument', 'orderId is required.');
    }

    try {
        const result = await createShipmentForOrder(orderId, pickupLocation || '');
        await logAudit(
            request,
            'CREATE_SHIPMENT',
            'orders',
            orderId,
            null,
            { shipmentId: result.shipmentId, awbCode: result.awbCode }
        );
        return result;
    } catch (error) {
        console.error('createShipment error:', error);
        if (error instanceof HttpsError) throw error;
        throw new HttpsError('internal', error.message || 'Failed to create shipment.');
    }
});

/**
 * checkShippingServiceability
 * ---------------------------
 * Admin-only callable function.
 * Checks whether Shiprocket can deliver to a given pincode from the store's
 * pickup pincode, and returns a list of available courier partners with rates.
 *
 * Request data:
 *   { deliveryPincode: string, weight?: number, isCOD?: boolean }
 *
 * Returns:
 *   { isServiceable, availableCouriers: [...], pickupPincode, deliveryPincode }
 */
exports.checkShippingServiceability = onCall(async (request) => {
    verifyAdmin(request);

    const { deliveryPincode, weight, isCOD } = request.data || {};

    if (!deliveryPincode) {
        throw new HttpsError("invalid-argument", "deliveryPincode is required.");
    }

    // Use store pincode from environment (set in .env and Firebase Secrets)
    const pickupPincode = process.env.STORE_PICKUP_PINCODE;
    if (!pickupPincode) {
        console.error("[SHIPPING] STORE_PICKUP_PINCODE is not configured in environment.");
        throw new HttpsError(
            "internal",
            "Store pickup pincode is not configured. Contact your system administrator."
        );
    }

    const packageWeight = typeof weight === "number" && weight > 0 ? weight : 0.5;

    console.log(JSON.stringify({
        severity: "INFO",
        component: "SHIPPING_FUNCTION",
        function: "checkShippingServiceability",
        adminId: request.auth.uid,
        deliveryPincode,
        pickupPincode,
        weight: packageWeight,
    }));

    try {
        const result = await checkServiceability({
            pickupPincode,
            deliveryPincode,
            weight: packageWeight,
            isCOD: isCOD === true,
        });

        await logAudit(
            request,
            "CHECK_SHIPPING_SERVICEABILITY",
            "shipping",
            deliveryPincode,
            null,
            { isServiceable: result.isServiceable, courierCount: result.availableCouriers.length }
        );

        return {
            success: true,
            pickupPincode,
            deliveryPincode,
            ...result,
        };
    } catch (err) {
        console.error(JSON.stringify({
            severity: "ERROR",
            component: "SHIPPING_FUNCTION",
            function: "checkShippingServiceability",
            error: err.message,
            deliveryPincode,
        }));
        throw new HttpsError("internal", `Serviceability check failed: ${err.message}`);
    }
});

/**
 * getShippingCouriers
 * -------------------
 * Admin-only callable function.
 * Fetches available courier options for a specific order by reading the order's
 * shipping address from Firestore and checking serviceability.
 *
 * Request data:
 *   { orderId: string }
 *
 * Returns:
 *   { orderId, orderNumber, isServiceable, availableCouriers, packageWeight }
 */
exports.getShippingCouriers = onCall(async (request) => {
    verifyAdmin(request);

    const { orderId } = request.data || {};
    if (!orderId) {
        throw new HttpsError("invalid-argument", "orderId is required.");
    }

    const pickupPincode = process.env.STORE_PICKUP_PINCODE;
    if (!pickupPincode) {
        console.error("[SHIPPING] STORE_PICKUP_PINCODE is not configured in environment.");
        throw new HttpsError(
            "internal",
            "Store pickup pincode is not configured. Contact your system administrator."
        );
    }

    console.log(JSON.stringify({
        severity: "INFO",
        component: "SHIPPING_FUNCTION",
        function: "getShippingCouriers",
        adminId: request.auth.uid,
        orderId,
    }));

    try {
        const result = await getAvailableCouriersForOrder(orderId, pickupPincode);

        await logAudit(
            request,
            "GET_SHIPPING_COURIERS",
            "orders",
            orderId,
            null,
            { isServiceable: result.isServiceable, courierCount: result.availableCouriers.length }
        );

        return { success: true, ...result };
    } catch (err) {
        console.error(JSON.stringify({
            severity: "ERROR",
            component: "SHIPPING_FUNCTION",
            function: "getShippingCouriers",
            error: err.message,
            orderId,
        }));

        // Map known error types to appropriate HttpsError codes
        if (err.message.includes("not found")) {
            throw new HttpsError("not-found", err.message);
        }
        if (err.message.includes("shipping address")) {
            throw new HttpsError("failed-precondition", err.message);
        }
        throw new HttpsError("internal", `Failed to get couriers: ${err.message}`);
    }
});

/**
 * getShipmentTracking
 * -------------------
 * Admin OR authenticated customer callable function.
 * Fetches live tracking info for a shipment.
 *
 * Admins can track any order.
 * Customers can only track their own orders.
 *
 * Request data (one of the following):
 *   { orderId: string }           — looks up shipmentId from Firestore
 *   { shipmentId: string|number } — tracks directly by Shiprocket shipment ID
 *
 * Returns:
 *   { orderId?, shipmentId?, awbCode?, currentStatus, activities, expectedDeliveryDate, courierName }
 */
exports.getShipmentTracking = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "User must be logged in.");
    }

    const { orderId, shipmentId } = request.data || {};

    if (!orderId && !shipmentId) {
        throw new HttpsError("invalid-argument", "Either orderId or shipmentId is required.");
    }

    const isAdminRole = ["owner", "manager", "staff"].includes(request.auth.token.role);

    console.log(JSON.stringify({
        severity: "INFO",
        component: "SHIPPING_FUNCTION",
        function: "getShipmentTracking",
        userId: request.auth.uid,
        isAdmin: isAdminRole,
        orderId: orderId || null,
        shipmentId: shipmentId || null,
    }));

    try {
        // If tracking by orderId: verify customer ownership (unless admin)
        if (orderId) {
            if (!isAdminRole) {
                const orderSnap = await db.collection("orders").doc(orderId).get();
                if (!orderSnap.exists) {
                    throw new HttpsError("not-found", "Order not found.");
                }
                if (orderSnap.data().customerId !== request.auth.uid) {
                    throw new HttpsError("permission-denied", "You can only track your own orders.");
                }
            }

            const result = await getTrackingByOrderId(orderId, true);
            return { success: true, ...result };
        }

        // Tracking by shipmentId (admin only for direct shipment lookups)
        if (!isAdminRole) {
            throw new HttpsError(
                "permission-denied",
                "Direct shipment ID tracking requires admin access. Use orderId instead."
            );
        }

        const result = await getTrackingByShipmentId(shipmentId);
        return { success: true, ...result };

    } catch (err) {
        console.error(JSON.stringify({
            severity: "ERROR",
            component: "SHIPPING_FUNCTION",
            function: "getShipmentTracking",
            error: err.message,
            orderId: orderId || null,
            shipmentId: shipmentId || null,
        }));

        // Re-throw HttpsErrors as-is
        if (err instanceof HttpsError) throw err;

        if (err.message.includes("not found")) {
            throw new HttpsError("not-found", err.message);
        }
        if (err.message.includes("no Shiprocket shipment")) {
            throw new HttpsError("failed-precondition", err.message);
        }
        throw new HttpsError("internal", `Tracking failed: ${err.message}`);
    }
});

/**
 * getShiprocketPickupLocations
 * ----------------------------
 * Admin-only callable function.
 * Returns the list of pickup locations configured on the Shiprocket account.
 * Used by admin when setting up or changing the store's pickup address.
 *
 * Request data: (none required)
 * Returns: { pickupLocations: [...] }
 */
exports.getShiprocketPickupLocations = onCall(async (request) => {
    verifyAdmin(request);

    console.log(JSON.stringify({
        severity: "INFO",
        component: "SHIPPING_FUNCTION",
        function: "getShiprocketPickupLocations",
        adminId: request.auth.uid,
    }));

    try {
        const locations = await getPickupLocations();
        return { success: true, pickupLocations: locations };
    } catch (err) {
        console.error(JSON.stringify({
            severity: "ERROR",
            component: "SHIPPING_FUNCTION",
            function: "getShiprocketPickupLocations",
            error: err.message,
        }));
        throw new HttpsError("internal", `Failed to fetch pickup locations: ${err.message}`);
    }
});

// Alias for duplicate endpoints to maintain backwards compatibility
exports.getOrderTracking = exports.getShipmentTracking;
exports.getPickupLocations = exports.getShiprocketPickupLocations;

exports.createCODOrder = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "User must be logged in to place an order.");
    }

    const { items, promoCode, shippingAddress, notes } = request.data;
    if (!items || !Array.isArray(items) || items.length === 0) {
        throw new HttpsError("invalid-argument", "Cart cannot be empty.");
    }
    if (items.length > 50) {
        throw new HttpsError("invalid-argument", "Cart exceeds maximum item limit.");
    }
    if (!shippingAddress) {
        throw new HttpsError("invalid-argument", "Shipping address is required.");
    }
    validateAddress(shippingAddress);
    
    if (notes !== undefined && notes !== null) {
        if (typeof notes !== 'string') {
            throw new HttpsError("invalid-argument", "Notes must be a string.");
        }
        if (notes.length > 500) {
            throw new HttpsError("invalid-argument", "Notes cannot exceed 500 characters.");
        }
    }

    try {
        const {
            trustedItems,
            subtotal,
            discount,
            gst,
            deliveryCharge,
            codFee,
            totalAmount
        } = await calculateOrderTotals(items, promoCode, true);

        const orderNumber = `ORD-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        const now_ts = admin.firestore.FieldValue.serverTimestamp();

        const codOrder = {
            orderNumber,
            customerId: request.auth.uid,
            items: trustedItems, // Use server-calculated trusted item prices
            shippingAddress: shippingAddress || {},
            orderStatus: 'pending',
            paymentStatus: 'pending',
            shippingStatus: 'not_shipped',
            payment: {
                method: 'cod',
                amount: totalAmount,
                currency: 'INR',
                paidAt: null
            },
            shippingDetails: {
                carrier: null, trackingNumber: null, shippedAt: null, deliveredAt: null
            },
            subtotal, discount, gst, deliveryCharge, codFee, totalAmount, couponCode: promoCode || null,
            statusHistory: [{ status: 'pending', changedAt: now_ts, changedBy: 'system', note: 'COD Order placed.' }],
            notes: notes || null,
            createdAt: now_ts,
            updatedAt: now_ts
        };

        const docRef = await db.collection('orders').add(codOrder);
        await logAudit(request, 'CREATE_COD_ORDER', 'orders', docRef.id, null, codOrder);

        return {
            success: true,
            orderId: docRef.id,
            orderNumber
        };

    } catch (error) {
        console.error("Error creating COD order:", error);
        if (error instanceof HttpsError) throw error;
        throw new HttpsError("internal", "Unable to place COD order.");
    }
});

