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

if (!admin.apps.length) {
    admin.initializeApp();
}

const db = admin.firestore();

module.exports = { admin, db };