/**
 * Loader.js — Kalyan Covering
 * Global spinner/skeleton overlay loader.
 *
 * Usage:
 *   Loader.show('Loading products...');
 *   Loader.hide();
 *   Loader.showSkeleton('products-grid', 6); // Skeleton cards
 */

export const Loader = {
    _overlay: null,

    /**
     * Get or create the fullscreen overlay element
     * @returns {HTMLElement}
     */
    _getOverlay() {
        if (!this._overlay) {
            this._overlay = document.getElementById('kc-loader-overlay');
            if (!this._overlay) {
                this._overlay = document.createElement('div');
                this._overlay.id = 'kc-loader-overlay';
                this._overlay.className = 'kc-loader-overlay';
                this._overlay.setAttribute('aria-live', 'polite');
                this._overlay.setAttribute('role', 'status');
                this._overlay.innerHTML = `
                    <div class="kc-spinner" aria-hidden="true"></div>
                    <div class="kc-loader-msg" style="color:var(--gold);font-size:0.9rem;letter-spacing:1px;text-transform:uppercase;font-family:var(--font-sans);"></div>
                `;
                document.body.appendChild(this._overlay);
            }
        }
        return this._overlay;
    },

    /**
     * Show the fullscreen loading overlay
     * @param {string} message - Optional loading message
     */
    show(message = '') {
        const overlay = this._getOverlay();
        const msg = overlay.querySelector('.kc-loader-msg');
        if (msg) msg.textContent = message;
        overlay.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    },

    /**
     * Hide the fullscreen loading overlay
     */
    hide() {
        const overlay = this._overlay || document.getElementById('kc-loader-overlay');
        if (overlay) overlay.style.display = 'none';
        document.body.style.overflow = '';
    },

    /**
     * Render skeleton product card placeholders inside a container
     * @param {string|HTMLElement} containerOrId - Container element or its ID
     * @param {number} count - Number of skeleton cards to render
     */
    showSkeleton(containerOrId, count = 6) {
        const container = typeof containerOrId === 'string'
            ? document.getElementById(containerOrId)
            : containerOrId;
        if (!container) return;

        container.innerHTML = Array.from({ length: count }, () => `
            <div class="product-card skeleton-card" aria-hidden="true">
                <div class="card-img-wrap skeleton-img"></div>
                <div class="card-body">
                    <div class="skeleton-line wide"></div>
                    <div class="skeleton-line medium"></div>
                    <div class="skeleton-line narrow"></div>
                </div>
            </div>
        `).join('');
    },

    /**
     * Clear skeleton placeholders by replacing with empty string
     * @param {string|HTMLElement} containerOrId
     */
    clearSkeleton(containerOrId) {
        const container = typeof containerOrId === 'string'
            ? document.getElementById(containerOrId)
            : containerOrId;
        if (container) container.innerHTML = '';
    },

    /**
     * Show a small inline spinner inside an element
     * @param {HTMLElement|string} btnOrId - Button or element to show spinner in
     * @param {string} label - Accessible label for the spinner
     * @returns {Function} Restore function to call when done
     */
    spinButton(btnOrId, label = 'Loading…') {
        const btn = typeof btnOrId === 'string' ? document.getElementById(btnOrId) : btnOrId;
        if (!btn) return () => {};
        const original = btn.innerHTML;
        const originalDisabled = btn.disabled;
        btn.disabled = true;
        btn.innerHTML = `<span class="kc-spinner" style="width:18px;height:18px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:6px;" aria-hidden="true"></span>${label}`;
        return () => {
            btn.innerHTML = original;
            btn.disabled = originalDisabled;
        };
    }
};

// Bind to window for HTML compatibility
window.Loader = Loader;
