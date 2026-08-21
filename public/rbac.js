// rbac.js - Reusable Role-Based Access Control Middleware

export const RBAC = {
    // Define which roles can access which resources (panels)
    permissions: {
        owner: ['dashboard', 'analytics', 'products', 'orders', 'users', 'theme', 'social', 'settings', 'notifications', 'coupons', 'inventory'],
        manager: ['dashboard', 'products', 'orders', 'users', 'coupons', 'analytics'], // users = customers, analytics = reports
        staff: ['dashboard', 'products', 'orders', 'inventory']
    },

    /**
     * Get the user's role from their custom claims
     * @param {Object} user - Firebase user object
     * @returns {Promise<string|null>} The user's role or null
     */
    async getUserRole(user) {
        if (!user) return null;
        try {
            // Force refresh to ensure we always have the latest role claims
            const idTokenResult = await user.getIdTokenResult(true);
            return idTokenResult.claims.role || null;
        } catch (error) {
            console.error('Error fetching custom claims:', error);
            return null;
        }
    },

    /**
     * Check if a given role has access to a specific resource
     * @param {string} role - The user's role (owner, manager, staff)
     * @param {string} resource - The resource being accessed (e.g. 'products')
     * @returns {boolean} True if access is granted, false otherwise
     */
    canAccess(role, resource) {
        if (!role || !this.permissions[role]) return false;
        
        // Owner has full access to everything explicitly, but we can also just return true if role is owner.
        if (role === 'owner') return true;

        return this.permissions[role].includes(resource);
    },

    /**
     * Parse the DOM and hide elements that the user does not have access to.
     * Uses the 'data-rbac' attribute on HTML elements.
     * @param {string} role - The user's role
     */
    applyUI(role) {
        const elements = document.querySelectorAll('[data-rbac]');
        elements.forEach(el => {
            const resource = el.getAttribute('data-rbac');
            if (resource && !this.canAccess(role, resource)) {
                el.style.display = 'none'; // Hide unauthorized element
            } else {
                // We keep it visible, removing display none if it was hidden
                el.style.display = '';
            }
        });
    }
};
