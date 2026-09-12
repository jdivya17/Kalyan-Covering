/**
 * cartService.js — Kalyan Covering
 * Cart state management: LocalStorage persistence, item CRUD, totals.
 *
 * Dependencies: state.js, Toast.js, Navbar.js
 */

import { KC } from '../store/state.js';
import { Toast } from '../components/Toast.js';
import { formatCurrency } from '../utils/helpers.js';

let _lastActionTime = 0;

export const Cart = {
    // ---- Core CRUD ----
    /**
     * Add a product to the cart (throttled to prevent spam)
     * @param {Object} product - Product from Firestore
     * @param {number} [qty=1] - Quantity to add
     */
    add(product, qty = 1) {
        if (!product || !product.id) return;
        const now = Date.now();
        if (now - _lastActionTime < 200) return; // throttle 200ms
        _lastActionTime = now;

        // Normalize image
        const item = { ...product };
        if (!item.image && item.images?.length) item.image = item.images[0];
        if (!item.image && item.imageURLs?.length) item.image = item.imageURLs[0];
        if (!item.image && item.primaryImageURL) item.image = item.primaryImageURL;

        const qtyToAdd = qty || item.qty || 1;
        const existing = KC.cart.find(i => i.id === product.id);
        if (existing) {
            existing.qty = Math.min((existing.qty || 1) + qtyToAdd, 10);
        } else {
            KC.cart.push({ ...item, qty: qtyToAdd });
        }
        this.save();
        this.updateBadge();
        Toast.cart(product.name);
    },

    /**
     * Remove a product from the cart by ID
     * @param {string} id
     */
    remove(id) {
        KC.cart = KC.cart.filter(i => i.id !== id);
        this.save();
        this.updateBadge();
    },

    /**
     * Update the quantity of a cart item
     * @param {string} id
     * @param {number} qty - New quantity (0 = remove)
     */
    updateQty(id, qty) {
        const item = KC.cart.find(i => i.id === id);
        if (!item) return;
        if (qty <= 0) {
            this.remove(id);
        } else {
            item.qty = Math.min(Math.max(1, qty), 10);
            this.save();
            this.updateBadge();
        }
    },

    /**
     * Clear the entire cart
     */
    clear() {
        KC.cart = [];
        this.save();
        this.updateBadge();
    },

    // ---- Queries ----
    /**
     * Total item count (sum of all quantities)
     * @returns {number}
     */
    count() { return KC.cart.reduce((s, i) => s + (i.qty || 1), 0); },

    /**
     * Subtotal before discounts, shipping, or tax
     * @returns {number}
     */
    subtotal() { return KC.cart.reduce((s, i) => s + ((i.price || 0) * (i.qty || 1)), 0); },

    /**
     * Delivery charge: free above ₹999
     * @returns {number}
     */
    delivery() { return this.subtotal() > 999 ? 0 : 99; },

    /**
     * Build order summary for checkout display
     * @param {number} [couponDiscount=0]
     * @param {boolean} [isCOD=false]
     * @returns {Object}
     */
    summary(couponDiscount = 0, isCOD = false) {
        const subtotal = this.subtotal();
        const discount = Math.min(couponDiscount, subtotal);
        const gst = Math.round((subtotal - discount) * 0.12);
        const delivery = this.delivery();
        const codFee = isCOD ? 50 : 0;
        const total = subtotal - discount + gst + delivery + codFee;
        return { subtotal, discount, gst, delivery, codFee, total };
    },

    /**
     * Prepare cart items for Cloud Function (id + qty only)
     * @returns {Array<{id:string, qty:number}>}
     */
    toOrderItems() {
        return KC.cart.map(i => ({ id: i.id, qty: i.qty || 1 }));
    },

    // ---- Persistence ----
    /**
     * Save cart to localStorage
     */
    save() {
        try {
            localStorage.setItem('kc_cart', JSON.stringify(KC.cart));
        } catch (e) {
            console.error('Cart save error:', e);
        }
    },

    /**
     * Reload cart from localStorage
     */
    load() {
        try {
            KC.cart = JSON.parse(localStorage.getItem('kc_cart') || '[]');
        } catch {
            KC.cart = [];
        }
        this.updateBadge();
    },

    // ---- Badge ----
    /**
     * Update cart count badge across all .cart-count elements
     */
    updateBadge() {
        const count = this.count();
        document.querySelectorAll('.cart-count').forEach(el => {
            el.textContent = count;
            el.classList.remove('pop');
            void el.offsetWidth;
            el.classList.add('pop');
        });
    },

    // ---- Render ----
    /**
     * Render cart items into a container element
     * @param {string|HTMLElement} containerOrId
     * @param {Function} [onUpdate] - Called after quantity change or remove
     */
    render(containerOrId, onUpdate) {
        const container = typeof containerOrId === 'string'
            ? document.getElementById(containerOrId)
            : containerOrId;
        if (!container) return;

        if (!KC.cart.length) {
            container.innerHTML = `
                <div style="text-align:center;padding:3rem;color:var(--white-dim)">
                    <div style="font-size:3rem;margin-bottom:1rem">🛒</div>
                    <p style="color:var(--gold);font-family:var(--font-serif);font-size:1.4rem;margin-bottom:0.5rem">Your cart is empty</p>
                    <p style="font-size:0.9rem;margin-bottom:2rem">Add some beautiful jewellery to get started</p>
                    <a href="products.html" class="btn btn-gold">Browse Collection</a>
                </div>`;
            return;
        }

        container.innerHTML = KC.cart.map(item => `
            <div class="cart-item" data-id="${item.id}" style="display:flex;gap:1.2rem;padding:1.2rem 0;border-bottom:1px solid var(--black-border);align-items:center">
                <img src="${item.image || item.primaryImageURL || ''}" alt="${item.name}" style="width:80px;height:80px;object-fit:cover;border-radius:var(--radius);border:1px solid var(--black-border);" onerror="this.src='/img-fallback.svg'">
                <div style="flex:1;min-width:0">
                    <div style="font-family:var(--font-serif);font-size:1rem;color:var(--white);margin-bottom:0.3rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${item.name}</div>
                    <div style="color:var(--gold);font-weight:700">${formatCurrency(item.price)}</div>
                    <div style="display:flex;align-items:center;gap:0.8rem;margin-top:0.7rem">
                        <button onclick="Cart.updateQty('${item.id}', ${(item.qty || 1) - 1})" class="btn btn-ghost btn-sm" style="padding:0.3rem 0.7rem" aria-label="Decrease quantity">−</button>
                        <span style="color:var(--white);min-width:24px;text-align:center">${item.qty || 1}</span>
                        <button onclick="Cart.updateQty('${item.id}', ${(item.qty || 1) + 1})" class="btn btn-ghost btn-sm" style="padding:0.3rem 0.7rem" aria-label="Increase quantity">+</button>
                        <button onclick="Cart.remove('${item.id}'); Cart.render('${container.id || 'cart-items'}', window._cartOnUpdate)" class="btn btn-ghost btn-sm" style="color:#ef4444;margin-left:auto" aria-label="Remove ${item.name}">🗑</button>
                    </div>
                </div>
                <div style="font-weight:700;color:var(--gold);white-space:nowrap">${formatCurrency((item.price || 0) * (item.qty || 1))}</div>
            </div>
        `).join('');

        if (typeof onUpdate === 'function') window._cartOnUpdate = onUpdate;
    }
};

// Bind to window for HTML inline onclick compatibility
window.Cart = Cart;
