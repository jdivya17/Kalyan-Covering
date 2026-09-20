/**
 * invoiceGenerator.js — Kalyan Covering
 * Client-side GST Tax Invoice PDF Generator using pinned jsPDF CDN (v2.5.1).
 * All store identity, tax rates, GSTIN placeholders, and HSN codes are loaded from STORE_CONFIG.
 * 
 * NOTE: For production go-live, sequential invoice numbering (e.g. INV-YYYY-NNNN)
 * must be generated server-side via a Firestore transaction or Cloud Function
 * to guarantee strict sequential ordering and compliance without client-side race conditions.
 */

import { STORE_CONFIG } from '../config/storeConfig.js';

// Pinned jsPDF CDN URL
const JSPDF_CDN_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';

/**
 * Load pinned jsPDF library dynamically if not already present
 */
export async function loadJsPDF() {
    if (window.jspdf && window.jspdf.jsPDF) {
        return window.jspdf.jsPDF;
    }
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = JSPDF_CDN_URL;
        script.onload = () => {
            if (window.jspdf && window.jspdf.jsPDF) {
                resolve(window.jspdf.jsPDF);
            } else {
                reject(new Error('jsPDF loaded but constructor not found'));
            }
        };
        script.onerror = () => reject(new Error('Failed to load jsPDF library from pinned CDN'));
        document.head.appendChild(script);
    });
}

/**
 * Generate and download a GST Tax Invoice PDF
 * @param {Object} order
 */
export async function generateInvoicePDF(order) {
    if (!order) {
        throw new Error('Order data is missing');
    }

    const jsPDF = await loadJsPDF();
    const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
    });

    const primaryGold = [214, 178, 94];     // #D6B25E
    const darkBg = [15, 14, 12];           // #0F0E0C
    const darkText = [30, 30, 30];

    const orderId = order.orderNumber || order.id || 'KC-ORD';
    const invoiceNum = order.invoiceNumber || `INV-${new Date().getFullYear()}-${orderId.slice(-6).toUpperCase()}`;
    const invoiceDate = order.createdAt
        ? new Date(order.createdAt.seconds ? order.createdAt.seconds * 1000 : order.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
        : new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

    const customer = order.shippingAddress || order.address || {};
    const items = order.items || [];
    
    // Total amounts
    const subtotal = order.subtotal || items.reduce((sum, item) => sum + ((item.price || 0) * (item.qty || item.quantity || 1)), 0);
    const discount = order.discount || 0;
    const giftWrap = order.giftWrap ? STORE_CONFIG.shipping.giftWrapFee : 0;
    const shipping = order.shippingFee !== undefined ? order.shippingFee : (subtotal >= STORE_CONFIG.shipping.freeShippingThreshold ? 0 : STORE_CONFIG.shipping.standardDeliveryFee);
    const grandTotal = order.total || order.grandTotal || (subtotal - discount + giftWrap + shipping);

    // Accurate Tax Calculation from Gross Tax-Inclusive Prices
    const gstRate = STORE_CONFIG.tax.gstRate || 0.12;
    const taxableBase = Math.round((subtotal / (1 + gstRate)) * 100) / 100;
    const totalGst = Math.round((subtotal - taxableBase) * 100) / 100;
    const cgst = Math.round((totalGst / 2) * 100) / 100;
    const sgst = Math.round((totalGst - cgst) * 100) / 100;

    // --- Header Banner ---
    doc.setFillColor(...darkBg);
    doc.rect(0, 0, 210, 38, 'F');

    doc.setFillColor(...primaryGold);
    doc.rect(0, 38, 210, 1.5, 'F');

    // Store Brand
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.setTextColor(...primaryGold);
    doc.text(STORE_CONFIG.storeName.toUpperCase(), 15, 18);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(200, 200, 200);
    doc.text(STORE_CONFIG.storeSubtitle, 15, 24);
    doc.text(`${STORE_CONFIG.address.fullAddress} | GSTIN: ${STORE_CONFIG.tax.gstin}`, 15, 29);

    // Invoice Title
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(255, 255, 255);
    doc.text('TAX INVOICE', 195, 18, { align: 'right' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...primaryGold);
    doc.text(`ORIGINAL FOR RECIPIENT`, 195, 24, { align: 'right' });
    doc.setTextColor(200, 200, 200);
    doc.text(`Date: ${invoiceDate}`, 195, 29, { align: 'right' });

    // --- Invoice Info Box ---
    let y = 48;
    doc.setDrawColor(220, 220, 220);
    doc.setFillColor(248, 248, 248);
    doc.roundedRect(15, y, 180, 22, 2, 2, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...darkText);
    doc.text('Invoice Number:', 20, y + 7);
    doc.text('Order ID:', 20, y + 14);

    doc.text('Payment Mode:', 110, y + 7);
    doc.text('Payment Status:', 110, y + 14);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(80, 80, 80);
    doc.text(invoiceNum, 50, y + 7);
    doc.text(orderId, 50, y + 14);

    doc.text(String(order.paymentMethod || 'Online (Razorpay)').toUpperCase(), 145, y + 7);
    doc.setTextColor(40, 167, 69);
    doc.text(String(order.status || 'PAID').toUpperCase(), 145, y + 14);

    // --- Billing & Shipping ---
    y += 28;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...darkText);
    doc.text('SOLD BY:', 15, y);
    doc.text('BILLED & SHIPPED TO:', 110, y);

    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(80, 80, 80);

    // Store Details
    doc.text(STORE_CONFIG.storeName, 15, y);
    doc.text(STORE_CONFIG.address.line1, 15, y + 4);
    doc.text(`${STORE_CONFIG.address.city}, ${STORE_CONFIG.address.state} - ${STORE_CONFIG.address.pincode}`, 15, y + 8);
    doc.text(`State Code: ${STORE_CONFIG.address.stateCode}`, 15, y + 12);
    doc.text(`Email: ${STORE_CONFIG.contact.email} | Tel: ${STORE_CONFIG.contact.phone}`, 15, y + 16);

    // Customer Details
    const custName = customer.fullName || customer.name || order.customerName || 'Valued Customer';
    const custAddr = customer.street || customer.address || 'Address on file';
    const custCity = `${customer.city || 'Erode'}, ${customer.state || 'Tamil Nadu'} - ${customer.pincode || customer.pin || '638001'}`;
    const custPhone = customer.phone || order.customerPhone || '—';

    doc.text(custName, 110, y);
    doc.text(custAddr.slice(0, 45), 110, y + 4);
    doc.text(custCity, 110, y + 8);
    doc.text(`Phone: ${custPhone}`, 110, y + 12);
    doc.text(`Place of Supply: ${customer.state || 'Tamil Nadu'}`, 110, y + 16);

    // --- Items Table ---
    y += 24;
    doc.setFillColor(...darkBg);
    doc.rect(15, y, 180, 8, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...primaryGold);
    doc.text('#', 18, y + 5.5);
    doc.text('DESCRIPTION OF GOODS', 26, y + 5.5);
    doc.text('HSN', 110, y + 5.5);
    doc.text('QTY', 125, y + 5.5, { align: 'right' });
    doc.text('UNIT (₹)', 148, y + 5.5, { align: 'right' });
    doc.text('GST %', 165, y + 5.5, { align: 'right' });
    doc.text('TOTAL (₹)', 190, y + 5.5, { align: 'right' });

    y += 8;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...darkText);

    items.forEach((item, index) => {
        const itemQty = item.qty || item.quantity || 1;
        const itemPrice = item.price || 0;
        const lineTotal = itemPrice * itemQty;
        const bg = index % 2 === 0 ? 255 : 248;

        doc.setFillColor(bg, bg, bg);
        doc.rect(15, y, 180, 7.5, 'F');
        doc.setDrawColor(230, 230, 230);
        doc.line(15, y + 7.5, 195, y + 7.5);

        doc.text(String(index + 1), 18, y + 5);
        doc.text(String(item.name || 'Gold Covering Jewellery').slice(0, 45), 26, y + 5);
        doc.text(STORE_CONFIG.tax.hsnCode, 110, y + 5);
        doc.text(String(itemQty), 125, y + 5, { align: 'right' });
        doc.text(itemPrice.toLocaleString('en-IN'), 148, y + 5, { align: 'right' });
        doc.text(`${(STORE_CONFIG.tax.gstRate * 100)}%`, 165, y + 5, { align: 'right' });
        doc.text(lineTotal.toLocaleString('en-IN'), 190, y + 5, { align: 'right' });

        y += 7.5;
    });

    // --- Totals Summary Box ---
    y += 4;
    const totalsY = y;
    doc.setDrawColor(220, 220, 220);
    doc.setFillColor(252, 252, 252);
    doc.roundedRect(120, totalsY, 75, 45, 1.5, 1.5, 'FD');

    doc.setFontSize(8);
    doc.setTextColor(80, 80, 80);
    doc.text('Taxable Base (excl. GST):', 124, totalsY + 6);
    doc.text(`₹${taxableBase.toLocaleString('en-IN')}`, 190, totalsY + 6, { align: 'right' });

    doc.text(`CGST (${STORE_CONFIG.tax.cgstRate * 100}%):`, 124, totalsY + 12);
    doc.text(`₹${cgst.toLocaleString('en-IN')}`, 190, totalsY + 12, { align: 'right' });

    doc.text(`SGST (${STORE_CONFIG.tax.sgstRate * 100}%):`, 124, totalsY + 18);
    doc.text(`₹${sgst.toLocaleString('en-IN')}`, 190, totalsY + 18, { align: 'right' });

    if (discount > 0) {
        doc.setTextColor(40, 167, 69);
        doc.text('Coupon Discount:', 124, totalsY + 24);
        doc.text(`- ₹${discount.toLocaleString('en-IN')}`, 190, totalsY + 24, { align: 'right' });
    } else {
        doc.text('Discount:', 124, totalsY + 24);
        doc.text(`₹0`, 190, totalsY + 24, { align: 'right' });
    }

    doc.setTextColor(80, 80, 80);
    doc.text('Delivery & Shipping:', 124, totalsY + 30);
    doc.text(shipping === 0 ? 'FREE' : `₹${shipping}`, 190, totalsY + 30, { align: 'right' });

    // Grand Total Bar
    doc.setFillColor(...darkBg);
    doc.rect(120, totalsY + 34, 75, 11, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...primaryGold);
    doc.text('GRAND TOTAL:', 124, totalsY + 41.5);
    doc.text(`₹${grandTotal.toLocaleString('en-IN')}`, 190, totalsY + 41.5, { align: 'right' });

    // --- Terms & Signature (Left Side) ---
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...darkText);
    doc.text('Declaration & Terms:', 15, totalsY + 6);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 100, 100);
    doc.text('1. Premium gold-covering jewellery with high-grade micro-plating.', 15, totalsY + 11);
    doc.text('2. 1-Year Guarantee on micro gold-plating with care card included.', 15, totalsY + 15);
    doc.text('3. This is a computer-generated tax invoice and requires no physical signature.', 15, totalsY + 19);

    // Signatory Stamp Box
    doc.setDrawColor(214, 178, 94);
    doc.rect(15, totalsY + 25, 65, 20);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...primaryGold);
    doc.text(STORE_CONFIG.storeName.toUpperCase(), 47.5, totalsY + 31, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(120, 120, 120);
    doc.text('Authorised Signatory / Stamp', 47.5, totalsY + 40, { align: 'center' });

    // --- Footer Banner ---
    doc.setFillColor(...darkBg);
    doc.rect(0, 282, 210, 15, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(180, 180, 180);
    doc.text(`Thank you for choosing Kalyan Covering. For support: ${STORE_CONFIG.contact.supportEmail} | ${STORE_CONFIG.contact.phone}`, 105, 290, { align: 'center' });

    // Save PDF
    const filename = `Kalyan_Covering_Invoice_${orderId}.pdf`;
    doc.save(filename);
    return true;
}

window.generateInvoicePDF = generateInvoicePDF;
