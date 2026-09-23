/**
 * stockAdminPage.js — Back-in-stock alerts management controller for Kalyan Covering admin panel.
 */

import { db, collection, getDocs, doc, deleteDoc, query, orderBy } from '../firebase-config.js';
import { toast } from '../utils/icons.js';

export async function loadAdminStockAlerts() {
  const container = document.getElementById('stock-alerts-list');
  const badge = document.getElementById('nav-stock-badge');
  if (!container) return;

  container.innerHTML = '<div class="card empty"><h3>Loading...</h3><p>Fetching stock alerts.</p></div>';

  try {
    const snap = await getDocs(query(collection(db, 'stock_alerts'), orderBy('createdAt', 'desc')));
    const alerts = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (badge) {
      badge.textContent = alerts.length;
      badge.style.display = alerts.length > 0 ? 'inline-block' : 'none';
    }

    if (alerts.length === 0) {
      container.innerHTML = '<div class="card empty"><h3>No Stock Alerts</h3><p>No customer back-in-stock notifications registered currently.</p></div>';
      return;
    }

    container.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th>Customer Email</th>
            <th>Registered Date</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${alerts.map(a => `
            <tr>
              <td><b>${(a.productName || a.productId || 'Product').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}</b></td>
              <td>${(a.email || '—').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}</td>
              <td>${a.createdAt ? (a.createdAt.toDate ? a.createdAt.toDate().toLocaleDateString('en-IN') : new Date(a.createdAt).toLocaleDateString('en-IN')) : '—'}</td>
              <td>
                <button class="tbtn ghost sm danger" onclick="deleteStockAlert('${a.id}')">Remove</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    console.error('loadAdminStockAlerts:', err);
    container.innerHTML = `<div class="card empty"><h3 style="color:var(--red)">Error</h3><p>${err.message}</p></div>`;
  }
}

export async function deleteStockAlert(alertId) {
  try {
    await deleteDoc(doc(db, 'stock_alerts', alertId));
    toast('Alert removed');
    await loadAdminStockAlerts();
  } catch (err) {
    console.error('deleteStockAlert:', err);
    toast('Error: ' + err.message);
  }
}

if (typeof window !== 'undefined') {
  window.loadAdminStockAlerts = loadAdminStockAlerts;
  window.deleteStockAlert = deleteStockAlert;
}
