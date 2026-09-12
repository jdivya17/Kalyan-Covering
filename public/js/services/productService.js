/**
 * productService.js — Kalyan Covering
 * Firestore product fetching with 5-minute sessionStorage cache,
 * search, filter, and category helpers.
 */

import { db, collection, getDocs, doc, getDoc, query, where, orderBy } from '../firebase-config.js';
import { KC } from '../store/state.js';

const PRODUCTS_CACHE_KEY = 'kc_products_cache';
const PRODUCTS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ---- Load All Products ----
/**
 * Fetch all products from Firestore, with 5-min sessionStorage cache.
 * Fires the 'kc-products-loaded' CustomEvent when complete.
 * @returns {Promise<Array>}
 */
export async function loadProducts() {
    // Try cache first
    try {
        const cached = sessionStorage.getItem(PRODUCTS_CACHE_KEY);
        if (cached) {
            const { data, ts } = JSON.parse(cached);
            if (Date.now() - ts < PRODUCTS_CACHE_TTL && Array.isArray(data) && data.length > 0) {
                KC.products = data;
                window.dispatchEvent(new CustomEvent('kc-products-loaded', { detail: data }));
                return data;
            }
        }
    } catch (_) {
        sessionStorage.removeItem(PRODUCTS_CACHE_KEY);
    }

    try {
        const snapshot = await getDocs(collection(db, 'products'));
        if (snapshot.empty) {
            KC.products = [];
            window.dispatchEvent(new CustomEvent('kc-products-loaded', { detail: [] }));
            return [];
        }
        const products = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        sessionStorage.setItem(PRODUCTS_CACHE_KEY, JSON.stringify({ data: products, ts: Date.now() }));
        KC.products = products;
        window.dispatchEvent(new CustomEvent('kc-products-loaded', { detail: products }));
        return products;
    } catch (e) {
        console.error('Error loading products:', e);
        KC.products = [];
        window.dispatchEvent(new CustomEvent('kc-products-loaded', { detail: [] }));
        return [];
    }
}

// ---- Get Single Product ----
/**
 * Fetch a single product by ID.
 * Uses the in-memory cache (KC.products) if available.
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
export async function getProduct(id) {
    if (!id) return null;
    // Try in-memory first
    const cached = KC.products.find(p => p.id === id);
    if (cached) return cached;

    try {
        const snap = await getDoc(doc(db, 'products', id));
        if (!snap.exists()) return null;
        return { id: snap.id, ...snap.data() };
    } catch (e) {
        console.error('Error fetching product:', e);
        return null;
    }
}

// ---- Invalidate Cache ----
/**
 * Force-clear the products cache on next load
 */
export function invalidateProductCache() {
    sessionStorage.removeItem(PRODUCTS_CACHE_KEY);
    KC.products = [];
}

// ---- Search ----
/**
 * Search products by name or category (case-insensitive)
 * @param {string} query
 * @param {Array} [products] - Defaults to KC.products
 * @returns {Array}
 */
export function searchProducts(queryStr, products = KC.products) {
    if (!queryStr || queryStr.trim().length < 2) return products;
    const q = queryStr.trim().toLowerCase();
    return products.filter(p =>
        (p.name && p.name.toLowerCase().includes(q)) ||
        (p.productName && p.productName.toLowerCase().includes(q)) ||
        (p.category && p.category.toLowerCase().includes(q)) ||
        (p.brand && p.brand.toLowerCase().includes(q)) ||
        (p.description && p.description.toLowerCase().includes(q)) ||
        (Array.isArray(p.tags) && p.tags.some(t => t.toLowerCase().includes(q)))
    );
}

// ---- Filter ----
/**
 * Filter products by a criteria object
 * @param {Array} products
 * @param {Object} filters
 * @param {string} [filters.category]
 * @param {string} [filters.brand]
 * @param {number} [filters.minPrice]
 * @param {number} [filters.maxPrice]
 * @param {string} [filters.stock] - 'in' | 'low' | 'out'
 * @param {boolean} [filters.isNew]
 * @param {boolean} [filters.popular]
 * @returns {Array}
 */
export function filterProducts(products, filters = {}) {
    return products.filter(p => {
        if (filters.category && p.category !== filters.category) return false;
        if (filters.brand && p.brand !== filters.brand) return false;
        if (filters.minPrice != null && p.price < filters.minPrice) return false;
        if (filters.maxPrice != null && p.price > filters.maxPrice) return false;
        if (filters.stock && p.stock !== filters.stock) return false;
        if (filters.isNew && !p.isNew) return false;
        if (filters.popular && !p.popular) return false;
        return true;
    });
}

// ---- Sort ----
/**
 * Sort products by a field
 * @param {Array} products
 * @param {'price-asc'|'price-desc'|'name-asc'|'rating-desc'|'new'} sortKey
 * @returns {Array}
 */
export function sortProducts(products, sortKey = 'name-asc') {
    const arr = [...products];
    switch (sortKey) {
        case 'price-asc': return arr.sort((a, b) => (a.price || 0) - (b.price || 0));
        case 'price-desc': return arr.sort((a, b) => (b.price || 0) - (a.price || 0));
        case 'name-asc': return arr.sort((a, b) => (a.name || a.productName || '').localeCompare(b.name || b.productName || ''));
        case 'rating-desc': return arr.sort((a, b) => (b.rating || 0) - (a.rating || 0));
        case 'new': return arr.sort((a, b) => (b.isNew ? 1 : 0) - (a.isNew ? 1 : 0));
        default: return arr;
    }
}

// ---- Category List ----
/**
 * Get unique categories from a product array
 * @param {Array} [products]
 * @returns {string[]}
 */
export function getCategories(products = KC.products) {
    return [...new Set(products.map(p => p.category).filter(Boolean))].sort();
}

// Bind to window for legacy HTML compatibility
window.loadProducts = loadProducts;
window.getProduct = getProduct;
window.searchProducts = searchProducts;
window.filterProducts = filterProducts;
window.sortProducts = sortProducts;
window.invalidateProductCache = invalidateProductCache;
window.getCategories = getCategories;
