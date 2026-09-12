const admin = require("firebase-admin");
const path = require("path");
const sa = require(path.join(__dirname, "serviceAccountKey.json"));

admin.initializeApp({
    credential: admin.credential.cert(sa)
});

async function main() {
    try {
        const list = await admin.auth().listUsers(50);
        console.log(`\n=== Total Users in Firebase: ${list.users.length} ===`);
        for (const u of list.users) {
            console.log(`Email: ${u.email} | UID: ${u.uid} | Verified: ${u.emailVerified} | Claims: ${JSON.stringify(u.customClaims || {})}`);
        }
    } catch (e) {
        console.error("Error listing users:", e.message);
    } finally {
        process.exit(0);
    }
}

main();
