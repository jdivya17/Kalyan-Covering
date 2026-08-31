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
    signOut,
    sendPasswordResetEmail,
    onAuthStateChanged
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
    const response = await fetch(endpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify(data)
    });
    const result = await response.json();
    if (!response.ok) {
        throw new Error(result.message || result.error || "API Request Failed");
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
    signOut,
    sendPasswordResetEmail,
    onAuthStateChanged
};
