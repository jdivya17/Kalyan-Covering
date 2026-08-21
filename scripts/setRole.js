const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

/**
 * script to set custom claims (roles) for a user in Firebase Auth.
 * 
 * Usage:
 * 1. Download your Firebase Admin SDK service account key (JSON) from the Firebase Console 
 *    (Project Settings -> Service Accounts -> Generate new private key).
 * 2. Save the downloaded file as 'serviceAccountKey.json' in this folder.
 * 3. Run: npm install firebase-admin
 * 4. Run: node setRole.js <user-email> <role>
 * 
 * Valid roles: owner, manager, staff
 */

// Verify arguments
const args = process.argv.slice(2);
if (args.length !== 2) {
    console.error('Usage: node setRole.js <user-email> <role>');
    console.log('Roles: owner, manager, staff');
    process.exit(1);
}

const email = args[0];
const role = args[1].toLowerCase();

const validRoles = ['owner', 'manager', 'staff'];
if (!validRoles.includes(role)) {
    console.error(`Invalid role '${role}'. Valid roles are: ${validRoles.join(', ')}`);
    process.exit(1);
}

// Load service account key
const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');
if (!fs.existsSync(serviceAccountPath)) {
    console.error(`Error: Could not find ${serviceAccountPath}`);
    console.error('Please download your service account key from the Firebase Console and save it as serviceAccountKey.json in this directory.');
    process.exit(1);
}

const serviceAccount = require(serviceAccountPath);

// Initialize Firebase Admin
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

async function setRole() {
    try {
        console.log(`Looking up user with email: ${email}...`);
        const userRecord = await admin.auth().getUserByEmail(email);
        
        console.log(`User found: ${userRecord.uid}`);
        console.log(`Assigning role '${role}' to ${email}...`);
        
        // Set custom claims
        await admin.auth().setCustomUserClaims(userRecord.uid, { role: role });
        
        console.log('✅ Success! Role assigned.');
        console.log('Note: The user may need to log out and log back in for the new role to take effect immediately.');
    } catch (error) {
        if (error.code === 'auth/user-not-found') {
            console.error(`❌ Error: No user found with email ${email}`);
        } else {
            console.error('❌ Error setting role:', error.message);
        }
    } finally {
        process.exit(0);
    }
}

setRole();
