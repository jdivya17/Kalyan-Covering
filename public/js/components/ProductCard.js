/**
 * ProductCard.js — Kalyan Covering
 * Reusable product card renderer with quick-view, wishlist overlay,
 * gold badges, star ratings, and add-to-cart integration.
 *
 * Dependencies: state.js, helpers.js, cloudinaryUtils.js
 */

import { KC } from '../store/state.js';
import { renderStars, escapeHtml, formatCurrency, discountPercent } from '../utils/helpers.js';
import { getOptimizedUrl } from '../utils/cloudinaryUtils.js';

export function getStockStatus(p) {
    if (!p) return 'out';
    if (p.stockStatus && typeof p.stockStatus === 'string') return p.stockStatus;
    if (typeof p.stock === 'string' && ['in', 'low', 'out'].includes(p.stock)) return p.stock;
    const num = Number(p.stock);
    if (!isNaN(num)) {
        if (num <= 0) return 'out';
        if (num <= 5) return 'low';
        return 'in';
    }
    return 'in';
}

/**
 * Render a product card HTML string
 * @param {Object} p - Product object from Firestore
 * @param {Object} opts
 * @param {boolean} opts.mini - Render a minimal variant (no actions, no wishlist)
 * @param {boolean} opts.lazy - Use lazy loading on image (default: true)
 * @param {string}  opts.detailBase - Base URL for product detail page (default: 'product-detail.html')
 * @returns {string} HTML string
 */
export function renderProductCard(p, opts = {}) {
    const { mini = false, lazy = true, detailBase = 'product-detail.html' } = opts;

    if (!p || !p.id) return '';

    const rawImg =
        p.primaryImageURL ||
        (p.imageURLs && p.imageURLs[0]) ||
        (p.images && p.images[0]) ||
        p.image ||
        'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=400&h=300&fit=crop';
    const mainImg = getOptimizedUrl(rawImg, 500);
    const altText = escapeHtml(p.name || 'Kalyan Covering Jewellery');
    const title = escapeHtml(p.name || '');
    const price = p.price ?? 0;
    const mrp = p.mrp ?? 0;
    const discount = discountPercent(price, mrp);

    const stockStatus = getStockStatus(p);
    const stockClass = stockStatus === 'in' ? 'stock-in' : stockStatus === 'low' ? 'stock-low' : 'stock-out';
    const stockText = stockStatus === 'in' ? 'In Stock' : stockStatus === 'low' ? 'Low Stock' : 'Out of Stock';

    const isWishlisted = KC.wishlist && KC.wishlist.some(i => i.id === p.id);
    const starsHtml = renderStars(p.rating || 4.5);

    return `
    <div class="product-card${mini ? ' mini' : ''} reveal" data-id="${p.id}" onclick="window.location='${detailBase}?id=${p.id}'" role="article" aria-label="${altText}">
      ${p.isNew ? '<span class="ribbon" aria-label="New arrival">NEW</span>' : ''}
      <div class="card-img-wrap">
        <img
          src="${mainImg}"
          alt="${altText}"
          ${lazy ? 'loading="lazy"' : ''}
          onerror="this.src='/img-fallback.svg'"
        >
        ${discount > 0 ? `<span class="card-badge" aria-label="${discount}% off">${discount}% OFF</span>` : ''}
        ${!mini ? `
        <button
          class="wishlist-overlay-btn ${isWishlisted ? 'active' : ''}"
          onclick="event.stopPropagation(); window.ProductCard.toggleWishlist('${p.id}', this)"
          aria-label="${isWishlisted ? 'Remove from wishlist' : 'Add to wishlist'}"
          title="Wishlist"
        >${isWishlisted ? '♥' : '♡'}</button>
        <button
          class="quick-view-btn"
          onclick="event.stopPropagation(); window.openQuickView && window.openQuickView('${p.id}')"
          aria-label="Quick view ${altText}"
        >Quick View</button>
        ` : ''}
      </div>
      <div class="card-body">
        <div class="card-title" title="${altText}">${title}</div>
        <div class="card-stars" aria-label="Rating: ${p.rating || 4.5} out of 5">
          ${starsHtml}
          <span style="color:#666;font-size:0.75rem;font-family:var(--font-sans)">(${p.reviews || 0})</span>
        </div>
        <div class="card-price-row">
          <span class="card-price">${formatCurrency(price)}</span>
          ${mrp > price ? `<span class="card-price-old">${formatCurrency(mrp)}</span>` : ''}
          <span class="stock-badge ${stockClass}"><span class="dot"></span>${stockText}</span>
        </div>
        ${!mini ? `
        <div class="card-actions">
          <button
            class="btn btn-gold btn-sm"
            onclick="event.stopPropagation(); window.ProductCard.addToCart('${p.id}')"
            ${stockStatus === 'out' ? 'disabled' : ''}
            aria-label="Add ${altText} to cart"
          >${stockStatus === 'out' ? 'Out of Stock' : 'Add to Cart'}</button>
        </div>
        ` : ''}
      </div>
    </div>
  `;
}

/**
 * ProductCard controller — handles add-to-cart and wishlist-toggle actions
 * referenced by card HTML via window.ProductCard
 */
export const ProductCard = {
    /**
     * Add a product to cart by ID
     * @param {string} id
     */
    addToCart(id) {
        const p = KC.products.find(p => p.id === id);
        if (!p) return;
        if (window.Cart) {
            window.Cart.add(p);
        } else {
            // Fallback: dispatch custom event for pages that handle cart themselves
            window.dispatchEvent(new CustomEvent('kc-add-to-cart', { detail: p }));
        }
    },

    /**
     * Toggle wishlist state for a product
     * @param {string} id
     * @param {HTMLElement} btn - The wishlist button element to update
     */
    async toggleWishlist(id, btn) {
        const p = KC.products.find(p => p.id === id);
        if (!p) return;
        let added;
        if (window.Wishlist) {
            added = await window.Wishlist.toggle(p);
        } else {
            // Fallback: local toggle
            const idx = KC.wishlist.findIndex(i => i.id === id);
            if (idx > -1) {
                KC.wishlist.splice(idx, 1);
                added = false;
            } else {
                KC.wishlist.push(p);
                added = true;
            }
            localStorage.setItem('kc_wishlist', JSON.stringify(KC.wishlist));
        }
        if (btn) {
            btn.innerHTML = added ? '♥' : '♡';
            btn.classList.toggle('active', added);
            btn.setAttribute('aria-label', added ? 'Remove from wishlist' : 'Add to wishlist');
        }
    }
};

// Bind to window for HTML compatibility
window.ProductCard = ProductCard;
window.renderProductCard = renderProductCard;
