/**
 * settingsAdminPage.js — Store settings & branch locations management for Kalyan Covering admin panel.
 */

import { db, collection, getDocs, doc, setDoc, deleteDoc } from '../firebase-config.js';
import { callVercelApi } from '../firebase-config.js';
import { toast, confirmModal, openDrawer, closeDrawer, ic } from '../utils/icons.js';

export async function renderBranchesTable() {
  const container = document.getElementById('branches-list');
  if (!container) return;

  try {
    const snap = await getDocs(collection(db, 'branches'));
    const branches = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (branches.length === 0) {
      container.innerHTML = '<div style="color:var(--muted2);padding:1rem">No physical branches registered yet.</div>';
      return;
    }

    container.innerHTML = branches.map(b => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--line2)">
        <div>
          <b>${(b.name || 'Branch').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}</b>
          <div style="font-size:0.8rem;color:var(--muted)">${(b.address || '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))} • ${b.phone || ''}</div>
        </div>
        <button class="iconbtn danger" onclick="deleteBranch('${b.id}')">${ic('trash', 15)}</button>
      </div>
    `).join('');
  } catch (err) {
    console.error('renderBranchesTable:', err);
  }
}

export async function saveSocialSettings() {
  const insta = document.getElementById('sm-insta')?.value.trim() || '';
  const wa = document.getElementById('sm-wa')?.value.trim() || '';
  const fb = document.getElementById('sm-fb')?.value.trim() || '';
  const yt = document.getElementById('sm-yt')?.value.trim() || '';
  const tw = document.getElementById('sm-tw')?.value.trim() || '';

  const data = { instagram: insta, whatsapp: wa, facebook: fb, youtube: yt, twitter: tw };

  try {
    await callVercelApi('/api/admin/update-settings', { section: 'social', data });
    toast('Social links saved!');
  } catch (err) {
    console.error('saveSocialSettings:', err);
    toast('Error: ' + err.message);
  }
}

export async function saveGeneralSettings() {
  const keyword = document.getElementById('setting-admin-keyword')?.value.trim() || 'admin';
  try {
    await callVercelApi('/api/admin/update-settings', { section: 'settings', data: { adminKeyword: keyword } });
    toast('Settings saved!');
  } catch (err) {
    console.error('saveGeneralSettings:', err);
    toast('Error: ' + err.message);
  }
}

export async function deleteBranch(id) {
  confirmModal(
    'Delete Branch?',
    'Are you sure you want to remove this branch location? This cannot be undone.',
    'Delete',
    async () => {
      try {
        await deleteDoc(doc(db, 'branches', id));
        toast('Branch deleted successfully!');
        if (typeof window.loadAdminData === 'function') await window.loadAdminData();
        await renderBranchesTable();
      } catch (err) {
        console.error('deleteBranch:', err);
        toast('Failed to delete branch: ' + err.message);
      }
    }
  );
}

if (typeof window !== 'undefined') {
  window.renderBranchesTable = renderBranchesTable;
  window.saveSocialSettings = saveSocialSettings;
  window.saveGeneralSettings = saveGeneralSettings;
  window.deleteBranch = deleteBranch;
}
