/**
 * ║  homePage.js – Kalyan Covering
 * ║  Homepage initialization, banners, featured products, categories
 */
import { KC } from '../store/state.js';
import { ProductCard } from '../components/ProductCard.js';

export function initHomePage() {
    console.log('HomePage initialized.');
    renderHomePageFeatured();
}

export function renderHomePageFeatured() {
    const grid = document.getElementById('featured-products-grid');
    if (!grid) return;

    const featured = (KC.products || []).filter(p => p.popular || p.featured).slice(0, 8);
    if (featured.length === 0) {
        grid.innerHTML = '<p class="text-center" style="grid-column: 1/-1; color: var(--gold-light);">Discover our finest collection below.</p>';
        return;
    }

    grid.innerHTML = featured.map(product => ProductCard(product)).join('');
}
