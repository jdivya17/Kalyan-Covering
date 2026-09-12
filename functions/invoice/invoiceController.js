"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { admin, db } = require("../lib/admin");
const PDFDocument = require("pdfkit");
const nodemailer = require("nodemailer");

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** v2-compatible auth check. Throws HttpsError if not authenticated. */
function requireAuth(request) {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Authentication required.");
    }
    return request.auth;
}

/** v2-compatible staff check. Allowed roles: owner | manager | staff */
function requireStaff(request) {
    const auth = requireAuth(request);
    const role = (auth.token && auth.token.role) || "";
    if (!["owner", "manager", "staff"].includes(role)) {
        throw new HttpsError("permission-denied", "Staff privileges required.");
    }
    return auth;
}

/** Build a professional A4 PDF invoice, return base64 string. */
function buildInvoicePDF(inv) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 50, size: "A4" });
            const buffers = [];
            doc.on("data", (c) => buffers.push(c));
            doc.on("end", () => resolve(Buffer.concat(buffers).toString("base64")));
            doc.on("error", reject);

            const GOLD = "#C9A84C";
            const DARK = "#111111";
            const GREY = "#F5F5F5";

            // ── Dark Header ────────────────────────────────────────────────────
            doc.rect(0, 0, 595, 90).fill(DARK);
            doc.fillColor(GOLD).font("Helvetica-Bold").fontSize(22)
               .text("KALYAN COVERING", 50, 25);
            doc.fillColor("#FFFFFF").font("Helvetica").fontSize(10)
               .text("Premium Car Seat Covers | Kanyakumari District", 50, 52);
            doc.fillColor(GOLD).font("Helvetica-Bold").fontSize(22)
               .text("TAX INVOICE", 395, 30, { width: 150, align: "right" });

            // ── Invoice Meta (left) ────────────────────────────────────────────
            doc.fillColor(DARK).font("Helvetica-Bold").fontSize(10)
               .text("Invoice Details", 50, 108);
            doc.moveTo(50, 121).lineTo(280, 121).strokeColor(GOLD).lineWidth(1).stroke();

            const metaLines = [
                ["Invoice No", inv.invoiceNumber || "-"],
                ["Order No",   inv.orderNumber   || "-"],
                ["Date",       inv.dateStr        || new Date().toLocaleDateString("en-IN")],
                ["Payment",   (inv.paymentMethod || "Online").toUpperCase()],
                ["Status",     inv.orderStatus   || "Confirmed"]
            ];
            let my = 128;
            metaLines.forEach(([label, value]) => {
                doc.fillColor("#555").font("Helvetica").fontSize(9)
                   .text(label + " : ", 50, my, { continued: true })
                   .font("Helvetica-Bold").fillColor(DARK).text(value);
                my += 14;
            });

            // ── Bill To (right) ────────────────────────────────────────────────
            doc.fillColor(DARK).font("Helvetica-Bold").fontSize(10)
               .text("Bill To", 320, 108);
            doc.moveTo(320, 121).lineTo(545, 121).strokeColor(GOLD).lineWidth(1).stroke();

            let by = 128;
            const billLines = [
                inv.customerName  || "Customer",
                inv.customerEmail || "",
                inv.customerPhone || "",
                inv.shippingAddress || ""
            ].filter(Boolean);
            billLines.forEach((line) => {
                doc.fillColor("#333").font("Helvetica").fontSize(9)
                   .text(line, 320, by, { width: 225 });
                by += 14;
            });

            // ── Items Table ────────────────────────────────────────────────────
            const TBL_TOP = Math.max(my, by) + 20;
            doc.rect(50, TBL_TOP, 495, 20).fill(DARK);
            doc.fillColor("#FFF").font("Helvetica-Bold").fontSize(9);
            doc.text("Item / Description", 55, TBL_TOP + 6);
            doc.text("Qty",        340, TBL_TOP + 6, { width: 40,  align: "center" });
            doc.text("Unit Price", 385, TBL_TOP + 6, { width: 70,  align: "right"  });
            doc.text("Total",      460, TBL_TOP + 6, { width: 80,  align: "right"  });

            let iy = TBL_TOP + 24;
            const items = inv.items || [];
            doc.font("Helvetica").fontSize(9);
            items.forEach((item, i) => {
                if (i % 2 === 0) doc.rect(50, iy - 3, 495, 18).fill(GREY);
                doc.fillColor("#333");
                const lineTotal = (item.price || 0) * (item.quantity || 1);
                doc.text(item.name || "Product",                            55,  iy, { width: 280 });
                doc.text(String(item.quantity || 1),                       340,  iy, { width: 40,  align: "center" });
                doc.text(`Rs.${(item.price || 0).toLocaleString("en-IN")}`,385,  iy, { width: 70,  align: "right"  });
                doc.text(`Rs.${lineTotal.toLocaleString("en-IN")}`,        460,  iy, { width: 80,  align: "right"  });
                iy += 20;
            });
            if (items.length === 0) {
                doc.fillColor("#999").text("No items", 55, iy);
                iy += 20;
            }

            // ── Totals Block ───────────────────────────────────────────────────
            iy += 12;
            doc.moveTo(350, iy).lineTo(545, iy).strokeColor("#DDD").lineWidth(0.5).stroke();
            iy += 8;

            const subtotal   = inv.subtotal   || inv.grandTotal || 0;
            const cgst       = inv.cgst       || 0;
            const sgst       = inv.sgst       || 0;
            const grandTotal = inv.grandTotal || 0;
            const discount   = inv.discount   || 0;

            doc.font("Helvetica").fontSize(9).fillColor("#333");
            const addRow = (label, value) => {
                doc.text(label, 350, iy, { width: 105, align: "right" });
                doc.text(value, 460, iy, { width: 80,  align: "right" });
                iy += 16;
            };
            if (discount > 0) addRow("Discount:",  `-Rs.${discount.toLocaleString("en-IN")}`);
            addRow("Subtotal:",  `Rs.${subtotal.toLocaleString("en-IN")}`);
            addRow("CGST (9%):", `Rs.${cgst.toLocaleString("en-IN")}`);
            addRow("SGST (9%):", `Rs.${sgst.toLocaleString("en-IN")}`);

            iy += 4;
            doc.rect(350, iy, 195, 24).fill(DARK);
            doc.fillColor(GOLD).font("Helvetica-Bold").fontSize(10);
            doc.text("Grand Total:", 355, iy + 7, { width: 100, align: "right" });
            doc.text(`Rs.${grandTotal.toLocaleString("en-IN")}`, 460, iy + 7, { width: 80, align: "right" });

            // ── Footer ─────────────────────────────────────────────────────────
            iy += 46;
            doc.moveTo(50, iy).lineTo(545, iy).strokeColor(GOLD).lineWidth(0.5).stroke();
            iy += 8;
            doc.fillColor("#888").font("Helvetica").fontSize(8)
               .text("Thank you for choosing Kalyan Covering! Queries: kalyancoveringstore@gmail.com",
                     50, iy, { align: "center", width: 495 });
            doc.text("This is a computer-generated invoice and does not require a signature.",
                     50, iy + 12, { align: "center", width: 495 });

            doc.end();
        } catch (e) {
            reject(e);
        }
    });
}

/** Build invoice data object from an order document. */
function invoiceDataFromOrder(order, orderId, invoiceNumber) {
    const grandTotal = order.grandTotal || order.totalAmount || 0;
    const subtotal   = order.subtotal   || grandTotal;
    const cgst       = order.cgst  || Math.round(subtotal * 0.09 * 100) / 100;
    const sgst       = order.sgst  || Math.round(subtotal * 0.09 * 100) / 100;
    const shippingAddress = order.shippingAddress
        ? (typeof order.shippingAddress === "string"
            ? order.shippingAddress
            : [order.shippingAddress.line1, order.shippingAddress.city,
               order.shippingAddress.state, order.shippingAddress.pincode]
                  .filter(Boolean).join(", "))
        : "";
    return {
        invoiceNumber,
        orderNumber:     order.orderNumber   || orderId,
        customerName:    order.customerName  || order.userName  || "",
        customerEmail:   order.customerEmail || order.userEmail || "",
        customerPhone:   order.customerPhone || order.userPhone || "",
        shippingAddress,
        items:           order.items  || [],
        subtotal,
        cgst,
        sgst,
        totalGst:        cgst + sgst,
        grandTotal,
        discount:        order.discount      || 0,
        paymentMethod:   order.paymentMethod || "razorpay",
        orderStatus:     order.status || order.orderStatus || "Confirmed",
        dateStr: new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
    };
}

/** Save an invoice doc to Firestore and link it to the order. */
async function saveInvoice(invData, orderId, customerId, pdfBase64) {
    const doc = {
        ...invData,
        orderId,
        customerId,
        pdfBase64,
        emailedAt: null,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
    };
    const ref = await db.collection("invoices").add(doc);
    await db.collection("orders").doc(orderId).update({ invoiceId: ref.id }).catch(() => {});
    return ref;
}

/** Create nodemailer transporter (SMTP creds from Firebase Secret env vars). */
function getTransporter() {
    return nodemailer.createTransport({
        host: process.env.SMTP_HOST || "smtp.gmail.com",
        port: parseInt(process.env.SMTP_PORT || "587"),
        secure: process.env.SMTP_SECURE === "true",
        auth: {
            user: process.env.SMTP_USER || "kalyancoveringstore@gmail.com",
            pass: process.env.SMTP_PASS || ""
        }
    });
}

// ─── Cloud Functions ───────────────────────────────────────────────────────────

/**
 * generateInvoice
 * Generates (or returns cached) PDF invoice for an order.
 * Returns: { success, invoiceNumber, orderNumber, pdfBase64 }
 */
const generateInvoice = onCall(async (request) => {
    requireAuth(request);
    const { orderId } = request.data || {};
    if (!orderId) throw new HttpsError("invalid-argument", "orderId is required.");

    const orderSnap = await db.collection("orders").doc(orderId).get();
    if (!orderSnap.exists) throw new HttpsError("not-found", "Order not found.");
    const order = orderSnap.data();

    // Access control
    const role = (request.auth.token && request.auth.token.role) || "";
    const isStaff = ["owner", "manager", "staff"].includes(role);
    if (!isStaff && order.customerId !== request.auth.uid) {
        throw new HttpsError("permission-denied", "Access denied.");
    }

    // Return cached invoice PDF if available
    const cached = await db.collection("invoices")
        .where("orderId", "==", orderId).limit(1).get();
    if (!cached.empty) {
        const d = cached.docs[0].data();
        return {
            success: true,
            invoiceNumber: d.invoiceNumber,
            orderNumber:   d.orderNumber || order.orderNumber,
            pdfBase64:     d.pdfBase64
        };
    }

    // Generate new invoice
    const invoiceNumber = `INV-${Date.now()}`;
    const invData = invoiceDataFromOrder(order, orderId, invoiceNumber);
    const pdfBase64 = await buildInvoicePDF(invData);
    await saveInvoice(invData, orderId, order.customerId, pdfBase64);

    return { success: true, invoiceNumber, orderNumber: invData.orderNumber, pdfBase64 };
});

/**
 * emailInvoice
 * Sends the invoice PDF to the customer via email.
 * Requires staff role.
 */
const emailInvoice = onCall(async (request) => {
    requireStaff(request);
    const { orderId, invoiceId } = request.data || {};
    if (!orderId) throw new HttpsError("invalid-argument", "orderId is required.");

    const orderSnap = await db.collection("orders").doc(orderId).get();
    if (!orderSnap.exists) throw new HttpsError("not-found", "Order not found.");
    const order = orderSnap.data();

    const toEmail = order.customerEmail || order.userEmail || "";
    if (!toEmail) throw new HttpsError("invalid-argument", "No customer email found on this order.");

    let pdfBase64, invoiceNumber, invRef;

    // 1. Try specific invoiceId
    if (invoiceId) {
        const snap = await db.collection("invoices").doc(invoiceId).get();
        if (snap.exists) {
            pdfBase64 = snap.data().pdfBase64;
            invoiceNumber = snap.data().invoiceNumber;
            invRef = snap.ref;
        }
    }

    // 2. Try by orderId
    if (!pdfBase64) {
        const snap = await db.collection("invoices")
            .where("orderId", "==", orderId).limit(1).get();
        if (!snap.empty) {
            pdfBase64 = snap.docs[0].data().pdfBase64;
            invoiceNumber = snap.docs[0].data().invoiceNumber;
            invRef = snap.docs[0].ref;
        }
    }

    // 3. Generate fresh
    if (!pdfBase64) {
        invoiceNumber = `INV-${Date.now()}`;
        const invData = invoiceDataFromOrder(order, orderId, invoiceNumber);
        pdfBase64 = await buildInvoicePDF(invData);
        invRef = await saveInvoice(invData, orderId, order.customerId, pdfBase64);
    }

    const fromEmail = process.env.SMTP_USER || "kalyancoveringstore@gmail.com";
    await getTransporter().sendMail({
        from: `"Kalyan Covering" <${fromEmail}>`,
        to: toEmail,
        subject: `🧾 Your Invoice ${invoiceNumber} – Kalyan Covering`,
        html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fafafa;border:1px solid #e0e0e0;border-radius:8px;overflow:hidden">
                <div style="background:#111;padding:20px;text-align:center">
                    <h1 style="margin:0;color:#FFD700;font-size:24px">KALYAN COVERING</h1>
                    <p style="margin:5px 0 0;color:#fff;font-size:14px">Your Invoice is Ready</p>
                </div>
                <div style="padding:24px;background:#fff">
                    <p style="color:#333">Hi ${order.customerName || order.userName || "Customer"},</p>
                    <p style="color:#666;line-height:1.6">
                        Please find your invoice <strong>${invoiceNumber}</strong> attached.<br>
                        Order: <strong>${order.orderNumber || orderId}</strong><br>
                        Amount Paid: <strong>&#8377;${(order.grandTotal || order.totalAmount || 0).toLocaleString("en-IN")}</strong>
                    </p>
                    <p style="color:#888;font-size:12px;margin-top:24px">
                        Questions? Email us: kalyancoveringstore@gmail.com
                    </p>
                </div>
            </div>`,
        attachments: [{
            filename: `${invoiceNumber}.pdf`,
            content: Buffer.from(pdfBase64, "base64"),
            contentType: "application/pdf"
        }]
    });

    if (invRef) {
        await invRef.update({ emailedAt: admin.firestore.FieldValue.serverTimestamp() }).catch(() => {});
    }

    return { success: true, message: `Invoice ${invoiceNumber} emailed to ${toEmail}` };
});

/**
 * getMyInvoices
 * Returns all invoices belonging to the logged-in customer (no PDF payload).
 */
const getMyInvoices = onCall(async (request) => {
    requireAuth(request);
    const snap = await db.collection("invoices")
        .where("customerId", "==", request.auth.uid)
        .orderBy("createdAt", "desc")
        .get();

    const invoices = snap.docs.map((d) => {
        const data = d.data();
        return {
            id: d.id,
            invoiceNumber:  data.invoiceNumber  || "",
            orderNumber:    data.orderNumber    || "",
            orderId:        data.orderId        || "",
            grandTotal:     data.grandTotal     || 0,
            paymentMethod:  data.paymentMethod  || "",
            orderStatus:    data.orderStatus    || "",
            createdAt:      data.createdAt      || null
        };
    });
    return { success: true, invoices };
});

/**
 * getInvoices — Admin only.
 * Fetches from `invoices` collection (NOT orders). Returns all fields the
 * admin dashboard table needs. Supports cursor-based pagination.
 */
const getInvoices = onCall(async (request) => {
    requireStaff(request);
    const { limit = 20, startAfterDate } = request.data || {};

    let query = db.collection("invoices")
        .orderBy("createdAt", "desc")
        .limit(limit);

    if (startAfterDate) {
        const ts = startAfterDate.seconds
            ? new admin.firestore.Timestamp(
                  startAfterDate.seconds,
                  startAfterDate.nanoseconds || 0)
            : admin.firestore.Timestamp.fromDate(new Date(startAfterDate));
        query = query.startAfter(ts);
    }

    const snap = await query.get();
    const invoices = snap.docs.map((d) => {
        const data = d.data();
        return {
            id:            d.id,
            invoiceNumber: data.invoiceNumber  || "",
            orderNumber:   data.orderNumber    || "",
            orderId:       data.orderId        || "",
            customerId:    data.customerId     || "",
            customerName:  data.customerName   || "",
            customerEmail: data.customerEmail  || "",
            customerPhone: data.customerPhone  || "",
            grandTotal:    data.grandTotal     || 0,
            subtotal:      data.subtotal       || 0,
            cgst:          data.cgst           || 0,
            sgst:          data.sgst           || 0,
            totalGst:      data.totalGst       || 0,
            discount:      data.discount       || 0,
            paymentMethod: data.paymentMethod  || "",
            orderStatus:   data.orderStatus    || "",
            emailedAt:     data.emailedAt      || null,
            createdAt:     data.createdAt      || null
            // pdfBase64 excluded intentionally — keep response small
        };
    });

    return { success: true, invoices };
});

module.exports = {
    generateInvoice,
    emailInvoice,
    getMyInvoices,
    getInvoices
};
