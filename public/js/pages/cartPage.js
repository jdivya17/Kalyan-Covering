/**
 * ║  cartPage.js – Kalyan Covering
 * ║  Cart page table rendering, item updates, totals
 */
import { KC } from '../store/state.js';
import { formatCurrency } from '../utils/helpers.js';

export function initCartPage() {
    console.log('CartPage initialized.');
    renderCartView();
}

export function renderCartView() {
    // cart.html uses id="cart-items-list"; match that
    const container = document.getElementById('cart-items-list') || document.getElementById('cart-items-container');
    if (!container) return;

    if (!KC.cart || KC.cart.length === 0) {
        container.innerHTML = `
            <div style="text-align:center; padding: 4rem 2rem; background: var(--black-card); border: 1px solid var(--black-border); border-radius: var(--radius);">
                <div style="font-size: 3.5rem; margin-bottom: 1.2rem; opacity: 0.6;">🛒</div>
                <h2 style="font-family: var(--font-serif); font-size: 1.8rem; margin-bottom: 0.75rem; font-weight: 400;">Your cart is empty</h2>
                <p style="color: var(--white-dim); margin-bottom: 2rem; max-width: 320px; margin-left: auto; margin-right: auto;">Explore our exquisite jewellery collection and add pieces you love.</p>
                <a href="products.html" class="btn btn-gold btn-lg">Explore Collection</a>
            </div>
        `;
        return;
    }

    // Render cart items if present
    const total = KC.cart.reduce((sum, item) => sum + ((item.price || 0) * (item.qty || item.quantity || 1)), 0);
    const totalEl = document.getElementById('cart-grand-total');
    const subtotalEl = document.getElementById('cart-subtotal');
    if (totalEl) totalEl.textContent = formatCurrency(total);
    if (subtotalEl) subtotalEl.textContent = formatCurrency(total);
}
