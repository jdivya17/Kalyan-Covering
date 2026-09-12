const admin = require("firebase-admin");
const path = require("path");
const sa = require(path.join(__dirname, "serviceAccountKey.json"));

admin.initializeApp({
    credential: admin.credential.cert(sa)
});

const email = process.argv[2] || "owner@kalyancovering.com";
const role = process.argv[3] || "owner";
const password = process.argv[4] || "Admin@123456";

async function makeAdmin(targetEmail, targetRole, targetPassword) {
    try {
        console.log(`Processing admin setup for: ${targetEmail} (role: ${targetRole})...`);
        let user;
        try {
            user = await admin.auth().getUserByEmail(targetEmail);
            console.log(`User found: ${user.uid}`);
            const updatePayload = { emailVerified: true };
            if (targetPassword) updatePayload.password = targetPassword;
            await admin.auth().updateUser(user.uid, updatePayload);
            console.log(`✅ Email ${targetEmail} marked as VERIFIED and password updated.`);
        } catch (findErr) {
            if (findErr.code === 'auth/user-not-found') {
                console.log(`User not found, creating new account for ${targetEmail}...`);
                user = await admin.auth().createUser({
                    email: targetEmail,
                    password: targetPassword || 'Admin@123456',
                    emailVerified: true,
                    displayName: 'Store Owner'
                });
                console.log(`✅ Created user ${user.uid}`);
            } else {
                throw findErr;
            }
        }
        
        // 2. Set Custom Claims
        await admin.auth().setCustomUserClaims(user.uid, {
            role: targetRole
        });
        console.log(`✅ Role '${targetRole}' assigned to custom claims for UID: ${user.uid}`);

        // 3. Update Firestore users collection
        const userRef = admin.firestore().collection("users").doc(user.uid);
        await userRef.set({
            email: targetEmail,
            role: targetRole,
            status: "active",
            emailVerified: true,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        console.log(`✅ Firestore users/${user.uid} document updated with role: ${targetRole}`);

        console.log("\n🎉 Admin account is ready to login!");
    } catch (err) {
        console.error("❌ Error:", err.message);
    } finally {
        process.exit(0);
    }
}

makeAdmin(email, role, password);

