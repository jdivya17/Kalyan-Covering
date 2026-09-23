/**
 * cmsAdminPage.js — CMS & Video content management controller for Kalyan Covering admin panel.
 */

import { db, collection, getDocs, doc, setDoc, updateDoc, deleteDoc } from '../firebase-config.js';
import { toast, confirmModal } from '../utils/icons.js';

export async function loadCMSVideos() {
  const grid = document.getElementById('video-mgmt-grid');
  if (!grid) return;

  grid.innerHTML = '<div class="card empty"><h3>Loading...</h3><p>Fetching community videos.</p></div>';

  try {
    const snap = await getDocs(collection(db, 'videos'));
    const videos = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (videos.length === 0) {
      grid.innerHTML = '<div class="card empty"><h3>No Videos</h3><p>No community or promotional videos uploaded yet.</p></div>';
      return;
    }

    grid.innerHTML = videos.map(v => `
      <div class="video-mgmt-card">
        <div class="vmg-thumb">
          <video src="${v.url || v.videoUrl}" style="width:100%;height:140px;object-fit:cover;border-radius:6px"></video>
          <span class="vmg-badge ${v.status}">${v.status === 'pending' ? '⏳ Pending' : '✓ Approved'}</span>
        </div>
        <div class="vmg-body">
          <div class="vmg-title"><b>${(v.title || 'Untitled Video').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}</b></div>
          <div class="vmg-meta">by ${(v.author || v.userName || 'Customer').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}</div>
          <div class="vmg-actions" style="margin-top:8px">
            ${v.status === 'pending'
              ? `<button class="tbtn solid sm" onclick="approveCMSVideo('${v.id}')">✓ Approve</button>`
              : `<span style="color:var(--ok);font-size:.8rem">Live</span>`}
            <button class="tbtn ghost sm danger" onclick="deleteCMSVideo('${v.id}')">Delete</button>
          </div>
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error('loadCMSVideos:', err);
    grid.innerHTML = `<div class="card empty"><h3 style="color:var(--red)">Error</h3><p>${err.message}</p></div>`;
  }
}

export async function approveCMSVideo(id) {
  try {
    await updateDoc(doc(db, 'videos', id), { status: 'approved' });
    toast('Video approved');
    loadCMSVideos();
  } catch (err) {
    console.error('approveCMSVideo:', err);
    toast('Error approving video');
  }
}

export async function deleteCMSVideo(id) {
  confirmModal('Delete Video?', 'Permanently remove this video?', 'Delete', async () => {
    try {
      await deleteDoc(doc(db, 'videos', id));
      toast('Video deleted');
      loadCMSVideos();
    } catch (err) {
      console.error('deleteCMSVideo:', err);
      toast('Error deleting video');
    }
  });
}

if (typeof window !== 'undefined') {
  window.loadCMSVideos = loadCMSVideos;
  window.approveCMSVideo = approveCMSVideo;
  window.deleteCMSVideo = deleteCMSVideo;
}
