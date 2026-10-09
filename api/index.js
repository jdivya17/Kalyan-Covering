"use strict";
const express = require("express");
const cors = require("cors");
const app = express();

const defaultOrigins = [
    "https://kalyancoveringstore-c53e4.web.app",
    "https://kalyancoveringstore-c53e4.firebaseapp.com",
    "http://localhost:5173"
];
const extraOrigins = (process.env.CUSTOM_DOMAIN || "")
    .split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
const allowedOrigins = new Set([...defaultOrigins, ...extraOrigins]);

const corsOptions = {
    origin: (origin, cb) => cb(null, !origin || allowedOrigins.has(origin)),
    credentials: true
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf;
    }
}));

const ordersRouter = require("../server/routes/orders");
const paymentsRouter = require("../server/routes/payments");
const productsRouter = require("../server/routes/products");
const shippingRouter = require("../server/routes/shipping");
const adminRouter = require("../server/routes/admin");
const invoicesRouter = require("../server/routes/invoices");
const notificationsRouter = require("../server/routes/notifications");
const uploadsRouter = require("../server/routes/uploads");

app.use("/api/orders", ordersRouter);
app.use("/api/payments", paymentsRouter);
app.use("/api/products", productsRouter);
app.use("/api/shipping", shippingRouter);
app.use("/api/admin", adminRouter);
app.use("/api/invoices", invoicesRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/uploads", uploadsRouter);

app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Fallback for missing Vercel routes
app.all("/api/*", (req, res) => {
    res.status(404).json({ error: "Route not found in Vercel API." });
});

module.exports = app;
