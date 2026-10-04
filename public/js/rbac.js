// rbac.js - Reusable Role-Based Access Control Middleware
import { db, doc, getDoc } from './firebase-config.js';

const safeStore = {
  get(s, k) { try { return s.getItem(k); } catch (e) { return null; } },
  set(s, k, v) { try { s.setItem(k, v); } catch (e) {} },
  del(s, k) { try { s.removeItem(k); } catch (e) {} }
};

export const RBAC = {
    permissions: {
        owner: ['dashboard', 'analytics', 'products', 'orders', 'invoices', 'users', 'theme', 'social', 'settings', 'notifications', 'coupons', 'inventory', 'audit'],
        admin: ['dashboard', 'analytics', 'products', 'orders', 'invoices', 'users', 'theme', 'social', 'settings', 'notifications', 'coupons', 'inventory', 'audit'],
        manager: ['dashboard', 'products', 'orders', 'invoices', 'users', 'coupons', 'analytics', 'audit'],
        staff: ['dashboard', 'products', 'orders', 'invoices', 'inventory', 'audit']
    },

    // true when the last getUserRole() could not reach a verdict (timeout / network / permission error).
    // Callers must NOT treat that as "no admin role" (don't sign out, don't wipe cache, don't redirect).
    lastCheckInconclusive: false,

    async getUserRole(user) {
        this.lastCheckInconclusive = false;
        if (!user) return null;

        const validRoles = ['owner', 'admin', 'manager', 'staff'];
        let inconclusive = false;

        const withTimeout = (promise, ms = 6000) =>
            Promise.race([
                promise,
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms))
            ]);

        const remember = (raw) => {
            let r = String(raw || '').toLowerCase();
            if (r === 'admin') r = 'owner';
            if (!validRoles.includes(r)) return null;
            safeStore.set(sessionStorage, 'kc_admin_role', r);
            safeStore.set(localStorage, 'kc_admin_role', r);
            return r;
        };

        const roleFromClaims = (res) => {
            const c = res && res.claims;
            if (!c) return null;
            return remember(c.role || (c.admin ? 'admin' : null));
        };

        // 1. Custom claims. First use the token already on the device (no network call).
        //    Only if that has no role, force ONE refresh (claims may have just been granted).
        try {
            let r = roleFromClaims(await withTimeout(user.getIdTokenResult(false)));
            if (r) return r;
            r = roleFromClaims(await withTimeout(user.getIdTokenResult(true)));
            if (r) return r;
        } catch (error) {
            inconclusive = true;
            console.warn('[RBAC] ID token claims check failed:', error.code || error.message);
        }

        // 2 & 3. Firestore fallback (users, then admins)
        for (const col of ['users', 'admins']) {
            try {
                const snap = await withTimeout(getDoc(doc(db, col, user.uid)));
                if (snap && snap.exists() && snap.data() && snap.data().role) {
                    const r = remember(snap.data().role);
                    if (r) return r;
                }
            } catch (e) {
                inconclusive = true;
                console.warn(`[RBAC] Firestore ${col} check failed:`, e.code || e.message);
            }
        }

        // 4. No role found.
        if (inconclusive) {
            // We could not verify - keep whatever is cached, let the caller show a retry message.
            this.lastCheckInconclusive = true;
            console.warn('[RBAC] Role check inconclusive (network / App Check / permissions).');
            return null;
        }
        safeStore.del(sessionStorage, 'kc_admin_role');
        safeStore.del(localStorage, 'kc_admin_role');
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

