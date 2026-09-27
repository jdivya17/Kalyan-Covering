/**
 * productsAdminPage.js — Kalyan Covering Admin Products Panel Controller
 */

import { statusPill } from '../components/StatusPill.js';
import { ic, openDrawer, closeDrawer, toast, confirmModal } from '../utils/icons.js';
import { callVercelApi } from '../firebase-config.js';
import { invalidateProductCache } from '../services/productService.js';

export let currentProductViewMode = 'table';
export let editingProductData = null;

export function renderProductsTable(products) {
  const list = products || window.adminProducts || (window.adminData && window.adminData.products) || [];
  const tbody = document.getElementById('products-table');
  const countLabel = document.getElementById('products-count-label');
  const pagerInfo = document.getElementById('products-pager-info');

  if (countLabel) countLabel.textContent = `${list.length} products total.`;
  if (pagerInfo) pagerInfo.textContent = `Showing ${list.length} of ${list.length}`;

  if (!tbody) return;

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--muted2)">No products found.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(p => {
    const id = p.id || '';
    const name = String(p.name || 'Untitled').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const cat = String(p.category || p.cat || 'General').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const price = Number(p.price || 0);
    const mrp = Number(p.mrp || 0);
    const stockVal = typeof p.stock === 'number' ? p.stock : (p.stock === 'out_of_stock' || p.stock === 'out' ? 0 : 10);
    const statusVal = String(p.status || 'active').toLowerCase();

    let stockPillHtml = statusPill('ok', `${stockVal} in stock`);
    if (stockVal === 0) stockPillHtml = statusPill('cancelled', 'Out of stock');
    else if (stockVal <= 5) stockPillHtml = statusPill('warn', `${stockVal} left`);

    const img = (p.imageURLs && p.imageURLs[0]) || p.image || '../assets/kalyan_logo.png';
    const priceFmt = '₹' + Math.round(price).toLocaleString('en-IN');
    const mrpFmt = mrp > price ? `<span style="color:var(--muted2);margin-left:4px">/ ₹${Math.round(mrp).toLocaleString('en-IN')}</span>` : '';

    return `
      <tr>
        <td><input type="checkbox" data-prod-id="${id}" aria-label="Select ${name}"></td>
        <td>
          <div class="cell-prod">
            <img src="${img}" alt="" onerror="this.src='../assets/kalyan_logo.png'">
            <div>
              <b>${name}</b>
              <span>${id}</span>
            </div>
          </div>
        </td>
        <td>${cat}</td>
        <td class="mono">${priceFmt}${mrpFmt}</td>
        <td>${stockPillHtml}</td>
        <td>${statusPill(statusVal)}</td>
        <td>
          <div class="rowact">
            <button class="iconbtn" onclick="openProductDrawer('${id}')" aria-label="Edit ${name}">
              ${ic('edit', 15)}
            </button>
            <button class="iconbtn danger" onclick="confirmDeleteProduct('${id}', '${name.replace(/'/g, "\\'")}')" aria-label="Delete ${name}">
              ${ic('trash', 15)}
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

export function filterProductsUI() {
  const query = (document.getElementById('prod-search-input')?.value || '').toLowerCase().trim();
  const cat = (document.getElementById('prod-cat-filter')?.value || 'all');
  const status = (document.getElementById('prod-status-filter')?.value || 'all');

  let list = window.adminProducts || (window.adminData && window.adminData.products) || [];

  if (query) {
    list = list.filter(p => (p.name || '').toLowerCase().includes(query) || (p.id || '').toLowerCase().includes(query) || (p.category || '').toLowerCase().includes(query));
  }
  if (cat !== 'all') {
    list = list.filter(p => (p.category || p.cat || '') === cat);
  }
  if (status !== 'all') {
    list = list.filter(p => String(p.status || 'active').toLowerCase() === status);
  }

  renderProductsTable(list);
}

export function openProductDrawer(productId) {
  let p = null;
  if (productId) {
    const list = window.adminProducts || (window.adminData && window.adminData.products) || [];
    p = list.find(x => x.id === productId);
  }
  editingProductData = p ? { ...p } : { id: 'KC-' + Date.now().toString(36).toUpperCase(), name: '', category: 'Necklaces', price: '', mrp: '', stock: 10, status: 'active', description: '', occasion: '', videoUrl: '', imageURLs: [] };
  window.editingProductData = editingProductData;

  const title = p ? 'Edit product' : 'Add product';
  const curP = editingProductData;

  const html = `
    <div class="dr-h">
      <h2>${title}</h2>
      <button class="iconbtn" onclick="closeDrawer()" aria-label="Close">${ic('close', 16)}</button>
    </div>
    <div class="dr-b">
      <!-- Photos Section -->
      <div class="f">
        <label>Product photos</label>
        <div class="vdrop" onclick="document.getElementById('drawer-photos-input').click()">
          ${ic('upload', 22)}
          <p style="margin-top:8px">Drag photos here or click to upload</p>
          <span style="font-size:.76rem;color:var(--muted2)">JPEG or PNG, up to 5MB each</span>
        </div>
        <input type="file" id="drawer-photos-input" accept="image/*" multiple style="display:none" onchange="handleDrawerPhotosUpload(this.files)">
        <div class="thumbrow" id="drawer-photos-thumbs">
          ${(curP.imageURLs || (curP.image ? [curP.image] : [])).map((imgUrl, idx) => `
            <div class="tb">
              <img src="${imgUrl}" style="width:100%;height:100%;object-fit:cover" alt="">
              <button type="button" onclick="removeDrawerPhoto(${idx})" aria-label="Remove photo">${ic('x', 10)}</button>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Video Section -->
      <div class="f">
        <label>Product video <span style="color:var(--muted2);font-weight:400">(optional, MP4 &lt; 20MB)</span></label>
        <div class="vdrop" id="vdrop-zone" onclick="document.getElementById('drawer-video-input').click()">
          ${ic('film', 22)}
          <p style="margin-top:8px">Drag a video here or click to upload</p>
          <span style="font-size:.76rem;color:var(--muted2)">MP4, up to 30 seconds and 20MB</span>
        </div>
        <input type="file" id="drawer-video-input" accept="video/mp4,video/*" style="display:none" onchange="handleDrawerVideoUpload(this.files[0])">
        <div id="drawer-video-progress" style="display:none;margin-top:8px;font-size:.8rem;color:var(--gold-hi)">Uploading video...</div>
        <div id="drawer-video-preview">
          ${curP.videoUrl ? `
            <div class="vpreview">
              <div class="vt">${ic('play', 20)}</div>
              <div class="vinfo">
                <b>video.mp4</b>
                <span style="word-break:break-all">${curP.videoUrl}</span>
              </div>
              <button type="button" class="iconbtn danger" onclick="removeDrawerVideo()" aria-label="Remove video">${ic('trash', 15)}</button>
            </div>
          ` : ''}
        </div>
      </div>

      <div class="frow2">
        <div class="f">
          <label>Product name *</label>
          <input type="text" id="df-name" value="${curP.name || ''}" placeholder="Temple Lakshmi Haaram">
        </div>
        <div class="f">
          <label>Category *</label>
          <select class="select" id="df-cat">
            <option ${curP.category==='Necklaces'?'selected':''}>Necklaces</option>
            <option ${curP.category==='Rings'?'selected':''}>Rings</option>
            <option ${curP.category==='Earrings'?'selected':''}>Earrings</option>
            <option ${curP.category==='Bangles'?'selected':''}>Bangles</option>
            <option ${curP.category==='Bracelets'?'selected':''}>Bracelets</option>
            <option ${curP.category==='Anklets'?'selected':''}>Anklets</option>
            <option ${curP.category==='Mangalsutra'?'selected':''}>Mangalsutra</option>
            <option ${curP.category==='Others'?'selected':''}>Others</option>
          </select>
        </div>
      </div>

      <div class="frow2">
        <div class="f">
          <label>Selling price (₹) *</label>
          <input type="number" id="df-price" value="${curP.price || ''}" placeholder="3490">
        </div>
        <div class="f">
          <label>MRP (₹)</label>
          <input type="number" id="df-mrp" value="${curP.mrp || ''}" placeholder="4990">
        </div>
      </div>

      <div class="frow2">
        <div class="f">
          <label>Stock quantity *</label>
          <input type="number" id="df-stock" value="${curP.stock !== undefined ? curP.stock : 10}" placeholder="10">
        </div>
        <div class="f">
          <label>Status</label>
          <select class="select" id="df-status">
            <option value="active" ${curP.status==='active'?'selected':''}>Active</option>
            <option value="draft" ${curP.status==='draft'?'selected':''}>Draft</option>
          </select>
        </div>
      </div>

      <div class="f">
        <label>Description</label>
        <textarea id="df-desc" rows="4" placeholder="A long temple haaram with coin medallions...">${curP.description || ''}</textarea>
      </div>

      <div class="f">
        <label>Best for (occasion)</label>
        <input type="text" id="df-occasion" value="${curP.occasion || ''}" placeholder="Wedding, festive">
      </div>
    </div>

    <div class="dr-f">
      <button type="button" class="tbtn ghost" onclick="closeDrawer()">Cancel</button>
      <button type="button" class="tbtn solid" onclick="saveDrawerProduct()">Save product</button>
    </div>
  `;

  openDrawer(html);
}

export async function handleDrawerPhotosUpload(files) {
  if (!files || files.length === 0) return;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    try {
      if (typeof window.uploadToCloudinary === 'function') {
        const url = await window.uploadToCloudinary(file, 'image');
        if (url) {
          if (!editingProductData.imageURLs) editingProductData.imageURLs = [];
          editingProductData.imageURLs.push(url);
          editingProductData.image = editingProductData.imageURLs[0];
        }
      }
    } catch (e) {
      console.error(e);
    }
  }
  const thumbsContainer = document.getElementById('drawer-photos-thumbs');
  if (thumbsContainer) {
    thumbsContainer.innerHTML = (editingProductData.imageURLs || []).map((imgUrl, idx) => `
      <div class="tb">
        <img src="${imgUrl}" style="width:100%;height:100%;object-fit:cover" alt="">
        <button type="button" onclick="removeDrawerPhoto(${idx})" aria-label="Remove photo">${ic('x', 10)}</button>
      </div>
    `).join('');
  }
}

export function removeDrawerPhoto(idx) {
  if (editingProductData && editingProductData.imageURLs) {
    editingProductData.imageURLs.splice(idx, 1);
    editingProductData.image = editingProductData.imageURLs.length > 0 ? editingProductData.imageURLs[0] : '';
    const thumbsContainer = document.getElementById('drawer-photos-thumbs');
    if (thumbsContainer) {
      thumbsContainer.innerHTML = (editingProductData.imageURLs || []).map((imgUrl, i) => `
        <div class="tb">
          <img src="${imgUrl}" style="width:100%;height:100%;object-fit:cover" alt="">
          <button type="button" onclick="removeDrawerPhoto(${i})" aria-label="Remove photo">${ic('x', 10)}</button>
        </div>
      `).join('');
    }
  }
}

export async function handleDrawerVideoUpload(file) {
  if (!file) return;
  if (!file.type.includes('mp4') && !file.name.endsWith('.mp4')) {
    toast('Error: MP4 video format required!');
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    toast('Error: Video file size must be under 20MB!');
    return;
  }

  const progEl = document.getElementById('drawer-video-progress');
  if (progEl) progEl.style.display = 'block';

  try {
    let downloadURL = '';
    if (typeof window.uploadToCloudinary === 'function') {
      downloadURL = await window.uploadToCloudinary(file, 'video');
    }
    if (downloadURL) {
      editingProductData.videoUrl = downloadURL;
      editingProductData.videoURLs = [downloadURL];
      if (progEl) progEl.style.display = 'none';

      const prevEl = document.getElementById('drawer-video-preview');
      if (prevEl) {
        prevEl.innerHTML = `
          <div class="vpreview">
            <div class="vt">${ic('play', 20)}</div>
            <div class="vinfo">
              <b>video.mp4</b>
              <span style="word-break:break-all">${downloadURL}</span>
            </div>
            <button type="button" class="iconbtn danger" onclick="removeDrawerVideo()" aria-label="Remove video">${ic('trash', 15)}</button>
          </div>
        `;
      }
      toast('Video uploaded successfully!');
    }
  } catch (err) {
    console.error(err);
    if (progEl) progEl.style.display = 'none';
    toast('Upload failed: ' + err.message);
  }
}

export function removeDrawerVideo() {
  if (editingProductData) {
    editingProductData.videoUrl = '';
    editingProductData.videoURLs = [];
    const prevEl = document.getElementById('drawer-video-preview');
    if (prevEl) prevEl.innerHTML = '';
  }
}

export async function saveDrawerProduct() {
  const name = document.getElementById('df-name')?.value.trim();
  const cat = document.getElementById('df-cat')?.value;
  const price = parseFloat(document.getElementById('df-price')?.value || '0');
  const mrp = parseFloat(document.getElementById('df-mrp')?.value || '0');
  const stock = parseInt(document.getElementById('df-stock')?.value || '0', 10);
  const status = document.getElementById('df-status')?.value || 'active';
  const desc = document.getElementById('df-desc')?.value.trim() || '';
  const occasion = document.getElementById('df-occasion')?.value.trim() || '';

  if (!name) { toast('Please enter a product name!'); return; }
  if (isNaN(price) || price <= 0) { toast('Please enter a valid price!'); return; }

  const curP = editingProductData || {};

  const productPayload = {
    name,
    category: cat,
    cat,
    price,
    mrp: mrp || price,
    stock,
    stockStatus: stock === 0 ? 'out' : (stock <= 5 ? 'low' : 'in'),
    status,
    description: desc,
    occasion,
    imageURLs: curP.imageURLs || (curP.image ? [curP.image] : []),
    image: (curP.imageURLs && curP.imageURLs[0]) || curP.image || '',
    videoUrl: curP.videoUrl || '',
    videoURLs: curP.videoUrl ? [curP.videoUrl] : []
  };

  try {
    if (curP && curP.id && window.adminProducts && window.adminProducts.some(x => x.id === curP.id)) {
      await callVercelApi('/api/products/update', { id: curP.id, ...productPayload });
    } else {
      await callVercelApi('/api/products/create', productPayload);
    }
    invalidateProductCache();
    closeDrawer();
    toast('Product saved successfully!');
    if (typeof window.loadAdminData === 'function') window.loadAdminData();
  } catch (err) {
    console.error(err);
    toast('Error saving product: ' + err.message);
  }
}

export function confirmDeleteProduct(id, name) {
  confirmModal(
    'Delete this product?',
    `This cannot be undone. "${name}" will be removed from the store immediately.`,
    'Delete',
    async () => {
      try {
        await callVercelApi('/api/products/delete', { id });
        invalidateProductCache();
        toast('Product deleted!');
        if (typeof window.loadAdminData === 'function') window.loadAdminData();
      } catch (err) {
        console.error(err);
        toast('Failed to delete product: ' + err.message);
      }
    }
  );
}

export function openBulkUploadDrawer() {
  const html = `
    <div class="dr-h"><h2>Bulk upload products</h2><button class="iconbtn" onclick="closeDrawer()" aria-label="Close">${ic('close',16)}</button></div>
    <div class="dr-b">
     <div class="f"><label>CSV File</label>
      <div class="vdrop" onclick="document.getElementById('csvInput').click()">
        ${ic('csv',22)}
        <p style="margin-top:8px">Click to choose a .csv file</p>
        <span style="font-size:.76rem;color:var(--muted2)">Columns: name, category, price, mrp, stock, status</span>
      </div>
      <input type="file" id="csvInput" accept=".csv" style="display:none" onchange="handleCSVSelect(this.files[0])">
     </div>
     <div id="csvPreview" style="margin-top:1rem"></div>
    </div>
    <div class="dr-f">
      <button class="tbtn ghost" onclick="closeDrawer()">Cancel</button>
      <button class="tbtn solid" id="csvImportBtn" disabled onclick="executeCSVImport()">Import products</button>
    </div>
  `;
  openDrawer(html);
}

let parsedCSVProducts = [];

export async function handleCSVSelect(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) {
      toast('CSV file is empty or missing headers!');
      return;
    }

    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/^["']|["']$/g, ''));
    
    const nameIdx = headers.findIndex(h => h === 'name' || h === 'product name' || h === 'title');
    const catIdx = headers.findIndex(h => h === 'category' || h === 'cat');
    const priceIdx = headers.findIndex(h => h === 'price');
    const mrpIdx = headers.findIndex(h => h === 'mrp' || h === 'compare_at_price');
    const stockIdx = headers.findIndex(h => h === 'stock' || h === 'quantity');
    const statusIdx = headers.findIndex(h => h === 'status');

    if (nameIdx === -1 || priceIdx === -1) {
      toast('CSV must contain at least "name" and "price" columns!');
      return;
    }

    parsedCSVProducts = [];
    let invalidCount = 0;

    for (let i = 1; i < lines.length; i++) {
      const rowParts = lines[i].split(',').map(cell => cell.trim().replace(/^["']|["']$/g, ''));
      const name = rowParts[nameIdx] || '';
      const price = parseFloat(rowParts[priceIdx]);
      const cat = catIdx !== -1 ? (rowParts[catIdx] || 'General') : 'General';
      const mrp = mrpIdx !== -1 ? (parseFloat(rowParts[mrpIdx]) || price) : price;
      const stock = stockIdx !== -1 ? (parseInt(rowParts[stockIdx], 10) || 10) : 10;
      const status = statusIdx !== -1 ? (rowParts[statusIdx] || 'active') : 'active';

      if (name && !isNaN(price) && price > 0) {
        parsedCSVProducts.push({ name, category: cat, price, mrp, stock, status });
      } else {
        invalidCount++;
      }
    }

    const previewEl = document.getElementById('csvPreview');
    const importBtn = document.getElementById('csvImportBtn');

    if (previewEl) {
      if (parsedCSVProducts.length === 0) {
        previewEl.innerHTML = `<div style="color:var(--red,#ef4444);font-size:0.85rem">No valid product rows found in CSV. Required: name & price > 0.</div>`;
        if (importBtn) importBtn.disabled = true;
      } else {
        const rowsHTML = parsedCSVProducts.slice(0, 5).map(p => `
          <tr>
            <td style="padding:4px 8px">${p.name}</td>
            <td style="padding:4px 8px">${p.category}</td>
            <td style="padding:4px 8px">₹${p.price}</td>
            <td style="padding:4px 8px">₹${p.mrp}</td>
            <td style="padding:4px 8px">${p.stock}</td>
            <td style="padding:4px 8px">${p.status}</td>
          </tr>
        `).join('');

        previewEl.innerHTML = `
          <div style="font-size:0.85rem;margin-bottom:8px;color:var(--gold,#d4af37)">
            Ready to import <b>${parsedCSVProducts.length}</b> products. ${invalidCount > 0 ? `(${invalidCount} invalid rows ignored)` : ''}
          </div>
          <div style="max-height:160px;overflow-y:auto;border:1px solid var(--line,#333);border-radius:6px;padding:4px">
            <table style="width:100%;font-size:0.8rem;text-align:left;border-collapse:collapse">
              <thead>
                <tr style="border-bottom:1px solid var(--line,#333);color:var(--muted)">
                  <th style="padding:4px 8px">Name</th>
                  <th style="padding:4px 8px">Category</th>
                  <th style="padding:4px 8px">Price</th>
                  <th style="padding:4px 8px">MRP</th>
                  <th style="padding:4px 8px">Stock</th>
                  <th style="padding:4px 8px">Status</th>
                </tr>
              </thead>
              <tbody>${rowsHTML}</tbody>
            </table>
          </div>
          ${parsedCSVProducts.length > 5 ? `<div style="font-size:0.75rem;color:var(--muted);margin-top:4px">+ ${parsedCSVProducts.length - 5} more rows...</div>` : ''}
        `;
        if (importBtn) importBtn.disabled = false;
      }
    }
  } catch (err) {
    console.error('CSV parse error:', err);
    toast('Error reading CSV file: ' + err.message);
  }
}

export async function executeCSVImport() {
  if (!parsedCSVProducts || parsedCSVProducts.length === 0) {
    toast('No valid products to import!');
    return;
  }

  const importBtn = document.getElementById('csvImportBtn');
  if (importBtn) {
    importBtn.disabled = true;
    importBtn.textContent = 'Importing...';
  }

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < parsedCSVProducts.length; i++) {
    const p = parsedCSVProducts[i];
    if (importBtn) importBtn.textContent = `Importing (${i + 1}/${parsedCSVProducts.length})...`;

    const productPayload = {
      name: p.name,
      category: p.category,
      cat: p.category,
      price: p.price,
      mrp: p.mrp || p.price,
      stock: p.stock,
      stockStatus: p.stock === 0 ? 'out' : (p.stock <= 5 ? 'low' : 'in'),
      status: p.status || 'active',
      description: '',
      imageURLs: [],
      image: '',
      videoUrl: '',
      videoURLs: []
    };

    try {
      await callVercelApi('/api/products/create', productPayload);
      successCount++;
    } catch (err) {
      console.error(`Failed to import CSV row ${i + 1} (${p.name}):`, err);
      failCount++;
    }
  }

  invalidateProductCache();
  closeDrawer();
  toast(`Bulk import complete! ${successCount} imported${failCount > 0 ? `, ${failCount} failed` : ''}.`);
  
  if (typeof window.loadAdminData === 'function') {
    await window.loadAdminData();
  }
}

// Bind window object for legacy inline HTML calls
if (typeof window !== 'undefined') {
  window.currentProductViewMode = currentProductViewMode;
  window.editingProductData = editingProductData;
  window.renderProductsTable = renderProductsTable;
  window.filterProductsUI = filterProductsUI;
  window.openProductDrawer = openProductDrawer;
  window.handleDrawerPhotosUpload = handleDrawerPhotosUpload;
  window.removeDrawerPhoto = removeDrawerPhoto;
  window.handleDrawerVideoUpload = handleDrawerVideoUpload;
  window.removeDrawerVideo = removeDrawerVideo;
  window.saveDrawerProduct = saveDrawerProduct;
  window.confirmDeleteProduct = confirmDeleteProduct;
  window.openBulkUploadDrawer = openBulkUploadDrawer;
  window.handleCSVSelect = handleCSVSelect;
  window.executeCSVImport = executeCSVImport;
}
