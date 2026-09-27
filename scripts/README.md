# Admin Role Provisioning & Bootstrap Guide

This directory contains utility scripts and documents the administration role provisioning workflows for Kalyan Covering Store.

---

## 1. Automatic First-Owner Self-Provisioning (Bootstrap Endpoint)

When initializing a fresh environment where **no owner account exists yet**, the system provides a safe one-time API endpoint:

- **Endpoint**: `POST /api/admin/bootstrap-first-owner`
- **Authentication**: Requires a valid Firebase ID token (`Bearer <token>`).
- **Behavior**:
  - Checks Firebase Auth and Firestore to see if an `owner` account already exists.
  - **If zero owners exist**: Grants the requesting user custom claims `{ role: 'owner', admin: true }` and updates their Firestore user document to `role: 'owner'`.
  - **If an owner already exists**: Automatically locks and returns `403 bootstrap-locked` ("An owner account already exists in the system. Bootstrap is disabled.").

---

## 2. Manual CLI Script (`scripts/setRole.js`)

To assign or change roles manually via CLI (offline / administrative access):

### Setup
1. Download your Firebase Admin SDK Service Account key from Firebase Console:
   - **Firebase Console** -> **Project Settings** -> **Service Accounts** -> **Generate New Private Key**.
2. Save the downloaded JSON file as `scripts/serviceAccountKey.json`.

### Usage
Run the script passing the target user's email and desired role (`owner`, `manager`, `staff`):

```bash
node scripts/setRole.js <user-email> <role>
```

#### Example:
```bash
node scripts/setRole.js admin@kalyancovering.com owner
```

### Checking User Claims
To verify custom claims assigned to an account:
```bash
node scripts/check_claims.js
```
