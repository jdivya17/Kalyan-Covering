/**
 * productsPage.js — Kalyan Covering
 * Full catalog page logic: Filter panel (Category, Price Min/Max + Presets, Stone Colour, Occasion, Discount),
 * URL Query String Sync (read & write), instant apply on desktop, mobile bottom sheet with live count,
 * active filter chips, and sorting select.
 */

import { KC } from '../store/state.js';
import { loadProducts } from '../services/productService.js';
import { Cart } from '../services/cartService.js';
import { Wishlist } from '../services/wishlistService.js';
import { ic } from '../utils/icons.js';
import { formatCurrency, escapeHtml } from '../utils/helpers.js';

export async function initProductsPage() {
  console.log('Products Catalog initialized.');
  const products = await loadProducts();
  renderCatalogPage(products);

  // Sync state on back/forward browser navigation
  window.addEventListener('popstate', () => {
    renderCatalogPage(KC.products);
  });
}

export function parseQueryParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    category: params.getAll('category').flatMap(c => c.split(',')).filter(Boolean),
    minPrice: params.get('minPrice') || '',
    maxPrice: params.get('maxPrice') || '',
    stone: params.getAll('stone').flatMap(s => s.split(',')).filter(Boolean),
    occasion: params.getAll('occasion').flatMap(o => o.split(',')).filter(Boolean),
    discount: params.get('discount') || '',
    tag: params.get('tag') || '',
    search: params.get('q') || params.get('search') || '',
    sort: params.get('sort') || 'featured'
  };
}

export function filterProducts(products, filters) {
  return products.filter(p => {
    // Category filter
    if (filters.category.length > 0) {
      if (!p.category || !filters.category.includes(p.category)) return false;
    }

    // Price filter
    if (filters.minPrice && p.price < Number(filters.minPrice)) return false;
    if (filters.maxPrice && p.price > Number(filters.maxPrice)) return false;

    // Stone / Gem filter
    if (filters.stone.length > 0) {
      const pStone = p.stone || p.gem || p.stoneColor || '';
      if (!filters.stone.some(s => pStone.toLowerCase().includes(s.toLowerCase()))) return false;
    }

    // Occasion filter
    if (filters.occasion.length > 0) {
      const pOcc = (p.occasion || p.occ || p.tag || '').toLowerCase();
      if (!filters.occasion.some(o => pOcc.includes(o.toLowerCase()))) return false;
    }

    // Tag filter (e.g. Bridal, New)
    if (filters.tag) {
      const pTag = (p.tag || p.tags?.join(' ') || '').toLowerCase();
      if (!pTag.includes(filters.tag.toLowerCase())) return false;
    }

    // Discount filter
    if (filters.discount) {
      const mrp = p.mrp || Math.round(p.price * 1.2);
      const disc = Math.round(((mrp - p.price) / mrp) * 100);
      if (disc < Number(filters.discount)) return false;
    }

    // Search query
    if (filters.search) {
      const q = filters.search.toLowerCase();
      const pName = (p.name || p.productName || '').toLowerCase();
      const pCat = (p.category || '').toLowerCase();
      if (!pName.includes(q) && !pCat.includes(q)) return false;
    }

    return true;
  });
}

export function sortProducts(products, sortKey) {
  const list = [...products];
  switch (sortKey) {
    case 'price-asc':
    case 'low':
      return list.sort((a, b) => a.price - b.price);
    case 'price-desc':
    case 'high':
      return list.sort((a, b) => b.price - a.price);
    case 'discount':
    case 'off':
      return list.sort((a, b) => {
        const discA = ((a.mrp || a.price * 1.2) - a.price) / (a.mrp || a.price * 1.2);
        const discB = ((b.mrp || b.price * 1.2) - b.price) / (b.mrp || b.price * 1.2);
        return discB - discA;
      });
    default:
      return list;
  }
}

export function renderCatalogPage(products = KC.products) {
  const filters = parseQueryParams();
  const filtered = filterProducts(products, filters);
  const sorted = sortProducts(filtered, filters.sort);

  // Update Page Title & Breadcrumbs
  const titleEl = document.getElementById('catalog-title');
  const countEl = document.getElementById('catalog-count');
  if (titleEl) {
    if (filters.category.length === 1) titleEl.textContent = `${filters.category[0]} Collection`;
    else if (filters.tag === 'Bridal') titleEl.textContent = 'Bridal Jewellery Sets';
    else if (filters.search) titleEl.textContent = `Search: "${filters.search}"`;
    else titleEl.textContent = 'All Jewellery Catalog';
  }
  if (countEl) countEl.textContent = `${sorted.length} piece${sorted.length === 1 ? '' : 's'}`;

  // Render Active Filter Chips
  renderActiveChips(filters);

  // Render Filter Sidebar Form Controls
  renderFilterPanel(products, filters, sorted.length);

  // Render Catalog Grid
  const grid = document.getElementById('catalog-grid');
  if (!grid) return;

  if (sorted.length === 0) {
    grid.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:4rem 1rem;" class="empty">
        <h2>No Jewellery Found</h2>
        <p style="color:var(--muted);margin:0.8rem 0 1.6rem;">Try clearing your active filters or searching for another term.</p>
        <button class="btn solid" onclick="clearAllFilters()">Clear All Filters</button>
      </div>`;
    return;
  }

  grid.innerHTML = sorted.map(product => {
    const isWish = Wishlist.has(product.id);
    const mrp = product.mrp || Math.round(product.price * 1.2);
    const discount = Math.round(((mrp - product.price) / mrp) * 100);
    const image = product.image || product.primaryImageURL || product.images?.[0] || '/img-fallback.svg';

    return `
      <article class="card">
        <a class="card-art" href="product-detail.html?id=${product.id}">
          <img src="${image}" alt="${escapeHtml(product.name)}" loading="lazy" onerror="this.src='/img-fallback.svg'" />
          ${product.isNew ? '<span class="badge">New Arrival</span>' : (product.popular ? '<span class="badge">Bestseller</span>' : '')}
        </a>

        <button class="heart ${isWish ? 'on' : ''}" onclick="handleWishToggle('${product.id}', this)" aria-label="Toggle Wishlist">
          ${ic('heart', 18)}
        </button>

        <div class="card-b">
          <a href="product-detail.html?id=${product.id}">
            <h3>${escapeHtml(product.name)}</h3>
          </a>
          <div class="sub">${escapeHtml(product.category || 'Jewellery')}</div>
          <div class="pr">
            <strong>${formatCurrency(product.price)}</strong>
            ${mrp > product.price ? `<s>${formatCurrency(mrp)}</s> <span class="off">${discount}% off</span>` : ''}
          </div>
          <button class="btn sm block" onclick="handleAddToCart('${product.id}', this)">
            Add to bag
          </button>
        </div>
      </article>
    `;
  }).join('');
}

function renderFilterPanel(products, filters, resultCount) {
  const panel = document.getElementById('fpanel');
  if (!panel) return;

  const categories = ['Necklaces', 'Rings', 'Earrings', 'Bangles'];
  const stones = [
    { key: 'cz', label: 'CZ Diamond', color: '#ffffff' },
    { key: 'ruby', label: 'Ruby Red', color: '#b91c1c' },
    { key: 'emerald', label: 'Emerald Green', color: '#047857' },
    { key: 'kundan', label: 'Kundan Gold', color: '#d6b25e' }
  ];
  const occasions = ['Bridal', 'Wedding', 'Festive', 'Everyday'];

  panel.innerHTML = `
    <form id="filterForm" onsubmit="return false">
      <div class="fh">
        <h3>Filters</h3>
        <span style="display:flex;gap:6px;align-items:center">
          <button type="button" class="btn ghost sm" onclick="clearAllFilters()">Clear all</button>
          <button type="button" class="ib only-m" onclick="closeFilterPanel()" aria-label="Close filters">${ic('close')}</button>
        </span>
      </div>
      <div class="fbody">
        <!-- Category Filter -->
        <details open>
          <summary>Category</summary>
          <div class="opts">
            ${categories.map(c => `
              <label class="ck">
                <input type="checkbox" name="category" value="${c}" ${filters.category.includes(c) ? 'checked' : ''} onchange="handleFilterChange()" />
                <span>${c}</span>
                <small>(${products.filter(p => p.category === c).length})</small>
              </label>
            `).join('')}
          </div>
        </details>

        <!-- Price Range Filter -->
        <details open>
          <summary>Price Range</summary>
          <div class="price2">
            <label>Min (₹)
              <input type="number" name="minPrice" placeholder="0" value="${filters.minPrice}" onchange="handleFilterChange()" />
            </label>
            <label>Max (₹)
              <input type="number" name="maxPrice" placeholder="15000" value="${filters.maxPrice}" onchange="handleFilterChange()" />
            </label>
          </div>
          <div class="pre">
            <button type="button" onclick="setPricePreset(0, 1000)">Under ₹1,000</button>
            <button type="button" onclick="setPricePreset(1000, 3000)">₹1,000 - ₹3,000</button>
            <button type="button" onclick="setPricePreset(3000, 5000)">₹3,000 - ₹5,000</button>
            <button type="button" onclick="setPricePreset(5000, '')">₹5,000+</button>
          </div>
        </details>

        <!-- Stone Colour Filter -->
        <details open>
          <summary>Stone Colour / Gem</summary>
          <div class="opts">
            ${stones.map(st => `
              <label class="ck">
                <input type="checkbox" name="stone" value="${st.key}" ${filters.stone.includes(st.key) ? 'checked' : ''} onchange="handleFilterChange()" />
                <i style="background:${st.color}"></i>
                <span>${st.label}</span>
              </label>
            `).join('')}
          </div>
        </details>

        <!-- Occasion Filter -->
        <details ${filters.occasion.length ? 'open' : ''}>
          <summary>Occasion</summary>
          <div class="opts">
            ${occasions.map(o => `
              <label class="ck">
                <input type="checkbox" name="occasion" value="${o}" ${filters.occasion.includes(o) ? 'checked' : ''} onchange="handleFilterChange()" />
                <span>${o}</span>
              </label>
            `).join('')}
          </div>
        </details>

        <!-- Discount Filter -->
        <details ${filters.discount ? 'open' : ''}>
          <summary>Discount</summary>
          <div class="opts">
            <label class="ck">
              <input type="radio" name="discount" value="" ${!filters.discount ? 'checked' : ''} onchange="handleFilterChange()" />
              <span>Any discount</span>
            </label>
            <label class="ck">
              <input type="radio" name="discount" value="10" ${filters.discount === '10' ? 'checked' : ''} onchange="handleFilterChange()" />
              <span>10% or more</span>
            </label>
            <label class="ck">
              <input type="radio" name="discount" value="20" ${filters.discount === '20' ? 'checked' : ''} onchange="handleFilterChange()" />
              <span>20% or more</span>
            </label>
            <label class="ck">
              <input type="radio" name="discount" value="30" ${filters.discount === '30' ? 'checked' : ''} onchange="handleFilterChange()" />
              <span>30% or more</span>
            </label>
          </div>
        </details>
      </div>

      <!-- Mobile Bottom Sheet Apply Button -->
      <div class="ff">
        <button type="button" class="btn solid block" onclick="closeFilterPanel()">
          Show ${resultCount} piece${resultCount === 1 ? '' : 's'}
        </button>
      </div>
    </form>
  `;
}

function renderActiveChips(filters) {
  const container = document.getElementById('active-chips-container');
  if (!container) return;

  const chips = [];

  filters.category.forEach(c => chips.push({ label: c, key: 'category', value: c }));
  filters.stone.forEach(s => chips.push({ label: `Stone: ${s}`, key: 'stone', value: s }));
  filters.occasion.forEach(o => chips.push({ label: o, key: 'occasion', value: o }));

  if (filters.minPrice || filters.maxPrice) {
    const minStr = filters.minPrice ? formatCurrency(filters.minPrice) : '₹0';
    const maxStr = filters.maxPrice ? formatCurrency(filters.maxPrice) : 'Above';
    chips.push({ label: `${minStr} - ${maxStr}`, key: 'price' });
  }

  if (filters.discount) chips.push({ label: `${filters.discount}%+ Off`, key: 'discount' });
  if (filters.search) chips.push({ label: `"${filters.search}"`, key: 'search' });
  if (filters.tag) chips.push({ label: `${filters.tag} Sets`, key: 'tag' });

  if (chips.length === 0) {
    container.style.display = 'none';
    container.innerHTML = '';
    return;
  }

  container.style.display = 'flex';
  container.innerHTML = `
    ${chips.map(chip => `
      <span class="fchip">
        ${chip.label}
        <button type="button" onclick="removeFilterChip('${chip.key}', '${chip.value || ''}')" style="background:none;border:0;color:inherit;cursor:pointer;padding:0;">${ic('close', 14)}</button>
      </span>
    `).join('')}
    <button type="button" class="btn ghost sm" onclick="clearAllFilters()" style="margin-left:6px">Clear All</button>
  `;
}

window.handleFilterChange = function() {
  const form = document.getElementById('filterForm');
  if (!form) return;

  const getChecked = (name) => Array.from(form.querySelectorAll(`input[name="${name}"]:checked`)).map(i => i.value);

  const categories = getChecked('category');
  const stones = getChecked('stone');
  const occasions = getChecked('occasion');
  const discountRadio = form.querySelector('input[name="discount"]:checked');
  const discount = discountRadio ? discountRadio.value : '';
  const minPrice = form.querySelector('input[name="minPrice"]').value;
  const maxPrice = form.querySelector('input[name="maxPrice"]').value;

  updateUrlQueryParams({
    category: categories.join(','),
    stone: stones.join(','),
    occasion: occasions.join(','),
    discount,
    minPrice,
    maxPrice
  });

  renderCatalogPage(KC.products);
};

window.setPricePreset = function(min, max) {
  const form = document.getElementById('filterForm');
  if (form) {
    form.querySelector('input[name="minPrice"]').value = min || '';
    form.querySelector('input[name="maxPrice"]').value = max || '';
    handleFilterChange();
  }
};

window.removeFilterChip = function(key, value) {
  const current = parseQueryParams();
  if (key === 'category') current.category = current.category.filter(c => c !== value);
  else if (key === 'stone') current.stone = current.stone.filter(s => s !== value);
  else if (key === 'occasion') current.occasion = current.occasion.filter(o => o !== value);
  else if (key === 'price') { current.minPrice = ''; current.maxPrice = ''; }
  else if (key === 'discount') current.discount = '';
  else if (key === 'search') current.search = '';
  else if (key === 'tag') current.tag = '';

  updateUrlQueryParams({
    category: current.category.join(','),
    stone: current.stone.join(','),
    occasion: current.occasion.join(','),
    discount: current.discount,
    minPrice: current.minPrice,
    maxPrice: current.maxPrice,
    q: current.search,
    tag: current.tag
  });

  renderCatalogPage(KC.products);
};

window.clearAllFilters = function() {
  const url = new URL(window.location);
  url.search = '';
  window.history.pushState({}, '', url);
  renderCatalogPage(KC.products);
};

window.handleSortChange = function(sortValue) {
  updateUrlQueryParams({ sort: sortValue });
  renderCatalogPage(KC.products);
};

function updateUrlQueryParams(newParams) {
  const url = new URL(window.location);
  Object.entries(newParams).forEach(([k, v]) => {
    if (v) url.searchParams.set(k, v);
    else url.searchParams.delete(k);
  });
  window.history.pushState({}, '', url);
}

window.openFilterPanel = function() {
  const panel = document.getElementById('fpanel');
  if (panel) panel.classList.add('open');
};

window.closeFilterPanel = function() {
  const panel = document.getElementById('fpanel');
  if (panel) panel.classList.remove('open');
};

window.initProductsPage = initProductsPage;
