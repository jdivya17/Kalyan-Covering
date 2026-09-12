/**
 * Modal.js — Kalyan Covering
 * Universal modal overlay controller.
 * Works with any .modal-overlay element that has an ID.
 *
 * Usage:
 *   Modal.open('product-modal');
 *   Modal.close('product-modal');
 *   // or from HTML: onclick="Modal.open('xyz')"
 */

export const Modal = {
    /**
     * Open a modal by ID
     * @param {string} id
     */
    open(id) {
        const modal = document.getElementById(id);
        if (!modal) return;
        modal.classList.add('active');
        modal.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';

        // Focus first focusable element inside
        requestAnimationFrame(() => {
            const focusable = modal.querySelector(
                'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
            );
            focusable?.focus();
        });

        // Close on overlay click
        modal._overlayHandler = (e) => {
            if (e.target === modal) this.close(id);
        };
        modal.addEventListener('click', modal._overlayHandler);
    },

    /**
     * Close a modal by ID
     * @param {string} id
     */
    close(id) {
        const modal = document.getElementById(id);
        if (!modal) return;
        modal.classList.remove('active');
        modal.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
        if (modal._overlayHandler) {
            modal.removeEventListener('click', modal._overlayHandler);
            delete modal._overlayHandler;
        }
    },

    /**
     * Toggle a modal by ID
     * @param {string} id
     */
    toggle(id) {
        const modal = document.getElementById(id);
        if (!modal) return;
        if (modal.classList.contains('active')) {
            this.close(id);
        } else {
            this.open(id);
        }
    },

    /**
     * Close all currently open modals
     */
    closeAll() {
        document.querySelectorAll('.modal-overlay.active').forEach(m => {
            this.close(m.id);
        });
    },

    /**
     * Initialize global keyboard listener (ESC to close)
     */
    init() {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.closeAll();
        });
    }
};

// Bind to window for HTML onclick compatibility
window.Modal = Modal;
window.openModal = (id) => Modal.open(id);
window.closeModal = (id) => Modal.close(id);

// Auto-initialize on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => Modal.init());
} else {
    Modal.init();
}
