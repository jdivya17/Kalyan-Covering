/**
 * Navbar.js — Kalyan Covering
 * Customer-facing navigation bar component.
 * Manages scroll-state, auth state, cart/wishlist badges,
 * hamburger mobile drawer, and search modal toggle.
 *
 * Dependencies: state.js
 */

import { KC } from '../store/state.js';

export const Navbar = {
    /** Initialize all navbar behaviors */
    init() {
        this._initScrollBehavior();
        this._initAuthState();
        this._updateBadges();
        this._initHamburger();
        this._initSearchModal();
        this._initKeyboard();
    },

    // ---- Scroll Behavior ----
    _initScrollBehavior() {
        const nav = document.getElementById('main-nav') || document.querySelector('.nav');
        if (!nav) return;
        const update = () => nav.classList.toggle('scrolled', window.scrollY > 50);
        window.addEventListener('scroll', update, { passive: true });
        update(); // set initial state
    },

    // ---- Auth State ----
    _initAuthState() {
        const user = this._getUser();
        const authBtns = document.getElementById('nav-auth-btns');
        const userBtn = document.getElementById('nav-user-btn');
        const drawerUserInfo = document.getElementById('drawer-user-info');
        const drawerProfileLink = document.getElementById('drawer-profile-link');

        if (user) {
            if (authBtns) authBtns.style.display = 'none';
            if (userBtn) {
                userBtn.style.display = 'block';
                userBtn.innerHTML = `<span style="font-size:0.75rem;color:var(--gold);border:1px solid var(--gold);padding:2px 10px;border-radius:12px;font-weight:700;">${(user.name || 'User').split(' ')[0]}</span>`;
            }
            if (drawerUserInfo) {
                drawerUserInfo.style.display = 'flex';
                drawerUserInfo.innerHTML = `
                    <span class="avatar" aria-hidden="true">${(user.name || 'U').charAt(0).toUpperCase()}</span>
                    <div>
                        <div style="font-weight:600;color:var(--gold)">${user.name || 'User'}</div>
                        <div style="font-size:0.8rem;color:var(--white-dim)">${user.phone || user.email || ''}</div>
                    </div>`;
            }
            if (drawerProfileLink) drawerProfileLink.style.display = 'flex';
        } else {
            if (authBtns) authBtns.style.display = 'flex';
            if (userBtn) userBtn.style.display = 'none';
            if (drawerUserInfo) drawerUserInfo.style.display = 'none';
            if (drawerProfileLink) drawerProfileLink.style.display = 'none';
        }
    },

    // ---- Badge Updates ----
    _updateBadges() {
        this.updateCartBadge();
        this.updateWishlistBadge();
    },

    updateCartBadge() {
        const count = KC.cart ? KC.cart.reduce((s, i) => s + (i.qty || 1), 0) : 0;
        document.querySelectorAll('.cart-count').forEach(el => {
            el.textContent = count;
            el.classList.remove('pop');
            void el.offsetWidth;
            el.classList.add('pop');
        });
    },

    updateWishlistBadge() {
        const count = KC.wishlist ? KC.wishlist.length : 0;
        const badge = document.getElementById('wishlist-count');
        if (badge) {
            badge.textContent = count;
            badge.style.display = count > 0 ? 'flex' : 'none';
            badge.classList.remove('pop');
            void badge.offsetWidth;
            badge.classList.add('pop');
        }
    },

    // ---- Hamburger / Mobile Drawer ----
    _initHamburger() {
        const hamburger = document.getElementById('hamburger-btn');
        if (hamburger) hamburger.classList.remove('open');
    },

    toggleMobileMenu() {
        const drawer = document.getElementById('mobile-drawer');
        const overlay = document.getElementById('mobile-overlay');
        const hamburger = document.getElementById('hamburger-btn');
        if (drawer && overlay) {
            const isOpen = drawer.classList.toggle('open');
            overlay.classList.toggle('active', isOpen);
            if (hamburger) {
                hamburger.classList.toggle('open', isOpen);
                hamburger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
            }
            document.body.style.overflow = isOpen ? 'hidden' : '';
        }
    },

    closeMobileMenu() {
        const drawer = document.getElementById('mobile-drawer');
        const overlay = document.getElementById('mobile-overlay');
        const hamburger = document.getElementById('hamburger-btn');
        if (drawer) drawer.classList.remove('open');
        if (overlay) overlay.classList.remove('active');
        if (hamburger) {
            hamburger.classList.remove('open');
            hamburger.setAttribute('aria-expanded', 'false');
        }
        document.body.style.overflow = '';
    },

    // ---- Search Modal ----
    _initSearchModal() {
        const searchModal = document.getElementById('search-modal');
        if (searchModal) {
            searchModal.setAttribute('aria-hidden', 'true');
        }
    },

    toggleSearch() {
        const modal = document.getElementById('search-modal');
        if (!modal) return;
        const isActive = modal.classList.toggle('active');
        modal.setAttribute('aria-hidden', isActive ? 'false' : 'true');
        if (isActive) {
            setTimeout(() => document.getElementById('smart-search-input')?.focus(), 100);
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
    },

    closeSearch() {
        const modal = document.getElementById('search-modal');
        if (modal) {
            modal.classList.remove('active');
            modal.setAttribute('aria-hidden', 'true');
            document.body.style.overflow = '';
        }
    },

    // ---- Keyboard ----
    _initKeyboard() {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeSearch();
                this.closeMobileMenu();
            }
        });
    },

    // ---- Helpers ----
    _getUser() {
        try {
            return KC.user || JSON.parse(localStorage.getItem('kc_user'));
        } catch {
            return null;
        }
    }
};

// Bind to window for HTML onclick compatibility
window.Navbar = Navbar;
window.toggleMobileMenu = () => Navbar.toggleMobileMenu();
window.toggleSearch = () => Navbar.toggleSearch();
window.updateWishlistBadge = () => Navbar.updateWishlistBadge();
