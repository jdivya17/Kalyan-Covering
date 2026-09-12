/**
 * wishlistService.js — Kalyan Covering
 * Wishlist item toggles with localStorage sync and Firestore wishlistCount update.
 */

import { db, doc, updateDoc, increment } from '../firebase-config.js';
import { KC } from '../store/state.js';
import { Toast } from '../components/Toast.js';

export const Wishlist = {
    /**
     * Toggle a product in/out of the wishlist
     * Syncs Firestore wishlistCount and localStorage in parallel
     * @param {Object} product
     * @returns {Promise<boolean>} true if added, false if removed
     */
    async toggle(product) {
        if (!product || !product.id) return false;
        const idx = KC.wishlist.findIndex(i => i.id === product.id);
        const added = idx === -1;

        if (added) {
            KC.wishlist.push(product);
            Toast.success('Added to Wishlist!', product.name);
        } else {
            KC.wishlist.splice(idx, 1);
            Toast.info('Removed from Wishlist', product.name);
        }

        this.save();
        this._updateBadge();

        // Firestore wishlistCount — fire-and-forget
        try {
            const productRef = doc(db, 'products', product.id);
            updateDoc(productRef, { wishlistCount: increment(added ? 1 : -1) }).catch(() => {});
        } catch (_) {}

        return added;
    },

    /**
     * Check if a product is in the wishlist
     * @param {string} id
     * @returns {boolean}
     */
    has(id) { return KC.wishlist.some(i => i.id === id); },

    /**
     * Remove a product from wishlist by ID (without toggle logic)
     * @param {string} id
     */
    remove(id) {
        KC.wishlist = KC.wishlist.filter(i => i.id !== id);
        this.save();
        this._updateBadge();
    },

    /**
     * Clear the entire wishlist
     */
    clear() {
        KC.wishlist = [];
        this.save();
        this._updateBadge();
    },

    /**
     * Persist wishlist to localStorage and Firestore
     */
    async save() {
        try {
            localStorage.setItem('kc_wishlist', JSON.stringify(KC.wishlist));
            const user = KC.user || JSON.parse(localStorage.getItem('kc_user') || 'null');
            if (user?.uid) {
                const userRef = doc(db, 'users', user.uid);
                updateDoc(userRef, { wishlist: KC.wishlist }).catch(err => {
                    console.warn('Firestore wishlist sync warning:', err);
                });
            }
        } catch (e) {
            console.error('Wishlist save error:', e);
        }
    },

    /**
     * Reload wishlist from localStorage / Firestore
     */
    async load() {
        try {
            KC.wishlist = JSON.parse(localStorage.getItem('kc_wishlist') || '[]');
            const user = KC.user || JSON.parse(localStorage.getItem('kc_user') || 'null');
            if (user?.uid) {
                const { getDoc } = await import('../firebase-config.js');
                const userSnap = await getDoc(doc(db, 'users', user.uid));
                if (userSnap.exists() && Array.isArray(userSnap.data().wishlist)) {
                    KC.wishlist = userSnap.data().wishlist;
                    localStorage.setItem('kc_wishlist', JSON.stringify(KC.wishlist));
                }
            }
        } catch {
            KC.wishlist = [];
        }
        this._updateBadge();
    },

    /**
     * Update wishlist badge count in the navbar
     * @private
     */
    _updateBadge() {
        const count = KC.wishlist.length;
        const badge = document.getElementById('wishlist-count');
        if (badge) {
            badge.textContent = count;
            badge.style.display = count > 0 ? 'flex' : 'none';
            badge.classList.remove('pop');
            void badge.offsetWidth;
            badge.classList.add('pop');
        }
    }
};

// Bind to window for HTML compatibility
window.Wishlist = Wishlist;
