// ╔══════════════════════════════════════════════════════════════╗
// ║  firebase-config.js  –  Kalyan Covering                      ║
// ║  ES-Module export of Firebase app, auth, and Firestore       ║
// ║  Imported by:  auth.html  •  checkout.html                   ║
// ╚══════════════════════════════════════════════════════════════╝

import { initializeApp, getApps, getApp } from
    "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getFunctions, httpsCallable } from
    "https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js";

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
    query,
    where,
    orderBy,
    serverTimestamp,
    increment,
    onSnapshot,
    arrayUnion
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

import {
    getAuth,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    sendEmailVerification,
    signOut,
    sendPasswordResetEmail,
    onAuthStateChanged,
    RecaptchaVerifier,
    signInWithPhoneNumber
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

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
    : "https://kalyan-covering-store.vercel.app"; // ← your Vercel deployment URL

/**
 * Helper to call Vercel API endpoints with Firebase Auth Token.
 * @param {string} endpoint - The API path, e.g., '/api/payments/create-order'
 * @param {object} data - The payload
 */
async function callVercelApi(endpoint, data = {}) {
    let token = "";
    if (auth.currentUser) {
        token = await auth.currentUser.getIdToken();
    }
    // Prefix the Vercel URL when not on localhost (Firebase Hosting has no API)
    const url = VERCEL_API_BASE + endpoint;
    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify(data)
    });
    
    let result = {};
    const text = await response.text();
    try {
        result = text ? JSON.parse(text) : {};
    } catch (e) {
        result = { error: text || `HTTP ${response.status} ${response.statusText}` };
    }

    if (!response.ok) {
        throw new Error(result.message || result.error || `API Request Failed (HTTP ${response.status})`);
    }
    return result;
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
    query,
    where,
    orderBy,
    serverTimestamp,
    increment,
    onSnapshot,
    arrayUnion,
    // Auth helpers
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    sendEmailVerification,
    signOut,
    sendPasswordResetEmail,
    onAuthStateChanged,
    RecaptchaVerifier,
    signInWithPhoneNumber
};
