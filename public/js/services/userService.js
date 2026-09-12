/**
 * userService.js — Kalyan Covering
 * User profile & address book CRUD (Firestore users collection).
 */

import { db, doc, getDoc, setDoc, updateDoc, serverTimestamp, arrayUnion } from '../firebase-config.js';
import { KC } from '../store/state.js';
import { Toast } from '../components/Toast.js';

// ---- Get User Profile ----
/**
 * Fetch user profile from Firestore
 * @param {string} [uid] - Defaults to currently logged-in user
 * @returns {Promise<Object|null>}
 */
export async function getUserProfile(uid) {
    const userId = uid || KC.user?.uid;
    if (!userId) return null;
    try {
        const snap = await getDoc(doc(db, 'users', userId));
        return snap.exists() ? { uid: snap.id, ...snap.data() } : null;
    } catch (e) {
        console.error('Error fetching user profile:', e);
        return null;
    }
}

// ---- Update Profile ----
/**
 * Update user profile fields (name, phone, etc.)
 * @param {Object} updates - Fields to update
 * @param {string} [uid] - Defaults to currently logged-in user
 * @returns {Promise<{success:boolean, error?:string}>}
 */
export async function updateProfile(updates, uid) {
    const userId = uid || KC.user?.uid;
    if (!userId) return { success: false, error: 'Not logged in.' };
    try {
        await updateDoc(doc(db, 'users', userId), {
            ...updates,
            updatedAt: serverTimestamp()
        });
        // Sync KC.user in memory
        if (KC.user) {
            KC.user = { ...KC.user, ...updates };
            localStorage.setItem('kc_user', JSON.stringify(KC.user));
        }
        Toast.success('Profile Updated', 'Your profile has been saved.');
        return { success: true };
    } catch (e) {
        const msg = e.message || 'Failed to update profile.';
        Toast.error('Update Failed', msg);
        return { success: false, error: msg };
    }
}

// ---- Address Book ----

/**
 * Get all saved addresses for the current user
 * @returns {Promise<Array>}
 */
export async function getAddresses() {
    const profile = await getUserProfile();
    return profile?.addresses || [];
}

/**
 * Add a new address to the user's address book
 * @param {Object} address - Address object
 * @returns {Promise<{success:boolean, error?:string}>}
 */
export async function addAddress(address) {
    const userId = KC.user?.uid;
    if (!userId) return { success: false, error: 'Not logged in.' };
    if (!address || !address.name || !address.phone) {
        return { success: false, error: 'Address name and phone are required.' };
    }
    const newAddress = {
        id: `addr_${Date.now()}`,
        ...address,
        createdAt: new Date().toISOString()
    };
    try {
        await updateDoc(doc(db, 'users', userId), {
            addresses: arrayUnion(newAddress),
            updatedAt: serverTimestamp()
        });
        Toast.success('Address Added', 'New address saved to your account.');
        return { success: true, address: newAddress };
    } catch (e) {
        const msg = e.message || 'Failed to save address.';
        Toast.error('Save Failed', msg);
        return { success: false, error: msg };
    }
}

/**
 * Update an existing address by ID
 * @param {string} addressId
 * @param {Object} updates
 * @returns {Promise<{success:boolean, error?:string}>}
 */
export async function updateAddress(addressId, updates) {
    const userId = KC.user?.uid;
    if (!userId) return { success: false, error: 'Not logged in.' };
    try {
        const profile = await getUserProfile();
        const addresses = (profile?.addresses || []).map(addr =>
            addr.id === addressId ? { ...addr, ...updates } : addr
        );
        await updateDoc(doc(db, 'users', userId), {
            addresses,
            updatedAt: serverTimestamp()
        });
        Toast.success('Address Updated');
        return { success: true };
    } catch (e) {
        const msg = e.message || 'Failed to update address.';
        Toast.error('Update Failed', msg);
        return { success: false, error: msg };
    }
}

/**
 * Delete an address by ID
 * @param {string} addressId
 * @returns {Promise<{success:boolean, error?:string}>}
 */
export async function deleteAddress(addressId) {
    const userId = KC.user?.uid;
    if (!userId) return { success: false, error: 'Not logged in.' };
    try {
        const profile = await getUserProfile();
        const addresses = (profile?.addresses || []).filter(addr => addr.id !== addressId);
        await updateDoc(doc(db, 'users', userId), {
            addresses,
            updatedAt: serverTimestamp()
        });
        Toast.info('Address Removed');
        return { success: true };
    } catch (e) {
        const msg = e.message || 'Failed to delete address.';
        Toast.error('Delete Failed', msg);
        return { success: false, error: msg };
    }
}

// Bind to window for HTML compatibility
window.getUserProfile = getUserProfile;
window.updateProfile = updateProfile;
window.getAddresses = getAddresses;
window.addAddress = addAddress;
window.updateAddress = updateAddress;
window.deleteAddress = deleteAddress;
