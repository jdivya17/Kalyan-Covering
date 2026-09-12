# Kalyan Covering Codebase Architecture & Migration Plan

## A. Current Architecture
- **Frontend**: Vanilla HTML/CSS/JS bundled with Vite (`public/`). Pages exist in `public/` root as well as subfolders `public/customer/` and `public/admin/`. Shared JS is partially modular in `public/js/` but still heavily relies on a monolithic `public/app.js` (1437 lines) with window-level function attachments.
- **Styling**: `public/css/` contains `design-system.css`, `components.css`, `customer.css`, `admin.css`.
- **Backend Layer**: Firebase Cloud Functions in `functions/index.js` (2672 lines monolithic export file) using Node 18 runtime and Firebase v2 SDK (`onCall`, `onRequest`). Sub-services partially split in `functions/shipping/`, `functions/product/`, `functions/user/`, `functions/payment/`.
- **Database & Storage**: Firestore with collections (`products`, `orders`, `users`, `carts`, `wishlists`, `videos`, `reviews`, `coupons`, `settings`, `audit_logs`). Images/videos managed via Cloudinary and Firebase Storage.
- **Services**: Razorpay for payments (live keys configured via Cloud Functions secrets), Shiprocket for shipping.

---

## B. Target Architecture
```
Kalyan-Covering/
│
├── public/
│   ├── customer/
│   │   ├── index.html
│   │   ├── products.html
│   │   ├── product-detail.html
│   │   ├── cart.html
│   │   ├── wishlist.html
│   │   ├── auth.html
│   │   ├── checkout.html
│   │   ├── order-success.html
│   │   ├── my-orders.html
│   │   ├── order-details.html
│   │   ├── invoice.html
│   │   ├── profile.html
│   │   ├── addresses.html
│   │   └── notifications.html
│   │
│   ├── admin/
│   │   ├── admin-login.html
│   │   ├── dashboard.html
│   │   ├── products.html
│   │   ├── inventory.html
│   │   ├── orders.html
│   │   ├── reviews.html
│   │   ├── users.html
│   │   ├── branches.html
│   │   ├── analytics.html
│   │   ├── notifications.html
│   │   ├── audit-logs.html
│   │   └── settings.html
│   │
│   ├── css/
│   │   ├── design-system.css
│   │   ├── components.css
│   │   ├── customer.css
│   │   └── admin.css
│   │
│   ├── js/
│   │   ├── components/
│   │   │   ├── Navbar.js
│   │   │   ├── Footer.js
│   │   │   ├── ProductCard.js
│   │   │   ├── Modal.js
│   │   │   ├── Loader.js
│   │   │   └── Toast.js
│   │   │
│   │   ├── services/
│   │   │   ├── authService.js
│   │   │   ├── productService.js
│   │   │   ├── cartService.js
│   │   │   ├── wishlistService.js
│   │   │   ├── orderService.js
│   │   │   ├── paymentService.js
│   │   │   ├── shippingService.js
│   │   │   ├── reviewService.js
│   │   │   └── userService.js
│   │   │
│   │   ├── store/
│   │   │   └── state.js
│   │   │
│   │   ├── utils/
│   │   │   ├── cloudinaryUtils.js
│   │   │   ├── validation.js
│   │   │   └── helpers.js
│   │   │
│   │   ├── firebase-config.js
│   │   └── rbac.js
│   │
│   └── 404.html
│
├── functions/
│   ├── index.js
│   ├── user/
│   │   └── userController.js
│   ├── product/
│   │   └── productController.js
│   ├── order/
│   │   └── orderController.js
│   ├── payment/
│   │   └── razorpay.js
│   ├── content/
│   │   └── contentController.js
│   ├── shipping/
│   │   └── shiprocket.js
│   └── utils/
│       ├── auth.js
│       ├── validation.js
│       └── audit.js
│
├── scripts/
│   └── setRole.js
│
├── firestore.rules
├── firestore.indexes.json
├── storage.rules
├── firebase.json
├── vite.config.js
├── .gitignore
└── package.json
```

---

## C. Migration Map

### Frontend Files
- `public/app.js` → split logic into:
  - `public/js/services/productService.js` (Product fetching, caching, search/filter)
  - `public/js/services/authService.js` (Auth state, phone OTP, profile updates)
  - `public/js/services/cartService.js` & `wishlistService.js` (Cart/wishlist mutations)
  - `public/js/components/Toast.js`, `Navbar.js`, `Footer.js`, `ProductCard.js` (UI elements)
  - `public/js/utils/cloudinaryUtils.js` & `helpers.js` (Formatting, Cloudinary, theme)
- Legacy root HTML files (`public/admin.html`, `public/products.html`, `public/checkout.html`, etc.) → Clean up redundant legacy files after redirecting imports to target `public/customer/` and `public/admin/` routes.
- Script references in all `public/customer/*.html` and `public/admin/*.html` → Update imports to load modular `public/js/` services & components cleanly.

### Backend Cloud Functions
- `functions/index.js` monolithic definitions → Modular domain controllers:
  - **Payment**: `createRazorpayOrder`, `verifyPayment`, `razorpayWebhook` → `functions/payment/razorpay.js`
  - **Order**: `createCODOrder`, `updateOrderStatus`, `cancelOrder`, `initiateReturn` → `functions/order/orderController.js`
  - **Product**: `createProduct`, `updateProduct`, `deleteProduct`, `adjustStock` → `functions/product/productController.js`
  - **User**: `onUserCreated`, `setUserRole`, `getUserProfile` → `functions/user/userController.js`
  - **Content**: `submitVideoReview`, `updateTheme`, `getSocialLinks` → `functions/content/contentController.js`
  - **Shipping**: `checkShippingServiceability`, `getShippingCouriers`, `getShipmentTracking` → `functions/shipping/shiprocket.js`
  - **Utils**: `logAudit`, `verifyRole`, `validateAddress` → `functions/utils/`

---

## D. Risk List

> [!WARNING]
> **1. Legacy Global Window Dependencies (`app.js`)**
> HTML files in `public/customer/` and `public/admin/` execute inline `<script>` blocks calling global functions like `window.addToCart`, `window.loadProducts`, `window.Toast`. Refactoring must maintain top-level or window bindings so existing inline handlers do not crash.

> [!WARNING]
> **2. Cloud Function Export Signatures & Names**
> The frontend calls callable Cloud Functions by string name (e.g. `httpsCallable(functions, 'createRazorpayOrder')`). Refactoring `functions/index.js` into domain submodules must export all function names identically from `functions/index.js`.

> [!CAUTION]
> **3. Secrets & Secret Manager Compatibility**
> Production deployment requires Firebase Secret Manager (`defineSecret`). Local development requires fallback handling when secrets are read.

---

## E. Feature Audit & Categorization

| Feature | Category | Notes |
| :--- | :--- | :--- |
| Customer catalog, search, filter, detail view | **Already exists** | Working with sessionStorage caching |
| Cart & Wishlist management | **Already exists** | LocalStorage + Firestore persistence |
| Razorpay Online Payment & COD order creation | **Already exists** | Secure server-side calculation in Cloud Functions |
| Admin Dashboard, Products, Orders, Reviews management | **Already exists** | Functioning under `public/admin/` |
| Video Review submission flow | **Already exists** | Integrated with Cloudinary and Firestore |
| Modular JS services & UI components structure | **Needs refactoring** | Code split across `app.js` and `public/js/`; needs unified import cleanup |
| Cloud Functions monolithic structure | **Needs refactoring** | 2672-line `functions/index.js` needs domain splitting |
| Shiprocket shipment auto-dispatch (`createShipment`) | **Needs implementation** | Tracking/serviceability endpoints exist; creation logic to be completed |
| Automated multi-branch inventory routing | **Future feature** | Reserved for multi-warehouse expansion |

---

## F. Step-by-Step Migration Plan

### Phase 1: Frontend Organization & Entry Alignment
- Verify all HTML files are positioned in `public/customer/` and `public/admin/`.
- Clean up any orphaned legacy root HTML duplicates once target page paths are fully routed.
- Update `vite.config.js` and `firebase.json` rewrites to strictly serve customer and admin paths.

### Phase 2: Shared Component & UI Module Consolidation
- Ensure `Navbar.js`, `Footer.js`, `ProductCard.js`, `Modal.js`, `Loader.js`, and `Toast.js` in `public/js/components/` provide pure, reusable DOM rendering and event handling.
- Include backward-compatible window bindings for existing inline scripts across all customer pages.

### Phase 3: Service Layer Clean-up & `app.js` Decoupling
- Route data calls in HTML views through `public/js/services/` (`productService.js`, `cartService.js`, `orderService.js`, `authService.js`, `paymentService.js`, `shippingService.js`, `reviewService.js`, `userService.js`).
- Refactor `public/app.js` to act solely as a lightweight entry module loading services and components.

### Phase 4: Backend Modularization (`functions/`)
- Extract domain controllers into `functions/user/`, `functions/product/`, `functions/order/`, `functions/payment/`, `functions/content/`, `functions/shipping/`, and `functions/utils/`.
- Re-export all Cloud Functions cleanly from `functions/index.js`.
- Verify Node.js 18 syntax and Firebase Functions v2 `onCall` / `onRequest` handlers compile without error.

### Phase 5: Database & Security Hardening
- Audit `firestore.rules` and `storage.rules` to ensure strict RBAC control for admin vs customer operations.
- Enforce secret management via `defineSecret` across Razorpay and Shiprocket integrations.

### Phase 6: Build & Hosting Verification
- Execute `npm run build` with Vite to ensure 0 bundling errors across all customer and admin pages.
- Verify asset path resolution (`../css/`, `../js/`, `../assets/`).

### Phase 7: End-to-End Functional Verification
- Test customer browsing, cart addition, wishlist toggle, checkout flow, order creation, admin login, and dashboard features.
