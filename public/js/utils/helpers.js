/**
 * helpers.js — Kalyan Covering
 * Shared utility functions: formatting, text manipulation, debounce, etc.
 */

// ---- Currency Formatting ----
/**
 * Format a number as Indian Rupees (₹)
 * @param {number} amount
 * @param {boolean} showSymbol
 * @returns {string}
 */
export function formatCurrency(amount, showSymbol = true) {
    if (typeof amount !== 'number' || isNaN(amount)) return showSymbol ? '₹0' : '0';
    const formatted = amount.toLocaleString('en-IN');
    return showSymbol ? `₹${formatted}` : formatted;
}

/**
 * Calculate discount percentage
 * @param {number} price
 * @param {number} mrp
 * @returns {number}
 */
export function discountPercent(price, mrp) {
    if (!mrp || mrp <= price) return 0;
    return Math.round(((mrp - price) / mrp) * 100);
}

// ---- Date Formatting ----
/**
 * Format a Firestore Timestamp or Date as a human-readable string
 * @param {Date|{seconds:number}|string} ts
 * @param {string} locale
 * @returns {string}
 */
export function formatDate(ts, locale = 'en-IN') {
    try {
        let date;
        if (!ts) return '—';
        if (ts instanceof Date) date = ts;
        else if (ts.seconds) date = new Date(ts.seconds * 1000);
        else if (ts.toDate) date = ts.toDate();
        else date = new Date(ts);
        return date.toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' });
    } catch {
        return '—';
    }
}

/**
 * Format a timestamp as a relative time string ("2 hours ago")
 * @param {Date|{seconds:number}|string} ts
 * @returns {string}
 */
export function timeAgo(ts) {
    try {
        let date;
        if (!ts) return '';
        if (ts instanceof Date) date = ts;
        else if (ts.seconds) date = new Date(ts.seconds * 1000);
        else if (ts.toDate) date = ts.toDate();
        else date = new Date(ts);
        const diff = (Date.now() - date.getTime()) / 1000;
        if (diff < 60) return 'just now';
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
        if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
        return formatDate(date);
    } catch {
        return '';
    }
}

// ---- Text Helpers ----
/**
 * Safely escape HTML to prevent XSS
 * @param {string} str
 * @returns {string}
 */
export function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Truncate text to a max length with ellipsis
 * @param {string} text
 * @param {number} maxLength
 * @returns {string}
 */
export function truncate(text, maxLength = 80) {
    if (!text) return '';
    return text.length > maxLength ? text.slice(0, maxLength).trimEnd() + '…' : text;
}

/**
 * Capitalize the first letter of a string
 * @param {string} str
 * @returns {string}
 */
export function capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Render star rating HTML (★ characters)
 * @param {number} rating - 0 to 5
 * @returns {string} HTML string
 */
export function renderStars(rating) {
    const r = Math.max(0, Math.min(5, rating || 0));
    const full = Math.floor(r);
    const half = r % 1 >= 0.5 ? 1 : 0;
    const empty = 5 - full - half;
    return '★'.repeat(full) + (half ? '⯨' : '') + `<span class="empty">${'★'.repeat(empty)}</span>`;
}

// ---- Debounce ----
/**
 * Returns a debounced version of fn that delays invocation by `wait` ms
 * @param {Function} fn
 * @param {number} wait
 * @returns {Function}
 */
export function debounce(fn, wait = 300) {
    let timer;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), wait);
    };
}

/**
 * Throttle a function to run at most once per `limit` ms
 * @param {Function} fn
 * @param {number} limit
 * @returns {Function}
 */
export function throttle(fn, limit = 200) {
    let last = 0;
    return function (...args) {
        const now = Date.now();
        if (now - last >= limit) {
            last = now;
            return fn.apply(this, args);
        }
    };
}

// ---- URL Helpers ----
/**
 * Get a query param from the current URL
 * @param {string} key
 * @returns {string|null}
 */
export function getQueryParam(key) {
    return new URLSearchParams(window.location.search).get(key);
}

// Bind to window for legacy HTML compatibility
window.formatCurrency = formatCurrency;
window.discountPercent = discountPercent;
window.formatDate = formatDate;
window.timeAgo = timeAgo;
window.escapeHtml = escapeHtml;
window.truncate = truncate;
window.renderStars = renderStars;
window.debounce = debounce;
window.throttle = throttle;
window.getQueryParam = getQueryParam;
