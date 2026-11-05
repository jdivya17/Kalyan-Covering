/**
 * shellInit.js — Kalyan Covering
 * Mounts the Global Shell (Header, Mega Menu, Drawers, Mobile Tabs, WhatsApp, Footer)
 * on all customer pages.
 */

import { renderHeader } from '../components/Header.js';
import { renderFooter } from '../components/Footer.js';
import { KC } from '../store/state.js';
import { Cart } from '../services/cartService.js';
import { Wishlist } from '../services/wishlistService.js';

export function initGlobalShell() {

  // Mount Header
  const headerContainer = document.getElementById('global-header') || document.querySelector('header') || document.querySelector('nav.nav');
  if (headerContainer) {
    const wrapper = document.createElement('div');
    wrapper.id = 'global-header-wrapper';
    wrapper.innerHTML = renderHeader();
    headerContainer.parentNode.replaceChild(wrapper, headerContainer);
  } else {
    const wrapper = document.createElement('div');
    wrapper.id = 'global-header-wrapper';
    wrapper.innerHTML = renderHeader();
    document.body.insertBefore(wrapper, document.body.firstChild);
  }

  // Mount Footer
  const footerContainer = document.getElementById('global-footer') || document.querySelector('footer');
  if (footerContainer) {
    const wrapper = document.createElement('div');
    wrapper.id = 'global-footer-wrapper';
    wrapper.innerHTML = renderFooter();
    footerContainer.parentNode.replaceChild(wrapper, footerContainer);
  } else {
    const wrapper = document.createElement('div');
    wrapper.id = 'global-footer-wrapper';
    wrapper.innerHTML = renderFooter();
    document.body.appendChild(wrapper);
  }

  // Mount Quick View Modal if missing
  if (!document.getElementById('quick-view-modal')) {
    const qv = document.createElement('div');
    qv.className = 'quick-view-modal';
    qv.id = 'quick-view-modal';
    qv.innerHTML = `
      <div class="qv-overlay" onclick="window.closeQuickView()"></div>
      <div class="qv-content">
        <button class="qv-close" onclick="window.closeQuickView()" aria-label="Close">&times;</button>
        <div class="qv-grid">
          <img id="qv-img" class="qv-image" src="" alt="Product Preview" />
          <div>
            <h3 id="qv-title" class="qv-title"></h3>
            <div id="qv-price" class="qv-price"></div>
            <p id="qv-desc" class="qv-desc" style="color:var(--white-dim);margin-bottom:1.2rem;"></p>
            <div style="display:flex;gap:10px;flex-wrap:wrap">
              <button id="qv-add-cart" class="btn solid" style="flex:1">Add to Bag</button>
              <button id="qv-buy-now" class="btn" style="flex:1">Buy Now</button>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(qv);
  }

  // Quick View handlers
  window.openQuickView = async function(productId) {
    let product = (KC.products || []).find(p => p.id === productId);
    if (!product) {
      try {
        const { getProduct } = await import('../services/productService.js');
        product = await getProduct(productId);
      } catch (_) {}
    }
    if (!product) return;

    const modal = document.getElementById('quick-view-modal');
    if (!modal) return;

    const rawImg = product.image || product.primaryImageURL || product.images?.[0] || '/img-fallback.svg';
    const imgEl = document.getElementById('qv-img');
    const titleEl = document.getElementById('qv-title');
    const priceEl = document.getElementById('qv-price');
    const descEl = document.getElementById('qv-desc');
    const addBtn = document.getElementById('qv-add-cart');
    const buyBtn = document.getElementById('qv-buy-now');

    if (imgEl) imgEl.src = rawImg;
    if (titleEl) titleEl.textContent = product.name || 'Jewellery Piece';
    if (priceEl) {
      const price = Number(product.price || 0);
      const mrp = Number(product.mrp || 0);
      priceEl.innerHTML = `<strong style="color:var(--gold,#d4af37);font-size:1.4rem;">₹${price.toLocaleString('en-IN')}</strong>` +
        (mrp > price ? ` <s style="color:var(--text-muted,#888);font-size:0.95rem;margin-left:8px;">₹${mrp.toLocaleString('en-IN')}</s>` : '');
    }
    if (descEl) descEl.textContent = product.description || product.shortDescription || 'Authentic gold covering jewellery handcrafted with 100% micro-gold plating for long-lasting sheen.';

    if (addBtn) {
      addBtn.onclick = () => {
        Cart.add(product, 1);
        window.closeQuickView();
      };
    }
    if (buyBtn) {
      buyBtn.onclick = () => {
        const buyNowItem = {
          id: String(product.id),
          name: product.name || 'Jewellery Item',
          price: Number(product.price) || 0,
          image: rawImg,
          qty: 1
        };
        try {
          sessionStorage.setItem('kc_buy_now', JSON.stringify(buyNowItem));
        } catch (_) {}
        window.location.href = 'checkout.html?buyNow=1';
      };
    }

    modal.classList.add('open');
  };

  window.closeQuickView = function() {
    const modal = document.getElementById('quick-view-modal');
    if (modal) modal.classList.remove('open');
  };

  // Sync Badges
  Cart.load();
  Wishlist.load();
}

// Auto init when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initGlobalShell);
} else {
  initGlobalShell();
}
