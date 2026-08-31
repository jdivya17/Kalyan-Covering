"use strict";
const express = require("express");
const cors = require("cors");
const app = express();

app.use(cors({ origin: true }));
app.use(express.json());

const ordersRouter = require("../server/routes/orders");
const paymentsRouter = require("../server/routes/payments");
const productsRouter = require("../server/routes/products");
const shippingRouter = require("../server/routes/shipping");
const adminRouter = require("../server/routes/admin");
const invoicesRouter = require("../server/routes/invoices");

app.use("/api/orders", ordersRouter);
app.use("/api/payments", paymentsRouter);
app.use("/api/products", productsRouter);
app.use("/api/shipping", shippingRouter);
app.use("/api/admin", adminRouter);
app.use("/api/invoices", invoicesRouter);

// Fallback for missing Vercel routes
app.all("/api/*", (req, res) => {
    res.status(404).json({ error: "Route not found in Vercel API." });
});

module.exports = app;
