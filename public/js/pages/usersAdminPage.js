/**
 * usersAdminPage.js — Customer & User management controller for Kalyan Covering admin panel.
 */

import { db, collection, getDocs, doc, setDoc, updateDoc } from '../firebase-config.js';
import { callVercelApi } from '../firebase-config.js';
import { toast } from '../utils/icons.js';

export async function renderUsersTable() {
  const tbody = document.getElementById('users-table-body');
  if (!tbody) return;

  try {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--muted2)">Loading customers...</td></tr>';
    const snap = await getDocs(collection(db, 'users'));
    const users = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (users.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--muted2)">No users found.</td></tr>';
      return;
    }

    tbody.innerHTML = users.map(u => {
      const name = (u.name || u.displayName || u.email || 'Customer').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      const email = u.email || '—';
      const role = u.role || 'customer';
      const status = u.status || 'active';
      const uid = u.id || u.uid;

      return `
        <tr>
          <td><b>${name}</b></td>
          <td>${email}</td>
          <td><span class="pill ${role === 'owner' || role === 'manager' ? 'ok' : 'muted'}">${role}</span></td>
          <td><span class="pill ${status === 'active' ? 'ok' : 'danger'}">${status}</span></td>
          <td>
            <select onchange="updateUserRole('${uid}', this.value)" style="background:#111;color:#fff;border:1px solid #333;padding:4px 8px;border-radius:4px">
              <option value="customer" ${role === 'customer' ? 'selected' : ''}>Customer</option>
              <option value="staff" ${role === 'staff' ? 'selected' : ''}>Staff</option>
              <option value="manager" ${role === 'manager' ? 'selected' : ''}>Manager</option>
              <option value="owner" ${role === 'owner' ? 'selected' : ''}>Owner</option>
            </select>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('renderUsersTable:', err);
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--red)">Failed to load users: ${err.message}</td></tr>`;
  }
}

export async function updateUserRole(targetUid, role) {
  try {
    await callVercelApi('/api/admin/set-user-role', { targetUid, role });
    toast(`User role set to ${role}`);
    renderUsersTable();
  } catch (err) {
    console.error('updateUserRole:', err);
    toast('Role update failed: ' + err.message);
  }
}

if (typeof window !== 'undefined') {
  window.renderUsersTable = renderUsersTable;
  window.updateUserRole = updateUserRole;
}
