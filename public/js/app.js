import { KC } from './store/state.js';
import { uploadToCloudinary, getOptimizedUrl } from './utils/cloudinaryUtils.js';
import { Toast } from './components/Toast.js';
import { initHomePage, renderHomePageFeatured } from './pages/homePage.js';
import { initProductsPage, renderProductsList } from './pages/productsPage.js';
import { initCartPage, renderCartView } from './pages/cartPage.js';
import { initAdminDashboardPage, formatAdminOrderBadge } from './pages/adminDashboardPage.js';

// Attach page modules & utility functions to window for legacy inline scripts
window.initHomePage = initHomePage;
window.renderHomePageFeatured = renderHomePageFeatured;
window.initProductsPage = initProductsPage;
window.renderProductsList = renderProductsList;
window.initCartPage = initCartPage;
window.renderCartView = renderCartView;
window.initAdminDashboardPage = initAdminDashboardPage;
window.formatAdminOrderBadge = formatAdminOrderBadge;
window.initCounters = initCounters;
window.initReveal = initReveal;
window.animateCounter = animateCounter;
window.launchConfetti = launchConfetti;
window.addSparkleEffect = addSparkleEffect;



// ---- Firebase Config ----
// ✅ Updated to new Firebase project: kalyancoveringstore-c53e4
const firebaseConfig = {
    apiKey: "AIzaSyDIubUWf0tbhdruetUyFRPvzXkdHZ7gLbQ",
    authDomain: "kalyancoveringstore-c53e4.firebaseapp.com",
    projectId: "kalyancoveringstore-c53e4",
    storageBucket: "kalyancoveringstore-c53e4.firebasestorage.app",
    messagingSenderId: "360203251639",
    appId: "1:360203251639:web:27da7f788859bdb4068232"
};

// Initialize Firebase
let app, db, auth;
let firebaseReady = false;

async function initFirebase() {
    if (firebaseReady) return { db, auth };
    try {
        const { initializeApp, getApps, getApp } = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js");
        const { getFirestore } = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js");
        const { getAuth } = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js");
        const { initializeAppCheck, ReCaptchaV3Provider } = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-check.js");

        // Reuse existing app if already initialized (e.g. by firebase-config.js)
        app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
        
        // Initialize App Check (Production only - skip on localhost to avoid 403 debug token blocks)
        const isLocalhost = typeof window !== 'undefined' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1');
        if (typeof window !== 'undefined' && !isLocalhost) {
            try {
                const RECAPTCHA_V3_SITE_KEY = '6LdWCp0tAAAAAD0xB9blIVm3IT6A7KBC2o50SfS-';
                if (RECAPTCHA_V3_SITE_KEY && RECAPTCHA_V3_SITE_KEY !== 'INSERT_YOUR_REAL_RECAPTCHA_V3_SITE_KEY_HERE') {
                    initializeAppCheck(app, {
                        provider: new ReCaptchaV3Provider(RECAPTCHA_V3_SITE_KEY),
                        isTokenAutoRefreshEnabled: true
                    });
                    console.log('App Check initialized in production');
                }
            } catch (err) {
                console.warn('App Check init skipped/failed:', err);
            }
        }

        db = getFirestore(app);
        auth = getAuth(app);
        firebaseReady = true;
        console.log('Firebase (SDK 10.14.1) connected correctly.');
        return { db, auth };
    } catch (e) {
        console.error('Firebase failed to connect:', e);
        return null;
    }
}
window.initFirebase = initFirebase;

// Cloudinary optimization logic is now imported from utils

// ---- Firestore Data Functions ----
async function loadProductsFromFirebase() {
    // ---- 5-minute sessionStorage cache: avoids re-fetch on every page navigation ----
    const PRODUCTS_CACHE_KEY = 'kc_products_cache';
    const PRODUCTS_CACHE_TTL = 5 * 60 * 1000;
    try {
        const cached = sessionStorage.getItem(PRODUCTS_CACHE_KEY);
        if (cached) {
            const { data, ts } = JSON.parse(cached);
            if (Date.now() - ts < PRODUCTS_CACHE_TTL && Array.isArray(data) && data.length > 0) {
                console.log('Products served from sessionStorage cache.');
                KC.products = data;
                window.dispatchEvent(new CustomEvent('kc-products-loaded', { detail: data }));
                return data;
            }
        }
    } catch (_) { sessionStorage.removeItem(PRODUCTS_CACHE_KEY); }

    const fb = await initFirebase();
    if (!fb) {
        const fallback = getDefaultProducts();
        KC.products = fallback;
        window.dispatchEvent(new CustomEvent('kc-products-loaded', { detail: fallback }));
        return fallback;
    }
    try {
        const { getDocs, collection, query } = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js");
        const q = query(collection(fb.db, "products"));
        const snapshot = await getDocs(q);
        if (snapshot.empty) {
            const fallback = getDefaultProducts();
            KC.products = fallback;
            window.dispatchEvent(new CustomEvent('kc-products-loaded', { detail: fallback }));
            return fallback;
        }
        const products = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        // Store in sessionStorage for subsequent page navigations within this session
        sessionStorage.setItem(PRODUCTS_CACHE_KEY, JSON.stringify({ data: products, ts: Date.now() }));
        KC.products = products;
        window.dispatchEvent(new CustomEvent('kc-products-loaded', { detail: products }));
        return products;
    } catch (e) {
        console.error('Error loading products:', e);
        const fallback = getDefaultProducts();
        KC.products = fallback;
        window.dispatchEvent(new CustomEvent('kc-products-loaded', { detail: fallback }));
        return fallback;
    }
}

async function saveProductToFirebase(product) {
    console.error('_deprecated_ saveProductToFirebase called. Use Cloud Function instead.');
    return null;
}

async function saveOrderToFirestore(orderData) {
    console.error('saveOrderToFirestore is deprecated. Orders must be created securely via Razorpay cloud functions (createRazorpayOrder, verifyPayment).');
    return null;
}

async function saveUserToFirestore(userData) {
    const fb = await initFirebase();
    if (!fb) return;
    try {
        const { doc, setDoc, serverTimestamp, increment } = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js");
        if (!userData.uid) {
            console.error('Cannot save user to Firestore: missing uid');
            return;
        }
        const userRef = doc(fb.db, "users", userData.uid);
        await setDoc(userRef, {
            ...userData,
            lastLogin: serverTimestamp(),
            updatedAt: serverTimestamp(),
            loginCount: increment(1)
        }, { merge: true });
        console.log('User synced to Firestore:', userData.phone);
    } catch (e) {
        console.error('Error syncing user to Firestore:', e);
    }
}

async function initThemeSync() {
    // Uses getDoc + 5-min sessionStorage cache instead of onSnapshot.
    // onSnapshot for live preview is kept only in admin.html.
    const CACHE_KEY = 'kc_theme_cache';
    const CACHE_TTL = 5 * 60 * 1000;
    try {
        const cached = sessionStorage.getItem(CACHE_KEY);
        if (cached) {
            const { data, ts } = JSON.parse(cached);
            if (Date.now() - ts < CACHE_TTL) {
                if (data.value && data.value !== KC.theme) SeasonalTheme.apply(data.value);
                return;
            }
        }
        const fb = await initFirebase();
        if (!fb) return;
        const { doc, getDoc } = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js");
        const snap = await getDoc(doc(fb.db, "settings", "theme"));
        if (snap.exists()) {
            const data = snap.data();
            sessionStorage.setItem(CACHE_KEY, JSON.stringify({ data, ts: Date.now() }));
            if (data.value && data.value !== KC.theme) {
                console.log('Theme loaded:', data.value);
                SeasonalTheme.apply(data.value);
            }
        }
    } catch (e) { console.error('Theme sync error:', e); }
}

async function initSocialLinks() {
    // Uses getDoc + 5-min sessionStorage cache instead of onSnapshot.
    // onSnapshot for live preview is kept only in admin.html.
    const CACHE_KEY = 'kc_social_cache';
    const CACHE_TTL = 5 * 60 * 1000;
    try {
        const cached = sessionStorage.getItem(CACHE_KEY);
        if (cached) {
            const { data, ts } = JSON.parse(cached);
            if (Date.now() - ts < CACHE_TTL) { applySocialLinks(data); return; }
        }
        const fb = await initFirebase();
        if (!fb) return;
        const { doc, getDoc } = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js");
        const snap = await getDoc(doc(fb.db, "config", "social"));
        if (snap.exists()) {
            const data = snap.data();
            sessionStorage.setItem(CACHE_KEY, JSON.stringify({ data, ts: Date.now() }));
            applySocialLinks(data);
        }
    } catch (e) { console.error('Social links sync error:', e); }
}

async function initGeneralSettings() {
    // Uses getDocs + 5-min sessionStorage cache instead of onSnapshot.
    // onSnapshot for live preview is kept only in admin.html.
    const CACHE_KEY = 'kc_branches_cache';
    const CACHE_TTL = 5 * 60 * 1000;
    try {
        const cached = sessionStorage.getItem(CACHE_KEY);
        if (cached) {
            const { data, ts } = JSON.parse(cached);
            if (Date.now() - ts < CACHE_TTL) {
                KC.branches = data;
                renderBranches();
                return;
            }
        }
        const fb = await initFirebase();
        if (!fb) return;
        const { getDocs, collection } = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js");
        const snap = await getDocs(collection(fb.db, "branches"));
        KC.branches = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        sessionStorage.setItem(CACHE_KEY, JSON.stringify({ data: KC.branches, ts: Date.now() }));
        renderBranches();
    } catch (e) { console.error('Settings init error:', e); }
}

function renderBranches() {
    const grid = document.getElementById('branches-grid');
    if (!grid) return;
    
    if (KC.branches.length === 0) {
        grid.innerHTML = '<p style="color:var(--white-dim);text-align:center;grid-column:1/-1">No branches listed yet.</p>';
        return;
    }

    grid.innerHTML = KC.branches.map(b => `
        <div class="branch-card reveal">
            <div class="branch-icon">🏪</div>
            <div class="branch-name">${b.name}</div>
            <div class="branch-addr">${b.address}<br>PIN: ${b.pin}</div>
            <a href="tel:${b.phone}" class="branch-tel">📞 ${b.phone}</a>
        </div>
    `).join('');
    if (typeof initReveal === 'function') initReveal();
}

window.initGeneralSettings = initGeneralSettings;

function applySocialLinks(data) {
    if (!data) return;
    const instaUser = data.instagram || 'kalyan_covering';
    const instaUrl = instaUser.startsWith('http') ? instaUser : `https://www.instagram.com/${instaUser.replace('@', '')}/`;
    const waNum = data.whatsapp || '919876543210';
    const waUrl = `https://wa.me/${waNum}?text=${encodeURIComponent("Hi Kalyan Covering, I'm interested in your jewellery!")}`;
    const fbUrl = data.facebook || 'https://www.facebook.com/kalyan_covering';
    const ytUrl = data.youtube || 'https://www.youtube.com/@kalyancovering';
    const twUrl = data.twitter || 'https://twitter.com/kalyan_covering';

    document.querySelectorAll('.dynamic-insta').forEach(el => {
        if (el.tagName === 'A') el.href = instaUrl;
        if (el.classList.contains('insta-handle-text')) el.textContent = `@${instaUser.replace('@', '')}`;
    });
    document.querySelectorAll('.dynamic-wa').forEach(el => { if (el.tagName === 'A') el.href = waUrl; });
    document.querySelectorAll('.dynamic-fb').forEach(el => { if (el.tagName === 'A') el.href = fbUrl; });
    document.querySelectorAll('.dynamic-yt').forEach(el => { if (el.tagName === 'A') el.href = ytUrl; });
    document.querySelectorAll('.dynamic-tw').forEach(el => { if (el.tagName === 'A') el.href = twUrl; });

    document.querySelectorAll('.dynamic-insta-click').forEach(el => {
        el.onclick = () => window.open(instaUrl, '_blank');
    });

    // Admin IDs if present
    const smInsta = document.getElementById('sm-insta');
    if (smInsta && !smInsta.value) smInsta.value = instaUser;
    const smWa = document.getElementById('sm-wa');
    if (smWa && !smWa.value) smWa.value = waNum;
    const smFb = document.getElementById('sm-fb');
    if (smFb && !smFb.value) smFb.value = fbUrl;
    const smYt = document.getElementById('sm-yt');
    if (smYt && !smYt.value) smYt.value = ytUrl;
    const smTw = document.getElementById('sm-tw');
    if (smTw && !smTw.value) smTw.value = twUrl;
}

window.initThemeSync = initThemeSync;
window.initSocialLinks = initSocialLinks;
window.saveUserToFirestore = saveUserToFirestore;

// ---- Auto Logout Timer (30 minutes) ----
let idleTime = 0;
const IDLE_TIMEOUT_MINUTES = 30;

function resetIdleTimer() {
    idleTime = 0;
}

// Increment idle time every minute
setInterval(() => {
    idleTime++;
    if (idleTime >= IDLE_TIMEOUT_MINUTES) {
        if (KC.user || localStorage.getItem('kc_user')) {
            console.log(`User idle for ${IDLE_TIMEOUT_MINUTES} minutes, logging out...`);
            window.logoutUser(true);
        }
    }
}, 60000);

document.addEventListener('mousemove', resetIdleTimer);
document.addEventListener('keypress', resetIdleTimer);
document.addEventListener('scroll', resetIdleTimer, { passive: true });
document.addEventListener('click', resetIdleTimer);
document.addEventListener('touchstart', resetIdleTimer);

// ---- Secure Logout ----
window.logoutUser = async (isAuto = false) => {
    try {
        if (auth) {
            const { signOut } = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js");
            await signOut(auth);
        }
    } catch (e) { console.error('Signout error:', e); }
    
    // Secure clear
    localStorage.removeItem('kc_user');
    localStorage.removeItem('kc_cart');
    localStorage.removeItem('kc_wishlist');
    sessionStorage.clear();
    
    if (isAuto === true) {
        Toast.info('Session Expired', 'You have been logged out due to inactivity for security reasons.');
    }
    const isAdminPage = window.location.pathname.includes('admin');
    window.location.replace(isAdminPage ? 'admin-login.html' : 'auth.html');
};

async function uploadVideoFile(file) {
    try {
        const result = await uploadVideoToCloudinary(file);
        if (result && result.url) {
            return result.url;
        }
        return null;
    } catch (e) {
        console.error('Error uploading video:', e);
        return null;
    }
}

async function loadVideosFromFirebase() {
    const fb = await initFirebase();
    if (!fb) return getDefaultVideos();
    try {
        const { getDocs, collection, query, where } = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js");
        const q = query(collection(fb.db, "videos"), where("status", "==", "approved"));
        const snapshot = await getDocs(q);
        if (snapshot.empty) return getDefaultVideos();
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (e) {
        console.error('Error loading videos:', e);
        return getDefaultVideos();
    }
}

// ---- Default Data ----
function getDefaultProducts() {
    return KC.products.length > 0 ? KC.products : [
        { id: "p1", name: "Premium Gold Necklace", price: 12500, mrp: 15000, category: "Necklaces", image: "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=800&h=600&fit=crop", rating: 4.8, reviews: 124, stock: "in", isNew: true, popular: true },
        { id: "p2", name: "Royal Diamond Ring", price: 8500, mrp: 10000, category: "Rings", image: "https://images.unsplash.com/photo-1605100804763-247f67b3557e?w=800&h=600&fit=crop", rating: 4.9, reviews: 86, stock: "in", isNew: false, popular: true },
        { id: "p3", name: "Classic Gold Bangles", price: 15000, mrp: 18000, category: "Bangles", image: "https://images.unsplash.com/photo-1611085583191-a3b1a30a8a3a?w=800&h=600&fit=crop", rating: 4.7, reviews: 52, stock: "low", isNew: true, popular: false }
    ];
}

function getDefaultVideos() {
    return [];
}

// ---- Sparkle on Hover ----
function addSparkleEffect(el) {
    let lastSpark = 0;
    el.addEventListener('mousemove', (e) => {
        const now = Date.now();
        if (now - lastSpark < 83) return;
        lastSpark = now;
        const rect = el.getBoundingClientRect();
        for (let i = 0; i < 3; i++) {
            const spark = document.createElement('span');
            spark.className = 'sparkle';
            const angle = Math.random() * 360;
            const dist = Math.random() * 30 + 10;
            spark.style.cssText = `
        left: ${e.clientX - rect.left}px;
        top: ${e.clientY - rect.top}px;
        --tx: ${Math.cos(angle) * dist}px;
        --ty: ${Math.sin(angle) * dist}px;
        width: ${Math.random() * 5 + 3}px;
        height: ${Math.random() * 5 + 3}px;
        animation-delay: ${i * 0.05}s;
      `;
            el.appendChild(spark);
            setTimeout(() => spark.remove(), 700);
        }
    });
}

// ---- Cart Logic ----
let lastCartActionTime = 0;
const Cart = {
    add(product) {
        if (!product || !product.id) return;
        
        const now = Date.now();
        if (now - lastCartActionTime < 200) return;
        lastCartActionTime = now;

        const normalizedProduct = { ...product };
        if (!normalizedProduct.image && normalizedProduct.images && normalizedProduct.images.length > 0) {
            normalizedProduct.image = normalizedProduct.images[0];
        }

        const qtyToAdd = normalizedProduct.qty || 1;
        const existing = KC.cart.find(i => i.id === product.id);
        if (existing) {
            existing.qty = (existing.qty || 1) + qtyToAdd;
        } else {
            KC.cart.push({ ...normalizedProduct, qty: qtyToAdd });
        }
        this.save();
        this.updateBadge();
        Toast.cart(product.name);
    },
    remove(id) {
        KC.cart = KC.cart.filter(i => i.id !== id);
        this.save();
        this.updateBadge();
    },
    total() { return KC.cart.reduce((s, i) => s + (i.price * (i.qty || 1)), 0); },
    count() { return KC.cart.reduce((s, i) => s + (i.qty || 1), 0); },
    save() { localStorage.setItem('kc_cart', JSON.stringify(KC.cart)); },
    updateBadge() {
        document.querySelectorAll('.cart-count').forEach(el => {
            el.textContent = this.count();
            el.classList.remove('pop');
            void el.offsetWidth;
            el.classList.add('pop');
        });
    }
};

// ---- Wishlist ----
const Wishlist = {
    async toggle(product) {
        const idx = KC.wishlist.findIndex(i => i.id === product.id);
        try {
            const { doc, updateDoc, increment } = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js");
            const fb = await initFirebase();
            if (fb && product.id) {
                const productRef = doc(fb.db, "products", product.id);
                if (idx > -1) {
                    KC.wishlist.splice(idx, 1);
                    Toast.info('Removed from Wishlist', product.name);
                    try { await updateDoc(productRef, { wishlistCount: increment(-1) }); } catch (e) { }
                } else {
                    if (!KC.wishlist.some(i => i.id === product.id)) {
                        KC.wishlist.push(product);
                        Toast.success('Added to Wishlist!', product.name);
                        try { await updateDoc(productRef, { wishlistCount: increment(1) }); } catch (e) { }
                    }
                }
            } else {
                if (idx > -1) {
                    KC.wishlist.splice(idx, 1);
                    Toast.info('Removed from Wishlist', product.name);
                } else {
                    if (!KC.wishlist.some(i => i.id === product.id)) {
                        KC.wishlist.push(product);
                        Toast.success('Added to Wishlist!', product.name);
                    }
                }
            }
        } catch (e) {
            console.error('Wishlist toggle error:', e);
            if (idx > -1) {
                KC.wishlist.splice(idx, 1);
                Toast.info('Removed from Wishlist', product.name);
            } else {
                if (!KC.wishlist.some(i => i.id === product.id)) {
                    KC.wishlist.push(product);
                    Toast.success('Added to Wishlist!', product.name);
                }
            }
        }
        localStorage.setItem('kc_wishlist', JSON.stringify(KC.wishlist));
        updateWishlistBadge();
        return idx === -1;
    },
    has(id) { return KC.wishlist.some(i => i.id === id); }
};

// ---- Seasonal Theme ----
const SeasonalTheme = {
    canvas: null,
    ctx: null,
    particles: [],
    animFrame: null,

    init() {
        console.log('Seasonal Theme System Initialized');
    },

    apply(theme) {
        KC.theme = theme;
        localStorage.setItem('kc_theme', theme);
        document.body.className = document.body.className.replace(/\btheme-\S+/g, '').trim();
        if (theme !== 'normal') document.body.classList.add(`theme-${theme}`);
        this.stopParticles();
        if (theme === 'diwali') this.startDiwali();
        else if (theme === 'christmas') this.startChristmas();
    },

    getCanvas() {
        if (!this.canvas) {
            this.canvas = document.getElementById('seasonal-canvas');
            if (!this.canvas) {
                this.canvas = document.createElement('canvas');
                this.canvas.id = 'seasonal-canvas';
                this.canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9998;';
                document.body.appendChild(this.canvas);
            }
            this.ctx = this.canvas.getContext('2d');
        }
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        return this.canvas;
    },

    stopParticles() {
        if (this.animFrame) cancelAnimationFrame(this.animFrame);
        if (this.canvas) this.canvas.remove();
        this.canvas = null; this.ctx = null; this.particles = [];
    },

    startDiwali() {
        this.getCanvas();
        const count = 40;
        for (let i = 0; i < count; i++) {
            this.particles.push({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height,
                size: Math.random() * 4 + 1,
                speed: Math.random() * 1.5 + 0.5,
                opacity: Math.random(),
                color: ['#FFD700', '#FF8C00', '#FF4500', '#FFA500'][Math.floor(Math.random() * 4)],
                type: Math.random() > 0.7 ? 'firecracker' : 'glow',
                vx: (Math.random() - 0.5) * 2,
                vy: -(Math.random() * 2 + 1),
                life: 1,
            });
        }
        this.animateDiwali();
    },

    animateDiwali() {
        const { ctx, canvas } = this;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        this.particles.forEach((p, i) => {
            ctx.save();
            ctx.globalAlpha = p.opacity * p.life;
            ctx.fillStyle = p.color;
            if (window.innerWidth >= 768) {
                ctx.shadowColor = p.color;
                ctx.shadowBlur = 15;
            }
            if (p.type === 'glow') {
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx.fill();
            } else {
                for (let s = 0; s < 6; s++) {
                    ctx.beginPath();
                    ctx.arc(p.x + Math.cos(s * 60 * Math.PI / 180) * p.size * 3, p.y + Math.sin(s * 60 * Math.PI / 180) * p.size * 3, p.size / 2, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
            ctx.restore();
            p.x += p.vx; p.y += p.vy;
            p.life -= 0.003;
            if (p.life < 0 || p.y < -10) {
                this.particles[i] = {
                    x: Math.random() * canvas.width,
                    y: canvas.height + 10,
                    size: Math.random() * 4 + 1, speed: Math.random() * 1.5 + 0.5,
                    opacity: Math.random(), life: 1,
                    color: ['#FFD700', '#FF8C00', '#FF4500', '#FFA500'][Math.floor(Math.random() * 4)],
                    type: Math.random() > 0.7 ? 'firecracker' : 'glow',
                    vx: (Math.random() - 0.5) * 2, vy: -(Math.random() * 2 + 1),
                };
            }
        });
        this.animFrame = requestAnimationFrame(() => this.animateDiwali());
    },

    startChristmas() {
        this.getCanvas();
        for (let i = 0; i < 80; i++) {
            this.particles.push({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height,
                size: Math.random() * 5 + 2,
                vy: Math.random() * 1.5 + 0.3,
                vx: (Math.random() - 0.5) * 0.5,
                opacity: Math.random() * 0.8 + 0.2,
                wobble: Math.random() * Math.PI * 2,
                wobbleSpeed: Math.random() * 0.03 + 0.01,
            });
        }
        this.animateChristmas();
    },

    animateChristmas() {
        const { ctx, canvas } = this;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        this.particles.forEach(p => {
            ctx.save();
            ctx.globalAlpha = p.opacity;
            ctx.fillStyle = '#FFFFFF';
            if (window.innerWidth >= 768) {
                ctx.shadowColor = '#AADDFF';
                ctx.shadowBlur = 10;
            }
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
            p.wobble += p.wobbleSpeed;
            p.x += p.vx + Math.sin(p.wobble) * 0.5;
            p.y += p.vy;
            if (p.y > canvas.height + 10) {
                p.y = -10; p.x = Math.random() * canvas.width;
            }
        });
        this.animFrame = requestAnimationFrame(() => this.animateChristmas());
    }
};

// ---- Reveal on Scroll ----
function initReveal(container = document) {
    const scope = (container && container.querySelectorAll) ? container : document;
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.1 });
    scope.querySelectorAll('.reveal').forEach(el => observer.observe(el));
}

// ---- Counter Animation ----
function animateCounter(el, target, duration = 1500, prefix = '', suffix = '') {
    const start = Date.now();
    const frame = () => {
        const elapsed = Date.now() - start;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 4);
        el.textContent = prefix + Math.floor(eased * target).toLocaleString() + suffix;
        if (progress < 1) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
}

function initCounters(container = document) {
    const scope = (container && container.querySelectorAll) ? container : document;
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const el = entry.target;
                const target = parseInt(el.dataset.target || el.textContent.replace(/\D/g, ''));
                const prefix = el.dataset.prefix || '';
                const suffix = el.dataset.suffix || '';
                animateCounter(el, target, 1600, prefix, suffix);
                observer.unobserve(el);
            }
        });
    }, { threshold: 0.5 });
    scope.querySelectorAll('.counter').forEach(el => observer.observe(el));
}

// ---- Navigation ----
function initNav() {
    const nav = document.getElementById('main-nav') || document.querySelector('.nav');
    const hamburger = document.getElementById('hamburger-btn');
    const authBtns = document.getElementById('nav-auth-btns');
    const userBtn = document.getElementById('nav-user-btn');
    const drawerUserInfo = document.getElementById('drawer-user-info');
    const drawerProfileLink = document.getElementById('drawer-profile-link');
    const user = JSON.parse(localStorage.getItem('kc_user'));

    if (nav) {
        window.addEventListener('scroll', () => {
            nav.classList.toggle('scrolled', window.scrollY > 50);
        }, { passive: true });
    }

    if (user) {
        if (authBtns) authBtns.style.display = 'none';
        if (userBtn) {
            userBtn.style.display = 'block';
            userBtn.innerHTML = `<span style="font-size:0.75rem; color:var(--gold); border:1px solid var(--gold); padding:2px 8px; border-radius:12px; font-weight:700">${(user.name || 'User').split(' ')[0]}</span>`;
        }
        if (drawerUserInfo) {
            drawerUserInfo.style.display = 'flex';
            drawerUserInfo.innerHTML = `<span class="avatar">${(user.name || 'U').charAt(0).toUpperCase()}</span><div><div style="font-weight:600;color:var(--gold)">${user.name || 'User'}</div><div style="font-size:0.8rem;color:var(--white-dim)">${user.phone || ''}</div></div>`;
        }
        if (drawerProfileLink) drawerProfileLink.style.display = 'flex';
    } else {
        if (authBtns) authBtns.style.display = 'flex';
        if (userBtn) userBtn.style.display = 'none';
        if (drawerUserInfo) drawerUserInfo.style.display = 'none';
        if (drawerProfileLink) drawerProfileLink.style.display = 'none';
    }

    if (hamburger) {
        hamburger.classList.remove('open');
    }

    updateWishlistBadge();
    Cart.updateBadge();
}

function updateWishlistBadge() {
    const badge = document.getElementById('wishlist-count');
    if (badge) {
        badge.textContent = KC.wishlist.length;
        badge.style.display = KC.wishlist.length > 0 ? 'flex' : 'none';
        badge.classList.remove('pop');
        void badge.offsetWidth;
        badge.classList.add('pop');
    }
}

// ---- Nav Global Actions ----
window.toggleMobileMenu = function() {
    const drawer = document.getElementById('mobile-drawer');
    const overlay = document.getElementById('mobile-overlay');
    const hamburger = document.getElementById('hamburger-btn');
    if(drawer && overlay) {
        drawer.classList.toggle('open');
        overlay.classList.toggle('active');
        if(hamburger) {
            hamburger.classList.toggle('open');
            const isOpen = drawer.classList.contains('open');
            hamburger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        }
        document.body.style.overflow = drawer.classList.contains('open') ? 'hidden' : '';
    }
};

window.toggleSearch = function() {
    const modal = document.getElementById('search-modal');
    if(modal) {
        modal.classList.toggle('active');
        const isActive = modal.classList.contains('active');
        modal.setAttribute('aria-hidden', isActive ? 'false' : 'true');
        if(isActive) {
            setTimeout(() => document.getElementById('smart-search-input')?.focus(), 100);
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
    }
};

let smartSearchTimeout = null;
window.handleSmartSearch = function(query) {
    if (smartSearchTimeout) clearTimeout(smartSearchTimeout);
    smartSearchTimeout = setTimeout(() => {
        const resultsContainer = document.getElementById('smart-search-results');
        const suggestionLabel = document.querySelector('.search-suggestions-label');
        if (!resultsContainer) return;
        
        if (!query || query.trim().length < 2) {
            resultsContainer.innerHTML = '';
            if (suggestionLabel) suggestionLabel.style.display = 'none';
            return;
        }

        const q = query.trim().toLowerCase();
        const results = KC.products.filter(p => 
            p.name.toLowerCase().includes(q) || 
            (p.category && p.category.toLowerCase().includes(q))
        );

        if (suggestionLabel) suggestionLabel.style.display = 'block';

        if (results.length === 0) {
            resultsContainer.innerHTML = `
                <div style="padding:2rem 1rem;text-align:center;color:var(--white-dim)">
                    <div style="font-size:2rem;margin-bottom:0.5rem">🔍</div>
                    <div style="font-weight:600;color:var(--gold);margin-bottom:0.3rem">No matches for "${query}"</div>
                    <p style="font-size:0.85rem;color:#888;margin-bottom:1rem">Try searching by category or popular collections:</p>
                    <div style="display:flex;gap:0.5rem;justify-content:center;flex-wrap:wrap">
                        <button onclick="window.location='products.html?cat=Necklaces'" class="kc-suggestion-chip">Necklaces</button>
                        <button onclick="window.location='products.html?cat=Rings'" class="kc-suggestion-chip">Rings</button>
                        <button onclick="window.location='products.html?cat=Bangles'" class="kc-suggestion-chip">Bangles</button>
                        <button onclick="window.location='products.html'" class="kc-suggestion-chip">All Products</button>
                    </div>
                </div>`;
        } else {
            resultsContainer.innerHTML = results.slice(0, 5).map(p => `
                <div onclick="window.location='product-detail.html?id=${p.id}'" style="display:flex;align-items:center;gap:1rem;padding:0.8rem;background:var(--black-card);border:1px solid var(--black-border);border-radius:var(--radius);cursor:pointer;transition:border-color 0.2s">
                    <img src="${p.primaryImageURL || p.image || ''}" style="width:50px;height:50px;object-fit:cover;border-radius:4px">
                    <div>
                        <div style="font-weight:600;color:var(--gold)">${p.name}</div>
                        <div style="font-size:0.8rem;color:var(--white-dim)">₹${p.price.toLocaleString()} • ${p.category || 'Jewellery'}</div>
                    </div>
                </div>
            `).join('');
        }
    }, 250);
};

window.logout = function(event) {
    if(event) event.preventDefault();
    localStorage.removeItem('kc_user');
    Toast.success('Logged Out', 'You have successfully logged out.');
    setTimeout(() => {
        window.location = 'index.html';
    }, 1000);
};

window.renderBreadcrumbs = function(containerId, currentLabel) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const urlParams = new URLSearchParams(window.location.search);
    const cat = urlParams.get('cat');
    
    let html = `<div class="breadcrumb-luxury"><a href="index.html">Home</a>`;
    if (window.location.pathname.includes('products.html')) {
        html += `<span class="separator">/</span> <a href="products.html">Products</a>`;
    }
    if (cat) {
        html += `<span class="separator">/</span> <span class="current">${cat}</span>`;
    } else if (currentLabel) {
        html += `<span class="separator">/</span> <span class="current">${currentLabel}</span>`;
    }
    html += `</div>`;
    container.innerHTML = html;
};

// ---- Tabs ----
function initTabs(container) {
    const ctx = container || document;
    const tabBars = [...ctx.querySelectorAll('.tabs'), ...ctx.querySelectorAll('.tab-bar')];
    tabBars.forEach(tabBar => {
        tabBar.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tabId = btn.dataset.tab;
                tabBar.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const panels = tabBar.closest('.tabs-wrapper') || tabBar.parentElement.parentElement;
                panels.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
                const panel = panels.querySelector(`#${tabId}`);
                if (panel) panel.classList.add('active');
            });
        });
    });
}

// ---- Carousel ----
function initCarousel(carouselEl) {
    const track = carouselEl.querySelector('.carousel-track');
    const prevBtn = carouselEl.querySelector('.carousel-btn.prev');
    const nextBtn = carouselEl.querySelector('.carousel-btn.next');
    const dotsContainer = carouselEl.querySelector('.carousel-dots');
    if (!track) return;
    let currentIdx = 0;
    const items = Array.from(track.children);
    const visibleCount = () => {
        if (window.innerWidth < 480) return 1;
        if (window.innerWidth < 768) return 2;
        if (window.innerWidth < 1100) return 3;
        return parseInt(carouselEl.dataset.visible || 4);
    };
    const maxIdx = () => Math.max(0, items.length - visibleCount());

    if (dotsContainer) {
        const dotCount = Math.ceil(items.length / visibleCount());
        dotsContainer.innerHTML = Array.from({ length: dotCount }, (_, i) =>
            `<button class="carousel-dot ${i === 0 ? 'active' : ''}" data-idx="${i}"></button>`
        ).join('');
        dotsContainer.querySelectorAll('.carousel-dot').forEach(dot => {
            dot.addEventListener('click', () => goTo(parseInt(dot.dataset.idx) * visibleCount()));
        });
    }

    const goTo = (idx) => {
        currentIdx = Math.max(0, Math.min(idx, maxIdx()));
        const itemWidth = items[0]?.offsetWidth + 24;
        track.style.transform = `translateX(-${currentIdx * itemWidth}px)`;
        dotsContainer?.querySelectorAll('.carousel-dot').forEach((d, i) => {
            d.classList.toggle('active', i === Math.floor(currentIdx / visibleCount()));
        });
    };

    prevBtn?.addEventListener('click', () => goTo(currentIdx - 1));
    nextBtn?.addEventListener('click', () => goTo(currentIdx + 1));

    let startX = 0, isDragging = false;
    track.addEventListener('mousedown', e => { startX = e.clientX; isDragging = true; });
    track.addEventListener('mousemove', e => { if (isDragging) e.preventDefault(); });
    track.addEventListener('mouseup', e => {
        if (!isDragging) return; isDragging = false;
        const diff = startX - e.clientX;
        if (Math.abs(diff) > 50) goTo(diff > 0 ? currentIdx + 1 : currentIdx - 1);
    });
    track.addEventListener('touchstart', e => { startX = e.touches[0].clientX; }, { passive: true });
    track.addEventListener('touchend', e => {
        const diff = startX - e.changedTouches[0].clientX;
        if (Math.abs(diff) > 50) goTo(diff > 0 ? currentIdx + 1 : currentIdx - 1);
    });

    window.addEventListener('resize', () => goTo(0));
}

KC.products = [];

function renderStars(rating) {
    const full = Math.floor(rating);
    const half = rating % 1 >= 0.5 ? 1 : 0;
    const empty = 5 - full - half;
    return '★'.repeat(full) + (half ? '⯨' : '') + '<span class="empty">' + '★'.repeat(empty) + '</span>';
}

function getStockStatus(p) {
    if (!p) return 'out';
    if (p.stockStatus && typeof p.stockStatus === 'string') return p.stockStatus;
    if (typeof p.stock === 'string' && ['in', 'low', 'out'].includes(p.stock)) return p.stock;
    const num = Number(p.stock);
    if (!isNaN(num)) {
        if (num <= 0) return 'out';
        if (num <= 5) return 'low';
        return 'in';
    }
    return 'in';
}

function renderProductCard(p, mini = false) {
    const stockStatus = getStockStatus(p);
    const stockClass = stockStatus === 'in' ? 'stock-in' : stockStatus === 'low' ? 'stock-low' : 'stock-out';
    const stockText = stockStatus === 'in' ? 'In Stock' : stockStatus === 'low' ? 'Low Stock' : 'Out of Stock';
    const rawImg = p.primaryImageURL || (p.imageURLs && p.imageURLs[0]) || (p.images && p.images[0]) || p.image || 'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=400&h=300&fit=crop';
    const mainImg = getOptimizedUrl(rawImg, 500);

    return `
    <div class="product-card ${mini ? 'mini' : ''}" data-id="${p.id}" onclick="window.location='product-detail.html?id=${p.id}'">
      ${p.isNew ? '<span class="ribbon">NEW</span>' : ''}
      <div class="card-img-wrap">
        <img src="${mainImg}" alt="${p.name}" loading="lazy">
        ${p.discount ? `<span class="card-badge">${p.discount}% OFF</span>` : ''}
        ${!mini ? `
        <button class="wishlist-overlay-btn ${Wishlist.has(p.id) ? 'active' : ''}" onclick="event.stopPropagation();toggleWishlistCard('${p.id}',this)" title="Toggle Wishlist">
            ${Wishlist.has(p.id) ? '♥' : '♡'}
        </button>
        <button class="quick-view-btn" onclick="event.stopPropagation();window.openQuickView('${p.id}')">Quick View</button>
        ` : ''}
      </div>
      <div class="card-body">
        <div class="card-title" title="${p.name}">${p.name}</div>
        <div class="card-stars">${renderStars(p.rating || 4.5)} <span style="color:#666;font-size:0.75rem;font-family:var(--font-sans)">(${p.reviews || 0})</span></div>
        <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap">
          <span class="card-price">₹${p.price.toLocaleString()}</span>
          ${p.mrp && p.mrp > p.price ? `<span class="card-price-old">₹${p.mrp.toLocaleString()}</span>` : ''}
          <span class="stock-badge ${stockClass}"><span class="dot"></span>${stockText}</span>
        </div>
        ${!mini ? `<div class="card-actions">
          <button class="btn btn-gold btn-sm" onclick="event.stopPropagation();addToCartFromCard('${p.id}')" ${stockStatus === 'out' ? 'disabled' : ''}>${stockStatus === 'out' ? 'Out of Stock' : 'Add to Cart'}</button>
        </div>` : ''}
      </div>
    </div>
  `;
}

window.openQuickView = function(id) {
    const p = KC.products.find(prod => prod.id == id);
    if (!p) return;
    
    const modal = document.getElementById('quick-view-modal');
    if (!modal) return;
    
    const rawImg = p.primaryImageURL || (p.imageURLs && p.imageURLs[0]) || p.image || '';
    const imgUrl = getOptimizedUrl(rawImg, 800);
    
    document.getElementById('qv-img').src = imgUrl;
    document.getElementById('qv-title').textContent = p.name;
    document.getElementById('qv-price').textContent = `₹${p.price.toLocaleString()}`;
    document.getElementById('qv-desc').textContent = p.description || 'Experience the elegance of our premium jewellery collection.';
    
    const addToCartBtn = document.getElementById('qv-add-cart');
    addToCartBtn.onclick = function() {
        Cart.add(p);
        if (Math.random() > 0.7) launchConfetti(1000);
        window.closeQuickView();
    };
    
    modal.classList.add('active');
};

window.closeQuickView = function() {
    const modal = document.getElementById('quick-view-modal');
    if (modal) modal.classList.remove('active');
};

function addToCartFromCard(id) {
    const p = KC.products.find(p => p.id == id);
    if (p) { Cart.add(p); if (Math.random() > 0.7) launchConfetti(1000); }
}

async function toggleWishlistCard(id, btn) {
    const p = KC.products.find(p => p.id == id);
    if (p) {
        const added = await Wishlist.toggle(p);
        btn.innerHTML = added ? '♥' : '♡';
        btn.classList.toggle('active', added);
    }
}

// ---- Render Functions ----
function renderFeaturedProducts() {
    const track = document.getElementById('featured-track');
    if (!track || !KC.products) return;
    const featured = KC.products.filter(p => p.featured || p.popular).slice(0, 8);
    track.innerHTML = featured.length > 0 ? featured.map(p => renderProductCard(p)).join('') : '<div style="width:100%;text-align:center;padding:3rem 1rem;color:#666"><div style="font-size:2rem;margin-bottom:0.5rem;opacity:0.4">✦</div><p>New featured pieces coming soon — check back shortly.</p></div>';
    track.querySelectorAll('.product-card').forEach(addSparkleEffect);
    const container = track.closest('.carousel-container');
    if (container) initCarousel(container);
}

function renderRecommendedProducts() {
    const track = document.getElementById('recommended-track');
    if (!track || !KC.products) return;
    const shuffled = [...KC.products].sort(() => Math.random() - 0.5).slice(0, 8);
    track.innerHTML = shuffled.map(p => renderProductCard(p)).join('');
    track.querySelectorAll('.product-card').forEach(addSparkleEffect);
    const container = track.closest('.carousel-container');
    if (container) initCarousel(container);
}

function renderProductsGrid() {
    const grid = document.getElementById('products-grid');
    if (!grid || !KC.products) return;
    grid.innerHTML = KC.products.map(p => renderProductCard(p)).join('');
    grid.querySelectorAll('.product-card').forEach(addSparkleEffect);
}

function renderNewLaunches() {
    const track = document.getElementById('new-track');
    if (!track || !KC.products) return;
    const newProducts = KC.products.filter(p => p.isNew);
    track.innerHTML = newProducts.length > 0 ? newProducts.map(p => renderProductCard(p)).join('') : '<div style="width:100%;text-align:center;padding:3rem 1rem;color:#666"><div style="font-size:2rem;margin-bottom:0.5rem;opacity:0.4">✦</div><p>New launches coming soon — check back shortly.</p></div>';
    track.querySelectorAll('.product-card').forEach(addSparkleEffect);
    const container = track.closest('.carousel-container');
    if (container) initCarousel(container);
}

// ---- Search Functionality ----
function performSearch(query) {
    const resultsContainer = document.getElementById('search-results');
    if (!resultsContainer) return;

    if (query.toLowerCase() === (KC.adminKeyword || 'admin').toLowerCase()) {
        window.location.href = '/admin/admin-login.html';
        return;
    }

    if (!query || query.length < 2) {
        resultsContainer.innerHTML = '';
        return;
    }

    query = query.toLowerCase();
    const results = KC.products.filter(p =>
        p.name.toLowerCase().includes(query) ||
        p.category.toLowerCase().includes(query)
    );

    if (results.length === 0) {
        resultsContainer.innerHTML = `<div class="no-results" style="padding:1.5rem;text-align:center;color:#666">No results for "${query}"</div>`;
    } else {
        resultsContainer.innerHTML = results.slice(0, 5).map(p => `
            <div class="search-result-item" onclick="window.location='product-detail.html?id=${p.id}'" 
                 style="display:flex;align-items:center;gap:1rem;padding:0.8rem;border-bottom:1px solid #1a1a1a;cursor:pointer;transition:background 0.2s">
                <img src="${p.primaryImageURL || p.image}" style="width:50px;height:50px;object-fit:cover;border-radius:6px">
                <div>
                    <div style="font-weight:600;color:var(--gold)">${p.name}</div>
                    <div style="font-size:0.8rem;color:#666">₹${p.price.toLocaleString()}</div>
                </div>
            </div>
        `).join('');
    }
}

function openSearchModal() {
    const modal = document.getElementById('search-modal');
    if (modal) {
        modal.classList.add('active');
        document.getElementById('search-input')?.focus();
    }
}

function closeSearchModal() {
    const modal = document.getElementById('search-modal');
    if (modal) {
        modal.classList.remove('active');
        const input = document.getElementById('search-input');
        if (input) input.value = '';
        const results = document.getElementById('search-results');
        if (results) results.innerHTML = '';
    }
}

// ---- Product Detail Page Functions ----
function addPdToCart() {
    if (currentProduct) {
        const qty = parseInt(document.getElementById('qty-input')?.value) || 1;
        const productToAdd = { ...currentProduct, qty: qty };
        Cart.add(productToAdd);
        if (Math.random() > 0.5) launchConfetti(1000);
    }
}

function buyNow() {
    if (currentProduct) {
        addPdToCart();
        window.location = 'checkout.html';
    }
}

function adjustQty(delta) {
    const input = document.getElementById('qty-input');
    if (input) {
        let val = parseInt(input.value) + delta;
        val = Math.max(1, Math.min(10, val));
        input.value = val;
    }
}

async function toggleWish() {
    if (currentProduct) {
        const added = await Wishlist.toggle(currentProduct);
        const btn = document.getElementById('wishlist-card-btn');
        if (btn) {
            btn.classList.toggle('active', added);
            btn.innerHTML = added ? '♥' : '♡';
        }
    }
}

function shareProduct() {
    if (navigator.share && currentProduct) {
        navigator.share({
            title: currentProduct.name,
            text: 'Check out this product from Kalyan Covering!',
            url: window.location.href
        });
    } else {
        navigator.clipboard.writeText(window.location.href);
        Toast.success('Link copied!', 'Share link copied to clipboard');
    }
}

function selectImage(idx) {
    currentImageIdx = idx;
    const mainImg = document.getElementById('pd-main-img');
    if (mainImg && productImages[idx]) {
        mainImg.src = productImages[idx];
    }
    document.querySelectorAll('.pd-thumb').forEach((t, i) => {
        t.classList.toggle('active', i === idx);
    });
}

function changeImage(delta) {
    const newIdx = (currentImageIdx + delta + productImages.length) % productImages.length;
    selectImage(newIdx);
}

function openLightbox(idx) {
    selectImage(idx);
    const lightbox = document.getElementById('lightbox');
    const img = document.getElementById('lightbox-img');
    if (lightbox && img && productImages[idx]) {
        img.src = productImages[idx];
        lightbox.classList.add('open');
    }
}

function setReviewRating(rating) {
    reviewRating = rating;
    document.querySelectorAll('.star-pick').forEach((s, i) => {
        s.classList.toggle('filled', i < rating);
    });
}

function toggleReviewForm() {
    const form = document.getElementById('add-review-section');
    if (form) {
        form.style.display = form.style.display === 'none' ? 'block' : 'none';
    }
}

function submitReview() {
    const name = document.getElementById('review-name')?.value;
    const title = document.getElementById('review-title')?.value;
    const text = document.getElementById('review-text')?.value;

    if (!name || !title || !text) {
        Toast.error('Please fill all fields');
        return;
    }
    if (reviewRating === 0) {
        Toast.error('Please select a rating');
        return;
    }

    const newReview = {
        name: name,
        avatar: '👤',
        rating: reviewRating,
        date: new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        title: title,
        text: text,
        helpful: 0
    };
    reviews.unshift(newReview);

    document.getElementById('reviews-list').innerHTML = reviews.map(r => `
        <div class="review-card">
            <div class="review-header">
                <div class="reviewer-avatar">${r.avatar}</div>
                <div>
                    <div class="reviewer-name">${r.name}</div>
                    <div class="review-date">${r.date}</div>
                </div>
                <div style="margin-left:auto;color:var(--gold)">${'★'.repeat(r.rating)}</div>
                <span class="badge badge-outline">${r.title}</span>
            </div>
            <div class="review-text">${r.text}</div>
            <div class="review-helpful">
                <span>Was this helpful?</span>
                <button onclick="this.textContent='✓'">👍 ${r.helpful}</button>
            </div>
        </div>
    `).join('');

    Toast.success('Review submitted!', 'Thank you for your feedback');
    toggleReviewForm();

    document.getElementById('review-name').value = '';
    document.getElementById('review-title').value = '';
    document.getElementById('review-text').value = '';
    reviewRating = 0;
    setReviewRating(0);
}

async function handleReviewMediaUpload(files) {
    const previewContainer = document.getElementById('review-upload-previews');
    if (!previewContainer) return;
    previewContainer.innerHTML = '';

    for (const file of files) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const div = document.createElement('div');
            div.className = 'preview-item';
            div.innerHTML = file.type.startsWith('image/')
                ? `<img src="${e.target.result}" style="width:60px;height:50px;object-fit:cover;border-radius:6px">`
                : `<div style="width:60px;height:50px;background:#222;display:flex;align-items:center;justify-content:center;border-radius:6px">📹</div>`;
            previewContainer.appendChild(div);
        };
        reader.readAsDataURL(file);
    }
}

function renderVideoGallery() {
    const gallery = document.getElementById('video-gallery');
    if (!gallery || !KC.videos) return;

    if (KC.videos.length === 0) {
        gallery.innerHTML = '<p style="grid-column:1/-1;text-align:center;padding:3rem;color:#666">No videos found yet.</p>';
        return;
    }

    gallery.innerHTML = KC.videos.map(v => `
        <div class="video-card">
            <video src="${v.url}" poster="${v.thumbnail || ''}" muted loop onmouseover="this.play()" onmouseout="this.pause()"></video>
            <div class="video-info">
                <div class="video-title">${v.title || 'Product Showcase'}</div>
            </div>
        </div>
    `).join('');
}

function launchConfetti(duration = 3000) {
    try {
        const canvas = document.createElement('canvas');
        canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999;';
        document.body.appendChild(canvas);
        const ctx = canvas.getContext('2d');
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        const particles = [];
        for (let i = 0; i < 100; i++) {
            particles.push({
                x: Math.random() * canvas.width,
                y: -20,
                vx: (Math.random() - 0.5) * 10,
                vy: Math.random() * 10 + 5,
                color: ['#FFD700', '#B8860B', '#FFF', '#FFA500'][Math.floor(Math.random() * 4)],
                size: Math.random() * 8 + 4
            });
        }

        const start = Date.now();
        const frame = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            particles.forEach(p => {
                p.x += p.vx;
                p.y += p.vy;
                ctx.fillStyle = p.color;
                ctx.fillRect(p.x, p.y, p.size, p.size);
            });
            if (Date.now() - start < duration) requestAnimationFrame(frame);
            else canvas.remove();
        };
        requestAnimationFrame(frame);
    } catch (e) { console.error('Confetti error', e); }
}

let currentProductDetail = null;

function initRangeSliders() {
    document.querySelectorAll('input[type="range"]').forEach(slider => {
        const update = () => {
            const val = ((slider.value - slider.min) / (slider.max - slider.min)) * 100;
            slider.style.setProperty('--val', val + '%');
        };
        slider.addEventListener('input', update);
        update();
    });
}

function openModal(id) {
    const m = document.getElementById(id);
    if (m) m.classList.add('active');
}
function closeModal(id) {
    const m = document.getElementById(id);
    if (m) m.classList.remove('active');
}
window.openModal = openModal;
window.closeModal = closeModal;
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
        e.target.classList.remove('active');
    }
});

document.addEventListener('DOMContentLoaded', async () => {
    Toast.init();
    initNav();
    initReveal();
    initCounters();
    initTabs();
    initRangeSliders();
    document.querySelectorAll('.carousel-container').forEach(initCarousel);
    document.querySelectorAll('.product-card, .btn-gold').forEach(addSparkleEffect);
    SeasonalTheme.init();
    SeasonalTheme.apply(KC.theme);
    initThemeSync();

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeSearchModal();
        }
    });

    await initFirebase();
    KC.products = await loadProductsFromFirebase();
    KC.videos = await loadVideosFromFirebase();

    if (document.getElementById('featured-track')) {
        renderFeaturedProducts();
    }
    if (document.getElementById('recommended-track')) {
        renderRecommendedProducts();
    }
    if (document.getElementById('products-grid')) {
        renderProductsGrid();
    }
    if (document.getElementById('new-track')) {
        renderNewLaunches();
    }

    if (document.getElementById('video-gallery')) {
        renderVideoGallery();
    }

    window.addEventListener('resize', () => {
        if (SeasonalTheme.canvas) {
            SeasonalTheme.canvas.width = window.innerWidth;
            SeasonalTheme.canvas.height = window.innerHeight;
        }
    });

    if (typeof initSocialLinks === 'function') {
        await initSocialLinks();
    }
    await initGeneralSettings();
});
