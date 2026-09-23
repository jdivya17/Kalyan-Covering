/**
 * Footer.js — Kalyan Covering
 * Global Luxury Footer Component.
 */

import { ic } from '../utils/icons.js';

export function renderFooter() {
  return `
    <footer class="foot">
      <div class="wrap">
        <div class="fgrid">
          <!-- Brand Column -->
          <div class="fbrand">
            <b>KALYAN COVERING</b>
            <p>Erode's premier destination for 100% authentic gold-covering and micro-plated traditional jewellery. Crafted with perfection since 2012.</p>
            <div class="soc">
              <a href="https://instagram.com/kalyan_covering" target="_blank" rel="noopener" aria-label="Instagram">${ic('ig', 20)}</a>
              <a href="https://facebook.com/kalyan_covering" target="_blank" rel="noopener" aria-label="Facebook">${ic('fb', 20)}</a>
              <a href="https://youtube.com/@kalyancovering" target="_blank" rel="noopener" aria-label="YouTube">${ic('yt', 20)}</a>
              <a href="https://wa.me/919876543210" target="_blank" rel="noopener" aria-label="WhatsApp">${ic('wa', 20)}</a>
            </div>
          </div>

          <!-- Quick Links -->
          <div class="fcol">
            <h4>Quick Links</h4>
            <ul>
              <li><a href="index.html">Home</a></li>
              <li><a href="products.html">All Jewellery Catalog</a></li>
              <li><a href="products.html?tag=Bridal">Bridal Collections</a></li>
              <li><a href="products.html?tag=New">New Arrivals</a></li>
              <li><a href="/video-display.html">Community Videos</a></li>
              <li><a href="/video-upload.html">Upload Jewellery Video</a></li>
            </ul>
          </div>

          <!-- Customer Service -->
          <div class="fcol">
            <h4>Customer Care</h4>
            <ul>
              <li><a href="profile.html">My Account</a></li>
              <li><a href="my-orders.html">Track Order</a></li>
              <li><a href="my-orders.html#returns">Returns & Refunds</a></li>
              <li><a href="wishlist.html">My Wishlist</a></li>
            </ul>
          </div>

          <!-- Showroom & Contact -->
          <div class="fcol">
            <h4>Visit Showroom</h4>
            <ul>
              <li style="color:var(--muted);">${ic('pin', 16)} Main Branch: Bazaar Street, Erode, Tamil Nadu - 638001</li>
              <li style="color:var(--muted);">${ic('phone', 16)} Support: +91 98765 43210</li>
              <li style="color:var(--muted);">${ic('clock', 16)} Open: 9:30 AM – 9:00 PM (Daily)</li>
            </ul>
          </div>
        </div>

        <!-- Footer Bottom Bar -->
        <div class="fbot">
          <div>© ${new Date().getFullYear()} Kalyan Covering Store. All rights reserved.</div>
          <div>Guaranteed Premium Micro Gold Plating • Handcrafted in Tamil Nadu</div>
        </div>
      </div>
    </footer>
  `;
}

window.renderFooter = renderFooter;
