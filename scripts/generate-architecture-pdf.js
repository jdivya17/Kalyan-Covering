const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

function generateComprehensiveArchitecturePDF() {
    const outputPath = path.join(__dirname, '..', 'Kalyan_Covering_Architecture_Document.pdf');
    const doc = new PDFDocument({
        margin: 40,
        size: 'A4',
        info: {
            Title: 'Kalyan Covering Store - Master Technical Architecture & AI Developer Specification',
            Author: 'Antigravity AI / Lead Architect',
            Subject: 'Complete System Architecture, Data Schema, Razorpay Security, Bug Audit & AI Handover Guide',
            Keywords: 'E-commerce, Architecture, Razorpay, Firebase, Firestore, Node.js, Vercel, Security'
        }
    });

    const writeStream = fs.createWriteStream(outputPath);
    doc.pipe(writeStream);

    const primaryColor = '#0f172a';   // Deep Slate Navy
    const accentGold = '#b45309';     // Warm Gold / Amber
    const secondaryColor = '#334155'; // Dark Charcoal for readable body
    const lightBg = '#f8fafc';        // Clean container background
    const borderGray = '#cbd5e1';
    const alertBg = '#fef3c7';

    function addHeader(title, category = 'MASTER ARCHITECTURAL SPECIFICATION') {
        doc.fontSize(7.5).fillColor(accentGold).text(category.toUpperCase(), { characterSpacing: 1.2 });
        doc.fontSize(15).fillColor(primaryColor).text(title, { bold: true });
        doc.moveDown(0.2);
        doc.strokeColor(borderGray).lineWidth(0.8).moveTo(40, doc.y).lineTo(555, doc.y).stroke();
        doc.moveDown(0.5);
    }

    function addSectionTitle(title) {
        doc.moveDown(0.4);
        doc.fontSize(11.5).fillColor(primaryColor).text(title, { bold: true });
        doc.moveDown(0.2);
    }

    function addSubSectionTitle(title) {
        doc.moveDown(0.3);
        doc.fontSize(9.5).fillColor(accentGold).text(title, { bold: true });
        doc.moveDown(0.15);
    }

    function addParagraph(text) {
        doc.fontSize(8.5).fillColor(secondaryColor).text(text, { lineGap: 2.2, align: 'justify' });
        doc.moveDown(0.25);
    }

    function addBullet(label, desc) {
        doc.fontSize(8.5).fillColor(primaryColor).text(`• ${label}: `, { continued: true, bold: true });
        doc.fillColor(secondaryColor).text(desc, { lineGap: 2 });
        doc.moveDown(0.15);
    }

    function addBox(title, lines) {
        const startY = doc.y;
        doc.rect(40, startY, 515, (lines.length * 13) + 22).fill(lightBg).stroke(borderGray);
        doc.fillColor(primaryColor).fontSize(9).text(title, 50, startY + 6, { bold: true });
        let currentY = startY + 19;
        lines.forEach(line => {
            doc.fillColor(secondaryColor).fontSize(8).text(line, 50, currentY);
            currentY += 13;
        });
        doc.y = currentY + 6;
    }

    // ==========================================
    // PAGE 1: TITLE BANNER & EXECUTIVE ARCHITECTURE
    // ==========================================
    doc.rect(40, 40, 515, 105).fill('#0f172a');
    doc.fillColor('#fbbf24').fontSize(8.5).text('KALYAN COVERING STORE • TECHNICAL MASTER SPECIFICATION', 55, 55, { characterSpacing: 1.5 });
    doc.fillColor('#ffffff').fontSize(19).text('Enterprise Full-Stack Architecture Blueprint', 55, 70, { bold: true });
    doc.fillColor('#94a3b8').fontSize(9.5).text('Complete Reference for Human Developers & AI Agents (Directory, API, Data Schema, Razorpay, Security)', 55, 95);
    doc.fillColor('#cbd5e1').fontSize(7.5).text(`Document Version: 2.0  |  Date: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}  |  Stack: Vanilla Vite + Express Vercel + Firebase Firestore`, 55, 118);

    doc.y = 160;

    addHeader('1. Executive Architecture & Core Philosophy');
    addParagraph('Kalyan Covering is an Indian high-trust jewelry e-commerce platform specializing in 1-gram gold-plated micro-covering ornaments, bridal sets, rings, and bangles. The application architecture follows a decoupled, high-performance JAMstack design: a lightweight Vanilla JS ES6+ Single Page Application (SPA) bundled via Vite, hosted on Firebase/Vercel Hosting, backed by serverless Express microservices running on Node.js/Vercel Serverless Functions, with Google Cloud Firestore serving as the authoritative transactional database.');

    addSubSectionTitle('Architectural Invariants (Non-Negotiable Rules)');
    addBullet('Zero Client-Side Pricing Trust', 'The frontend NEVER dictates product prices, discounts, or delivery fees. All pricing is recalculated and validated server-side in /api/payments and /api/orders using Firestore as single-source-of-truth.');
    addBullet('Two-Phase Payment Commitment', 'Order insertion requires cryptographic HMAC SHA256 signature verification before any order status changes to PAID.');
    addBullet('Decoupled Modular Styling', 'Vanilla CSS utilizing CSS Custom Properties in design-system.css and components.css. Tailwind or monolithic CSS frameworks are NOT used to maintain fast load times on Indian mobile networks.');

    addSectionTitle('2. System Topology & Request Lifecycle');
    addBox('END-TO-END SYSTEM TOPOLOGY', [
        'Browser Layer:      Mobile/Desktop SPA (public/customer/*, public/admin/dashboard.html) -> Vanilla JS Services',
        'CDN & Assets:       Cloudinary CDN (Product Images, Videos, Reviews) + Static Hosting (Vite / Firebase)',
        'Gateway Layer:      Vercel Serverless API (/api/index.js) -> Express Routers (/server/routes/*)',
        'Security Layer:     Bearer Token Auth (Firebase Admin SDK), RBAC Middleware, Rate Limiting (express-rate-limit)',
        'Database & Auth:    Cloud Firestore (Collections: products, orders, users, coupons, settings) + Firebase Auth',
        'Partner Logistics:  Shiprocket Shipping API (Automated AWB, Pincode Verification, Tracking Updates)',
        'Payment Subsystem:  Razorpay Standard Checkout + Server HMAC SHA256 Verification + Webhooks'
    ]);

    // ==========================================
    // PAGE 2: DIRECTORY STRUCTURE & RESPONSIBILITIES
    // ==========================================
    doc.addPage();
    addHeader('3. Codebase Directory Structure & Responsibilities');

    addParagraph('Any new AI or engineer working on this repository must strictly adhere to the established folder separation to avoid introducing regressions.');

    addBox('DIRECTORY MAP & PURPOSE', [
        'public/                  Frontend root bundled by Vite',
        '  |-- customer/          Storefront pages (index, products, product-detail, cart, checkout, auth, my-orders)',
        '  |-- admin/             Admin portal (admin-login.html, 400KB dashboard.html full-featured admin SPA)',
        '  |-- css/               Design system: design-system.css, components.css, customer.css, admin.css',
        '  |-- js/                Modular ES6 client-side JavaScript architecture',
        '       |-- components/   Reusable UI components (Navbar.js, Footer.js, ProductCard.js, Modal.js, Toast.js)',
        '       |-- services/     Data access layer (authService, productService, cartService, orderService, paymentService)',
        '       |-- store/        Reactive client state manager (state.js: cart, wishlist, auth sync)',
        '       |-- utils/        Utility helpers (cloudinaryUtils.js, validation.js, helpers.js)',
        '       |-- firebase-config.js  Firebase SDK client initialization, AppCheck config, callVercelApi helper',
        '       |-- rbac.js       Client-side role rendering (Customer, Staff, Manager, Owner)',
        'api/index.js             Vercel entrypoint delegating all /api/* requests to Express server',
        'server/                  Backend server code',
        '  |-- lib/               admin.js (Firebase Admin SDK), stock.js (Atomic inventory locks), utils.js',
        '  |-- middleware/        auth.js (verifyIdToken, requireAdmin), rateLimit.js (DDoS prevention)',
        '  |-- routes/            Express routers (payments, orders, products, shipping, admin, invoices, uploads)',
        'scripts/                 Maintenance CLI scripts (check-razorpay-keys.js, generate-architecture-pdf.js)',
        'firestore.rules          Production Firestore security rules governing client vs server permissions'
    ]);

    addSectionTitle('4. Database Schema & Collections (Google Cloud Firestore)');
    addParagraph('All data resides in Firestore document collections with strict schemas:');
    addBullet('products', '{ id, name, price, originalPrice, category, subcategory, stock, images: [], videos: [], specifications: {}, rating, reviewCount, status: "active"|"draft", createdAt }');
    addBullet('orders', '{ orderId, uid, items: [{ productId, name, price, qty, img }], pricing: { subtotal, discount, shipping, tax, total }, address: { fname, lname, phone, address, city, state, pin }, payment: { method: "razorpay"|"cod", status: "PENDING"|"PAID", razorpayOrderId, razorpayPaymentId }, shipping: { awb, courier, status: "ORDER_PLACED"|"SHIPPED"|"DELIVERED" }, createdAt }');
    addBullet('users', '{ uid, email, displayName, phone, role: "customer"|"staff"|"manager"|"owner", addresses: [], defaultAddressId, createdAt }');
    addBullet('coupons', '{ code: "SUMMER10", type: "percent"|"fixed", value: 10, minOrder: 500, maxDiscount: 200, status: "active", expiresAt }');
    addBullet('audit_logs', '{ timestamp, actorUid, actorEmail, action, resource, details: {} }');

    // ==========================================
    // PAGE 3: RAZORPAY PAYMENT & SECURITY WORKFLOW
    // ==========================================
    doc.addPage();
    addHeader('5. Razorpay Payment Architecture & Cryptographic Verification');

    addParagraph('Online payments use Razorpay’s Standard Checkout modal backed by server-side order initiation and HMAC SHA256 cryptographic verification.');

    addSubSectionTitle('Detailed Payment Sequence');
    addBullet('1. Pre-Payment Validation', 'Customer clicks "Place Order" in checkout.html. The client posts items, coupon, and address to POST /api/payments/create-order.');
    addBullet('2. Authoritative Price Resolution', 'The server loads each item from Firestore products collection. It multiplies dbPrice * qty, applies verified coupon discounts from coupons collection, checks pin code serviceability, and computes totalAmount in Paise (INR * 100).');
    addBullet('3. Razorpay Order Creation', 'Server calls Razorpay SDK: rzp.orders.create({ amount: totalAmountInPaise, currency: "INR", receipt: orderId, notes: { uid, orderId } }). The server saves a PENDING order in Firestore and returns the Razorpay orderId to the browser.');
    addBullet('4. Client Checkout Modal', 'Frontend initializes window.Razorpay with key_id, orderId, customer prefill info, and handler callback.');
    addBullet('5. Signature Verification', 'Upon payment completion, Razorpay returns: razorpay_order_id, razorpay_payment_id, and razorpay_signature. Client immediately submits them to POST /api/payments/verify.');
    addBullet('6. Cryptographic HMAC Check', 'Server computes: expectedSignature = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest("hex"). Only if expectedSignature === signature does the server mark order as PAID, decrement inventory atomically via stock.js, and trigger email invoice.');

    addSubSectionTitle('Testing & Sandbox Verification');
    addBullet('Test Key', 'rzp_test_... (Check validity using: npm run check:razorpay)');
    addBullet('Test Card', '4111 1111 1111 1111  |  Expiry: Any Future  |  CVV: 123  |  OTP: 123456');
    addBullet('Test UPI', 'success@razorpay (Simulates instantaneous UPI authorization)');

    addSectionTitle('6. Critical Gotchas & Bug Audit References');
    addParagraph('A full audit was conducted in BUG_REPORT.md. Any engineer or AI modifying code must be aware of:');
    addBullet('API Timeout', 'public/js/firebase-config.js line 101 has a 30s AbortController timeout. Must be adjusted to 60s for slow Indian 4G/3G connections.');
    addBullet('Quick View Modal', 'components.css defines #quick-view-modal but the HTML markup is missing from customer pages. Must be injected via DOM.');
    addBullet('Size Guide Modal', 'product-detail.html uses modal.classList.add("on"), whereas CSS listens to .modal.open.');

    // ==========================================
    // PAGE 4: PRODUCTION READINESS & AI HANDOVER
    // ==========================================
    doc.addPage();
    addHeader('7. Production Standards & AI Developer Handover');

    addParagraph('This section provides the master prompt and operational rules for any new AI model tasked with maintaining, extending, or fixing Kalyan Covering.');

    addBox('AI ONBOARDING PROMPT & SYSTEM CONTEXT', [
        'AI CONTEXT DIRECTIVE:',
        '"You are the lead full-stack engineer for Kalyan Covering (https://kalyancoveringstore-c53e4.web.app).',
        'Repository Structure: Vanilla HTML/JS frontend in public/, Express backend in server/, DB is Cloud Firestore.',
        'Core Rules:',
        '1. Maintain Vanilla CSS (design-system.css, components.css). Do NOT introduce Tailwind or large frameworks.',
        '2. Never trust client prices: all financial calculations must be handled in server/routes/payments.js.',
        '3. Preserve DOM IDs and existing class conventions (.modal.open, .toast, .btn-primary).',
        '4. All sensitive operations (inventory updates, order cancellations, refunds) must run through server APIs.',
        '5. Adhere to BUG_REPORT.md and implementation_plan.md for all pending fixes."'
    ]);

    addSubSectionTitle('Production Launch Checklist');
    addBullet('Mandatory Policy Pages', 'Privacy Policy, Terms of Service, Shipping & Delivery Policy, Return & Refund Policy (Required for Razorpay Live Gateway Approval).');
    addBullet('Contact Information', 'Display GSTIN number, physical store address, customer service phone, and grievance officer email.');
    addBullet('Webhooks Implementation', 'Configure POST /api/payments/webhook with Razorpay Webhook Secret on Vercel to capture dropped client sessions.');
    addBullet('SEO & OpenGraph', 'Implement meta tags on customer pages for dynamic WhatsApp / Facebook sharing previews with image and price.');
    addBullet('Monitoring & Logs', 'Configure Sentry for client/server error tracking and SonarLint for ongoing static analysis.');

    doc.end();

    writeStream.on('finish', () => {
        console.log(`[Comprehensive Architecture PDF] Successfully written to: ${outputPath}`);
    });
}

generateComprehensiveArchitecturePDF();
