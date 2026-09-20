/**
 * storeConfig.js — Kalyan Covering
 * Central configuration object for store details, GST tax parameters, HSN codes, and shipping rules.
 */

export const STORE_CONFIG = {
    // Store Identity
    storeName: "Kalyan Covering Jewellers",
    storeSubtitle: "South Indian Gold Covering Jewellers • Est. 2000",
    legalName: "Kalyan Covering",
    
    // Store Address
    address: {
        line1: "124, Nethaji Road, Clock Tower",
        city: "Erode",
        state: "Tamil Nadu",
        pincode: "638001",
        stateCode: "33 (Tamil Nadu)",
        fullAddress: "124, Nethaji Road, Clock Tower, Erode, Tamil Nadu 638001"
    },
    
    // Contact Information
    contact: {
        phone: "+91 98765 43210",
        email: "orders@kalyancovering.com",
        supportEmail: "info@kalyancovering.com",
        whatsapp: "919876543210",
        website: "https://kalyancoveringstore-c53e4.web.app"
    },
    
    // Tax & Regulatory (Placeholders clearly marked)
    tax: {
        // PLACEHOLDER: Replace with verified GSTIN before live tax filings
        gstin: "YOUR_GSTIN_HERE", // Example: "33XXXXX0000X1Z5"
        hsnCode: "711790",        // HSN code for imitation / gold-covering jewellery
        gstRate: 0.12,            // 12% total GST (Jewellery rate)
        cgstRate: 0.06,           // 6% Central GST
        sgstRate: 0.06,           // 6% State GST
        isTaxInclusive: true      // Product prices listed on store include GST
    },
    
    // Shipping & Dispatch Rules
    shipping: {
        freeShippingThreshold: 999, // Free delivery above ₹999
        standardDeliveryFee: 99,    // Delivery fee below threshold
        giftWrapFee: 99,            // Optional gift wrap charge
        showShipsIn24Hours: true,   // If true, shows "Ships in 24 hrs" badge; if false, shows "In Stock"
        dispatchTimeText: "Ships in 24 hrs",
        estimatedDeliveryDays: "3 to 5 business days",
        returnWindowDays: 7
    }
};
