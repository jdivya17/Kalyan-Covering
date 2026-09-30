/**
 * Header.js — Kalyan Covering
 * Global Luxury Shell: Announcement Bar, Sticky Header, Desktop Mega Menu,
 * Mobile Hamburger Drawer, Mobile Bottom Tab Bar, Account Popover, Search Modal, Floating WhatsApp.
 */

import { ic } from '../utils/icons.js';
import { KC } from '../store/state.js';

export function renderHeader() {
  const user = KC.user || JSON.parse(localStorage.getItem('kc_user') || 'null');
  const cartCount = KC.cart ? KC.cart.reduce((s, i) => s + (i.qty || 1), 0) : 0;
  const wishCount = KC.wishlist ? KC.wishlist.length : 0;
  const currentPath = window.location.pathname;

  return `
    <!-- Announcement Bar -->
    <div class="ann">
      <div class="ann-track">
        <span>✨ 100% Real Gold Covering Jewellery</span>
        <span>🚚 Free Shipping Nationwide Above ₹999</span>
        <span>⭐ Erode's Most Trusted Jewellery Store Since 2012</span>
        <span>✨ 100% Real Gold Covering Jewellery</span>
        <span>🚚 Free Shipping Nationwide Above ₹999</span>
      </div>
    </div>

    <!-- Sticky Header -->
    <header class="top">
      <div class="wrap hbar">
        <!-- Brand / Logo -->
        <a href="index.html" class="brand" aria-label="Kalyan Covering Home">
          <svg viewBox="0 0 100 100" fill="none" stroke="var(--gold)" stroke-width="2">
            <polygon points="50,5 95,50 50,95 5,50" fill="rgba(214,178,94,0.06)"/>
            <polygon points="50,18 82,50 50,82 18,50"/>
            <circle cx="50" cy="50" r="14" fill="var(--foil)"/>
          </svg>
          <div>
            <b>KALYAN</b>
            <small>COVERING JEWELLERY</small>
          </div>
        </a>

        <!-- Desktop Navigation -->
        <nav class="hl">
          <div class="nav">
            <a href="index.html" ${currentPath.endsWith('index.html') || currentPath === '/' || currentPath.endsWith('/customer/') ? 'aria-current="page"' : ''}>Home</a>
            
            <a href="products.html?category=Necklaces" class="mega-trigger" data-mega="Necklaces">Necklaces ${ic('chev', 12)}</a>
            <a href="products.html?category=Rings" class="mega-trigger" data-mega="Rings">Rings ${ic('chev', 12)}</a>
            <a href="products.html?category=Earrings" class="mega-trigger" data-mega="Earrings">Earrings ${ic('chev', 12)}</a>
            <a href="products.html?category=Bangles" class="mega-trigger" data-mega="Bangles">Bangles ${ic('chev', 12)}</a>
            
            <a href="products.html" ${currentPath.endsWith('products.html') && !window.location.search ? 'aria-current="page"' : ''}>All Shop</a>
            <a href="/video-display.html" ${currentPath.endsWith('video-display.html') ? 'aria-current="page"' : ''}>Videos</a>
          </div>
        </nav>

        <!-- Right Header Icons -->
        <div class="icons">
          <!-- Mobile Hamburger Toggle -->
          <button class="ib only-m" id="hamburger-btn" onclick="toggleMobileMenu()" aria-label="Open menu">
            ${ic('menu', 22)}
          </button>

          <!-- Search Button -->
          <button class="ib" onclick="toggleSearch()" aria-label="Search collection">
            ${ic('search', 20)}
          </button>

          <!-- Wishlist Button -->
          <a href="wishlist.html" class="ib hide-m" aria-label="Wishlist">
            ${ic('heart', 20)}
            <span class="cnt ${wishCount > 0 ? 'on' : ''}" id="wishlist-count">${wishCount}</span>
          </a>

          <!-- Account Popover Wrapper -->
          <div class="acw hide-m">
            <button class="ib" id="account-btn" onclick="toggleAccountPopover()" aria-label="Account menu">
              ${ic('user', 20)}
            </button>
            <div class="pop" id="pop">
              ${renderAccountPopoverContent(user)}
            </div>
          </div>

          <!-- Shopping Bag Link -->
          <a class="ib" href="cart.html" aria-label="Shopping bag">
            ${ic('bag', 20)}
            <span class="cnt cart-count ${cartCount > 0 ? 'on' : ''}">${cartCount}</span>
          </a>
        </div>
      </div>

      <!-- Mega Menu Container -->
      <div class="mega" id="mega" onmouseleave="closeMega()">
        <div class="wrap mg" id="mgIn"></div>
      </div>
    </header>

    <form class="kc-msearch" onsubmit="event.preventDefault(); location.href='products.html?search='+encodeURIComponent(this.q.value)">
      <input name="q" type="search" placeholder="Search for necklaces, rings, bangles…" aria-label="Search">
    </form>

    <!-- Overlay / Scrim -->
    <div id="scrim" onclick="closeAllDrawers()"></div>

    <!-- Mobile Drawer Menu -->
    <div class="panel" id="menu">
      <div class="ph">
        <h3 class="foil">Menu</h3>
        <button class="ib" onclick="closeAllDrawers()" aria-label="Close menu">${ic('close')}</button>
      </div>
      <div class="pb mm">
        <a class="ml" href="products.html">All Jewellery</a>
        <details>
          <summary>Necklaces</summary>
          <ul>
            <li><a href="products.html?category=Necklaces&style=Choker">Chokers</a></li>
            <li><a href="products.html?category=Necklaces&style=Haram">Long Harams</a></li>
            <li><a href="products.html?category=Necklaces&style=Antiques">Antique Sets</a></li>
            <li><a href="products.html?category=Necklaces">View All Necklaces</a></li>
          </ul>
        </details>
        <details>
          <summary>Rings</summary>
          <ul>
            <li><a href="products.html?category=Rings&style=Solitaire">Solitaires</a></li>
            <li><a href="products.html?category=Rings&style=Cocktail">Cocktail Rings</a></li>
            <li><a href="products.html?category=Rings">View All Rings</a></li>
          </ul>
        </details>
        <details>
          <summary>Earrings</summary>
          <ul>
            <li><a href="products.html?category=Earrings&style=Jhumka">Jhumkas</a></li>
            <li><a href="products.html?category=Earrings&style=Studs">Studs & Tops</a></li>
            <li><a href="products.html?category=Earrings">View All Earrings</a></li>
          </ul>
        </details>
        <details>
          <summary>Bangles</summary>
          <ul>
            <li><a href="products.html?category=Bangles&style=Kada">Kadas</a></li>
            <li><a href="products.html?category=Bangles&style=Set">Bangle Sets</a></li>
            <li><a href="products.html?category=Bangles">View All Bangles</a></li>
          </ul>
        </details>

        <a class="ml" href="products.html?occasion=Bridal">Bridal Collections</a>

        <div class="small">
          <a href="profile.html">${ic('user', 18)} My Profile</a>
          <a href="my-orders.html">${ic('box', 18)} My Orders & Tracking</a>
          <a href="wishlist.html">${ic('heart', 18)} Wishlist</a>
          <a href="profile.html#addresses">${ic('pin', 18)} Saved Addresses</a>
        </div>
      </div>
      <div class="pf">
        <div class="soc">
          <a href="https://instagram.com/kalyan_covering" target="_blank" rel="noopener" aria-label="Instagram">${ic('ig', 20)}</a>
          <a href="https://facebook.com/kalyan_covering" target="_blank" rel="noopener" aria-label="Facebook">${ic('fb', 20)}</a>
          <a href="https://youtube.com/@kalyancovering" target="_blank" rel="noopener" aria-label="YouTube">${ic('yt', 20)}</a>
        </div>
        <a class="btn block" href="tel:+919876543210">${ic('phone', 18)} Call Store</a>
      </div>
    </div>

    <!-- Search Modal -->
    <div id="search">
      <div class="wrap">
        <div class="sbox">
          ${ic('search', 28)}
          <input type="search" id="smart-search-input" placeholder="Search necklaces, rings, bangles..." autocomplete="off" oninput="handleHeaderSearch(this.value)" />
          <button class="ib" onclick="closeSearch()" aria-label="Close search">${ic('close', 24)}</button>
        </div>
        <div class="sres" id="header-search-results"></div>
      </div>
    </div>

    <!-- Floating WhatsApp Button -->
    <a href="https://wa.me/919876543210?text=Hi%20Kalyan%20Covering%2C%20I%20am%20interested%20in%20your%20jewellery!" class="wa" target="_blank" rel="noopener" aria-label="Contact on WhatsApp">
      ${ic('wa', 28)}
    </a>

    <!-- Mobile Bottom Tab Bar (under 860px) -->
    <nav class="tabbar" aria-label="Mobile navigation">
      <a href="index.html" ${currentPath.endsWith('index.html') || currentPath === '/' || currentPath.endsWith('/customer/') ? 'aria-current="true"' : ''}>
        ${ic('home', 20)}
        <span>Home</span>
      </a>
      <a href="products.html" ${currentPath.endsWith('products.html') ? 'aria-current="true"' : ''}>
        ${ic('grid', 20)}
        <span>Shop</span>
      </a>
      <a href="wishlist.html" ${currentPath.endsWith('wishlist.html') ? 'aria-current="true"' : ''}>
        ${ic('heart', 20)}
        <span>Wishlist</span>
        <span class="cnt ${wishCount > 0 ? 'on' : ''}">${wishCount}</span>
      </a>
      <a href="cart.html" ${currentPath.endsWith('cart.html') ? 'aria-current="true"' : ''}>
        ${ic('bag', 20)}
        <span>Bag</span>
        <span class="cnt cart-count ${cartCount > 0 ? 'on' : ''}">${cartCount}</span>
      </a>
      <a href="${user ? 'profile.html' : 'auth.html'}" ${currentPath.endsWith('profile.html') || currentPath.endsWith('auth.html') ? 'aria-current="true"' : ''}>
        ${ic('user', 20)}
        <span>Account</span>
      </a>
    </nav>

    <!-- Toast Notification Container -->
    <div id="toast"></div>
  `;
}

function renderAccountPopoverContent(user) {
  if (user) {
    return `
      <div class="who">
        <b>${user.name || 'Valued Customer'}</b>
        <small>${user.email || user.phone || ''}</small>
      </div>
      <a href="profile.html">${ic('user', 18)} My Profile</a>
      <a href="my-orders.html">${ic('box', 18)} Orders & Tracking</a>
      <a href="profile.html#addresses">${ic('pin', 18)} Saved Addresses</a>
      <a href="wishlist.html">${ic('heart', 18)} Wishlist</a>
      <hr>
      <button onclick="window.logoutUser()">${ic('logout', 18)} Log Out</button>
    `;
  }
  return `
    <a href="auth.html">${ic('user', 18)} Log In</a>
    <a href="auth.html?tab=reg">${ic('plus', 18)} Create Account</a>
    <hr>
    <a href="wishlist.html">${ic('heart', 18)} Wishlist</a>
  `;
}

// Global Shell Interactions
window.toggleAccountPopover = function() {
  const pop = document.getElementById('pop');
  if (pop) pop.classList.toggle('on');
};

window.toggleMobileMenu = function() {
  const menu = document.getElementById('menu');
  const scrim = document.getElementById('scrim');
  if (menu && scrim) {
    menu.classList.add('on');
    scrim.classList.add('on');
    document.body.classList.add('lock');
  }
};

window.closeAllDrawers = function() {
  const menu = document.getElementById('menu');
  const drawer = document.getElementById('drawer');
  const scrim = document.getElementById('scrim');
  const pop = document.getElementById('pop');
  if (menu) menu.classList.remove('on');
  if (drawer) drawer.classList.remove('on');
  if (scrim) scrim.classList.remove('on');
  if (pop) pop.classList.remove('on');
  document.body.classList.remove('lock');
};

// Close mobile menu when tapping any link inside mobile drawer
document.addEventListener('click', (e) => {
  if (e.target.closest('#menu a')) {
    window.closeAllDrawers();
  }
});

window.toggleSearch = function() {
  const search = document.getElementById('search');
  if (!search) return;
  const isOn = search.classList.toggle('on');
  if (isOn) {
    setTimeout(() => document.getElementById('smart-search-input')?.focus(), 100);
    document.body.classList.add('lock');
  } else {
    document.body.classList.remove('lock');
  }
};

window.closeSearch = function() {
  const search = document.getElementById('search');
  if (search) {
    search.classList.remove('on');
    document.body.classList.remove('lock');
  }
};

window.handleHeaderSearch = function(queryStr) {
  const container = document.getElementById('header-search-results');
  if (!container) return;
  if (!queryStr || queryStr.trim().length < 2) {
    container.innerHTML = '';
    return;
  }
  const q = queryStr.toLowerCase().trim();
  const products = KC.products || [];
  const matches = products.filter(p =>
    (p.name && p.name.toLowerCase().includes(q)) ||
    (p.category && p.category.toLowerCase().includes(q))
  ).slice(0, 6);

  if (matches.length === 0) {
    container.innerHTML = `<div class="sub" style="padding:1rem 0;">No jewellery found matching "${queryStr}"</div>`;
    return;
  }

  container.innerHTML = matches.map(p => `
    <a href="product-detail.html?id=${p.id}" class="sr-i">
      <img src="${p.image || p.primaryImageURL || p.images?.[0] || '/img-fallback.svg'}" alt="${p.name}" />
      <div>
        <b>${p.name}</b>
        <small>${p.category || 'Jewellery'}</small>
      </div>
      <div style="color:var(--gold);font-weight:600;">₹${Number(p.price).toLocaleString('en-IN')}</div>
    </a>
  `).join('');
};

window.closeMega = function() {
  const mega = document.getElementById('mega');
  if (mega) mega.classList.remove('on');
};

// Setup Mega Menu Hover triggers
document.addEventListener('mouseover', (e) => {
  const trigger = e.target.closest('.mega-trigger');
  if (trigger) {
    const category = trigger.dataset.mega;
    openMegaMenu(category);
  }
});

function openMegaMenu(category) {
  const mega = document.getElementById('mega');
  const mgIn = document.getElementById('mgIn');
  if (!mega || !mgIn) return;

  const megaData = {
    Necklaces: {
      styles: ['Choker', 'Haram', 'Antiques'],
      stones: ['CZ Ruby', 'Kundan', 'Emerald'],
      occasions: ['Bridal', 'Wedding', 'Festive', 'Everyday']
    },
    Rings: {
      styles: ['Solitaire', 'Cocktail', 'Traditional'],
      stones: ['CZ Diamond', 'Ruby', 'Pearl'],
      occasions: ['Bridal', 'Engagement', 'Everyday']
    },
    Earrings: {
      styles: ['Jhumka', 'Studs', 'Chandbali'],
      stones: ['CZ Stone', 'Kundan', 'Pearl'],
      occasions: ['Festive', 'Wedding', 'Daily Wear']
    },
    Bangles: {
      styles: ['Kada', 'Set of 4', 'Thin Bangle'],
      stones: ['Gold Plated', 'Stone Studded', 'Antique'],
      occasions: ['Bridal', 'Festive', 'Daily Wear']
    }
  };

  const data = megaData[category];
  if (!data) return;

  mgIn.innerHTML = `
    <div>
      <h4>${category} By Style</h4>
      <ul>
        ${data.styles.map(s => `<li><a href="products.html?category=${category}&style=${s}">${s}</a></li>`).join('')}
        <li><a href="products.html?category=${category}" style="color:var(--gold-hi);">View All ${category}</a></li>
      </ul>
    </div>
    <div>
      <h4>By Stone / Polish</h4>
      <ul>
        ${data.stones.map(st => `<li><a href="products.html?category=${category}&stone=${st}">${st}</a></li>`).join('')}
      </ul>
    </div>
    <div>
      <h4>By Occasion</h4>
      <ul>
        ${data.occasions.map(o => `<li><a href="products.html?category=${category}&occasion=${o}">${o}</a></li>`).join('')}
      </ul>
    </div>
    <a class="feat" href="products.html?category=${category}">
      <img src="https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=500&fit=crop" alt="Featured ${category}" />
      <div>
        <b>Featured ${category}</b>
        <span>Browse Craftsmanship</span>
      </div>
    </a>
  `;
  mega.classList.add('on');
}
