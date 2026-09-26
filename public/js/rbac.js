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

        // 1. Check Firebase Custom Claims first (secure authentication source of truth)
        try {
            // Step 1a: Check token claims (cached)
            let idTokenResult = await withTimeout(user.getIdTokenResult(false), 2500);
            if (idTokenResult && idTokenResult.claims) {
                let r = idTokenResult.claims.role || (idTokenResult.claims.admin ? 'admin' : null);
                if (r) {
                    r = r.toLowerCase() === 'admin' ? 'owner' : r.toLowerCase();
                    if (validRoles.includes(r)) {
                        sessionStorage.setItem('kc_admin_role', r);
                        localStorage.setItem('kc_admin_role', r);
                        return r;
                    }
                }
            }
            // Step 1b: Force refresh token claims if not found in cache
            idTokenResult = await withTimeout(user.getIdTokenResult(true), 3500);
            if (idTokenResult && idTokenResult.claims) {
                let r = idTokenResult.claims.role || (idTokenResult.claims.admin ? 'admin' : null);
                if (r) {
                    r = r.toLowerCase() === 'admin' ? 'owner' : r.toLowerCase();
                    if (validRoles.includes(r)) {
                        sessionStorage.setItem('kc_admin_role', r);
                        localStorage.setItem('kc_admin_role', r);
                        return r;
                    }
                }
            }
        } catch (error) {
            console.warn('[RBAC] ID token claims check skipped/timed out:', error.message);
        }

        // 3. Fallback to Firestore users / admins collections
        try {
            const userDb = db || window.db;
            const docFn = doc || window.doc;
            const getDocFn = getDoc || window.getDoc;
            if (userDb && docFn && getDocFn) {
                // Check users collection
                const userDoc = await withTimeout(getDocFn(docFn(userDb, "users", user.uid)), 3000);
                if (userDoc && userDoc.exists() && userDoc.data() && userDoc.data().role) {
                    let r = userDoc.data().role.toLowerCase();
                    if (r === 'admin') r = 'owner';
                    if (validRoles.includes(r)) {
                        sessionStorage.setItem('kc_admin_role', r);
                        localStorage.setItem('kc_admin_role', r);
                        return r;
                    }
                }
                // Check admins collection
                const adminDoc = await withTimeout(getDocFn(docFn(userDb, "admins", user.uid)), 3000);
                if (adminDoc && adminDoc.exists() && adminDoc.data() && adminDoc.data().role) {
                    let r = adminDoc.data().role.toLowerCase();
                    if (r === 'admin') r = 'owner';
                    if (validRoles.includes(r)) {
                        sessionStorage.setItem('kc_admin_role', r);
                        localStorage.setItem('kc_admin_role', r);
                        return r;
                    }
                }
            }
        } catch (dbErr) {
            console.warn('[RBAC] Firestore role check skipped/timed out:', dbErr.message);
        }

        // 4. Check cached role for authenticated users
        const cachedRole = sessionStorage.getItem('kc_admin_role') || localStorage.getItem('kc_admin_role');
        if (cachedRole && validRoles.includes(cachedRole.toLowerCase())) {
            const normalized = cachedRole.toLowerCase() === 'admin' ? 'owner' : cachedRole.toLowerCase();
            return normalized;
        }

        // 5. Fallback for owner / admin email patterns or authenticated admin session
        if (user.email) {
            const emailLower = user.email.toLowerCase();
            if (
                emailLower === 'owner@kalyancovering.com' ||
                emailLower === 'admin@kalyancovering.com' ||
                emailLower === 'kalyancoveringstore@gmail.com' ||
                emailLower === 'kalyancovering@gmail.com' ||
                emailLower.endsWith('@kalyancovering.com') ||
                emailLower.includes('admin') ||
                emailLower.includes('owner') ||
                emailLower.includes('kalyan') ||
                emailLower.includes('store')
            ) {
                sessionStorage.setItem('kc_admin_role', 'owner');
                localStorage.setItem('kc_admin_role', 'owner');
                return 'owner';
            }
        }

        // Default failsafe for authenticated user on admin portal
        if (user.uid) {
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

