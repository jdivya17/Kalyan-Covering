// rbac.js - Reusable Role-Based Access Control Middleware
import { db, doc, getDoc } from './firebase-config.js';

export const RBAC = {
    permissions: {
        owner: ['dashboard', 'analytics', 'products', 'orders', 'invoices', 'users', 'theme', 'social', 'settings', 'notifications', 'coupons', 'inventory', 'audit'],
        admin: ['dashboard', 'analytics', 'products', 'orders', 'invoices', 'users', 'theme', 'social', 'settings', 'notifications', 'coupons', 'inventory', 'audit'],
        manager: ['dashboard', 'products', 'orders', 'invoices', 'users', 'coupons', 'analytics', 'audit'],
        staff: ['dashboard', 'products', 'orders', 'invoices', 'inventory', 'audit']
    },

    /**
     * Get the user's role from their Firebase Auth custom claims or Firestore fallback.
     * @param {Object} user - Firebase user object
     * @returns {Promise<string|null>} The user's role or null
     */
    async getUserRole(user) {
        if (!user) return null;
        
        const validRoles = ['owner', 'admin', 'manager', 'staff'];

        // Helper: Timeout promise
        const withTimeout = (promise, ms = 3000) => 
            Promise.race([
                promise,
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms))
            ]);

        // 1. Try Firebase Custom Claims (Primary - with forced refresh)
        try {
            await withTimeout(user.getIdToken(true), 3000);
            let idTokenResult = await withTimeout(user.getIdTokenResult(true), 3000);
            if (idTokenResult && idTokenResult.claims && idTokenResult.claims.role) {
                let r = idTokenResult.claims.role.toLowerCase();
                if (r === 'admin') r = 'owner';
                if (validRoles.includes(r)) {
                    sessionStorage.setItem('kc_admin_role', r);
                    return r;
                }
            }
        } catch (error) {
            console.warn('[RBAC] ID token claims check skipped/timed out:', error.message);
        }

        // 2. Check Session/Local Cache
        const cachedRole = sessionStorage.getItem('kc_admin_role') || localStorage.getItem('kc_admin_role');
        if (cachedRole && validRoles.includes(cachedRole.toLowerCase())) {
            const normalized = cachedRole.toLowerCase() === 'admin' ? 'owner' : cachedRole.toLowerCase();
            return normalized;
        }

        // 3. Fallback to Firestore users collection
        try {
            const userDb = db || window.db;
            const docFn = doc || window.doc;
            const getDocFn = getDoc || window.getDoc;
            if (userDb && docFn && getDocFn) {
                const userDoc = await withTimeout(getDocFn(docFn(userDb, "users", user.uid)), 4000);
                if (userDoc && userDoc.exists() && userDoc.data() && userDoc.data().role) {
                    let r = userDoc.data().role.toLowerCase();
                    if (r === 'admin') r = 'owner';
                    if (validRoles.includes(r)) {
                        sessionStorage.setItem('kc_admin_role', r);
                        return r;
                    }
                }
            }
        } catch (dbErr) {
            console.warn('[RBAC] Firestore role check skipped/timed out:', dbErr.message);
        }

        // 4. Fallback for owner / admin email patterns (failsafe)
        if (user.email && (
            user.email.toLowerCase() === 'owner@kalyancovering.com' ||
            user.email.toLowerCase().includes('admin')
        )) {
            sessionStorage.setItem('kc_admin_role', 'owner');
            return 'owner';
        }

        return null;
    },

    canAccess(role, resource) {
        if (!role) return false;
        const normalizedRole = role === 'admin' ? 'owner' : role;
        if (!this.permissions[normalizedRole]) return false;
        if (normalizedRole === 'owner') return true;
        return this.permissions[normalizedRole].includes(resource);
    },

    applyUI(role) {
        const normalizedRole = role === 'admin' ? 'owner' : role;
        const elements = document.querySelectorAll('[data-rbac]');
        elements.forEach(el => {
            const resource = el.getAttribute('data-rbac');
            if (resource && !this.canAccess(normalizedRole, resource)) {
                el.style.display = 'none';
                el.innerHTML = '';
            } else {
                el.style.display = '';
            }
        });
    }
};

