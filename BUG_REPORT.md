# Kalyan Covering — Comprehensive Bug Audit Report

This report presents a full, non-destructive audit of the Kalyan Covering e-commerce platform (Customer Storefront and Admin Panel). The audit covers static code analysis, event handler integrity, DOM structure, navigation routing, API/backend timeout parameters, and mobile/desktop interaction patterns. **No code, layout, or styling modifications were performed during this audit.**

---

### Audit Summary & Severity Breakdown

- **Total Issues Identified**: 13
- **Blocker Issues**: 1
- **Major Issues**: 7
- **Minor Issues**: 5

#### Untested Elements & Justification
- **Live Razorpay Real Money Transactions**: Full payment completion via real UPI/Debit Card was tested against gateway initialization & order payload structure; real money deduction was not executed to prevent actual monetary charges.
- **Production App Check Recaptcha Tokens**: App Check initialization is bypassed on `localhost` (by design) to prevent local dev token blocks; live Recaptcha V3 token validation requires testing on the deployed `https://kalyancoveringstore-c53e4.web.app` domain.

---

## 1. Customer Site Audit

| # | Page | Element / action | Steps to reproduce | Expected | Actual | Severity | Likely cause (file/line if you can tell) |
|---|------|-------------------|---------------------|----------|--------|----------|-------------------------------------------|
| 1 | Home / Shop / Search | Quick View button on Product Cards | Click "Quick View" button on any product card across home, shop, or wishlist pages. | Opens Quick View Modal with product images, pricing, description, and Add to Bag button. | Nothing happens visually. The function returns silently. | **Major** | `public/js/app.js:1005` references `#quick-view-modal` which is defined in CSS (`components.css:121`) but missing from HTML DOM templates. |
| 2 | Product Detail | Size Guide button for Ring category | Open `product-detail.html?id=...` for a ring product, click "Size Guide". | Size Guide Modal opens showing ring sizing measurement guide. | Nothing appears on screen. | **Major** | `public/customer/product-detail.html:893` executes `modal.classList.add('on')`, but CSS rules rely on `.modal.open` to show modals. |
| 3 | Video Pages (`video-display.html`, `video-upload.html`) | Header navigation links ("Shop", "Checkout") | Click "Shop" or "Checkout" links in top navigation bar of video pages. | Navigates to `/customer/products.html` and `/customer/checkout.html`. | Browser attempts to navigate to non-existent `/products.html` or `/checkout.html`, resulting in HTTP 404 error. | **Minor** | `public/video-display.html` & `public/video-upload.html` use relative hrefs `products.html` instead of `customer/products.html`. |
| 4 | Product Detail | Review Submission with Photo Upload | Fill out review form, attach a photo, and click "Submit Review". | Photo is compressed, uploaded to Cloudinary, and review appears under customer reviews. | Fails silently or returns error if Cloudinary upload preset (`kalyan_reviews`) is unconfigured in Cloudinary environment. | **Major** | `public/js/utils/cloudinaryUtils.js` depends on unsigned Cloudinary upload preset matching backend configuration. |
| 5 | Checkout | Place Order Securely (COD / Online) | Fill checkout form, click "Place Order Securely" on slow network connection (> 4s latency). | Order request reaches API and returns order ID or payment modal. | Order placement fails with error: `API request to /api/... timed out after 4s`. | **Blocker** | `public/js/firebase-config.js:100` enforces an aggressive 4-second `AbortController` timeout on all `callVercelApi` calls. |
| 6 | My Orders / Order Details | Cancel Order / Return Request buttons | Click "Cancel Order" or "Return Request" on an existing order. | Opens confirmation modal and sends cancellation/return request to Firestore. | Buttons trigger alert toast or log console stub without persisting updated status to Firestore. | **Major** | `public/js/services/orderService.js` contains client-side stub methods for customer order cancellations and returns. |
| 7 | Root Entry (`/index.html`) | Domain Root Navigation | Navigate to `http://localhost:5173/` or root domain `/`. | Instant canonical redirect to `/customer/index.html`. | Brief white flash occurs while client JS executes `window.location.replace('/customer/index.html')`. | **Minor** | `public/index.html` relies solely on client-side JS redirect without server rewrite or HTML meta refresh fallback. |

---

## 2. Admin Panel Audit

| # | Page | Element / action | Steps to reproduce | Expected | Actual | Severity | Likely cause (file/line if you can tell) |
|---|------|-------------------|---------------------|----------|--------|----------|-------------------------------------------|
| 8 | Dashboard (`dashboard.html`) | Dashboard Stat Cards (Revenue, Orders, Products, Users) | Open `dashboard.html` via cold page load (direct URL entry). | Live statistics rendered dynamically from Firestore collections. | Shows hardcoded default fallback values (e.g. ₹1,48,500) before Firestore query resolves. | **Major** | `public/admin/dashboard.html` stat cards contain hardcoded default text without initial loading skeleton states. |
| 9 | Admin Products | "Bulk Upload" CSV button | Click "Bulk Upload" button in Products section toolbar. | Opens CSV file upload drawer to import bulk product inventory. | Displays toast: `Bulk Upload: CSV bulk upload feature coming soon.` | **Major** | `public/admin/dashboard.html:3387` defines `openBulkUploadDrawer` as a stub function displaying a coming-soon toast. |
| 10 | Admin Orders | "Export" Orders button | Click "Export" button in Orders toolbar. | Exports CSV file or opens order export options drawer. | Displays toast: `Export Orders: Order export feature coming soon.` | **Minor** | `public/admin/dashboard.html:3391` defines `openOrderExportDrawer` as a stub function displaying a coming-soon toast. |
| 11 | Admin Product Modal | Product Video Upload | Click "Upload Video" in Add/Edit product modal, select `.mp4` file. | Video uploads to Cloudinary and embeds video URL in product document. | Fails if unsigned Cloudinary video preset (`kalyan_videos`) is missing or file exceeds max size limit without progress bar. | **Major** | `public/js/utils/cloudinaryUtils.js` requires specific unsigned video upload preset configured in Cloudinary. |
| 12 | Admin Settings | Staff Roles & Permissions (RBAC) | Create or edit staff user role (e.g. Stock Manager). | Role persisted in Firebase Auth custom claims / Firestore with security rule enforcement. | Role stored in client-side `localStorage`/`sessionStorage` (`kc_rbac_role`), which can be modified via browser console. | **Major** | `public/js/rbac.js` handles role validation strictly on the client side without backend Firebase Security Rules enforcement. |
| 13 | Dashboard Mobile View | Mobile FAB (+ Add Product) Overlay | Open admin panel on mobile screen width (714x706), view detail drawer. | Detail drawer actions rendered clearly above screen elements. | Mobile floating quick action button (`#mobile-fab-add-product`) z-index overlaps bottom section of drawers. | **Minor** | `public/admin/dashboard.html:6364` floating action button has fixed z-index overlapping drawer footer controls on small screens. |

---

### Audit Conclusion & Recommended Next Steps

1. **Prompt 1 Complete**: The audit is finished and documented in `BUG_REPORT.md`.
2. **Zero Fixes Applied**: All code and files remain untouched in accordance with Prompt 1 instructions.
3. **Ready for Prompt 2**: We can proceed to fix these bugs whenever you provide Prompt 2.
