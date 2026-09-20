/**
 * homePage.js — Kalyan Covering
 * Home page logic: Hero, Trust strip, Categories grid, Signature Pieces (Tabs),
 * Festive Edit band, Why-Us list, Testimonials, Showroom info, and Social links.
 */

import { KC } from '../store/state.js';
import { loadProducts } from '../services/productService.js';
import { Cart } from '../services/cartService.js';
import { Wishlist } from '../services/wishlistService.js';
import { ic } from '../utils/icons.js';
import { formatCurrency, escapeHtml } from '../utils/helpers.js';

let activeTab = 'featured';

export async function initHomePage() {
  console.log('Home Page initialized');

  // Load products from Firestore (or cache)
  const products = await loadProducts();
  renderSignaturePieces(activeTab, products);
  setupTabListeners();
}

export function renderSignaturePieces(tab = 'featured', products = KC.products) {
  const container = document.getElementById('signature-grid');
  if (!container) return;

  let filtered = [];
  if (tab === 'featured') {
    filtered = products.filter(p => p.popular || p.featured || p.tags?.includes('Bestseller') || p.tags?.includes('Bridal'));
    if (filtered.length === 0) filtered = products.slice(0, 8);
  } else {
    filtered = products.filter(p => p.isNew || p.tags?.includes('New'));
    if (filtered.length === 0) filtered = [...products].reverse().slice(0, 8);
  }

  const items = filtered.slice(0, 8);

  if (!items.length) {
    container.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:3rem;color:var(--muted)">
        <p>No pieces currently found in this collection.</p>
      </div>`;
    return;
  }

  container.innerHTML = items.map(product => {
    const isWish = Wishlist.has(product.id);
    const mrp = product.mrp || Math.round(product.price * 1.2);
    const discount = Math.round(((mrp - product.price) / mrp) * 100);
    const image = product.image || product.primaryImageURL || product.images?.[0] || '/img-fallback.svg';

    return `
      <article class="card">
        <a class="card-art" href="product-detail.html?id=${product.id}">
          <img src="${image}" alt="${escapeHtml(product.name)}" loading="lazy" onerror="this.src='/img-fallback.svg'" />
          ${product.isNew ? '<span class="badge">New Arrival</span>' : (product.popular ? '<span class="badge">Bestseller</span>' : '')}
        </a>

        <button class="heart ${isWish ? 'on' : ''}" onclick="handleWishToggle('${product.id}', this)" aria-label="Toggle Wishlist">
          ${ic('heart', 18)}
        </button>

        <div class="card-b">
          <a href="product-detail.html?id=${product.id}">
            <h3>${escapeHtml(product.name)}</h3>
          </a>
          <div class="sub">${escapeHtml(product.category || 'Jewellery')}</div>
          <div class="pr">
            <strong>${formatCurrency(product.price)}</strong>
            ${mrp > product.price ? `<s>${formatCurrency(mrp)}</s> <span class="off">${discount}% off</span>` : ''}
          </div>
          <button class="btn sm block" onclick="handleAddToCart('${product.id}', this)">
            Add to bag
          </button>
        </div>
      </article>
    `;
  }).join('');
}

function setupTabListeners() {
  document.querySelectorAll('.signature-tab').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.signature-tab').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');

      activeTab = btn.dataset.tab;
      renderSignaturePieces(activeTab);
    });
  });
}

window.handleAddToCart = function(productId, btn) {
  const product = (KC.products || []).find(p => p.id === productId);
  if (!product) return;
  Cart.add(product);
  if (btn) {
    const origText = btn.textContent;
    btn.textContent = '✓ Added';
    btn.classList.add('solid');
    setTimeout(() => {
      btn.textContent = origText;
      btn.classList.remove('solid');
    }, 1400);
  }
};

window.handleWishToggle = async function(productId, btn) {
  const product = (KC.products || []).find(p => p.id === productId);
  if (!product) return;
  const added = await Wishlist.toggle(product);
  if (btn) {
    btn.classList.toggle('on', added);
  }
};

// Expose functions for window compatibility
window.initHomePage = initHomePage;
window.renderSignaturePieces = renderSignaturePieces;
