/**
 * reviewsAdminPage.js — Customer Reviews moderation controller for Kalyan Covering admin panel.
 */

import { db, collection, getDocs, doc, updateDoc, deleteDoc, query, where, orderBy, serverTimestamp } from '../firebase-config.js';
import { toast } from '../utils/icons.js';

export async function loadAdminReviews() {
  const listContainer = document.getElementById('admin-reviews-list');
  const countLabel = document.getElementById('reviews-count-label');
  if (!listContainer) return;
  const statusFilter = document.getElementById('review-filter-status')?.value || 'pending';
  listContainer.innerHTML = '<div class="card empty"><h3>Loading...</h3><p>Fetching reviews.</p></div>';
  try {
    let q;
    const reviewsCol = collection(db, 'reviews');
    if (statusFilter === 'all') {
      q = query(reviewsCol, orderBy('createdAt', 'desc'));
    } else {
      q = query(reviewsCol, where('status', '==', statusFilter), orderBy('createdAt', 'desc'));
    }
    const snap = await getDocs(q);
    const reviews = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (countLabel) {
      countLabel.textContent = `${reviews.length} ${statusFilter === 'all' ? '' : statusFilter} reviews.`;
    }

    if (reviews.length === 0) {
      listContainer.innerHTML = `<div class="card empty"><h3>All caught up</h3><p>No ${statusFilter === 'all' ? '' : statusFilter} reviews waiting for approval right now.</p></div>`;
      return;
    }

    listContainer.innerHTML = reviews.map(r => {
      const cleanName = (r.reviewerName || r.userName || 'Customer').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      const initial = cleanName.charAt(0).toUpperCase();
      const cleanText = (r.text || r.reviewText || '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      const starsNum = Math.min(5, Math.max(0, Number(r.rating) || 0));
      const starsHtml = '★'.repeat(starsNum) + '☆'.repeat(5 - starsNum);
      const prodName = (r.productName || r.productId?.substring(0,10) || 'Unknown Product').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      
      const photoCount = (r.photos || []).length;
      const photosHtml = photoCount > 0
        ? `<div class="rev-photos">${(r.photos || []).map(u => `<img src="${u}" style="width:40px;height:40px;object-fit:cover;border-radius:4px;" onerror="this.style.display='none'">`).join('')}</div>`
        : '';
        
      let actions = '';
      if (r.status === 'pending') {
        actions = `<div class="rev-act"><button class="tbtn ghost sm" onclick="rejectAdminReview('${r.id}')">Reject</button><button class="tbtn solid sm" onclick="approveAdminReview('${r.id}')">Approve</button></div>`;
      } else if (r.status === 'approved') {
        actions = `<div class="rev-act"><span style="color:var(--green);font-size:0.8rem;margin-right:auto">✅ Approved</span><button class="tbtn ghost sm" onclick="rejectAdminReview('${r.id}')">Reject instead</button><button class="tbtn ghost sm" onclick="deleteAdminReview('${r.id}')">Delete</button></div>`;
      } else {
        actions = `<div class="rev-act"><span style="color:var(--red);font-size:0.8rem;margin-right:auto">❌ Rejected</span><button class="tbtn ghost sm" onclick="approveAdminReview('${r.id}')">Approve instead</button><button class="tbtn ghost sm" onclick="deleteAdminReview('${r.id}')">Delete</button></div>`;
      }

      return `<div class="rev-card">
        <span class="avatar-sm">${initial}</span>
        <div>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <b>${cleanName}</b>
            <span class="stars" style="color:var(--gold)" aria-label="${starsNum} stars">${starsHtml}</span>
            <span style="color:var(--muted2);font-size:.78rem">on ${prodName}</span>
          </div>
          <p style="margin-top:0.5rem;color:var(--white-dim)">${cleanText}</p>
          ${photosHtml}
        </div>
        ${actions}
      </div>`;
    }).join('');
  } catch (err) {
    console.error('loadAdminReviews:', err);
    listContainer.innerHTML = `<div class="card empty"><h3 style="color:var(--red)">Error</h3><p>Failed to load reviews: ${err.message}</p></div>`;
  }
}

export async function approveAdminReview(reviewId) {
  try {
    await updateDoc(doc(db, 'reviews', reviewId), { status: 'approved', moderatedAt: serverTimestamp() });
    toast('Review Approved');
    await loadAdminReviews();
  } catch (err) {
    console.error('approveAdminReview:', err);
    toast('Error: ' + err.message);
  }
}

export async function rejectAdminReview(reviewId) {
  try {
    await updateDoc(doc(db, 'reviews', reviewId), { status: 'rejected', moderatedAt: serverTimestamp() });
    toast('Review Rejected');
    await loadAdminReviews();
  } catch (err) {
    console.error('rejectAdminReview:', err);
    toast('Error: ' + err.message);
  }
}

export async function deleteAdminReview(reviewId) {
  if (!confirm('Permanently delete this review? This cannot be undone.')) return;
  try {
    await deleteDoc(doc(db, 'reviews', reviewId));
    toast('Review Deleted');
    await loadAdminReviews();
  } catch (err) {
    console.error('deleteAdminReview:', err);
    toast('Error: ' + err.message);
  }
}

if (typeof window !== 'undefined') {
  window.loadAdminReviews = loadAdminReviews;
  window.approveAdminReview = approveAdminReview;
  window.rejectAdminReview = rejectAdminReview;
  window.deleteAdminReview = deleteAdminReview;
}
