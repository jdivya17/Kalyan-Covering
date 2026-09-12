/**
 * ║  productsPage.js – Kalyan Covering
 * ║  Products listing, category filtering, search, and sorting
 */
import { KC } from '../store/state.js';
import { ProductCard } from '../components/ProductCard.js';

export function initProductsPage() {
    console.log('ProductsPage initialized.');
    renderProductsList();
}

export function renderProductsList(filteredProducts = null) {
    const grid = document.getElementById('products-grid') || document.getElementById('catalog-grid');
    if (!grid) return;

    const list = filteredProducts || KC.products || [];
    if (list.length === 0) {
        grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--gold-dim);">No products found matching your selection.</div>';
        return;
    }

    grid.innerHTML = list.map(product => ProductCard(product)).join('');
}
