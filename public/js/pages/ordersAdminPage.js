/**
 * ordersAdminPage.js — Kalyan Covering Admin Orders Panel Controller
 */

import { statusPill } from '../components/StatusPill.js';
import { ic, openDrawer, closeDrawer, toast, confirmModal } from '../utils/icons.js';
import { callVercelApi } from '../firebase-config.js';

export let currentOrderStatusFilter = 'all';

export function renderOrdersTable(orders) {
  const list = orders || window.ordersData || (window.adminData && window.adminData.orders) || [];
  const tbody = document.getElementById('orders-table');
  const mobileList = document.getElementById('mobile-orders-list');
  const countLabel = document.getElementById('orders-count-label');

  const activeOrdersCount = list.filter(o => !['delivered', 'cancelled'].includes(String(o.orderStatus || o.status || '').toLowerCase())).length;

  if (countLabel) countLabel.textContent = `${list.length} orders total, ${activeOrdersCount} need action.`;

  if (!tbody) return;

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--muted2)">No orders found.</td></tr>`;
    if (mobileList) mobileList.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--muted2)">No orders found.</div>`;
    return;
  }

  tbody.innerHTML = list.map(o => {
    const id = (o.id || o.orderId || 'ORD').substring(0, 10).toUpperCase();
    const cust = String(o.customerName || o.customer || (o.shippingAddress ? (o.shippingAddress.fullName || o.shippingAddress.name) : 'Customer')).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const rawDate = o.createdAt ? (o.createdAt.toDate ? o.createdAt.toDate() : new Date(o.createdAt)) : (o.date ? new Date(o.date) : new Date());
    const dateStr = rawDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    const itemsCount = Array.isArray(o.items) ? o.items.length : (typeof o.items === 'number' ? o.items : 1);
    const total = typeof o.totalAmount === 'number' ? o.totalAmount : (typeof o.total === 'number' ? o.total : 0);
    const pay = (o.paymentMethod || o.payment || 'UPI').toUpperCase();
    const rawStatus = String(o.orderStatus || o.status || 'placed').toLowerCase();

    return `
      <tr>
        <td class="mono" style="color:var(--gold-hi)">#${id}</td>
        <td>${cust}</td>
        <td>${dateStr}</td>
        <td>${itemsCount}</td>
        <td class="mono">₹${Math.round(total).toLocaleString('en-IN')}</td>
        <td>${pay}</td>
        <td>${statusPill(rawStatus)}</td>
        <td style="text-align:right">
          <button class="tbtn ghost sm" onclick="openOrderDrawer('${o.id}')">View</button>
        </td>
      </tr>
    `;
  }).join('');

  if (mobileList) {
    mobileList.innerHTML = list.map(o => {
      const id = (o.id || o.orderId || 'ORD').substring(0, 10).toUpperCase();
      const cust = String(o.customerName || o.customer || 'Customer').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      const total = typeof o.totalAmount === 'number' ? o.totalAmount : (typeof o.total === 'number' ? o.total : 0);
      const rawStatus = String(o.orderStatus || o.status || 'placed').toLowerCase();
      return `
        <div class="mobile-card-item" style="cursor:pointer;padding:12px;border-bottom:1px solid var(--line2)" onclick="openOrderDrawer('${o.id}')">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div>
              <b style="color:var(--gold-hi)">#${id}</b> • ${cust}
            </div>
            ${statusPill(rawStatus)}
          </div>
          <div style="margin-top:6px;display:flex;justify-content:space-between;align-items:center;font-size:0.84rem;color:var(--muted)">
            <span>Total: ₹${Math.round(total).toLocaleString('en-IN')}</span>
            <button class="tbtn ghost sm" onclick="event.stopPropagation(); openOrderDrawer('${o.id}')">View</button>
          </div>
        </div>`;
    }).join('');
  }
}

export function filterOrdersByTab(statusTab, btn) {
  currentOrderStatusFilter = statusTab;
  window.currentOrderStatusFilter = currentOrderStatusFilter;
  if (btn) {
    document.querySelectorAll('#order-status-tabs button').forEach(b => b.removeAttribute('aria-current'));
    btn.setAttribute('aria-current', 'true');
  }
  filterOrdersUI();
}

export function filterOrdersUI() {
  const query = (document.getElementById('order-search-input')?.value || '').toLowerCase().trim();
  const tab = currentOrderStatusFilter || window.currentOrderStatusFilter || 'all';

  let list = window.ordersData || (window.adminData && window.adminData.orders) || [];

  if (tab !== 'all') {
    list = list.filter(o => String(o.orderStatus || o.status || '').toLowerCase().includes(tab));
  }

  if (query) {
    list = list.filter(o => (o.id || '').toLowerCase().includes(query) || (o.customerName || o.customer || '').toLowerCase().includes(query));
  }

  renderOrdersTable(list);
}

export function openOrderDrawer(orderId) {
  const list = window.ordersData || (window.adminData && window.adminData.orders) || [];
  const o = list.find(x => x.id === orderId || x.orderId === orderId);
  if (!o) { toast('Order not found!'); return; }

  const shortId = (o.id || o.orderId || 'ORD').substring(0, 10).toUpperCase();
  const cust = String(o.customerName || o.customer || (o.shippingAddress ? (o.shippingAddress.fullName || o.shippingAddress.name) : 'Customer')).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const rawDate = o.createdAt ? (o.createdAt.toDate ? o.createdAt.toDate() : new Date(o.createdAt)) : (o.date ? new Date(o.date) : new Date());
  const dateStr = rawDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const itemsList = Array.isArray(o.items) ? o.items : [];
  const itemsCount = itemsList.length || 1;
  const total = typeof o.totalAmount === 'number' ? o.totalAmount : (typeof o.total === 'number' ? o.total : 0);
  const pay = (o.paymentMethod || o.payment || 'UPI').toUpperCase();
  const curStatus = String(o.orderStatus || o.status || 'placed').toLowerCase();

  const osteps = ['placed', 'packed', 'shipped', 'delivered'];
  const curIdx = osteps.indexOf(curStatus);

  const addr = o.shippingAddress ? (typeof o.shippingAddress === 'string' ? o.shippingAddress : `${o.shippingAddress.addressLine1 || o.shippingAddress.address || ''}, ${o.shippingAddress.city || ''} ${o.shippingAddress.pincode || ''}`) : 'Bazaar Street, Erode, Tamil Nadu 638001';

  const html = `
    <div class="dr-h">
      <h2>#${shortId}</h2>
      <button class="iconbtn" onclick="closeDrawer()" aria-label="Close">${ic('close', 16)}</button>
    </div>
    <div class="dr-b">
      <div class="f">
        <label>Customer</label>
        <p style="color:var(--ivory)">${cust}, placed ${dateStr}</p>
      </div>

      <!-- Status Stepper -->
      <div class="f">
        <label>Update status</label>
        <div class="seg" style="width:fit-content" id="drawer-order-status-seg">
          ${osteps.map((s, i) => `
            <button type="button" aria-current="${i === curIdx ? 'true' : 'false'}" onclick="setDrawerOrderStatus('${o.id}', '${s}', this)">
              ${s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          `).join('')}
        </div>
        <span style="font-size:.78rem;color:var(--muted2);margin-top:4px">Customer is notified automatically when status changes.</span>
      </div>

      <!-- Items List -->
      <div class="f">
        <label>Items (${itemsCount})</label>
        <div class="card" style="padding:12px">
          ${itemsList.length > 0 ? itemsList.map(item => `
            <div class="cell-prod" style="margin-bottom:10px">
              <img src="${item.image || item.imageURL || '../assets/kalyan_logo.png'}" style="width:40px;height:40px;border-radius:6px;object-fit:cover;border:1px solid var(--line)" alt="">
              <div>
                <b style="color:var(--ivory)">${String(item.name || item.title || 'Jewellery Item').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}</b>
                <span>Qty ${item.quantity || 1}, ₹${Math.round(item.price || 0).toLocaleString('en-IN')}</span>
              </div>
            </div>
          `).join('') : `
            <div class="cell-prod">
              <span class="avatar-sm">K</span>
              <div><b>Jewellery Item</b><span>Qty 1, ₹${Math.round(total).toLocaleString('en-IN')}</span></div>
            </div>
          `}
        </div>
      </div>

      <!-- Payment -->
      <div class="f">
        <label>Payment</label>
        <p style="color:var(--ivory)">${pay}, total ₹${Math.round(total).toLocaleString('en-IN')}</p>
      </div>

      <!-- Delivery Address -->
      <div class="f">
        <label>Delivery address</label>
        <p style="color:var(--muted)">${addr}</p>
      </div>
    </div>

    <div class="dr-f">
      <button type="button" class="tbtn ghost" onclick="closeDrawer()">Close</button>
      <button type="button" class="tbtn danger" onclick="confirmCancelOrder('${o.id}')">Cancel order</button>
      <button type="button" class="tbtn solid" onclick="closeDrawer(); toast('Order details saved')">Save</button>
    </div>
  `;

  openDrawer(html);
}

export async function setDrawerOrderStatus(orderId, newStatus, btn) {
  if (btn) {
    const seg = btn.closest('.seg');
    if (seg) seg.querySelectorAll('button').forEach(b => b.removeAttribute('aria-current'));
    btn.setAttribute('aria-current', 'true');
  }
  try {
    await callVercelApi('/api/orders/update-status', { orderId, orderStatus: newStatus });
    toast('Status updated: ' + newStatus);
    if (typeof window.loadAdminData === 'function') window.loadAdminData();
  } catch (err) {
    console.error(err);
    toast('Status update error: ' + err.message);
  }
}

export function confirmCancelOrder(orderId) {
  confirmModal(
    'Cancel this order?',
    'The customer will be notified and a refund will start if it was prepaid.',
    'Cancel order',
    async () => {
      try {
        await setDrawerOrderStatus(orderId, 'cancelled');
        closeDrawer();
        toast('Order cancelled');
      } catch (err) {
        console.error(err);
        toast('Error cancelling order: ' + err.message);
      }
    }
  );
}

export function openOrderExportDrawer() {
  const today = new Date().toISOString().slice(0, 10);
  const html = `
    <div class="dr-h"><h2>Export sales report</h2><button class="iconbtn" onclick="closeDrawer()" aria-label="Close">${ic('close',16)}</button></div>
    <div class="dr-b">
     <div class="frow2">
      <div class="f"><label>From</label><input type="date" id="expFrom" value="${today}"></div>
      <div class="f"><label>To</label><input type="date" id="expTo" value="${today}"></div>
     </div>
     <div class="f"><label>Includes</label><p style="color:var(--muted);font-size:.84rem">Order ID, customer, date, items, total, payment mode and status for every order in range.</p></div>
    </div>
    <div class="dr-f">
      <button class="tbtn ghost" onclick="closeDrawer()">Cancel</button>
      <button class="tbtn solid" onclick="doExportSalesCSV()">${ic('csv',15)} Download CSV</button>
    </div>
  `;
  openDrawer(html);
}

export function doExportSalesCSV() {
  const orders = window.ordersData || (window.adminData && window.adminData.orders) || [];
  const rows = [['Order ID', 'Customer', 'Date', 'Items', 'Total Amount', 'Payment Method', 'Status']];

  orders.forEach(o => {
    const id = o.id || o.orderId || '';
    const cust = o.customerName || o.customer || '';
    const date = o.createdAt ? (o.createdAt.toDate ? o.createdAt.toDate().toLocaleDateString('en-IN') : new Date(o.createdAt).toLocaleDateString('en-IN')) : '';
    const items = Array.isArray(o.items) ? o.items.length : (typeof o.items === 'number' ? o.items : 1);
    const total = typeof o.totalAmount === 'number' ? o.totalAmount : (typeof o.total === 'number' ? o.total : 0);
    const pay = o.paymentMethod || o.payment || 'UPI';
    const status = o.orderStatus || o.status || 'placed';
    rows.push([`"${id}"`, `"${cust}"`, `"${date}"`, items, total, `"${pay}"`, `"${status}"`]);
  });

  const csv = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'kalyan-sales-report.csv';
  a.click();
  closeDrawer();
  toast('Sales report exported!');
}

if (typeof window !== 'undefined') {
  window.currentOrderStatusFilter = currentOrderStatusFilter;
  window.renderOrdersTable = renderOrdersTable;
  window.filterOrdersByTab = filterOrdersByTab;
  window.filterOrdersUI = filterOrdersUI;
  window.openOrderDrawer = openOrderDrawer;
  window.setDrawerOrderStatus = setDrawerOrderStatus;
  window.confirmCancelOrder = confirmCancelOrder;
  window.openOrderExportDrawer = openOrderExportDrawer;
  window.doExportSalesCSV = doExportSalesCSV;
}
