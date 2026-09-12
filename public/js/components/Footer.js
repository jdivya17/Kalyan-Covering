/**
 * Footer.js — Kalyan Covering
 * Reusable footer component.
 * Handles dynamic social links and store info injected from Firestore config.
 */

export const Footer = {
    /**
     * Apply dynamic social/contact links to footer and other elements.
     * Called after config/social is fetched from Firestore.
     * @param {Object} data - Social config from Firestore config/social document
     */
    applySocialLinks(data) {
        if (!data) return;

        const instaUser = data.instagram || 'kalyan_covering';
        const instaUrl = instaUser.startsWith('http')
            ? instaUser
            : `https://www.instagram.com/${instaUser.replace('@', '')}/`;

        const waNum = (data.whatsapp || '919876543210').replace(/\D/g, '');
        const waUrl = `https://wa.me/${waNum}?text=${encodeURIComponent("Hi Kalyan Covering, I'm interested in your jewellery!")}`;

        const fbUrl = data.facebook || 'https://www.facebook.com/kalyan_covering';
        const ytUrl = data.youtube || 'https://www.youtube.com/@kalyancovering';
        const twUrl = data.twitter || 'https://twitter.com/kalyan_covering';

        // Apply to anchor elements with dynamic link classes
        document.querySelectorAll('.dynamic-insta').forEach(el => {
            if (el.tagName === 'A') el.href = instaUrl;
            if (el.classList.contains('insta-handle-text'))
                el.textContent = `@${instaUser.replace('@', '')}`;
        });
        document.querySelectorAll('.dynamic-wa').forEach(el => {
            if (el.tagName === 'A') el.href = waUrl;
        });
        document.querySelectorAll('.dynamic-fb').forEach(el => {
            if (el.tagName === 'A') el.href = fbUrl;
        });
        document.querySelectorAll('.dynamic-yt').forEach(el => {
            if (el.tagName === 'A') el.href = ytUrl;
        });
        document.querySelectorAll('.dynamic-tw').forEach(el => {
            if (el.tagName === 'A') el.href = twUrl;
        });

        // Instagram onclick handler (for non-anchor click targets)
        document.querySelectorAll('.dynamic-insta-click').forEach(el => {
            el.onclick = () => window.open(instaUrl, '_blank', 'noopener,noreferrer');
        });

        // Sync admin social media form inputs if present (admin.html)
        this._syncAdminInputs({ instaUser, waNum, fbUrl, ytUrl, twUrl });
    },

    /**
     * Sync admin settings form inputs for social media
     * @private
     */
    _syncAdminInputs({ instaUser, waNum, fbUrl, ytUrl, twUrl }) {
        const fields = {
            'sm-insta': instaUser,
            'sm-wa': waNum,
            'sm-fb': fbUrl,
            'sm-yt': ytUrl,
            'sm-tw': twUrl
        };
        Object.entries(fields).forEach(([id, val]) => {
            const el = document.getElementById(id);
            if (el && !el.value) el.value = val;
        });
    },

    /**
     * Render branch cards into #branches-grid
     * @param {Array} branches - Branch objects from Firestore
     */
    renderBranches(branches = []) {
        const grid = document.getElementById('branches-grid');
        if (!grid) return;

        if (!branches.length) {
            grid.innerHTML = '<p style="color:var(--white-dim);text-align:center;grid-column:1/-1">No branches listed yet.</p>';
            return;
        }

        grid.innerHTML = branches.map(b => `
            <div class="branch-card reveal">
                <div class="branch-icon" aria-hidden="true">🏪</div>
                <div class="branch-name">${b.name || ''}</div>
                <div class="branch-addr">${b.address || ''}<br>PIN: ${b.pin || ''}</div>
                <a href="tel:${b.phone || ''}" class="branch-tel" aria-label="Call ${b.name}">📞 ${b.phone || ''}</a>
            </div>
        `).join('');

        if (typeof window.initReveal === 'function') window.initReveal();
    }
};

// Bind to window for HTML compatibility
window.Footer = Footer;
window.applySocialLinks = (data) => Footer.applySocialLinks(data);
window.renderBranches = () => Footer.renderBranches(window.KC?.branches || []);
