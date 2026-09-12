"use strict";

function validateAddress(address) {
  if (!address || typeof address !== "object") return false;
  const { name, phone, pincode, line1, city, state } = address;
  if (!name || !phone || !pincode || !line1 || !city || !state) return false;
  return /^[1-9][0-9]{5}$/.test(String(pincode).trim());
}

function validatePhoneNumber(phone) {
  if (!phone) return false;
  const cleaned = String(phone).replace(/\D/g, "");
  return cleaned.length === 10 || (cleaned.length === 12 && cleaned.startsWith("91"));
}

module.exports = {
  validateAddress,
  validatePhoneNumber
};
