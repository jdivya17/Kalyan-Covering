// ╔══════════════════════════════════════════════════════════════╗
// ║  firebase-config.js  –  Kalyan Covering                      ║
// ║  ES-Module export of Firebase app, auth, and Firestore       ║
// ║  Imported by:  auth.html  •  checkout.html                   ║
// ╚══════════════════════════════════════════════════════════════╝

import { initializeApp, getApps, getApp } from "firebase/app";
import { getFunctions, httpsCallable } from "firebase/functions";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";

import {
    getFirestore,
    collection,
    doc,
    getDoc,
    getDocs,
    setDoc,
    addDoc,
    updateDoc,
    deleteDoc,
    writeBatch,
    query,
    where,
    orderBy,
    serverTimestamp,
    Timestamp,
    increment,
    onSnapshot,
    arrayUnion
} from "firebase/firestore";

import {
    getAuth,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    sendEmailVerification,
    signOut,
    sendPasswordResetEmail,
    onAuthStateChanged,
    RecaptchaVerifier,
    signInWithPhoneNumber,
    setPersistence,
    browserLocalPersistence,
    browserSessionPersistence,
    getMultiFactorResolver,
    PhoneAuthProvider,
    PhoneMultiFactorGenerator,
    TotpMultiFactorGenerator
} from "firebase/auth";

// Firebase Storage removed — all file uploads now go through Cloudinary (cloudinaryUtils.js)

// ── Firebase project config ── ✅ Updated to: kalyancoveringstore-c53e4
const firebaseConfig = {
    apiKey: "AIzaSyDIubUWf0tbhdruetUyFRPvzXkdHZ7gLbQ",
    authDomain: "kalyancoveringstore-c53e4.firebaseapp.com",
    projectId: "kalyancoveringstore-c53e4",
    storageBucket: "kalyancoveringstore-c53e4.firebasestorage.app",
    messagingSenderId: "360203251639",
    appId: "1:360203251639:web:27da7f788859bdb4068232"
};

// ── Initialize (reuse existing instance if hot-reloaded) ──────
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const functions = getFunctions(app);

// ── App Check (moved here from app.js — ONE app, ONE App Check) ──
const _isLocalhostAC = (
    typeof window !== 'undefined' &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
);
if (typeof window !== 'undefined' && !_isLocalhostAC) {
    try {
        const RECAPTCHA_V3_SITE_KEY = '6LdWCp0tAAAAAD0xB9blIVm3IT6A7KBC2o50SfS-';
        if (RECAPTCHA_V3_SITE_KEY) {
            initializeAppCheck(app, {
                provider: new ReCaptchaV3Provider(RECAPTCHA_V3_SITE_KEY),
                isTokenAutoRefreshEnabled: true
            });
            console.log('App Check initialized (single shared app instance)');
        }
    } catch (err) {
        console.warn('App Check init skipped/failed:', err);
    }
}

// ── Vercel API Base URL ────────────────────────────────────────
// Firebase Hosting serves only static files — it has NO backend.
// When the site is running on Firebase (not localhost / Vite dev),
// we must send /api/* requests to the Vercel deployment instead.
// On localhost (Vite dev server) the Express API runs as middleware,
// so relative URLs work fine there.
const _isLocalhost = (
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname.startsWith("192.168.")
);
const VERCEL_API_BASE = _isLocalhost
    ? ""   // relative URL works on local Vite dev server
    : "https://kalyan-covering-store.vercel.app"; // ← ⚠️ UPDATE THIS if your Vercel deployment URL changes

/**
 * Helper to call Vercel API endpoints with Firebase Auth Token.
 * @param {string} endpoint - The API path, e.g., '/api/payments/create-order'
 * @param {object} data - The payload
 */
async function callVercelApi(endpoint, data = {}, isRetry = false) {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
        throw new Error('No internet connection. Please check your network connection and try again.');
    }

    let token = "";
    if (auth.currentUser) {
        try {
            token = await Promise.race([
                auth.currentUser.getIdToken(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Token timeout')), 3500))
            ]);
        } catch (_) {}
    }

    const timeoutMs = 30000; // 30s timeout

    const url = VERCEL_API_BASE + endpoint;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    
    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify(data),
            signal: controller ? controller.signal : undefined
        });
        if (timeoutId) clearTimeout(timeoutId);

        let result = {};
        const text = await response.text();
        try {
            result = text ? JSON.parse(text) : {};
        } catch (e) {
            result = { error: text || `HTTP ${response.status} ${response.statusText}` };
        }

        if (!response.ok) {
            let errMsg = result.message || result.error || `Server error (HTTP ${response.status})`;
            if (response.status === 403 || result.error === 'permission-denied' || (typeof errMsg === 'string' && (errMsg.includes('role required') || errMsg.includes('Permission') || errMsg.includes('permission')))) {
                errMsg = "Your account isn't authorized for this action — ask an owner to grant your role.";
            }
            const customErr = new Error(errMsg);
            customErr.status = response.status;
            throw customErr;
        }
        return result;
    } catch (err) {
        if (timeoutId) clearTimeout(timeoutId);
        
        // 1 retry on network or timeout errors
        if (!isRetry && (err.name === 'AbortError' || err.message?.includes('Failed to fetch') || err instanceof TypeError)) {
            console.warn(`[callVercelApi] Retrying call to ${endpoint}...`);
            return callVercelApi(endpoint, data, true);
        }

        if (err.name === 'AbortError') {
            throw new Error(`Request timed out after 30 seconds. Network slow ah irukku, please try again.`);
        }
        if (err.message && err.message.includes('Failed to fetch')) {
            throw new Error('Network error. Unable to reach server, please check your internet connection.');
        }
        throw err;
    }
}

// ── Named exports (used by auth.html, checkout.html, etc.) ────
export {
    app,
    db,
    auth,
    functions,
    httpsCallable,
    callVercelApi,
    // Firestore helpers
    collection,
    doc,
    getDoc,
    getDocs,
    setDoc,
    addDoc,
    updateDoc,
    deleteDoc,
    writeBatch,
    query,
    where,
    orderBy,
    serverTimestamp,
    Timestamp,
    increment,
    onSnapshot,
    arrayUnion,
    // Auth helpers
    getAuth,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    sendEmailVerification,
    signOut,
    sendPasswordResetEmail,
    onAuthStateChanged,
    RecaptchaVerifier,
    signInWithPhoneNumber,
    setPersistence,
    browserLocalPersistence,
    browserSessionPersistence,
    getMultiFactorResolver,
    PhoneAuthProvider,
    PhoneMultiFactorGenerator,
    TotpMultiFactorGenerator
};
