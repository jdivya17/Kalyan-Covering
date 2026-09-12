/** Safely parse a localStorage JSON value; returns fallback on any error */
function safeParse(key, fallback) {
    try {
        return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
    } catch {
        return fallback;
    }
}

export const KC = {
    user: safeParse('kc_user', null),
    cart: safeParse('kc_cart', []),
    wishlist: safeParse('kc_wishlist', []),
    theme: safeParse('kc_theme', 'normal') || 'normal', // normal | diwali | christmas
    products: [],
    videos: [],
    adminKeyword: 'admin',
    branches: []
};

// Bind to window for HTML compatibility
window.KC = KC;
