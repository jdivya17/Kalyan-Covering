/**
 * validation.js — Kalyan Covering
 * Client-side form validators: phone, email, pincode, required fields.
 */

// ---- Phone Validation ----
/**
 * Validate Indian mobile number (10 digits, optionally +91/0 prefix)
 * @param {string} phone
 * @returns {{ valid: boolean, message: string }}
 */
export function validatePhone(phone) {
    if (!phone || !phone.trim()) return { valid: false, message: 'Phone number is required.' };
    const cleaned = phone.trim().replace(/[\s\-\(\)]/g, '');
    const normalized = cleaned.replace(/^(\+91|91|0)/, '');
    if (!/^\d{10}$/.test(normalized)) {
        return { valid: false, message: 'Enter a valid 10-digit Indian mobile number.' };
    }
    return { valid: true, message: '' };
}

// ---- Email Validation ----
/**
 * Validate email address format
 * @param {string} email
 * @returns {{ valid: boolean, message: string }}
 */
export function validateEmail(email) {
    if (!email || !email.trim()) return { valid: false, message: 'Email address is required.' };
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (!re.test(email.trim())) {
        return { valid: false, message: 'Enter a valid email address.' };
    }
    return { valid: true, message: '' };
}

// ---- Pincode Validation ----
/**
 * Validate Indian 6-digit PIN code
 * @param {string} pincode
 * @returns {{ valid: boolean, message: string }}
 */
export function validatePincode(pincode) {
    if (!pincode || !String(pincode).trim()) return { valid: false, message: 'PIN code is required.' };
    if (!/^\d{6}$/.test(String(pincode).trim())) {
        return { valid: false, message: 'Enter a valid 6-digit PIN code.' };
    }
    return { valid: true, message: '' };
}

// ---- Required Field ----
/**
 * Validate that a field has a non-empty value
 * @param {string} value
 * @param {string} fieldName
 * @returns {{ valid: boolean, message: string }}
 */
export function validateRequired(value, fieldName = 'This field') {
    if (!value || !String(value).trim()) {
        return { valid: false, message: `${fieldName} is required.` };
    }
    return { valid: true, message: '' };
}

// ---- Name Validation ----
/**
 * Validate a person's name (min 2 chars, letters/spaces/hyphens)
 * @param {string} name
 * @returns {{ valid: boolean, message: string }}
 */
export function validateName(name) {
    if (!name || !name.trim()) return { valid: false, message: 'Name is required.' };
    if (name.trim().length < 2) return { valid: false, message: 'Name must be at least 2 characters.' };
    if (!/^[a-zA-Z\s\-'\.]+$/.test(name.trim())) {
        return { valid: false, message: 'Name can only contain letters, spaces, and hyphens.' };
    }
    return { valid: true, message: '' };
}

// ---- Address Validation ----
/**
 * Validate a shipping address object
 * Fields must match checkout.html form IDs and server-side validateAddress() in payments.js:
 * { fname, lname, phone, email, address, city, state, pin }
 * @param {{ fname:string, lname:string, phone:string, email:string, address:string, city:string, state:string, pin:string }} addr
 * @returns {{ valid: boolean, errors: Object }}
 */
export function validateAddress(addr) {
    const errors = {};
    const fname = validateName(addr.fname);
    if (!fname.valid) errors.fname = fname.message;
    const lname = validateRequired(addr.lname, 'Last Name');
    if (!lname.valid) errors.lname = lname.message;
    const phone = validatePhone(addr.phone);
    if (!phone.valid) errors.phone = phone.message;
    const email = validateEmail(addr.email);
    if (!email.valid) errors.email = email.message;
    const address = validateRequired(addr.address, 'Street address');
    if (!address.valid) errors.address = address.message;
    const city = validateRequired(addr.city, 'City');
    if (!city.valid) errors.city = city.message;
    const state = validateRequired(addr.state, 'State');
    if (!state.valid) errors.state = state.message;
    const pin = validatePincode(addr.pin);
    if (!pin.valid) errors.pin = pin.message;
    return { valid: Object.keys(errors).length === 0, errors };
}

// ---- Form Field Helper ----
/**
 * Show or clear an inline error on a form field
 * @param {HTMLElement|string} fieldOrId - Input element or its ID
 * @param {string} message - Error message (empty string to clear)
 */
export function showFieldError(fieldOrId, message) {
    const field = typeof fieldOrId === 'string' ? document.getElementById(fieldOrId) : fieldOrId;
    if (!field) return;
    let errEl = field.parentElement?.querySelector('.field-error');
    if (message) {
        field.classList.add('input-error');
        if (!errEl) {
            errEl = document.createElement('div');
            errEl.className = 'field-error';
            errEl.style.cssText = 'color:#ef4444;font-size:0.78rem;margin-top:0.3rem;';
            field.parentElement?.appendChild(errEl);
        }
        errEl.textContent = message;
    } else {
        field.classList.remove('input-error');
        if (errEl) errEl.remove();
    }
}

// Bind to window for legacy HTML compatibility
window.validatePhone = validatePhone;
window.validateEmail = validateEmail;
window.validatePincode = validatePincode;
window.validateRequired = validateRequired;
window.validateName = validateName;
window.validateAddress = validateAddress;
window.showFieldError = showFieldError;
