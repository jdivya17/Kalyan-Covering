"use strict";

const { db } = require("./admin");

function normalizeStatus(status) {
    if (!status || typeof status !== "string") return "pending";
    const clean = status.trim().toLowerCase().replace(/[\s-]+/g, "_");
    const legacyMap = {
        "order_placed": "pending",
        "placed": "pending",
        "order placed": "pending",
        "out for delivery": "out_for_delivery",
        "out_for_delivery": "out_for_delivery"
    };
    const slugMap = {
        "pending": "pending",
        "payment_pending": "payment_pending",
        "confirmed": "confirmed",
        "packed": "packed",
        "shipped": "shipped",
        "out_for_delivery": "out_for_delivery",
        "delivered": "delivered",
        "cancelled": "cancelled",
        "canceled": "cancelled",
        "cancel_requested": "cancelled",
        "returned": "returned",
        "return_requested": "returned",
        "action_required_oversold": "action_required_oversold",
        "oversold": "action_required_oversold"
    };
    const lowerRaw = status.trim().toLowerCase();
    if (legacyMap[lowerRaw]) return legacyMap[lowerRaw];
    return slugMap[clean] || clean;
}

/**
 * Helper function to execute stock restoration within a Firestore transaction.
 */
async function restoreOrderStockInTransaction(transaction, orderRef, oData, now) {
    if (oData.stockRestored) return false;

    // Restore stock ONLY if stock was deducted for this order (COD or paid, never payment_pending)
    const isPaidOrCod = oData.payment?.method === "cod" || oData.paymentStatus === "paid" || oData.paymentStatus === "paid_after_cancel";
    if (!isPaidOrCod) {
        transaction.update(orderRef, { stockRestored: true });
        return false;
    }

    // TASK 7c: If coupon was used, decrement usedCount on coupon
    if (oData.couponId) {
        const couponRef = db.collection("coupons").doc(oData.couponId);
        const cSnap = await transaction.get(couponRef);
        if (cSnap.exists) {
            const currentUsed = cSnap.data().usedCount || 0;
            if (currentUsed > 0) {
                transaction.update(couponRef, { usedCount: Math.max(0, currentUsed - 1) });
            }
        }
    }

    const validItems = (oData.items || []).filter(item => item && item.id && (item.qty > 0 || item.quantity > 0));

    const productReads = [];
    for (const item of validItems) {
        const productRef = db.collection("products").doc(item.id);
        const pDoc = await transaction.get(productRef);
        productReads.push({ item, productRef, pDoc });
    }

    for (const { item, productRef, pDoc } of productReads) {
        if (!pDoc.exists) continue;
        const pd = pDoc.data();
        const itemQty = item.qty || item.quantity || 0;
        // TASK 8: Use deductedQty if present, fallback to itemQty
        const restoreQty = typeof item.deductedQty === "number" ? item.deductedQty : itemQty;

        if (restoreQty > 0) {
            const currentStock = typeof pd.stock === "number" ? pd.stock : (parseInt(pd.stock, 10) || 0);
            const restoredStock = currentStock + restoreQty;
            const updatePayload = {
                stock: restoredStock,
                updatedAt: now
            };
            if (pd.status === "out_of_stock" && restoredStock > 0) {
                updatePayload.status = "active";
            }
            transaction.update(productRef, updatePayload);
        }
    }

    transaction.update(orderRef, { stockRestored: true });
    return true;
}

module.exports = { restoreOrderStockInTransaction, normalizeStatus };
