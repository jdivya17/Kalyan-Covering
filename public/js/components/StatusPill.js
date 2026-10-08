/**
 * StatusPill.js — Status pill generator and Needs Attention panel renderer.
 */

export function statusPill(s, label) {
  const st = String(s || '').toLowerCase();
  // Canonical slug → pill type
  const pillType = {
    delivered:                'ok',
    active:                   'ok',
    approved:                 'ok',
    shipped:                  'warn',
    out_for_delivery:         'warn',
    packed:                   'warn',
    confirmed:                'warn',
    low:                      'warn',
    cancelled:                'danger',
    rejected:                 'danger',
    returned:                 'danger',
    action_required_oversold: 'danger',
    out_of_stock:             'danger',
    draft:                    'muted',
    pending:                  'muted',
    payment_pending:          'muted'
  }[st] || '';
  // Human-readable label map
  const labelMap = {
    payment_pending:          'Payment Pending',
    pending:                  'Order Placed',
    confirmed:                'Confirmed',
    packed:                   'Packed',
    shipped:                  'Shipped',
    out_for_delivery:         'Out for Delivery',
    delivered:                'Delivered',
    cancelled:                'Cancelled',
    returned:                 'Returned',
    action_required_oversold: 'Action Required'
  };
  const displayLabel = label || labelMap[st] || (st ? st.charAt(0).toUpperCase() + st.slice(1) : '—');
  return `<span class="pill ${pillType}"><i></i>${displayLabel}</span>`;
}

export function renderNeedsAttention() {
  const container = document.getElementById('needs-attention-container');
  if (!container) return;

  const prods = window.adminProducts || (window.adminData && window.adminData.products) || [];
  const revs = window.adminReviews || [];

  const lowStock = prods.filter(p => {
    const s = typeof p.stock === 'number' ? p.stock : (p.stock === 'out_of_stock' ? 0 : 10);
    return s <= 5;
  }).slice(0, 4);

  const pendingRevs = revs.filter(r => (r.status || 'pending').toLowerCase() === 'pending').slice(0, 3);

  let html = '';

  if (lowStock.length > 0) {
    html += lowStock.map(p => {
      const stockVal = typeof p.stock === 'number' ? p.stock : 0;
      const stClass = stockVal === 0 ? 'cancelled' : 'warn';
      const stLabel = stockVal === 0 ? 'Out of stock' : `${stockVal} left`;
      const img = (p.imageURLs && p.imageURLs[0]) || p.image || '../assets/kalyan_logo.png';
      const nameClean = String(p.name || 'Product').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      return `
        <div style="display:flex;align-items:center;gap:11px;padding:.4rem 0;border-bottom:1px solid var(--line2)">
          <img src="${img}" alt="" style="width:34px;height:34px;border-radius:6px;object-fit:cover;border:1px solid var(--line);flex:none" onerror="this.src='../assets/kalyan_logo.png'">
          <div style="flex:1;min-width:0">
            <b style="display:block;font-size:.86rem;color:var(--ivory);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${nameClean}</b>
            <span style="color:var(--muted2);font-size:.76rem">${stLabel}</span>
          </div>
          ${statusPill(stClass, stockVal === 0 ? 'Out' : 'Low')}
        </div>`;
    }).join('');
  } else {
    html += `<div style="color:var(--ok);font-size:.84rem;padding:.3rem 0">✓ All products are well stocked!</div>`;
  }

  if (pendingRevs.length > 0) {
    html += `
      <div style="border-top:1px solid var(--line2);margin-top:4px;padding-top:10px">
        <b style="display:block;font-size:.86rem;color:var(--gold);margin-bottom:6px">Reviews waiting (${pendingRevs.length})</b>
        ${pendingRevs.map(r => `
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:.82rem;color:var(--muted);padding:.35rem 0">
            <span style="min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-right:8px"><b>${String(r.userName || r.cust || 'Customer').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}</b> on ${String(r.productName || 'Product').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}</span>
            <a class="lb" href="#reviews" onclick="if(typeof window.showPanel==='function'){window.showPanel('reviews');return false;}" style="font-size:.78rem;color:var(--gold-hi);flex:none">Review →</a>
          </div>
        `).join('')}
      </div>`;
  }

  container.innerHTML = html;
  if (typeof window.renderShellIcons === 'function') {
    window.renderShellIcons();
  }
}

if (typeof window !== 'undefined') {
  window.statusPill = statusPill;
  window.renderNeedsAttention = renderNeedsAttention;
}
