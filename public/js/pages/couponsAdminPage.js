/**
 * couponsAdminPage.js — Coupon management controller for Kalyan Covering admin panel.
 */

import { db, collection, getDocs, getDoc, doc, setDoc, deleteDoc, query, orderBy } from '../firebase-config.js';
import { toast, confirmModal, openDrawer, closeDrawer, ic } from '../utils/icons.js';

export async function loadCoupons() {
  const container = document.getElementById('coupons-list-container');
  if (!container) return;

  container.innerHTML = '<div class="card empty"><h3>Loading...</h3><p>Fetching coupons.</p></div>';

  try {
    const snap = await getDocs(query(collection(db, 'coupons'), orderBy('createdAt', 'desc')));
    const coupons = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (coupons.length === 0) {
      container.innerHTML = '<div class="card empty"><h3>No Coupons</h3><p>Create your first discount coupon code to attract customers!</p></div>';
      return;
    }

    container.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Code</th>
            <th>Discount</th>
            <th>Min Order</th>
            <th>Limits (Total / User)</th>
            <th>Used</th>
            <th>Expiry</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${coupons.map(c => `
            <tr>
              <td><b style="color:var(--gold-hi)">${c.code}</b></td>
              <td>${c.discountType === 'percentage' || c.discountType === 'percent' ? `${c.discountValue}% OFF` : `₹${c.discountValue} OFF`}</td>
              <td>₹${c.minPurchase || c.minOrder || 0}</td>
              <td>${c.usageLimit || '∞'} / ${c.perUserLimit || '∞'}</td>
              <td>${c.usedCount || 0}</td>
              <td>${c.expiryDate ? new Date(c.expiryDate).toLocaleDateString('en-IN') : 'Never'}</td>
              <td><span class="pill ${c.status === 'active' ? 'ok' : 'muted'}">${c.status || 'active'}</span></td>
              <td>
                <button class="iconbtn danger" onclick="deleteCoupon('${c.id}', '${c.code}')">${ic('trash', 15)}</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    console.error('loadCoupons:', err);
    container.innerHTML = `<div class="card empty"><h3 style="color:var(--red)">Error</h3><p>${err.message}</p></div>`;
  }
}

export function openAddCouponDrawer() {
  const html = `
    <div class="dr-h"><h2>Add Coupon</h2><button class="iconbtn" onclick="closeDrawer()">${ic('close',16)}</button></div>
    <div class="dr-b">
      <div class="f"><label>Coupon Code *</label><input type="text" id="cp-code" placeholder="FESTIVE10" style="text-transform:uppercase"></div>
      <div class="frow2">
        <div class="f"><label>Type</label><select class="select" id="cp-type"><option value="percentage">Percentage (%)</option><option value="flat">Flat Amount (₹)</option></select></div>
        <div class="f"><label>Value *</label><input type="number" id="cp-val" placeholder="10"></div>
      </div>
      <div class="frow2">
        <div class="f"><label>Min Order (₹)</label><input type="number" id="cp-min" placeholder="999"></div>
        <div class="f"><label>Expiry Date</label><input type="date" id="cp-expiry"></div>
      </div>
      <div class="frow2">
        <div class="f"><label>Total Usage Limit (0 = Unlimited)</label><input type="number" id="cp-usage-limit" placeholder="100" value="0"></div>
        <div class="f"><label>Per-User Limit (0 = Unlimited)</label><input type="number" id="cp-per-user-limit" placeholder="1" value="1"></div>
      </div>
    </div>
    <div class="dr-f">
      <button class="tbtn ghost" onclick="closeDrawer()">Cancel</button>
      <button class="tbtn solid" onclick="saveCoupon()">Save Coupon</button>
    </div>
  `;
  openDrawer(html);
}

export async function saveCoupon() {
  const code = document.getElementById('cp-code')?.value.trim().toUpperCase();
  const type = document.getElementById('cp-type')?.value;
  const val = parseFloat(document.getElementById('cp-val')?.value || '0');
  const minPurchase = parseFloat(document.getElementById('cp-min')?.value || '0');
  const expiry = document.getElementById('cp-expiry')?.value;
  const usageLimit = parseInt(document.getElementById('cp-usage-limit')?.value || '0', 10) || 0;
  const perUserLimit = parseInt(document.getElementById('cp-per-user-limit')?.value || '0', 10) || 0;

  if (!code) { toast('Enter a coupon code!'); return; }
  if (isNaN(val) || val <= 0) { toast('Enter a valid discount value!'); return; }

  try {
    const existingSnap = await getDoc(doc(db, 'coupons', code));
    const existingData = existingSnap.exists() ? existingSnap.data() : {};

    await setDoc(doc(db, 'coupons', code), {
      code,
      discountType: type,
      discountValue: val,
      minPurchase,
      minOrder: minPurchase,
      expiryDate: expiry || null,
      usageLimit,
      perUserLimit,
      usedCount: typeof existingData.usedCount === 'number' ? existingData.usedCount : 0,
      status: 'active',
      createdAt: existingData.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    closeDrawer();
    toast('Coupon saved successfully!');
    loadCoupons();
  } catch (err) {
    console.error('saveCoupon:', err);
    toast('Error: ' + err.message);
  }
}

export function deleteCoupon(id, code) {
  confirmModal('Delete Coupon?', `Remove code ${code}?`, 'Delete', async () => {
    try {
      await deleteDoc(doc(db, 'coupons', id));
      toast('Coupon deleted');
      loadCoupons();
    } catch (err) {
      toast('Error: ' + err.message);
    }
  });
}

if (typeof window !== 'undefined') {
  window.loadCoupons = loadCoupons;
  window.openAddCouponDrawer = openAddCouponDrawer;
  window.saveCoupon = saveCoupon;
  window.deleteCoupon = deleteCoupon;
}
