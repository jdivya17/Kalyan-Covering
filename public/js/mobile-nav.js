// mobile-nav.js - Mobile navigation & PDP body state management
(function () {
  const p = location.pathname;
  if (!p.includes('/customer/')) return;
  if (p.includes('product-detail')) {
    document.documentElement.classList.add('kc-pdp-page');
    if (document.body) {
      document.body.classList.add('kc-pdp');
    } else {
      document.addEventListener('DOMContentLoaded', () => document.body.classList.add('kc-pdp'));
    }
    return;
  }
  if (/(checkout|auth|order-success|invoice)/.test(p)) return;
})();
