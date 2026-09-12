"use strict";

const { HttpsError } = require("firebase-functions/v2/https");

function verifyAuthenticated(context) {
  if (!context || !context.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  return context.auth;
}

function verifyAdmin(context) {
  const auth = verifyAuthenticated(context);
  if (auth.token.role !== "admin" && auth.token.role !== "owner") {
    throw new HttpsError("permission-denied", "Admin privileges required.");
  }
  return auth;
}

function verifyStaff(context) {
  const auth = verifyAuthenticated(context);
  const role = auth.token.role;
  if (role !== "admin" && role !== "owner" && role !== "staff" && role !== "manager") {
    throw new HttpsError("permission-denied", "Staff privileges required.");
  }
  return auth;
}

module.exports = {
  verifyAuthenticated,
  verifyAdmin,
  verifyStaff
};
