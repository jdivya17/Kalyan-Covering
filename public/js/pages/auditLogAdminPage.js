/**
 * auditLogAdminPage.js — Enterprise System Audit Trail controller for Kalyan Covering admin panel.
 */

import { db, collection, getDocs, query, orderBy } from '../firebase-config.js';
import { callVercelApi } from '../firebase-config.js';

export let allAuditLogs = [];

export async function renderAuditLogs() {
  const tbody = document.getElementById('audit-table-body');
  if (!tbody) return;

  try {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:3rem;color:var(--muted2)">Fetching audit trail...</td></tr>';
    let logs = [];
    try {
      const result = await callVercelApi('/api/admin/get-audit-logs', { limit: 100 });
      logs = result.logs || [];
    } catch (vErr) {
      console.warn('Vercel get-audit-logs API failed, trying direct Firestore:', vErr.message);
      const snap = await getDocs(query(collection(db, 'audit_logs'), orderBy('timestamp', 'desc')));
      logs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }

    allAuditLogs = logs;
    updateAuditMetrics(allAuditLogs);
    displayAuditLogs(allAuditLogs);

  } catch (e) {
    console.error('Error fetching audit logs:', e);
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2.5rem;color:var(--danger)">Failed to load audit logs.</td></tr>';
  }
}

export function updateAuditMetrics(logs) {
  const totalEl = document.getElementById('audit-stat-total');
  const createEl = document.getElementById('audit-stat-create');
  const updateEl = document.getElementById('audit-stat-update');
  const deleteEl = document.getElementById('audit-stat-delete');

  if (!totalEl) return;
  totalEl.textContent = logs.length;
  if (createEl) createEl.textContent = logs.filter(l => l.action === 'CREATE').length;
  if (updateEl) updateEl.textContent = logs.filter(l => l.action === 'UPDATE' || l.action === 'UPDATE_SETTINGS' || l.action === 'ADJUST_STOCK').length;
  if (deleteEl) deleteEl.textContent = logs.filter(l => l.action === 'DELETE' || l.action === 'CLEAR_DATABASE').length;
}

export function displayAuditLogs(logs) {
  const tbody = document.getElementById('audit-table-body');
  if (!tbody) return;

  if (!logs || logs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:3rem;color:var(--muted2)">🔍 No audit logs match filter criteria.</td></tr>';
    return;
  }

  tbody.innerHTML = logs.map(log => {
    const dateObj = log.timestamp?.seconds ? new Date(log.timestamp.seconds * 1000) : (log.timestamp ? new Date(log.timestamp) : new Date());
    const dateStr = dateObj.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const timeStr = dateObj.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    const adminName = (log.adminId || 'Admin').split('@')[0];
    const action = log.action || 'UPDATE';
    const col = log.collection || 'products';

    return `
      <tr>
        <td class="mono">${dateStr} ${timeStr}</td>
        <td><b>${adminName}</b></td>
        <td><span class="pill ok">${action}</span></td>
        <td>${col}</td>
        <td class="mono">${log.documentId || '—'}</td>
        <td class="mono">${log.ip || '127.0.0.1'}</td>
      </tr>
    `;
  }).join('');
}

if (typeof window !== 'undefined') {
  window.renderAuditLogs = renderAuditLogs;
  window.updateAuditMetrics = updateAuditMetrics;
  window.displayAuditLogs = displayAuditLogs;
}
