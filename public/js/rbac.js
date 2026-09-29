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
        console.time('[RBAC.getUserRole] Total');
        
        const validRoles = ['owner', 'admin', 'manager', 'staff'];

        // Helper: Timeout promise
        const withTimeout = (promise, ms = 3000) => 
            Promise.race([
                promise,
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms))
            ]);

        // 1. Check Firebase Custom Claims first (Primary source of truth matching firestore.rules)
        try {
            console.time('[RBAC] Step 1: Custom Claims');
            let idTokenResult = await withTimeout(user.getIdTokenResult(true), 3500);
            console.timeEnd('[RBAC] Step 1: Custom Claims');
            if (idTokenResult && idTokenResult.claims) {
                let r = idTokenResult.claims.role || (idTokenResult.claims.admin ? 'admin' : null);
                if (r) {
                    r = r.toLowerCase() === 'admin' ? 'owner' : r.toLowerCase();
                    if (validRoles.includes(r)) {
                        sessionStorage.setItem('kc_admin_role', r);
                        localStorage.setItem('kc_admin_role', r);
                        console.timeEnd('[RBAC.getUserRole] Total');
                        return r;
                    }
                }
            }
        } catch (error) {
            console.timeEnd('[RBAC] Step 1: Custom Claims');
            console.warn('[RBAC] ID token claims check skipped/timed out:', error.message);
        }

        // 2 & 3. Fallback to Firestore users / admins collections
        const userDb = db || window.db;
        const docFn = doc || window.doc;
        const getDocFn = getDoc || window.getDoc;
        if (userDb && docFn && getDocFn) {
            // Check users collection
            try {
                console.time('[RBAC] Step 2: Firestore users collection');
                const userDoc = await withTimeout(getDocFn(docFn(userDb, "users", user.uid)), 3000);
                console.timeEnd('[RBAC] Step 2: Firestore users collection');
                if (userDoc && userDoc.exists() && userDoc.data() && userDoc.data().role) {
                    let r = userDoc.data().role.toLowerCase();
                    if (r === 'admin') r = 'owner';
                    if (validRoles.includes(r)) {
                        sessionStorage.setItem('kc_admin_role', r);
                        localStorage.setItem('kc_admin_role', r);
                        console.timeEnd('[RBAC.getUserRole] Total');
                        return r;
                    }
                }
            } catch (userDbErr) {
                console.timeEnd('[RBAC] Step 2: Firestore users collection');
                console.warn('[RBAC] Firestore users check skipped/timed out:', userDbErr.message);
            }

            // Check admins collection
            try {
                console.time('[RBAC] Step 3: Firestore admins collection');
                const adminDoc = await withTimeout(getDocFn(docFn(userDb, "admins", user.uid)), 3000);
                console.timeEnd('[RBAC] Step 3: Firestore admins collection');
                if (adminDoc && adminDoc.exists() && adminDoc.data() && adminDoc.data().role) {
                    let r = adminDoc.data().role.toLowerCase();
                    if (r === 'admin') r = 'owner';
                    if (validRoles.includes(r)) {
                        sessionStorage.setItem('kc_admin_role', r);
                        localStorage.setItem('kc_admin_role', r);
                        console.timeEnd('[RBAC.getUserRole] Total');
                        return r;
                    }
                }
            } catch (adminDbErr) {
                console.timeEnd('[RBAC] Step 3: Firestore admins collection');
                console.warn('[RBAC] Firestore admins check skipped/timed out:', adminDbErr.message);
            }
        }

        // Step 4: Fallback / No valid admin role found in custom claims or Firestore database
        console.log('[RBAC] Step 4: No valid role found in custom claims or Firestore');
        sessionStorage.removeItem('kc_admin_role');
        localStorage.removeItem('kc_admin_role');
        console.timeEnd('[RBAC.getUserRole] Total');
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

