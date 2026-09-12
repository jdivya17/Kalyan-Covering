const admin = require('firebase-admin');
const path = require('path');
const sa = require(path.join(__dirname, 'serviceAccountKey.json'));

admin.initializeApp({ credential: admin.credential.cert(sa) });

async function check() {
    const email = 'owner@kalyancovering.com';
    const user = await admin.auth().getUserByEmail(email);
    console.log('--- SERVER SIDE FIREBASE AUTH RECORD ---');
    console.log('UID:', user.uid);
    console.log('Email:', user.email);
    console.log('Email Verified:', user.emailVerified);
    console.log('Custom Claims:', user.customClaims);
}

check().catch(console.error);
