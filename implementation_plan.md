# PHASE 1 — BASELINE AUDIT

## Architecture Map
The application is a serverless e-commerce platform built on Firebase.
- **Frontend**: Vanilla HTML/CSS/JS (Vite for dev)
- **Backend**: Firebase Cloud Functions (Node.js 18)
- **Database**: Firestore (NoSQL)
- **Storage**: Firebase Storage (via Cloudinary for optimization in frontend)
- **Authentication**: Firebase Authentication
- **Payment**: Razorpay (Integration via Cloud Functions)
- **Shipping**: Shiprocket (Partial integration, API endpoints present but missing shipment creation)
- **Admin**: Dedicated admin HTML UI (`admin.html`, `admin-login.html`)
- **Deployment**: Firebase Hosting & Firebase Functions

## Dependency Map
- **Frontend Dependencies**: Firebase Web SDK v10.14.1 (Auth, Firestore, App Check)
- **Backend Dependencies**: `firebase-admin`, `firebase-functions`, `razorpay`, `pdfkit`, `nodemailer`, `axios`, `cors`
- **External Services**: Razorpay API, Shiprocket API, Cloudinary (via frontend script)

## Entry Points
- **Customer Facing**: `index.html`, `products.html`, `product-detail.html`, `checkout.html`, `profile.html`, `auth.html`, `my-orders.html`, `wishlist.html`
- **Admin Facing**: `admin.html`, `admin-login.html`
- **Backend Webhook**: `/razorpayWebhook` (Cloud Function)

## Important Files
- **Security Rules**: `firestore.rules`, `storage.rules`
- **Frontend Core**: `public/app.js` (init, cart, auth, ui logic), `public/rbac.js` (Role Based Access Control)
- **Backend Core**: `functions/index.js` (Payment, Order, Coupon, Product, Auth logic)
- **Configuration**: `functions/.env` (Contains sensitive credentials)

## Important Functions (Cloud Functions)
- **Payment & Orders**: `createRazorpayOrder`, `verifyPayment`, `razorpayWebhook`, `updateOrderStatus`, `cancelOrder`, `initiateReturn`
- **Catalog**: `createProduct`, `updateProduct`, `deleteProduct`, `adjustStock`
- **Coupons**: `createCoupon`, `updateCoupon`, `deleteCoupon`, `validateCoupon`
- **Invoices & Notifications**: `generateInvoice`, `emailInvoice`, `sendNotification`
- **Shipping (Shiprocket)**: `checkShippingServiceability`, `getShippingCouriers`, `getShipmentTracking`, `getShiprocketPickupLocations` *(Note: `createShipment` is currently missing)*

## Database Collections
`users`, `products`, `carts`, `orders`, `categories`, `brands`, `branches`, `settings`, `config`, `videos`, `coupons`, `reviews`, `wishlists`, `notifications`, `audit_logs`, `inventory_history`, `invoices`.

## API Integrations
- **Razorpay**: Used for creating payment orders and verifying payments via HMAC signature.
- **Shiprocket**: Used for fetching couriers, tracking, and serviceability (using `SHIPROCKET_EMAIL` and `SHIPROCKET_PASSWORD` from `.env`).

## Authentication Flow
Customers and Admins authenticate via Firebase Auth. The frontend listens to auth state changes in `app.js` and `rbac.js`. Custom claims are likely used for role-based access control (`owner`, `manager`, `staff`), as seen in `firestore.rules` (`request.auth.token.role`).

## Admin Flow
Admins log in via `admin-login.html` and are redirected to `admin.html`. The admin dashboard relies on Cloud Functions to perform secure writes (e.g., `createProduct`, `updateOrderStatus`, `createCoupon`), which validate the admin role via `request.auth.token.role`.

## Payment Flow
1. Customer initiates checkout from `checkout.html`.
2. Frontend calls `createRazorpayOrder` Cloud Function with cart items.
3. Backend fetches real product prices from Firestore, calculates the true total, and creates a Razorpay order.
4. Razorpay UI opens on the frontend.
5. On success, frontend calls `verifyPayment` with the signature.
6. Backend verifies the HMAC signature, updates the `orders` document to `paid`, and deducts stock in a secure transaction.
7. `razorpayWebhook` serves as a fallback to capture payments if the frontend disconnects.

## Shipping Flow
Currently, the shipping flow is incomplete. The backend provides endpoints to check serviceability and tracking, but the actual logic to push an order to Shiprocket and generate an AWB (`createShipment`) is missing. 

---

> [!CAUTION]
> **CRITICAL SECURITY FINDING (Phase 2 Preview)**
> The file `functions/.env` contains **LIVE Razorpay credentials** (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`) and was committed to the Git repository.
> **Action Required**: These secrets are COMPROMISED. They must be immediately rotated in the Razorpay dashboard, removed from Git history (or replaced in the repository), and securely provisioned using Firebase Secret Manager.

---

---

# PHASE 2 — SECURITY HARDENING

## 1. Inspect Existing Code
I have audited the repository for secrets, hardcoded credentials, and security misconfigurations.
- **`.env` file**: `functions/.env` contained live Razorpay keys (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`) and Shiprocket credentials (`SHIPROCKET_EMAIL`, `SHIPROCKET_PASSWORD`).
- **Git History**: `rzp-key.csv` was previously committed but has been deleted.
- **Frontend Code**: `checkout.html` contains the public `rzp_live_Skw8XRBEaJDquK` key, which is safe and intended for client-side use. No backend secrets (like `RAZORPAY_KEY_SECRET`) were found in the frontend.
- **Admin Credentials**: `admin-login.html` uses Firebase Authentication with a secure UI. No hardcoded admin passwords exist in the codebase.
- **Firebase App Check**: Implemented in `app.js` but missing a real ReCAPTCHA v3 site key (`INSERT_YOUR_REAL_RECAPTCHA_V3_SITE_KEY_HERE`).

## 2. Explain What is Wrong
- **Compromised Secrets**: The live Razorpay and Shiprocket secrets were committed to the Git repository in `functions/.env`.
- **Insecure Secret Storage**: Relying on `.env` files in source control for production secrets is an unsafe practice.
- **Missing App Check Key**: App Check cannot function without a valid ReCAPTCHA key.

## 3. Explain Why it Matters
- Anyone with access to the Git repository history can view the Razorpay secret. With this secret, an attacker could manipulate payments, issue unauthorized refunds, or access sensitive customer financial data.
- Shiprocket credentials could be used to manipulate shipments or incur fraudulent shipping charges.

## 4. Propose the Fix
1. **Rotate Credentials (Action Required by You)**: The compromised Razorpay keys and Shiprocket password must be rotated immediately in their respective dashboards.
2. **Remove Unsafe Usage**: Remove the live secrets from `functions/.env` and replace them with safe placeholders. (I have already done this step).
3. **Configure Secure Secret Storage**: We will migrate the Cloud Functions to use Firebase Secret Manager (`defineSecret` from `firebase-functions/params`). This ensures secrets are securely injected at runtime and never stored in code.
4. **Firebase App Check**: We will note the missing ReCAPTCHA key so it can be added to the production environment before final deployment.

## 5. Implementation Plan for Phase 2
- Refactor `functions/index.js` to use `defineSecret` for `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`.
- Update `createRazorpayOrder`, `verifyPayment`, and `razorpayWebhook` to dynamically load the secrets at execution time instead of relying on global variables.
- Refactor `functions/shipping/shiprocketClient.js` to use `defineSecret` for Shiprocket credentials.
- Test the Cloud Functions compilation to ensure no regressions.

## User Review Required
I have already safely removed the secrets from `functions/.env`. 
Do you approve the proposed migration to **Firebase Secret Manager** (`defineSecret`) for the Cloud Functions? Once approved, I will implement these changes.
