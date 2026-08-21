export const KC = {
    user: JSON.parse(localStorage.getItem('kc_user') || 'null'),
    cart: JSON.parse(localStorage.getItem('kc_cart') || '[]'),
    wishlist: JSON.parse(localStorage.getItem('kc_wishlist') || '[]'),
    theme: localStorage.getItem('kc_theme') || 'normal', // normal | diwali | christmas
    products: [],
    videos: [],
    adminKeyword: 'admin',
    branches: []
};

// Bind to window for HTML compatibility
window.KC = KC;
