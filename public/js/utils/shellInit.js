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
  // Ensure CSS theme stylesheet is loaded
  if (!document.getElementById('theme-stylesheet')) {
    const link = document.createElement('link');
    link.id = 'theme-stylesheet';
    link.rel = 'stylesheet';
    link.href = '../css/theme.css';
    document.head.appendChild(link);
  }

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
            <button id="qv-add-cart" class="btn solid block">Add to Bag</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(qv);
  }

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
