/**
 * authService.js — Kalyan Covering
 * Firebase Authentication: sign-in, register, Google Auth, sign-out, session sync.
 * Depends on firebase-config.js being loaded first (via public/firebase-config.js).
 */

import {
    auth,
    db,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    sendEmailVerification,
    signOut,
    sendPasswordResetEmail,
    onAuthStateChanged,
    RecaptchaVerifier,
    signInWithPhoneNumber,
    doc,
    setDoc,
    getDoc,
    serverTimestamp,
    increment
} from '../firebase-config.js';
import { KC } from '../store/state.js';
import { Toast } from '../components/Toast.js';

/**
 * Initialize reCAPTCHA verifier for Phone Auth
 * @param {string} containerId - Element ID for reCAPTCHA button/container
 * @returns {RecaptchaVerifier}
 */
export function initRecaptcha(containerId = 'recaptcha-container') {
    if (!window.recaptchaVerifier) {
        let el = document.getElementById(containerId);
        if (!el) {
            el = document.createElement('div');
            el.id = containerId;
            document.body.appendChild(el);
        }
        window.recaptchaVerifier = new RecaptchaVerifier(auth, containerId, {
            size: 'invisible',
            callback: (response) => {
                // reCAPTCHA solved
            },
            'expired-callback': () => {
                Toast.error('reCAPTCHA Expired', 'Please try requesting OTP again.');
            }
        });
    }
    return window.recaptchaVerifier;
}

/**
 * Send Phone OTP via Firebase Auth
 * @param {string} phoneNumber - 10 digit phone number or E.164 formatted string (+919876543210)
 * @param {string} containerId - Container ID for reCAPTCHA
 * @returns {Promise<{success:boolean, confirmationResult?:Object, error?:string}>}
 */
export async function sendPhoneOTP(phoneNumber, containerId = 'recaptcha-container') {
    try {
        let formattedPhone = phoneNumber.trim();
        if (!formattedPhone.startsWith('+')) {
            formattedPhone = `+91${formattedPhone.replace(/\D/g, '')}`;
        }
        const verifier = initRecaptcha(containerId);
        const confirmationResult = await signInWithPhoneNumber(auth, formattedPhone, verifier);
        window.confirmationResult = confirmationResult;
        return { success: true, confirmationResult };
    } catch (e) {
        console.error('Phone OTP send error details:', e);
        if (window.recaptchaVerifier) {
            try {
                window.recaptchaVerifier.clear();
                window.recaptchaVerifier = null;
            } catch (_) {}
        }
        return { success: false, error: _friendlyError(e) };
    }
}

/**
 * Verify 6-digit Phone OTP Code
 * @param {Object} confirmationResult - Firebase confirmation result object
 * @param {string} otpCode - 6 digit OTP string
 * @param {string} [name] - Optional name for new user creation
 * @param {string} [email] - Optional email address
 * @returns {Promise<{success:boolean, user?:Object, error?:string}>}
 */
export async function verifyPhoneOTP(confirmationResult, otpCode, name = '', email = '') {
    try {
        const userCredential = await confirmationResult.confirm(otpCode.trim());
        const fbUser = userCredential.user;

        // Check or create Firestore document for phone user
        const userDocRef = doc(db, 'users', fbUser.uid);
        const userSnap = await getDoc(userDocRef);
        
        let userData;
        if (userSnap.exists()) {
            userData = { uid: fbUser.uid, ...userSnap.data() };
            // Merge any newly provided email or name if provided
            const updatePayload = { lastLogin: serverTimestamp(), loginCount: increment(1) };
            if (name && !userData.name) updatePayload.name = name;
            if (email && !userData.email) updatePayload.email = email;
            await setDoc(userDocRef, updatePayload, { merge: true });
        } else {
            userData = {
                uid: fbUser.uid,
                phone: fbUser.phoneNumber || '',
                name: name || 'Customer',
                email: email || '',
                role: 'user',
                createdAt: serverTimestamp(),
                lastLogin: serverTimestamp(),
                loginCount: 1,
                addresses: []
            };
            await setDoc(userDocRef, userData);
        }

        KC.user = { 
            uid: fbUser.uid, 
            name: userData.name || name || 'Customer', 
            email: userData.email || email || '', 
            phone: fbUser.phoneNumber || userData.phone || '',
            role: userData.role || 'user'
        };
        localStorage.setItem('kc_user', JSON.stringify(KC.user));
        return { success: true, user: KC.user };
    } catch (e) {
        console.error('Phone OTP verify error:', e);
        return { success: false, error: _friendlyError(e) };
    }
}

/**
 * Update user email address in Firestore and local session
 * @param {string} email 
 */
export async function updateUserEmail(email) {
    if (!KC.user || !KC.user.uid) return;
    try {
        await setDoc(doc(db, 'users', KC.user.uid), { email }, { merge: true });
        KC.user.email = email;
        localStorage.setItem('kc_user', JSON.stringify(KC.user));
    } catch (e) {
        console.error('Failed to update user email:', e);
    }
}


// ---- Registration ----
/**
 * Register a new customer with email/password
 * @param {string} email
 * @param {string} password
 * @param {string} name
 * @param {string} phone
 * @returns {Promise<{success:boolean, user?:Object, error?:string}>}
 */
export async function registerUser(email, password, name, phone) {
    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const fbUser = userCredential.user;
        
        // Send email verification
        try {
            await sendEmailVerification(fbUser);
            Toast.info('Verification Email Sent', 'Please check your inbox to verify your email address.');
        } catch (evErr) {
            console.warn('Could not send email verification:', evErr);
        }

        const userData = {
            uid: fbUser.uid,
            email: fbUser.email,
            name,
            phone: phone || '',
            role: 'user',
            createdAt: serverTimestamp(),
            lastLogin: serverTimestamp(),
            loginCount: 1,
            addresses: []
        };
        await setDoc(doc(db, 'users', fbUser.uid), userData);
        KC.user = { uid: fbUser.uid, name, email: fbUser.email, phone, emailVerified: fbUser.emailVerified };
        localStorage.setItem('kc_user', JSON.stringify(KC.user));
        return { success: true, user: KC.user };
    } catch (e) {
        return { success: false, error: _friendlyError(e) };
    }
}

// ---- Sign In ----
/**
 * Sign in with email/password
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{success:boolean, user?:Object, error?:string}>}
 */
export async function loginUser(email, password) {
    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const fbUser = userCredential.user;
        return await _syncUserSession(fbUser);
    } catch (e) {
        return { success: false, error: _friendlyError(e) };
    }
}

// ---- Sign Out ----
/**
 * Sign out the current user and clear local session
 * @param {boolean} isAuto - Whether the logout is auto (session timeout)
 */
export async function logoutUser(isAuto = false) {
    try {
        await signOut(auth);
    } catch (e) {
        console.error('Signout error:', e);
    }
    localStorage.removeItem('kc_user');
    localStorage.removeItem('kc_cart');
    localStorage.removeItem('kc_wishlist');
    sessionStorage.clear();
    KC.user = null;
    KC.cart = [];
    KC.wishlist = [];

    if (isAuto) {
        Toast.info('Session Expired', 'You have been logged out due to inactivity.');
    }
    const isAdminPage = window.location.pathname.includes('admin');
    window.location.replace(isAdminPage ? 'admin-login.html' : 'auth.html');
}

// ---- Password Reset ----
/**
 * Send a password reset email
 * @param {string} email
 * @returns {Promise<{success:boolean, error?:string}>}
 */
export async function resetPassword(email) {
    try {
        await sendPasswordResetEmail(auth, email);
        return { success: true };
    } catch (e) {
        return { success: false, error: _friendlyError(e) };
    }
}

// ---- Auth State Listener ----
/**
 * Listen to Firebase auth state changes and sync KC.user
 * @param {Function} callback - Called with (user|null)
 * @returns {Function} Unsubscribe function
 */
export function onAuthChange(callback) {
    return onAuthStateChanged(auth, async (fbUser) => {
        if (fbUser) {
            await _syncUserSession(fbUser);
        } else {
            KC.user = null;
            localStorage.removeItem('kc_user');
        }
        if (typeof callback === 'function') callback(KC.user);
    });
}

// ---- Idle Timeout (30 min) ----
let _idleTime = 0;
const IDLE_TIMEOUT_MINUTES = 30;

function _resetIdle() { _idleTime = 0; }

export function initIdleLogout() {
    setInterval(() => {
        _idleTime++;
        if (_idleTime >= IDLE_TIMEOUT_MINUTES && KC.user) {
            logoutUser(true);
        }
    }, 60000);
    ['mousemove', 'keypress', 'scroll', 'click', 'touchstart'].forEach(ev =>
        document.addEventListener(ev, _resetIdle, { passive: true })
    );
}

// ---- Internal Helpers ----
async function _syncUserSession(fbUser) {
    try {
        const userDoc = await getDoc(doc(db, 'users', fbUser.uid));
        let userData;
        if (userDoc.exists()) {
            userData = { uid: fbUser.uid, ...userDoc.data() };
            // Update lastLogin async (non-blocking)
            setDoc(doc(db, 'users', fbUser.uid), {
                lastLogin: serverTimestamp(),
                loginCount: increment(1)
            }, { merge: true }).catch(() => {});
        } else {
            userData = { uid: fbUser.uid, email: fbUser.email, name: fbUser.displayName || '' };
        }
        KC.user = { uid: userData.uid, name: userData.name, email: userData.email, phone: userData.phone, role: userData.role };
        localStorage.setItem('kc_user', JSON.stringify(KC.user));
        return { success: true, user: KC.user };
    } catch (e) {
        return { success: false, error: _friendlyError(e) };
    }
}

function _friendlyError(e) {
    const code = e.code || '';
    const map = {
        'auth/operation-not-allowed': 'Phone Authentication is disabled in Firebase Console. Enable "Phone" under Auth > Sign-in method.',
        'auth/invalid-phone-number': 'The phone number entered is invalid. Enter a 10-digit mobile number.',
        'auth/quota-exceeded': 'SMS limit reached for today. Add test phone numbers in Firebase Console.',
        'auth/captcha-check-failed': 'reCAPTCHA check failed. Please refresh and try again.',
        'auth/email-already-in-use': 'This email is already registered. Try logging in instead.',
        'auth/wrong-password': 'Incorrect password. Please try again.',
        'auth/user-not-found': 'No account found with this email.',
        'auth/invalid-email': 'Please enter a valid email address.',
        'auth/weak-password': 'Password must be at least 6 characters.',
        'auth/too-many-requests': 'Too many attempts. Please try again later or use test phone numbers.',
        'auth/network-request-failed': 'Network error. Check your internet connection.'
    };
    return map[code] || e.message || 'An unexpected error occurred.';
}

// Bind to window for legacy HTML compatibility
window.logoutUser = logoutUser;
window.resetPassword = resetPassword;
window.sendPhoneOTP = sendPhoneOTP;
window.verifyPhoneOTP = verifyPhoneOTP;
window.updateUserEmail = updateUserEmail;
