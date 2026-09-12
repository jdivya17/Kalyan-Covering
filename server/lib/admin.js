"use strict";

// This file is ONLY for code that runs INSIDE Firebase Cloud Functions
// (functions/index.js, functions/shipping/*.js).
//
// Cloud Functions has ambient Google credentials — admin.initializeApp()
// with NO arguments is correct here. Do NOT use admin.credential.cert(...)
// in this file; that pattern is only needed for code running OUTSIDE
// Firebase's own infrastructure (e.g. a Vercel serverless function),
// which needs an explicit service account key instead.

const admin = require("firebase-admin");
const path = require("path");
const fs = require("fs");

if (!admin.apps.length) {
    const localKeyPath = path.join(__dirname, "../../scripts/serviceAccountKey.json");
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        try {
            const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
        } catch (e) {
            console.error("[Firebase Admin] Failed to parse FIREBASE_SERVICE_ACCOUNT JSON, falling back to default:", e.message);
            admin.initializeApp();
        }
    } else if (fs.existsSync(localKeyPath)) {
        try {
            const serviceAccount = require(localKeyPath);
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
        } catch (e) {
            console.error("[Firebase Admin] Failed to load local serviceAccountKey.json:", e.message);
            admin.initializeApp();
        }
    } else {
        admin.initializeApp();
    }
}

const db = admin.firestore();

module.exports = { admin, db };