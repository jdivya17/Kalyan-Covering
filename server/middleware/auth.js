"use strict";

const { admin, db } = require("../lib/admin");

/**
 * Middleware: Verify Firebase ID token from Authorization header.
 * Sets req.user = decoded token (uid, role, email, etc.)
 * Sets req.isAdmin, req.isOwnerOrManager based on custom claims.
 */
async function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization || "";
    if (!authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "unauthenticated", message: "Missing Authorization header." });
    }
    const idToken = authHeader.split("Bearer ")[1];
    try {
        const decoded = await admin.auth().verifyIdToken(idToken);
        req.user = decoded;
        req.isAdmin = ["owner", "manager", "staff"].includes(decoded.role);
        req.isOwnerOrManager = ["owner", "manager"].includes(decoded.role);
        next();
    } catch (err) {
        console.error("[AUTH] Token verification failed:", err.message);
        return res.status(401).json({ error: "unauthenticated", message: "Invalid or expired token." });
    }
}

/**
 * Middleware: Require admin role (owner | manager | staff).
 */
function requireAdmin(req, res, next) {
    if (!req.user) return res.status(401).json({ error: "unauthenticated" });
    if (!req.isAdmin) return res.status(403).json({ error: "permission-denied", message: "Admin role required." });
    next();
}

/**
 * Middleware: Require owner or manager role.
 */
function requireOwnerOrManager(req, res, next) {
    if (!req.user) return res.status(401).json({ error: "unauthenticated" });
    if (!req.isOwnerOrManager) return res.status(403).json({ error: "permission-denied", message: "Owner or Manager role required." });
    next();
}

module.exports = { authMiddleware, requireAdmin, requireOwnerOrManager };
