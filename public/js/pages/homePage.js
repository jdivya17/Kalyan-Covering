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
        grid.innerHTML = '<div style="width:100%;grid-column:1/-1;text-align:center;padding:3rem 1rem;color:#666"><div style="font-size:2rem;margin-bottom:0.5rem;opacity:0.4">✦</div><p>New featured pieces coming soon — check back shortly.</p></div>';
        return;
    }

    grid.innerHTML = featured.map(product => ProductCard(product)).join('');
}
