// Rangmudra admin SPA — vanilla ES6 module.

const TOKEN_KEY = 'rangmudra_admin_token';
// Origin of the backend API (set in config.js). Empty = same origin as this page.
const API_BASE = ((typeof window !== 'undefined' && window.RANGMUDRA_API_BASE) || '').replace(/\/$/, '');
const apiUrl = (path) => API_BASE + path;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const state = {
  token: localStorage.getItem(TOKEN_KEY) || '',
  email: '',
  tab: 'products',
  products: [],
  workshops: [],
  blogs: [],
  sections: null,
  admins: [],
  discounts: [],
  orders: [],
  orderStatusFilter: 'all',
  gallery: [],
  gallerySearch: '',
  workshopCategoryFilter: 'all',
  productSearch: '',
  productCategoryFilter: 'all',
  productPrintFilter: 'all',
  // Server-side upload ceiling, refreshed from /api/admin/ping so the client can
  // reject an oversized file before spending minutes sending it.
  maxUploadMB: 100,
};

// ---------- HTTP ----------

async function api(method, path, body, isFormData = false) {
  const headers = { 'X-Admin-Token': state.token };
  let payload;
  if (body && !isFormData) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  } else if (isFormData) {
    payload = body;
  }
  const res = await fetch(apiUrl(path), { method, headers, body: payload });
  if (res.status === 401) {
    state.token = '';
    localStorage.removeItem(TOKEN_KEY);
    showLogin();
    throw new Error('Session expired');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ---------- Auth ----------

function showLogin() {
  $('#login-screen').hidden = false;
  $('#app-shell').hidden = true;
  setTimeout(() => $('#login-passcode')?.focus(), 0);
}

function showApp() {
  $('#login-screen').hidden = true;
  $('#app-shell').hidden = false;
  const who = $('#current-admin');
  if (who) {
    who.textContent = state.email ? `Signed in as ${state.email}` : '';
    who.hidden = !state.email;
  }
  loadAll();
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('#login-email').value.trim();
  const password = $('#login-password').value;
  const err = $('#login-error');
  err.hidden = true;
  try {
    const res = await fetch(apiUrl('/api/admin/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    state.token = data.token;
    state.email = data.email || email;
    localStorage.setItem(TOKEN_KEY, state.token);
    showApp();
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
  }
});

$('#logout-btn').addEventListener('click', async () => {
  try { await api('POST', '/api/admin/logout'); } catch (_) {}
  state.token = '';
  localStorage.removeItem(TOKEN_KEY);
  showLogin();
});

// ---------- Tabs ----------

$$('.admin-tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.tab = btn.dataset.tab;
    $$('.admin-tab').forEach((b) => b.setAttribute('aria-selected', b === btn ? 'true' : 'false'));
    $$('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== state.tab; });
  });
});

// ---------- Data load ----------

async function loadAll() {
  try {
    const [products, workshops, blogs, sections] = await Promise.all([
      fetch(apiUrl('/api/products')).then((r) => r.json()),
      fetch(apiUrl('/api/workshops')).then((r) => r.json()),
      fetch(apiUrl('/api/blogs')).then((r) => r.json()),
      fetch(apiUrl('/api/sections')).then((r) => r.json()),
    ]);
    state.products = products;
    state.workshops = workshops;
    state.blogs = blogs;
    state.sections = sections;
    renderProducts();
    renderWorkshops();
    renderBlogs();
    renderSections();
    loadAdmins();
    loadSale();
    loadDiscounts();
    loadOrders();
    loadGallery();
  } catch (e) {
    toast(e.message, true);
  }
}

// ---------- Products ----------

function renderProducts() {
  const grid = $('#products-grid');
  grid.innerHTML = '';
  if (!state.products.length) {
    grid.innerHTML = emptyState('No products yet. Click <strong>+ New product</strong> to add one.');
    return;
  }
  const q = state.productSearch.trim().toLowerCase();
  const filtered = state.products.filter((p) => {
    if (state.productCategoryFilter !== 'all' && p.category !== state.productCategoryFilter) return false;
    if (state.productPrintFilter !== 'all' && p.printType !== state.productPrintFilter) return false;
    if (q) {
      const hay = `${p.name || ''} ${p.category || ''} ${p.printType || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  if (!filtered.length) {
    grid.innerHTML = emptyState('No products match your search or filters.');
    return;
  }
  filtered.forEach((p) => {
    const card = document.createElement('div');
    card.className = 'card';
    const img = p.images && p.images[0];
    const disc = (p.discount && Number(p.discount.value) > 0) ? p.discount : null;
    const price = Number(p.price) || 0;
    const now = disc
      ? Math.max(0, disc.type === 'flat' ? price - disc.value : Math.round(price * (1 - disc.value / 100)))
      : price;
    const discLabel = disc ? (disc.type === 'flat' ? `₹${disc.value} off` : `${disc.value}% off`) : '';
    const priceHtml = disc
      ? `<span class="card__price-was">₹${price.toLocaleString('en-IN')}</span> ₹${now.toLocaleString('en-IN')}`
      : `₹${price.toLocaleString('en-IN')}`;
    card.innerHTML = `
      <div class="card__img" ${img ? `style="background-image:url('${img}')"` : ''}>
        ${p.featured ? '<span class="card__tag">Featured</span>' : ''}
        ${disc ? `<span class="card__tag card__tag--sale">${discLabel}</span>` : ''}
      </div>
      <div class="card__body">
        <h3 class="card__title">${escapeHtml(p.name)}</h3>
        <p class="card__meta">${escapeHtml(p.category)} · ${escapeHtml(p.printType || '')}</p>
        <p class="card__price">${priceHtml}</p>
      </div>
      <div class="card__actions">
        <button class="btn btn--ghost btn--sm" data-action="edit-product" data-id="${p.id}">Edit</button>
        <button class="btn btn--danger btn--sm" data-action="delete-product" data-id="${p.id}">Delete</button>
      </div>
    `;
    grid.appendChild(card);
  });
}

$('#products-grid').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.action === 'edit-product') openProductModal(state.products.find((p) => p.id === id));
  if (btn.dataset.action === 'delete-product') confirmDeleteProduct(id);
});

$('#add-product-btn').addEventListener('click', () => openProductModal(null));

$('#products-search').addEventListener('input', (e) => {
  state.productSearch = e.target.value;
  renderProducts();
});

$('#product-category-filter').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  state.productCategoryFilter = chip.dataset.cat;
  $$('#product-category-filter .chip').forEach((c) => c.classList.toggle('active', c === chip));
  renderProducts();
});

$('#product-print-filter').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  state.productPrintFilter = chip.dataset.print;
  $$('#product-print-filter .chip').forEach((c) => c.classList.toggle('active', c === chip));
  renderProducts();
});

function openProductModal(product) {
  const isEdit = !!product;
  const p = product || {
    name: '', slug: '', category: "Women's Wear", tags: [], price: 0,
    sizes: ['One Size'], printType: 'Block Printed', featured: false,
    available: true, images: [], description: '', features: [],
    measurements: '', care: '',
  };
  const disc = (p.discount && Number(p.discount.value) > 0) ? p.discount : null;
  const discType = disc ? (disc.type === 'flat' ? 'flat' : 'percent') : 'none';
  const discValue = disc ? disc.value : '';
  openModal(isEdit ? `Edit ${p.name}` : 'New product', `
    <form id="product-form" class="form-grid" autocomplete="off">
      <div id="product-media"></div>
      <div class="field-row">
        <label class="field">
          <span class="field__label">Name</span>
          <input name="name" required value="${escapeAttr(p.name)}">
        </label>
        <label class="field">
          <span class="field__label">Slug</span>
          <input name="slug" required ${isEdit ? 'readonly' : ''} value="${escapeAttr(p.slug)}" pattern="[a-z0-9-]+">
        </label>
      </div>
      <div class="field-row">
        <label class="field">
          <span class="field__label">Category</span>
          <select name="category">
            ${['Women\'s Wear', 'Men\'s Wear', 'Home Decor', 'Accessories'].map((c) =>
              `<option ${c === p.category ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
        </label>
        <label class="field">
          <span class="field__label">Print type</span>
          <select name="printType">
            ${['Block Printed', 'Eco Printed'].map((c) =>
              `<option ${c === p.printType ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
        </label>
      </div>
      <div class="field-row">
        <label class="field">
          <span class="field__label">Price (₹)</span>
          <input name="price" type="number" min="0" value="${p.price || 0}">
        </label>
        <label class="field">
          <span class="field__label">Sizes (comma-separated)</span>
          <input name="sizes" value="${escapeAttr((p.sizes || []).join(', '))}">
        </label>
      </div>
      <div class="field-row">
        <label class="field">
          <span class="field__label">Discount</span>
          <select name="discountType">
            ${[['none', 'No discount'], ['percent', 'Percentage (% off)'], ['flat', 'Flat (₹ off)']].map(([v, l]) =>
              `<option value="${v}" ${v === discType ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </label>
        <label class="field">
          <span class="field__label">Discount amount</span>
          <input name="discountValue" type="number" min="0" value="${discValue}" placeholder="e.g. 20% or 500 flat">
        </label>
      </div>
      <p class="field__hint">A product's own discount takes priority over any store-wide sale — the sale won't apply on top of it.</p>
      <label class="field">
        <span class="field__label">Tags (comma-separated, e.g. INDIGO, TOPWEAR)</span>
        <input name="tags" value="${escapeAttr((p.tags || []).join(', '))}">
      </label>
      <label class="field">
        <span class="field__label">Description</span>
        <textarea name="description">${escapeHtml(p.description || '')}</textarea>
      </label>
      <label class="field">
        <span class="field__label">Features (one per line)</span>
        <textarea name="features">${escapeHtml((p.features || []).join('\n'))}</textarea>
      </label>
      <div class="field-row">
        <label class="field">
          <span class="field__label">Measurements</span>
          <input name="measurements" value="${escapeAttr(p.measurements || '')}">
        </label>
        <label class="field">
          <span class="field__label">Care</span>
          <input name="care" value="${escapeAttr(p.care || '')}">
        </label>
      </div>
      <div class="checkbox-row">
        <input type="checkbox" id="p-featured" name="featured" ${p.featured ? 'checked' : ''}>
        <label for="p-featured">Featured product</label>
      </div>
      <div class="checkbox-row">
        <input type="checkbox" id="p-available" name="available" ${p.available !== false ? 'checked' : ''}>
        <label for="p-available">Available for purchase</label>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn--ghost" data-modal-close>Cancel</button>
        <button type="submit" class="btn btn--primary">${isEdit ? 'Save changes' : 'Create product'}</button>
      </div>
    </form>
  `);

  const mediaEditor = mountMediaEditor($('#product-media'), entityMedia(p, 'images'), {
    label: 'Photos & videos',
    hint: 'The first item is the primary photo — it is what shows on the shop card and in the cart. Reorder with ↑ ↓. Use Crop / position to fit an oversized photo to the frame.',
  });

  $('#product-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const slug = (fd.get('slug') || '').toString().trim().toLowerCase();
    const payload = {
      name: fd.get('name').toString().trim(),
      slug,
      category: fd.get('category'),
      printType: fd.get('printType'),
      price: Number(fd.get('price')),
      sizes: splitCSV(fd.get('sizes')),
      tags: splitCSV(fd.get('tags')).map((t) => t.toUpperCase()),
      description: fd.get('description'),
      features: (fd.get('features') || '').toString().split('\n').map((s) => s.trim()).filter(Boolean),
      measurements: fd.get('measurements'),
      care: fd.get('care'),
      featured: fd.get('featured') === 'on',
      available: fd.get('available') === 'on',
      // Per-product discount: null clears it (percent OR flat ₹ off). The server
      // re-validates and clamps this; sending null on edit removes any discount.
      discount: (() => {
        const t = fd.get('discountType');
        const v = Number(fd.get('discountValue'));
        return (t === 'percent' || t === 'flat') && v > 0 ? { type: t, value: v } : null;
      })(),
      // The full ordered gallery. The server derives `images` from it, so the
      // two fields can't drift apart.
      media: mediaEditor.getValue(),
    };
    try {
      if (isEdit) {
        await api('PUT', `/api/admin/products/${product.id}`, payload);
        toast('Product updated');
      } else {
        await api('POST', '/api/admin/products', payload);
        toast('Product created');
      }
      closeModal();
      loadAll();
    } catch (err) {
      toast(err.message, true);
    }
  });
}

async function confirmDeleteProduct(id) {
  if (!confirm('Delete this product? This cannot be undone.')) return;
  try {
    await api('DELETE', `/api/admin/products/${id}`);
    toast('Product deleted');
    loadAll();
  } catch (e) { toast(e.message, true); }
}

// ---------- Workshops ----------

function renderWorkshops() {
  const grid = $('#workshops-grid');
  grid.innerHTML = '';
  const filtered = state.workshopCategoryFilter === 'all'
    ? state.workshops
    : state.workshops.filter((w) => w.category === state.workshopCategoryFilter);
  if (!filtered.length) {
    grid.innerHTML = emptyState('No workshops in this category yet.');
    return;
  }
  filtered.forEach((w) => {
    const card = document.createElement('div');
    card.className = 'card';
    const price = w.price != null
      ? `₹${w.price.toLocaleString('en-IN')} ${w.priceUnit || ''}`
      : (w.priceLabel || '');
    card.innerHTML = `
      <div class="card__img" ${w.image ? `style="background-image:url('${w.image}')"` : ''}>
        <span class="card__tag">${escapeHtml(w.categoryLabel || w.category)}</span>
      </div>
      <div class="card__body">
        <h3 class="card__title">${escapeHtml(w.title)}</h3>
        <p class="card__meta">${escapeHtml(w.level || '')} · ${escapeHtml(w.duration || '')}</p>
        <p class="card__price">${escapeHtml(price)}</p>
      </div>
      <div class="card__actions">
        <button class="btn btn--ghost btn--sm" data-action="edit-workshop" data-id="${w.id}">Edit</button>
        <button class="btn btn--danger btn--sm" data-action="delete-workshop" data-id="${w.id}">Delete</button>
      </div>
    `;
    grid.appendChild(card);
  });
}

$('#workshops-grid').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.action === 'edit-workshop') openWorkshopModal(state.workshops.find((w) => w.id === id));
  if (btn.dataset.action === 'delete-workshop') confirmDeleteWorkshop(id);
});

$('#workshop-category-filter').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  state.workshopCategoryFilter = chip.dataset.cat;
  $$('#workshop-category-filter .chip').forEach((c) => c.classList.toggle('active', c === chip));
  renderWorkshops();
});

$('#add-workshop-btn').addEventListener('click', () => openWorkshopModal(null));

function openWorkshopModal(workshop) {
  const isEdit = !!workshop;
  const w = workshop || {
    title: '', slug: '', category: 'experience', level: 'Beginner',
    description: '', duration: '', packageFor: '', tags: [],
    price: null, priceUnit: 'per person', priceLabel: '',
    seatsBooked: 0, totalSeats: 0, image: '', includes: [], idealFor: [],
  };
  const hasPrice = w.price != null && w.price !== '';
  openModal(isEdit ? `Edit ${w.title}` : 'New workshop', `
    <form id="workshop-form" class="form-grid" autocomplete="off">
      <div id="workshop-media"></div>
      <div class="field-row">
        <label class="field">
          <span class="field__label">Title</span>
          <input name="title" required value="${escapeAttr(w.title)}">
        </label>
        <label class="field">
          <span class="field__label">Slug</span>
          <input name="slug" required ${isEdit ? 'readonly' : ''} value="${escapeAttr(w.slug)}" pattern="[a-z0-9-]+">
        </label>
      </div>
      <div class="field-row">
        <label class="field">
          <span class="field__label">Category</span>
          <select name="category">
            ${[['experience', 'Experience'], ['corporate', 'Corporate'], ['curated', 'Curated']].map(([v, l]) =>
              `<option value="${v}" ${v === w.category ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </label>
        <label class="field">
          <span class="field__label">Level</span>
          <input name="level" value="${escapeAttr(w.level || '')}" placeholder="Beginner / All Levels / Advanced">
        </label>
      </div>
      <label class="field">
        <span class="field__label">Description</span>
        <textarea name="description" required>${escapeHtml(w.description)}</textarea>
      </label>
      <div class="field-row">
        <label class="field">
          <span class="field__label">Duration</span>
          <input name="duration" value="${escapeAttr(w.duration || '')}" placeholder="e.g. 2 hrs">
        </label>
        <label class="field">
          <span class="field__label">Package for</span>
          <input name="packageFor" value="${escapeAttr(w.packageFor || '')}" placeholder="e.g. Package for 25 people">
        </label>
      </div>
      <label class="field">
        <span class="field__label">Tags (comma-separated)</span>
        <input name="tags" value="${escapeAttr((w.tags || []).join(', '))}">
      </label>
      <div class="field-row">
        <label class="field">
          <span class="field__label">Seats booked</span>
          <input name="seatsBooked" type="number" min="0" value="${w.seatsBooked || 0}">
        </label>
        <label class="field">
          <span class="field__label">Total seats</span>
          <input name="totalSeats" type="number" min="0" value="${w.totalSeats || 0}">
        </label>
      </div>
      <fieldset class="field" style="border:1px solid rgba(44,26,16,0.1); padding:16px; border-radius:8px;">
        <span class="field__label" style="margin-bottom:12px;">Pricing</span>
        <div class="checkbox-row" style="margin-bottom:12px;">
          <input type="radio" id="price-mode-numeric" name="priceMode" value="numeric" ${hasPrice ? 'checked' : ''}>
          <label for="price-mode-numeric">Show numeric price</label>
        </div>
        <div class="field-row" style="margin-bottom:16px;">
          <label class="field">
            <span class="field__label">Price (₹)</span>
            <input name="price" type="number" min="0" value="${hasPrice ? w.price : ''}">
          </label>
          <label class="field">
            <span class="field__label">Per</span>
            <input name="priceUnit" value="${escapeAttr(w.priceUnit || 'per person')}">
          </label>
        </div>
        <div class="checkbox-row" style="margin-bottom:12px;">
          <input type="radio" id="price-mode-label" name="priceMode" value="label" ${!hasPrice ? 'checked' : ''}>
          <label for="price-mode-label">Show a custom label instead</label>
        </div>
        <label class="field">
          <span class="field__label">Price label</span>
          <input name="priceLabel" value="${escapeAttr(w.priceLabel || 'Contact for pricing')}">
        </label>
      </fieldset>
      <label class="field">
        <span class="field__label">"What the experience includes" (one per line) — corporate / curated only</span>
        <textarea name="includes">${escapeHtml((w.includes || []).join('\n'))}</textarea>
      </label>
      <label class="field">
        <span class="field__label">"Ideal for" (one per line) — corporate / curated only</span>
        <textarea name="idealFor">${escapeHtml((w.idealFor || []).join('\n'))}</textarea>
      </label>
      <div id="workshop-gallery-media"></div>
      <div class="form-actions">
        <button type="button" class="btn btn--ghost" data-modal-close>Cancel</button>
        <button type="submit" class="btn btn--primary">${isEdit ? 'Save changes' : 'Create workshop'}</button>
      </div>
    </form>
  `);

  const wsMedia = mountMediaEditor($('#workshop-media'), entityMedia(w, 'image'), {
    label: 'Photos & videos',
    hint: 'The first item is the hero and the card image; a second one fills the wide banner on the detail page.',
  });
  const wsGallery = mountMediaEditor($('#workshop-gallery-media'), w.gallery, {
    label: 'Photo gallery (mosaic)',
    hint: 'Shown as a mosaic wall on the workshop detail page — this is where corporate session photos go. Leave empty to hide the section.',
  });

  $('#workshop-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const slug = (fd.get('slug') || '').toString().trim().toLowerCase();
    const priceMode = fd.get('priceMode');
    const payload = {
      title: fd.get('title').toString().trim(),
      slug,
      category: fd.get('category'),
      level: fd.get('level'),
      description: fd.get('description'),
      duration: fd.get('duration'),
      packageFor: fd.get('packageFor'),
      tags: splitCSV(fd.get('tags')),
      seatsBooked: Number(fd.get('seatsBooked')) || 0,
      totalSeats: Number(fd.get('totalSeats')) || 0,
      media: wsMedia.getValue(),
      gallery: wsGallery.getValue(),
      includes: (fd.get('includes') || '').toString().split('\n').map((s) => s.trim()).filter(Boolean),
      idealFor: (fd.get('idealFor') || '').toString().split('\n').map((s) => s.trim()).filter(Boolean),
    };
    if (priceMode === 'numeric') {
      payload.price = Number(fd.get('price'));
      payload.priceUnit = fd.get('priceUnit') || 'per person';
    } else {
      payload.priceLabel = fd.get('priceLabel') || 'Contact for pricing';
    }
    try {
      if (isEdit) {
        await api('PUT', `/api/admin/workshops/${workshop.id}`, payload);
        toast('Workshop updated');
      } else {
        await api('POST', '/api/admin/workshops', payload);
        toast('Workshop created');
      }
      closeModal();
      loadAll();
    } catch (err) {
      toast(err.message, true);
    }
  });
}

async function confirmDeleteWorkshop(id) {
  if (!confirm('Delete this workshop? This cannot be undone.')) return;
  try {
    await api('DELETE', `/api/admin/workshops/${id}`);
    toast('Workshop deleted');
    loadAll();
  } catch (e) { toast(e.message, true); }
}

// ---------- Blogs ----------

// The public blog template renders an array of typed content blocks. In the
// editor we expose that array as plain text using a tiny convention so writing
// a post feels like writing prose, not filling JSON:
//   "## Heading"        → { type: 'h', text }
//   "- list item"       → grouped into { type: 'ul', items: [...] }
//   "![alt | caption](url)" → { type: 'img', src, alt, caption }
//   any other line      → { type: 'p', text }
// Blocks are separated by blank lines.
const IMG_LINE = /^!\[(.*?)\]\((.*?)\)$/;

function contentToText(content) {
  return (content || []).map((block) => {
    if (block.type === 'h') return `## ${block.text}`;
    if (block.type === 'ul') return (block.items || []).map((i) => `- ${i}`).join('\n');
    if (block.type === 'img') {
      const label = [block.alt, block.caption].filter(Boolean).join(' | ');
      return `![${label}](${block.src || ''})`;
    }
    return block.text || '';
  }).join('\n\n');
}

function textToContent(text) {
  const blocks = [];
  let list = null;
  const flushList = () => { if (list && list.items.length) blocks.push(list); list = null; };
  (text || '').split('\n').forEach((raw) => {
    const line = raw.trim();
    if (!line) { flushList(); return; }
    const imgMatch = line.match(IMG_LINE);
    if (line.startsWith('## ')) {
      flushList();
      blocks.push({ type: 'h', text: line.slice(3).trim() });
    } else if (imgMatch) {
      flushList();
      const [, label, src] = imgMatch;
      const [alt, caption] = label.split('|').map((s) => s.trim());
      const img = { type: 'img', src: src.trim() };
      if (alt) img.alt = alt;
      if (caption) img.caption = caption;
      if (img.src) blocks.push(img);
    } else if (line.startsWith('- ')) {
      if (!list) list = { type: 'ul', items: [] };
      list.items.push(line.slice(2).trim());
    } else {
      flushList();
      blocks.push({ type: 'p', text: line });
    }
  });
  flushList();
  return blocks;
}

function renderBlogs() {
  const grid = $('#blogs-grid');
  grid.innerHTML = '';
  if (!state.blogs.length) {
    grid.innerHTML = emptyState('No blogs yet. Click <strong>+ New blog</strong> to write one.');
    return;
  }
  state.blogs.forEach((b) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="card__img" ${b.image ? `style="background-image:url('${b.image}')"` : ''}>
        ${b.featured ? '<span class="card__tag">Featured</span>' : ''}
      </div>
      <div class="card__body">
        <h3 class="card__title">${escapeHtml(b.title)}</h3>
        <p class="card__meta">${escapeHtml(b.category || '')} · ${escapeHtml(b.date || '')}</p>
        <p class="card__price" style="font-size:13px;color:var(--sc-l3);font-weight:400;">${escapeHtml(b.author || '')} · ${escapeHtml(b.readTime || '')}</p>
      </div>
      <div class="card__actions">
        <button class="btn btn--ghost btn--sm" data-action="edit-blog" data-id="${b.id}">Edit</button>
        <button class="btn btn--danger btn--sm" data-action="delete-blog" data-id="${b.id}">Delete</button>
      </div>
    `;
    grid.appendChild(card);
  });
}

$('#blogs-grid').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.action === 'edit-blog') openBlogModal(state.blogs.find((b) => b.id === id));
  if (btn.dataset.action === 'delete-blog') confirmDeleteBlog(id);
});

$('#add-blog-btn').addEventListener('click', () => openBlogModal(null));

function openBlogModal(blog) {
  const isEdit = !!blog;
  const b = blog || {
    title: '', slug: '', excerpt: '', author: 'Rangmudra Studio',
    readTime: '', date: new Date().toISOString().slice(0, 10),
    category: '', image: '', featured: false, content: [],
  };
  openModal(isEdit ? `Edit ${b.title}` : 'New blog', `
    <form id="blog-form" class="form-grid" autocomplete="off">
      <div class="upload" data-upload="blog-image">
        <div class="upload__preview" style="${b.image ? `background-image:url('${b.image}')` : ''}">${b.image ? '' : 'No image'}</div>
        <div class="upload__btns">
          <button type="button" class="btn btn--ghost btn--sm" data-upload-trigger>Upload image</button>
          <button type="button" class="btn btn--ghost btn--sm" data-upload-pick>Choose from gallery</button>
          ${b.image ? '<button type="button" class="btn btn--danger btn--sm" data-upload-clear>Clear</button>' : ''}
        </div>
        <input type="file" accept="image/*" class="upload__input">
        <input type="hidden" name="image" value="${b.image || ''}">
      </div>
      <div class="field-row">
        <label class="field">
          <span class="field__label">Title</span>
          <input name="title" required value="${escapeAttr(b.title)}">
        </label>
        <label class="field">
          <span class="field__label">Slug</span>
          <input name="slug" required ${isEdit ? 'readonly' : ''} value="${escapeAttr(b.slug)}" pattern="[a-z0-9-]+">
        </label>
      </div>
      <div class="field-row">
        <label class="field">
          <span class="field__label">Category</span>
          <input name="category" value="${escapeAttr(b.category || '')}" placeholder="e.g. Eco Printing">
        </label>
        <label class="field">
          <span class="field__label">Author</span>
          <input name="author" value="${escapeAttr(b.author || '')}">
        </label>
      </div>
      <div class="field-row">
        <label class="field">
          <span class="field__label">Date</span>
          <input name="date" type="date" value="${escapeAttr(b.date || '')}">
        </label>
        <label class="field">
          <span class="field__label">Read time</span>
          <input name="readTime" value="${escapeAttr(b.readTime || '')}" placeholder="e.g. 5 min read">
        </label>
      </div>
      <label class="field">
        <span class="field__label">Excerpt</span>
        <textarea name="excerpt">${escapeHtml(b.excerpt || '')}</textarea>
      </label>
      <label class="field">
        <span class="field__label">Content</span>
        <p class="field__hint">One block per blank-line-separated chunk. Start a line with <code>## </code> for a heading or <code>- </code> for a bullet; everything else is a paragraph. Images sit on their own line as <code>![alt | caption](url)</code>.</p>
        <div class="upload__btns" style="margin-bottom:8px;">
          <button type="button" class="btn btn--ghost btn--sm" data-insert-image>+ Insert image</button>
        </div>
        <textarea name="content" id="blog-content" rows="14" style="min-height:240px;">${escapeHtml(contentToText(b.content))}</textarea>
      </label>
      <div class="checkbox-row">
        <input type="checkbox" id="b-featured" name="featured" ${b.featured ? 'checked' : ''}>
        <label for="b-featured">Featured (highlighted in Quick Reads)</label>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn--ghost" data-modal-close>Cancel</button>
        <button type="submit" class="btn btn--primary">${isEdit ? 'Save changes' : 'Create blog'}</button>
      </div>
    </form>
  `);

  wireUpload('[data-upload="blog-image"]');

  // Upload an image and drop a markdown image block at the textarea cursor.
  $('[data-insert-image]')?.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      try {
        const url = await uploadFile(file);
        insertContentBlock(`![ | ](${url})`);
        toast('Image inserted — add alt text and an optional caption');
      } catch (err) { toast(err.message, true); }
    };
    input.click();
  });

  $('#blog-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const slug = (fd.get('slug') || '').toString().trim().toLowerCase();
    const payload = {
      title: fd.get('title').toString().trim(),
      slug,
      category: fd.get('category'),
      author: fd.get('author'),
      date: fd.get('date'),
      readTime: fd.get('readTime'),
      excerpt: fd.get('excerpt'),
      image: fd.get('image'),
      featured: fd.get('featured') === 'on',
      content: textToContent(fd.get('content')),
    };
    try {
      if (isEdit) {
        await api('PUT', `/api/admin/blogs/${blog.id}`, payload);
        toast('Blog updated');
      } else {
        await api('POST', '/api/admin/blogs', payload);
        toast('Blog created');
      }
      closeModal();
      loadAll();
    } catch (err) {
      toast(err.message, true);
    }
  });
}

// Insert `snippet` as its own block at the cursor in the content textarea,
// padding it with blank lines so it parses as a standalone block.
function insertContentBlock(snippet) {
  const ta = $('#blog-content');
  if (!ta) return;
  const start = ta.selectionStart ?? ta.value.length;
  const before = ta.value.slice(0, start);
  const after = ta.value.slice(ta.selectionEnd ?? start);
  const lead = before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : '';
  const trail = after && !after.startsWith('\n\n') ? (after.startsWith('\n') ? '\n' : '\n\n') : '';
  ta.value = before + lead + snippet + trail + after;
  const caret = (before + lead + snippet).length;
  ta.focus();
  ta.setSelectionRange(caret, caret);
}

async function confirmDeleteBlog(id) {
  if (!confirm('Delete this blog? This cannot be undone.')) return;
  try {
    await api('DELETE', `/api/admin/blogs/${id}`);
    toast('Blog deleted');
    loadAll();
  } catch (e) { toast(e.message, true); }
}

// ---------- Sections ----------

const SECTION_LABELS = {
  homepage: {
    _title: 'Homepage',
    hero: 'Hero (full-bleed background)',
    introduction: 'Introduction still-life',
    'workshops-promo': 'Workshops promo banner',
    'shop-promo': 'Shop promo banner',
    testimonials: 'Testimonials backdrop',
    gallery: 'Gallery of experience',
    'quick-reads-large': 'Quick Reads — large card',
    'quick-reads-1': 'Quick Reads — thumb 1',
    'quick-reads-2': 'Quick Reads — thumb 2',
  },
  about: {
    _title: 'About page',
    hero: 'Hero block image',
    story: 'Our Story',
    sustainability: 'Sustainability',
    'team-hero': 'Our Team — primary',
    'team-secondary': 'Our Team — secondary',
    'faq-decor': 'FAQ decorative',
  },
  workshops: {
    _title: 'Workshops landing',
    hero: 'Hero band',
    'category-experience': 'Category card — Experience',
    'category-corporate': 'Category card — Corporate',
    'category-curated': 'Category card — Curated',
  },
  shop: {
    _title: 'Shop',
    hero: 'Shop hero (hanging fabrics)',
  },
  enquire: {
    _title: 'Enquire',
    hero: 'Enquire hero',
    'carousel-1': 'Artistic Experience slide 1',
    'carousel-2': 'Artistic Experience slide 2',
    'carousel-3': 'Artistic Experience slide 3',
  },
};

function renderSections() {
  const container = $('#sections-list');
  container.innerHTML = '';
  Object.entries(SECTION_LABELS).forEach(([pageKey, labels]) => {
    if (!state.sections[pageKey]) return;
    const group = document.createElement('div');
    group.className = 'section-group';
    const slotsHtml = Object.entries(labels)
      .filter(([k]) => k !== '_title')
      .map(([slotKey, slotLabel]) => {
        // A slot value is a media entry; records saved before the media model
        // are bare URL strings, which normalizeMedia() upgrades on read.
        const m = normalizeMedia(state.sections[pageKey][slotKey]);
        const preview = m
          ? mediaThumbHTML(m, 'slot__media')
          : '<span class="slot__empty">Not set</span>';
        return `
          <div class="slot">
            <div class="slot__preview">${preview}</div>
            <div class="slot__body">
              <p class="slot__name">${slotLabel}</p>
              <p class="slot__meta">${m ? `${m.type === 'video' ? 'Video' : 'Photo'} · ${m.fit === 'contain' ? 'Fit whole frame' : 'Fill frame'} · ${escapeHtml(m.position)}` : '—'}</p>
              <p class="slot__path">${m ? escapeHtml(m.url) : '(not set)'}</p>
            </div>
            <div class="slot__actions">
              <button class="btn btn--gold btn--sm btn--block" data-action="replace-section" data-page="${pageKey}" data-slot="${slotKey}">Replace photo / video</button>
              <button class="btn btn--ghost btn--sm btn--block" data-action="pick-section" data-page="${pageKey}" data-slot="${slotKey}">Choose from library</button>
              ${m && m.type === 'image' ? `<button class="btn btn--ghost btn--sm btn--block" data-action="frame-section" data-page="${pageKey}" data-slot="${slotKey}">Crop / position</button>` : ''}
              ${m && m.type === 'video' ? `<button class="btn btn--ghost btn--sm btn--block" data-action="fit-section" data-page="${pageKey}" data-slot="${slotKey}">${m.fit === 'contain' ? 'Switch to fill frame' : 'Switch to fit whole frame'}</button>` : ''}
            </div>
          </div>
        `;
      }).join('');
    group.innerHTML = `
      <h3 class="section-group__title">${labels._title}</h3>
      <p class="section-group__subtitle">${pageKey}.html</p>
      <div class="section-slots">${slotsHtml}</div>
    `;
    container.appendChild(group);
  });
}

// Save a slot. Fields omitted from `patch` keep their stored value, so framing
// survives a photo swap only when the caller means it to.
async function saveSection(page, slot, patch) {
  await api('PUT', `/api/admin/sections/${page}/${slot}`, patch);
  toast('Section updated');
  loadAll();
}

$('#sections-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const { page, slot } = btn.dataset;
  const current = normalizeMedia(state.sections[page] && state.sections[page][slot]);

  switch (btn.dataset.action) {
    case 'pick-section':
      // A new asset starts centred and filling the frame; re-frame it after.
      openGalleryPicker({ onSelect: async (item) => {
        try {
          await saveSection(page, slot, { url: item.url, type: item.type, fit: 'cover', position: '50% 50%' });
        } catch (err) { toast(err.message, true); }
      } });
      return;

    case 'replace-section': {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = MEDIA_ACCEPT;
      input.onchange = async () => {
        const file = input.files[0];
        if (!file) return;
        try {
          checkUploadSize(file);
          const [m] = await uploadFiles([file]);
          await saveSection(page, slot, { url: m.url, type: m.type, fit: 'cover', position: '50% 50%' });
        } catch (err) { toast(err.message, true); }
      };
      input.click();
      return;
    }

    case 'frame-section':
      if (!current) return;
      openFrameModal(current, async (updated) => {
        try {
          await saveSection(page, slot, updated);
        } catch (err) { toast(err.message, true); }
      }, { aspect: '1.6' });
      return;

    case 'fit-section':
      // Videos can't go through the crop tool, so they get a plain fit toggle.
      if (!current) return;
      try {
        await saveSection(page, slot, { fit: current.fit === 'contain' ? 'cover' : 'contain' });
      } catch (err) { toast(err.message, true); }
      return;

    default:
  }
});

// ---------- Media model ----------
//
// A media entry is `{ url, type:'image'|'video', fit:'cover'|'contain', position:'x% y%' }`.
// Records written before the media model store bare URL strings, so everything
// here accepts both shapes. `fit`/`position` decide how an oversized asset sits
// in a fixed frame on the public site — that is what the Frame tool below edits.

const VIDEO_URL_RE = /\.(mp4|webm|mov|ogg|ogv|mkv)(\?|#|$)/i;
const MEDIA_ACCEPT = 'image/*,video/*,.heic,.heif';

function normalizeMedia(raw) {
  if (!raw) return null;
  const o = typeof raw === 'string' ? { url: raw } : raw;
  const url = String(o.url || '').trim();
  if (!url) return null;
  return {
    url,
    type: o.type === 'video' || (!o.type && VIDEO_URL_RE.test(url)) ? 'video' : 'image',
    fit: o.fit === 'contain' ? 'contain' : 'cover',
    position: o.position || '50% 50%',
  };
}

function normalizeMediaList(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeMedia).filter(Boolean);
}

// The gallery for a record, falling back to its legacy single-field shape so a
// product/workshop saved before the media model still opens with its art.
function entityMedia(entity, legacyKey) {
  if (!entity) return [];
  if (Array.isArray(entity.media) && entity.media.length) return normalizeMediaList(entity.media);
  const legacy = entity[legacyKey];
  return normalizeMediaList(Array.isArray(legacy) ? legacy : (legacy ? [legacy] : []));
}

// Inline style that reproduces on a preview exactly what the public site will do
// with this entry.
function mediaFitStyle(m) {
  return `object-fit:${m.fit};object-position:${m.position};`;
}

function mediaThumbHTML(m, cls) {
  return m.type === 'video'
    ? `<video class="${cls}" src="${escapeAttr(m.url)}#t=0.1" style="${mediaFitStyle(m)}" muted playsinline preload="metadata"></video>`
    : `<img class="${cls}" src="${escapeAttr(m.url)}" alt="" style="${mediaFitStyle(m)}">`;
}

// ---------- Media list editor ----------
//
// Multi-item photo/video editor used by the product and workshop forms (and for
// a workshop's mosaic gallery). Mount it on a container, read it back with
// `getValue()` when the form submits.
//
//   mountMediaEditor(container, items, { label, hint })

function mountMediaEditor(container, initial, { label = 'Media', hint = '' } = {}) {
  if (!container) return { getValue: () => [] };
  let items = normalizeMediaList(initial);

  container.innerHTML = `
    <div class="media-editor">
      <div class="media-editor__head">
        <span class="field__label">${escapeHtml(label)}</span>
        <div class="media-editor__head-actions">
          <button type="button" class="btn btn--ghost btn--sm" data-media-add>+ Upload</button>
          <button type="button" class="btn btn--ghost btn--sm" data-media-pick>Choose from library</button>
        </div>
      </div>
      ${hint ? `<p class="field__hint">${escapeHtml(hint)}</p>` : ''}
      <div class="media-editor__list" data-media-list></div>
      <input type="file" accept="${MEDIA_ACCEPT}" multiple hidden data-media-input>
    </div>
  `;

  const list = $('[data-media-list]', container);
  const fileInput = $('[data-media-input]', container);

  const render = () => {
    if (!items.length) {
      list.innerHTML = '<p class="media-editor__empty">Nothing added yet. Upload a photo or video, or choose one from the library.</p>';
      return;
    }
    list.innerHTML = items.map((m, i) => `
      <div class="media-item" data-index="${i}">
        <div class="media-item__thumb">${mediaThumbHTML(m, 'media-item__media')}</div>
        <div class="media-item__body">
          <p class="media-item__role">${i === 0 ? 'Primary — used on cards and in the cart' : `Item ${i + 1}`}</p>
          <p class="media-item__meta">${m.type === 'video' ? 'Video' : 'Photo'} · ${m.fit === 'contain' ? 'Fit whole frame' : 'Fill frame'} · ${escapeHtml(m.position)}</p>
          <p class="media-item__url">${escapeHtml(m.url)}</p>
        </div>
        <div class="media-item__actions">
          <button type="button" class="btn btn--ghost btn--sm" data-media-up ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
          <button type="button" class="btn btn--ghost btn--sm" data-media-down ${i === items.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
          ${m.type === 'image' ? '<button type="button" class="btn btn--gold btn--sm" data-media-frame>Crop / position</button>' : ''}
          <button type="button" class="btn btn--danger btn--sm" data-media-remove>Remove</button>
        </div>
      </div>
    `).join('');
  };

  const add = (added) => { items = items.concat(added.filter(Boolean)); render(); };

  $('[data-media-add]', container).addEventListener('click', () => fileInput.click());
  $('[data-media-pick]', container).addEventListener('click', () => {
    openGalleryPicker({ onSelect: (item) => add([normalizeMedia({ url: item.url, type: item.type })]) });
  });

  fileInput.addEventListener('change', async () => {
    const files = Array.from(fileInput.files || []);
    fileInput.value = '';
    if (!files.length) return;
    toast(`Uploading ${files.length} file${files.length > 1 ? 's' : ''}…`);
    try {
      add(await uploadFiles(files));
      toast('Uploaded to the library');
    } catch (err) { toast(err.message, true); }
  });

  list.addEventListener('click', (e) => {
    const row = e.target.closest('[data-index]');
    if (!row) return;
    const i = Number(row.dataset.index);
    if (e.target.closest('[data-media-up]')) {
      [items[i - 1], items[i]] = [items[i], items[i - 1]];
      render();
    } else if (e.target.closest('[data-media-down]')) {
      [items[i + 1], items[i]] = [items[i], items[i + 1]];
      render();
    } else if (e.target.closest('[data-media-remove]')) {
      items.splice(i, 1);
      render();
    } else if (e.target.closest('[data-media-frame]')) {
      openFrameModal(items[i], (updated) => { items[i] = updated; render(); });
    }
  });

  render();
  return { getValue: () => items.slice() };
}

// ---------- Frame tool (crop & position) ----------
//
// Two ways to fit an oversized photo into a fixed slot:
//
//   Save framing   — non-destructive. Stores fit + focal point; the original
//                    file is untouched and the site does the framing in CSS.
//   Crop a copy    — destructive. Renders the visible region to a canvas and
//                    uploads it as a new file, so the stored asset is already
//                    the right shape (needed when you zoomed in).
//
// Aspect presets match the real slots on the site so what you frame here is what
// ships.

const FRAME_ASPECTS = [
  ['0.8', 'Product card / gallery (4:5)'],
  ['1', 'Square (1:1)'],
  ['1.6', 'Section band (16:10)'],
  ['1.7778', 'Wide banner (16:9)'],
  ['3.2', 'Hero strip (16:5)'],
];

// The frame tool gets its own backdrop rather than reusing #modal-backdrop: it
// is opened from inside the product/workshop form, and sharing the single modal
// would wipe out the half-filled form underneath it.
function openFrameLayer(bodyHtml) {
  $('#frame-body').innerHTML = bodyHtml;
  $('#frame-backdrop').hidden = false;
}

function closeFrameLayer() {
  $('#frame-backdrop').hidden = true;
  $('#frame-body').innerHTML = '';
}

$('#frame-close')?.addEventListener('click', closeFrameLayer);
// Same rule as the edit modal: an in-progress crop is unsaved work, so only the
// X button and Cancel dismiss it.
$('#frame-backdrop')?.addEventListener('click', (e) => {
  if (e.target.closest('[data-frame-close]')) closeFrameLayer();
});

function openFrameModal(media, onSave, { aspect = '0.8' } = {}) {
  const m = normalizeMedia(media);
  openFrameLayer(`
    <div class="frame-tool">
      <div class="frame-tool__stage" id="frame-stage">
        <img id="frame-img" src="${escapeAttr(m.url)}" alt="" draggable="false">
      </div>
      <div class="field-row">
        <label class="field">
          <span class="field__label">Frame shape</span>
          <select id="frame-aspect">
            ${FRAME_ASPECTS.map(([v, l]) => `<option value="${v}" ${v === aspect ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </label>
        <label class="field">
          <span class="field__label">Fit</span>
          <select id="frame-fit">
            <option value="cover" ${m.fit === 'cover' ? 'selected' : ''}>Fill the frame (crops the overflow)</option>
            <option value="contain" ${m.fit === 'contain' ? 'selected' : ''}>Fit the whole photo (leaves empty space)</option>
          </select>
        </label>
      </div>
      <label class="field">
        <span class="field__label">Zoom <span id="frame-zoom-val">100%</span></span>
        <input type="range" id="frame-zoom" min="100" max="300" step="1" value="100">
      </label>
      <p class="field__hint" id="frame-hint">Drag the photo to choose which part stays in frame.</p>
      <p class="field__hint">Frame shape previews how the photo sits in that slot — and, if you crop a copy, it is the shape the new file is cut to.</p>
      <div class="form-actions">
        <button type="button" class="btn btn--ghost" data-frame-close>Cancel</button>
        <button type="button" class="btn btn--ghost" id="frame-crop">Crop &amp; save a copy</button>
        <button type="button" class="btn btn--primary" id="frame-save">Save framing</button>
      </div>
    </div>
  `);

  const stage = $('#frame-stage');
  const img = $('#frame-img');
  const zoomInput = $('#frame-zoom');
  const fitSelect = $('#frame-fit');
  const aspectSelect = $('#frame-aspect');

  // Layout state, all in stage pixels. `base` is the cover/contain scale at
  // zoom 1; `ox/oy` is the image's top-left inside the stage.
  const st = { base: 1, zoom: 1, ox: 0, oy: 0, nw: 0, nh: 0 };

  const stageSize = () => ({ w: stage.clientWidth, h: stage.clientHeight });

  const clamp = () => {
    const { w, h } = stageSize();
    const dw = st.nw * st.base * st.zoom;
    const dh = st.nh * st.base * st.zoom;
    // 'cover' keeps the frame filled; 'contain' centres whatever is smaller.
    st.ox = dw <= w ? (w - dw) / 2 : Math.min(0, Math.max(w - dw, st.ox));
    st.oy = dh <= h ? (h - dh) / 2 : Math.min(0, Math.max(h - dh, st.oy));
  };

  const paint = () => {
    clamp();
    const dw = st.nw * st.base * st.zoom;
    const dh = st.nh * st.base * st.zoom;
    Object.assign(img.style, {
      width: `${dw}px`, height: `${dh}px`, left: `${st.ox}px`, top: `${st.oy}px`,
    });
    $('#frame-zoom-val').textContent = `${Math.round(st.zoom * 100)}%`;
    // Zooming can't be expressed as a CSS focal point, so past 100% the only
    // faithful way to keep it is a real crop.
    $('#frame-save').disabled = st.zoom > 1.001;
    $('#frame-hint').textContent = st.zoom > 1.001
      ? 'Zoomed in — use “Crop & save a copy” to keep this exact framing.'
      : 'Drag the photo to choose which part stays in frame. Saving framing keeps the original file untouched.';
  };

  // Recompute the base scale for the current stage size and fit mode, keeping
  // the focal point the drag/position already chose.
  const layout = (keepFocal = true) => {
    const ratio = Number(aspectSelect.value) || 0.8;
    stage.style.aspectRatio = String(ratio);
    const { w, h } = stageSize();
    if (!st.nw || !st.nh) return;
    const focal = keepFocal ? currentFocal() : { x: 0.5, y: 0.5 };
    st.base = fitSelect.value === 'contain'
      ? Math.min(w / st.nw, h / st.nh)
      : Math.max(w / st.nw, h / st.nh);
    const dw = st.nw * st.base * st.zoom;
    const dh = st.nh * st.base * st.zoom;
    st.ox = -(focal.x * (dw - w));
    st.oy = -(focal.y * (dh - h));
    paint();
  };

  // Focal point as the 0–1 fractions CSS object-position uses.
  const currentFocal = () => {
    const { w, h } = stageSize();
    const dw = st.nw * st.base * st.zoom;
    const dh = st.nh * st.base * st.zoom;
    return {
      x: dw > w ? Math.min(1, Math.max(0, -st.ox / (dw - w))) : 0.5,
      y: dh > h ? Math.min(1, Math.max(0, -st.oy / (dh - h))) : 0.5,
    };
  };

  img.addEventListener('load', () => {
    st.nw = img.naturalWidth;
    st.nh = img.naturalHeight;
    // Seed from the entry's stored focal point.
    const [px, py] = String(m.position).split(' ');
    const seed = { x: (parseFloat(px) || 50) / 100, y: (parseFloat(py) || 50) / 100 };
    st.base = 1; st.zoom = 1;
    const ratio = Number(aspectSelect.value) || 0.8;
    stage.style.aspectRatio = String(ratio);
    const { w, h } = stageSize();
    st.base = fitSelect.value === 'contain'
      ? Math.min(w / st.nw, h / st.nh)
      : Math.max(w / st.nw, h / st.nh);
    st.ox = -(seed.x * (st.nw * st.base - w));
    st.oy = -(seed.y * (st.nh * st.base - h));
    paint();
  });
  // Deliberately no crossOrigin here: a host without CORS headers would refuse
  // the request outright and the preview would go blank. Cropping re-fetches the
  // file with crossOrigin set (see renderCrop) and degrades with a message.
  img.src = m.url;

  // Drag to pan.
  let drag = null;
  stage.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, ox: st.ox, oy: st.oy };
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    st.ox = drag.ox + (e.clientX - drag.x);
    st.oy = drag.oy + (e.clientY - drag.y);
    paint();
  });
  ['pointerup', 'pointercancel'].forEach((ev) =>
    stage.addEventListener(ev, () => { drag = null; }));

  zoomInput.addEventListener('input', () => {
    const focal = currentFocal();
    st.zoom = Number(zoomInput.value) / 100;
    const { w, h } = stageSize();
    const dw = st.nw * st.base * st.zoom;
    const dh = st.nh * st.base * st.zoom;
    st.ox = -(focal.x * (dw - w));
    st.oy = -(focal.y * (dh - h));
    paint();
  });
  fitSelect.addEventListener('change', () => layout());
  aspectSelect.addEventListener('change', () => layout());

  $('#frame-save').addEventListener('click', () => {
    const f = currentFocal();
    onSave({
      ...m,
      fit: fitSelect.value,
      position: `${(f.x * 100).toFixed(1)}% ${(f.y * 100).toFixed(1)}%`,
    });
    closeFrameLayer();
    toast('Framing saved');
  });

  $('#frame-crop').addEventListener('click', async () => {
    const btn = $('#frame-crop');
    btn.disabled = true;
    try {
      const file = await renderCrop(m.url, stage, st);
      const url = await uploadFile(file);
      onSave({ ...m, url, fit: 'cover', position: '50% 50%' });
      closeFrameLayer();
      toast('Cropped copy uploaded');
    } catch (err) {
      btn.disabled = false;
      toast(err.message, true);
    }
  });
}

// Render the region currently visible in the stage to a JPEG File. Output is
// capped so a 6000px phone photo doesn't become a 6000px web asset.
const CROP_MAX_EDGE = 2400;

const CORS_HELP = 'This file’s host doesn’t allow cropping (no CORS headers on the media bucket). '
  + 'Use “Save framing” instead — it frames the photo without touching the file.';

// Re-fetch the source with CORS enabled so the canvas stays readable. A host
// that doesn't send the headers fails here rather than silently producing a
// blank crop.
function loadCorsImage(url) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error(CORS_HELP));
    im.src = url;
  });
}

async function renderCrop(url, stage, st) {
  const img = await loadCorsImage(url);
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  const scale = st.base * st.zoom;
  // The visible window, expressed in the source image's own pixels.
  const sx = -st.ox / scale;
  const sy = -st.oy / scale;
  const sw = w / scale;
  const sh = h / scale;

  const outScale = Math.min(1, CROP_MAX_EDGE / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw * outScale));
  canvas.height = Math.max(1, Math.round(sh * outScale));
  const ctx = canvas.getContext('2d');
  // 'contain' can leave bars; fill them with white rather than transparent-black.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise((resolve, reject) => {
    try {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not render the crop'))), 'image/jpeg', 0.9);
    } catch (e) {
      // A tainted canvas means the media host didn't send CORS headers.
      reject(new Error(CORS_HELP));
    }
  });
  return new File([blob], 'cropped.jpg', { type: 'image/jpeg' });
}

// ---------- Upload helper ----------

// Upload bytes only. Every upload auto-registers into the gallery library on the
// backend; here we just need the returned URL for the field being edited.
async function uploadFile(file) {
  checkUploadSize(file);
  const fd = new FormData();
  fd.append('file', file);
  const res = await api('POST', '/api/admin/upload', fd, true);
  return res.url;
}

// Upload with metadata (used by the Gallery tab's own upload form). Returns the
// full { url, id, item } response so the caller gets the created library record.
async function uploadImage(file, meta = {}) {
  checkUploadSize(file);
  const fd = new FormData();
  fd.append('file', file);
  Object.entries(meta).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') fd.append(k, v);
  });
  return api('POST', '/api/admin/upload', fd, true);
}

// Upload several files in sequence and return the created media entries. Each
// one still registers itself in the gallery library, so a batch added to a
// product also lands in the central library.
async function uploadFiles(files) {
  const out = [];
  for (const file of files) {
    checkUploadSize(file);
    const res = await api('POST', '/api/admin/upload', (() => {
      const fd = new FormData();
      fd.append('file', file);
      return fd;
    })(), true);
    out.push(normalizeMedia({ url: res.url, type: (res.item && res.item.type) || undefined }));
  }
  return out;
}

// The server caps uploads (MAX_UPLOAD_MB, reported by /api/admin/ping). Catching
// an oversized file here gives a useful message instead of a long upload that
// dies at the proxy.
function checkUploadSize(file) {
  const limit = (state.maxUploadMB || 100) * 1024 * 1024;
  if (file.size > limit) {
    throw new Error(`"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is ${state.maxUploadMB || 100} MB. Compress it and try again.`);
  }
}

// Read an image's intrinsic dimensions in the browser (for CLS + SEO metadata).
function readImageDims(file) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); resolve({ width: img.naturalWidth, height: img.naturalHeight }); };
    img.onerror = () => { URL.revokeObjectURL(url); resolve({ width: null, height: null }); };
    img.src = url;
  });
}

function wireUpload(rootSel) {
  const root = $(rootSel);
  if (!root) return;
  const trigger = $('[data-upload-trigger]', root);
  const pick = $('[data-upload-pick]', root);
  const clear = $('[data-upload-clear]', root);
  const fileInput = $('.upload__input', root);
  const preview = $('.upload__preview', root);
  const hidden = $('input[type="hidden"]', root);

  const setImage = (url) => {
    hidden.value = url;
    preview.style.backgroundImage = `url('${url}')`;
    preview.textContent = '';
  };

  trigger?.addEventListener('click', () => fileInput.click());
  pick?.addEventListener('click', () => {
    openGalleryPicker({ onSelect: (item) => { setImage(item.url); toast('Image selected'); } });
  });
  clear?.addEventListener('click', () => {
    hidden.value = '';
    preview.style.backgroundImage = '';
    preview.textContent = 'No image';
  });
  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      const url = await uploadFile(file);
      setImage(url);
      toast('Image uploaded to library');
    } catch (err) { toast(err.message, true); }
  });
}

// ---------- Gallery (central media library) ----------

async function loadGallery() {
  try {
    state.gallery = await api('GET', '/api/admin/gallery');
    renderGallery();
  } catch (e) {
    toast(e.message, true);
  }
}

function galleryMatches(g, q) {
  if (!q) return true;
  const hay = [g.title, g.description, (g.tags || []).join(' ')].join(' ').toLowerCase();
  return hay.includes(q);
}

function renderGallery() {
  const grid = $('#gallery-grid');
  if (!grid) return;
  const q = state.gallerySearch.trim().toLowerCase();
  const items = state.gallery.filter((g) => galleryMatches(g, q));
  if (!items.length) {
    grid.innerHTML = emptyState(state.gallery.length
      ? 'Nothing matches your search.'
      : 'Nothing here yet. Click <strong>+ Upload media</strong> to add a photo or video to the library.');
    return;
  }
  // Tiles are a uniform size and the asset is fitted whole inside it (letterboxed
  // rather than cropped), so a portrait photo and a landscape one are directly
  // comparable at a glance.
  grid.innerHTML = items.map((g) => `
    <div class="card">
      <div class="card__img card__img--fit">
        ${isVideoItem(g)
          // Playable in place: the library is where you check a clip is the right
          // one, and that needs the video itself, not a first-frame poster.
          // Muted + loop so a grid of them stays quiet.
          ? `<video class="card__media" src="${escapeAttr(g.url)}" controls loop muted playsinline preload="metadata"></video><span class="card__badge card__badge--corner">Video</span>`
          : `<img class="card__media" src="${escapeAttr(g.url)}" alt="">`}
        <span class="card__tag ${g.public ? 'card__tag--public' : 'card__tag--private'}">${g.public ? 'Public' : 'Private'}</span>
      </div>
      <div class="card__body">
        <h3 class="card__title">${escapeHtml(g.title)}</h3>
        <p class="card__meta">${escapeHtml((g.tags || []).join(' · ')) || '—'}</p>
      </div>
      <div class="card__actions">
        <button class="btn btn--ghost btn--sm" data-gallery-edit="${g.id}">Edit</button>
        <button class="btn btn--danger btn--sm" data-gallery-del="${g.id}">Delete</button>
      </div>
    </div>
  `).join('');
}

$('#gallery-admin-search')?.addEventListener('input', (e) => {
  state.gallerySearch = e.target.value;
  renderGallery();
});

$('#gallery-grid')?.addEventListener('click', (e) => {
  const editBtn = e.target.closest('[data-gallery-edit]');
  const delBtn = e.target.closest('[data-gallery-del]');
  if (editBtn) openGalleryForm(state.gallery.find((g) => g.id === editBtn.dataset.galleryEdit));
  if (delBtn) confirmDeleteGallery(delBtn.dataset.galleryDel);
});

$('#add-gallery-btn')?.addEventListener('click', () => openGalleryForm(null));

// New = upload form (file required). Edit = metadata only (delete + re-upload to
// change the image). Both flows keep a single library record per image.
function openGalleryForm(item) {
  const isEdit = !!item;
  const g = item || { title: '', description: '', alt: '', tags: [], public: false };
  openModal(isEdit ? `Edit — ${g.title}` : 'Upload media', `
    <form id="gallery-form" class="form-grid" autocomplete="off">
      ${isEdit ? `
        <div class="upload">
          ${isVideoItem(g)
            ? `<video class="upload__preview" src="${escapeAttr(g.url)}" controls muted playsinline preload="metadata"></video>`
            : `<div class="upload__preview" style="background-image:url('${escapeAttr(g.url)}')"></div>`}
        </div>
      ` : `
        <label class="field">
          <span class="field__label">Image or video file</span>
          <input type="file" accept="image/*,video/*,.heic,.heif" name="file" id="gallery-file" required>
          <span class="field__hint">Images, HEIC (auto-converted to JPEG), and video up to 100 MB.</span>
        </label>
      `}
      <label class="field">
        <span class="field__label">Title</span>
        <input name="title" required value="${escapeAttr(g.title)}">
      </label>
      <label class="field">
        <span class="field__label">Description (shown on the image's SEO page)</span>
        <textarea name="description">${escapeHtml(g.description || '')}</textarea>
      </label>
      <label class="field">
        <span class="field__label">Alt text (accessibility — defaults to the title)</span>
        <input name="alt" value="${escapeAttr(g.alt || '')}">
      </label>
      <label class="field">
        <span class="field__label">Tags (comma-separated, e.g. indigo, saree, ajrakh)</span>
        <input name="tags" value="${escapeAttr((g.tags || []).join(', '))}">
      </label>
      <div class="checkbox-row">
        <input type="checkbox" id="g-public" name="public" ${g.public ? 'checked' : ''}>
        <label for="g-public">Public — show in the consumer design gallery</label>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn--ghost" data-modal-close>Cancel</button>
        <button type="submit" class="btn btn--primary">${isEdit ? 'Save changes' : 'Upload'}</button>
      </div>
    </form>
  `);

  $('#gallery-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const meta = {
      title: (fd.get('title') || '').toString().trim(),
      description: (fd.get('description') || '').toString().trim(),
      alt: (fd.get('alt') || '').toString().trim(),
      tags: splitCSV(fd.get('tags')).join(','),
      public: fd.get('public') ? 'true' : 'false',
    };
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      if (isEdit) {
        await api('PUT', `/api/admin/gallery/${item.id}`, { ...meta, public: meta.public === 'true' });
        toast('Image updated');
      } else {
        const file = $('#gallery-file').files[0];
        if (!file) { toast('Choose an image file', true); submitBtn.disabled = false; return; }
        const dims = await readImageDims(file);
        await uploadImage(file, { ...meta, width: dims.width || '', height: dims.height || '' });
        toast('Uploaded to the library');
      }
      closeModal();
      loadGallery();
    } catch (err) {
      toast(err.message, true);
      submitBtn.disabled = false;
    }
  });
}

function confirmDeleteGallery(id) {
  const g = state.gallery.find((x) => x.id === id);
  openModal('Delete image', `
    <p style="color:var(--sc-l3);margin-bottom:24px;">Remove <strong>${escapeHtml(g ? g.title : 'this image')}</strong> from the library? This does not delete the underlying file, and any product still using its URL keeps working.</p>
    <div class="form-actions">
      <button type="button" class="btn btn--ghost" data-modal-close>Cancel</button>
      <button type="button" class="btn btn--danger" id="confirm-del-gallery">Delete</button>
    </div>
  `);
  $('#confirm-del-gallery').addEventListener('click', async () => {
    try {
      await api('DELETE', `/api/admin/gallery/${id}`);
      toast('Image removed');
      closeModal();
      loadGallery();
    } catch (err) { toast(err.message, true); }
  });
}

// ---------- Gallery picker (reused by every image field) ----------

let pickerOnSelect = null;

function openGalleryPicker({ onSelect }) {
  pickerOnSelect = onSelect;
  $('#picker-search').value = '';
  renderPicker('');
  $('#picker-backdrop').hidden = false;
  // Load fresh if the library hasn't been fetched yet.
  if (!state.gallery.length) loadGallery().then(() => renderPicker($('#picker-search').value.trim().toLowerCase()));
  setTimeout(() => $('#picker-search').focus(), 0);
}

function closePicker() {
  $('#picker-backdrop').hidden = true;
  pickerOnSelect = null;
}

function renderPicker(q) {
  const grid = $('#picker-grid');
  const items = state.gallery.filter((g) => galleryMatches(g, q));
  if (!items.length) {
    grid.innerHTML = `<p class="picker-empty">${state.gallery.length ? 'No images match.' : 'The library is empty — upload an image from the Gallery tab first.'}</p>`;
    return;
  }
  grid.innerHTML = items.map((g) => `
    <div class="picker-item" data-pick="${g.id}" title="${escapeAttr(g.title)}">
      ${isVideoItem(g)
        ? `<video class="picker-item__media" src="${escapeAttr(g.url)}#t=0.1" muted playsinline preload="metadata"></video>`
        : `<img class="picker-item__media" src="${escapeAttr(g.url)}" alt="">`}
      <span class="picker-item__label">${escapeHtml(g.title)}</span>
    </div>
  `).join('');
}

$('#picker-search')?.addEventListener('input', (e) => renderPicker(e.target.value.trim().toLowerCase()));
$('#picker-close')?.addEventListener('click', closePicker);
$('#picker-backdrop')?.addEventListener('click', (e) => {
  if (e.target === $('#picker-backdrop')) closePicker();
  const item = e.target.closest('[data-pick]');
  if (item) {
    const g = state.gallery.find((x) => x.id === item.dataset.pick);
    if (g && pickerOnSelect) pickerOnSelect(g);
    closePicker();
  }
});

// ---------- Store-wide sale ----------

// Convert a stored ISO timestamp to a value a <input type="datetime-local">
// accepts ('YYYY-MM-DDTHH:mm' in the admin's local time).
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function renderSaleStatus(sale) {
  const el = $('#sale-status');
  if (!el) return;
  const now = Date.now();
  const live = !!(sale && sale.active && Number(sale.percent) > 0 &&
    (!sale.startsAt || now >= new Date(sale.startsAt).getTime()) &&
    (!sale.endsAt || now <= new Date(sale.endsAt).getTime()));
  const scheduled = !!(sale && sale.active && Number(sale.percent) > 0 && !live);
  el.textContent = live ? `Live — ${sale.percent}% off` : scheduled ? 'Scheduled' : 'Off';
  el.classList.toggle('is-live', live);
  el.classList.toggle('is-scheduled', scheduled);
}

async function loadSale() {
  try {
    const sale = (await api('GET', '/api/admin/sale')) || {};
    state.sale = sale;
    $('#sale-active').checked = sale.active === true;
    $('#sale-percent').value = sale.percent || '';
    $('#sale-max').value = sale.maxDiscount ?? '';
    $('#sale-label').value = sale.label || '';
    $('#sale-banner-text').value = sale.bannerText || '';
    $('#sale-starts').value = toLocalInput(sale.startsAt);
    $('#sale-ends').value = toLocalInput(sale.endsAt);
    renderSaleStatus(sale);
  } catch (e) {
    toast(e.message, true);
  }
}

$('#sale-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const num = (v) => (v !== '' && v != null && !Number.isNaN(Number(v)) ? Number(v) : null);
  const percent = num($('#sale-percent').value);
  const active = $('#sale-active').checked;
  if (active && !(percent > 0)) { toast('Enter a percent greater than 0 to make the sale live', true); return; }
  const payload = {
    active,
    percent: percent || 0,
    maxDiscount: num($('#sale-max').value),
    label: $('#sale-label').value.trim(),
    bannerText: $('#sale-banner-text').value.trim(),
    startsAt: $('#sale-starts').value || null,
    endsAt: $('#sale-ends').value || null,
  };
  try {
    const saved = await api('PUT', '/api/admin/sale', payload);
    state.sale = saved;
    renderSaleStatus(saved);
    toast(saved.live ? 'Store-wide sale is live' : 'Sale settings saved');
  } catch (err) {
    toast(err.message, true);
  }
});

// ---------- Discounts ----------

async function loadDiscounts() {
  try {
    state.discounts = await api('GET', '/api/admin/discounts');
    renderDiscounts();
  } catch (e) {
    toast(e.message, true);
  }
}

function discountSummary(d) {
  if (d.type === 'flat') return `₹${d.value} off`;
  return `${d.value}% off${d.maxDiscount != null ? ` (max ₹${d.maxDiscount})` : ''}`;
}

function discountStatus(d) {
  const now = Date.now();
  if (d.active === false) return { label: 'Disabled', muted: true };
  if (d.startsAt && now < new Date(d.startsAt).getTime()) return { label: 'Scheduled', muted: true };
  if (d.expiresAt && now > new Date(d.expiresAt).getTime()) return { label: 'Expired', muted: true };
  if (d.usageLimit != null && (d.usedCount || 0) >= d.usageLimit) return { label: 'Used up', muted: true };
  return { label: 'Active', muted: false };
}

function renderDiscounts() {
  const wrap = $('#discounts-list');
  if (!wrap) return;
  if (!state.discounts.length) {
    wrap.innerHTML = emptyState('No discount codes yet.');
    return;
  }
  wrap.innerHTML = state.discounts.map((d) => {
    const status = discountStatus(d);
    const conditions = [
      d.minSubtotal != null ? `min order ₹${d.minSubtotal}` : '',
      d.usageLimit != null ? `${d.usedCount || 0}/${d.usageLimit} used` : `${d.usedCount || 0} used`,
      d.expiresAt ? `expires ${new Date(d.expiresAt).toLocaleDateString()}` : '',
    ].filter(Boolean).join(' · ');
    return `
      <div class="admin-row">
        <div>
          <p class="admin-row__email"><strong>${escapeHtml(d.code)}</strong> — ${escapeHtml(discountSummary(d))}
            <span class="admin-row__you"${status.muted ? ' style="opacity:.6"' : ''}>${status.label}</span></p>
          ${conditions ? `<p class="admin-row__meta">${escapeHtml(conditions)}</p>` : ''}
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn--ghost btn--sm" data-edit-discount="${escapeAttr(d.code)}">Edit</button>
          <button class="btn btn--ghost btn--sm" data-del-discount="${escapeAttr(d.code)}">Remove</button>
        </div>
      </div>`;
  }).join('');
}

$('#discounts-list').addEventListener('click', (e) => {
  const edit = e.target.closest('[data-edit-discount]');
  if (edit) {
    const d = state.discounts.find((x) => x.code === edit.dataset.editDiscount);
    if (d) openDiscountModal(d);
    return;
  }
  const del = e.target.closest('[data-del-discount]');
  if (del) confirmDeleteDiscount(del.dataset.delDiscount);
});

$('#add-discount-btn').addEventListener('click', () => openDiscountModal(null));

function openDiscountModal(d) {
  const isEdit = !!d;
  const v = d || {};
  const dateVal = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : '');
  openModal(isEdit ? `Edit ${v.code}` : 'New discount code', `
    <form id="discount-form" class="form" autocomplete="off">
      <label class="field">
        <span class="field__label">Code</span>
        <input type="text" name="code" required placeholder="WELCOME10" value="${escapeAttr(v.code || '')}"
          style="text-transform:uppercase;"${isEdit ? ' readonly' : ''}>
      </label>
      <label class="field">
        <span class="field__label">Type</span>
        <select name="type" id="discount-type">
          <option value="percent"${v.type !== 'flat' ? ' selected' : ''}>Percentage off (%)</option>
          <option value="flat"${v.type === 'flat' ? ' selected' : ''}>Flat amount off (₹)</option>
        </select>
      </label>
      <label class="field">
        <span class="field__label" id="discount-value-label">Value</span>
        <input type="number" name="value" required min="1" step="1" placeholder="10" value="${escapeAttr(v.value ?? '')}">
      </label>
      <label class="field" id="discount-max-field"${v.type === 'flat' ? ' hidden' : ''}>
        <span class="field__label">Max discount (₹) — optional cap for %</span>
        <input type="number" name="maxDiscount" min="1" step="1" placeholder="e.g. 500" value="${escapeAttr(v.maxDiscount ?? '')}">
      </label>
      <label class="field">
        <span class="field__label">Minimum order (₹) — optional</span>
        <input type="number" name="minSubtotal" min="0" step="1" placeholder="e.g. 1500" value="${escapeAttr(v.minSubtotal ?? '')}">
      </label>
      <label class="field">
        <span class="field__label">Usage limit — optional (total redemptions)</span>
        <input type="number" name="usageLimit" min="1" step="1" placeholder="Unlimited if blank" value="${escapeAttr(v.usageLimit ?? '')}">
      </label>
      <div style="display:flex;gap:16px;">
        <label class="field" style="flex:1;">
          <span class="field__label">Starts — optional</span>
          <input type="date" name="startsAt" value="${dateVal(v.startsAt)}">
        </label>
        <label class="field" style="flex:1;">
          <span class="field__label">Expires — optional</span>
          <input type="date" name="expiresAt" value="${dateVal(v.expiresAt)}">
        </label>
      </div>
      <label class="field" style="flex-direction:row;align-items:center;gap:8px;">
        <input type="checkbox" name="active" ${v.active === false ? '' : 'checked'} style="width:auto;">
        <span class="field__label" style="margin:0;">Active (customers can use this code)</span>
      </label>
      <div class="form-actions">
        <button type="button" class="btn btn--ghost" data-modal-close>Cancel</button>
        <button type="submit" class="btn btn--primary">${isEdit ? 'Save changes' : 'Create code'}</button>
      </div>
    </form>
  `);

  // Hide the % cap field when "flat" is selected.
  const typeSel = $('#discount-type');
  const maxField = $('#discount-max-field');
  const valueLabel = $('#discount-value-label');
  const syncType = () => {
    const flat = typeSel.value === 'flat';
    maxField.hidden = flat;
    valueLabel.textContent = flat ? 'Value (₹)' : 'Value (%)';
  };
  typeSel.addEventListener('change', syncType);
  syncType();

  $('#discount-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const str = (k) => (fd.get(k) || '').toString().trim();
    const payload = {
      code: str('code').toUpperCase(),
      type: str('type'),
      value: str('value'),
      maxDiscount: str('maxDiscount'),
      minSubtotal: str('minSubtotal'),
      usageLimit: str('usageLimit'),
      startsAt: str('startsAt'),
      expiresAt: str('expiresAt'),
      active: fd.get('active') != null,
    };
    try {
      if (isEdit) {
        await api('PUT', `/api/admin/discounts/${encodeURIComponent(v.code)}`, payload);
        toast('Discount updated');
      } else {
        await api('POST', '/api/admin/discounts', payload);
        toast('Discount created');
      }
      closeModal();
      loadDiscounts();
    } catch (err) {
      toast(err.message, true);
    }
  });
}

async function confirmDeleteDiscount(code) {
  if (!confirm(`Remove discount code ${code}? Customers will no longer be able to use it.`)) return;
  try {
    await api('DELETE', `/api/admin/discounts/${encodeURIComponent(code)}`);
    toast('Discount removed');
    loadDiscounts();
  } catch (e) {
    toast(e.message, true);
  }
}

// ---------- Orders ----------

const ORDER_STATUS_META = {
  created:   { label: 'Unpaid',    cls: 'ostatus--created' },
  paid:      { label: 'Paid',      cls: 'ostatus--paid' },
  shipped:   { label: 'Shipped',   cls: 'ostatus--shipped' },
  delivered: { label: 'Delivered', cls: 'ostatus--delivered' },
  cancelled: { label: 'Cancelled', cls: 'ostatus--cancelled' },
  failed:    { label: 'Failed',    cls: 'ostatus--failed' },
  signature_failed: { label: 'Failed', cls: 'ostatus--failed' },
};
const ORDER_STATUS_OPTS = ['created', 'paid', 'shipped', 'delivered', 'cancelled', 'failed'];

const money = (n) => '₹' + (Number(n) || 0).toLocaleString('en-IN');
function orderDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
function statusBadge(status) {
  const m = ORDER_STATUS_META[status] || { label: status || '—', cls: '' };
  return `<span class="ostatus ${m.cls}">${escapeHtml(m.label)}</span>`;
}

async function loadOrders() {
  try {
    state.orders = await api('GET', '/api/admin/orders');
    state.orders.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    renderOrders();
  } catch (e) {
    toast(e.message, true);
  }
}

function renderOrders() {
  const wrap = $('#orders-list');
  if (!wrap) return;
  const f = state.orderStatusFilter;
  const list = f === 'all' ? state.orders : state.orders.filter((o) => o.status === f);
  if (!list.length) {
    wrap.innerHTML = emptyState(state.orders.length ? 'No orders match this filter.' : 'No orders yet. Create one with “+ New order”.');
    return;
  }
  wrap.innerHTML = list.map((o) => {
    const itemCount = (o.items || []).reduce((n, i) => n + (i.qty || 1), 0);
    const who = o.customerName ? `${escapeHtml(o.customerName)} · ${escapeHtml(o.email || '—')}` : escapeHtml(o.email || '—');
    const hasLink = o.paymentLink && o.paymentLink.shortUrl && o.status !== 'paid';
    const link = hasLink ? `· <a class="order-link" href="${escapeAttr(o.paymentLink.shortUrl)}" target="_blank" rel="noopener">payment link ↗</a>` : '';
    const manual = o.source === 'manual' ? '<span class="order-tag">Manual</span>' : '';
    return `
      <div class="admin-row order-row">
        <div class="order-row__main">
          <p class="order-row__title"><strong>${money(o.amount)}</strong> ${statusBadge(o.status)} ${manual}</p>
          <p class="admin-row__meta">${who} · ${itemCount} item${itemCount === 1 ? '' : 's'} · ${escapeHtml(orderDate(o.createdAt))} · <span class="order-id">${escapeHtml(o.id)}</span> ${link}</p>
        </div>
        <div class="order-row__actions">
          <button class="btn btn--ghost btn--sm" data-edit-order="${escapeAttr(o.id)}">View / Edit</button>
          ${o.status !== 'paid' ? `<button class="btn btn--ghost btn--sm" data-link-order="${escapeAttr(o.id)}">Payment link</button>` : ''}
          <button class="btn btn--ghost btn--sm" data-del-order="${escapeAttr(o.id)}">Delete</button>
        </div>
      </div>`;
  }).join('');
}

$('#orders-list').addEventListener('click', (e) => {
  const edit = e.target.closest('[data-edit-order]');
  if (edit) { const o = state.orders.find((x) => x.id === edit.dataset.editOrder); if (o) openOrderModal(o); return; }
  const link = e.target.closest('[data-link-order]');
  if (link) { generatePaymentLink(link.dataset.linkOrder, link); return; }
  const del = e.target.closest('[data-del-order]');
  if (del) confirmDeleteOrder(del.dataset.delOrder);
});

$$('#order-status-filter .chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    state.orderStatusFilter = chip.dataset.status;
    $$('#order-status-filter .chip').forEach((c) => c.classList.toggle('active', c === chip));
    renderOrders();
  });
});

$('#add-order-btn').addEventListener('click', () => openOrderModal(null));

function orderItemRowHtml(it = {}) {
  return `
    <div class="oitem" data-oitem>
      <input class="oitem__name" type="text" placeholder="Item name" value="${escapeAttr(it.name || '')}">
      <input class="oitem__size" type="text" placeholder="Size" value="${escapeAttr(it.size || '')}">
      <input class="oitem__qty" type="number" min="1" step="1" placeholder="Qty" value="${escapeAttr(it.qty || 1)}">
      <input class="oitem__price" type="number" min="0" step="1" placeholder="Unit ₹" value="${escapeAttr(it.price ?? '')}">
      <button type="button" class="oitem__del" title="Remove item" data-oitem-del aria-label="Remove item">×</button>
    </div>`;
}

function collectOrderItems() {
  return $$('#oitems [data-oitem]').map((row) => ({
    name: row.querySelector('.oitem__name').value.trim(),
    size: row.querySelector('.oitem__size').value.trim(),
    qty: parseInt(row.querySelector('.oitem__qty').value, 10) || 1,
    price: Math.max(0, Math.round(Number(row.querySelector('.oitem__price').value) || 0)),
  })).filter((it) => it.name);
}

function openOrderModal(o) {
  const isEdit = !!o;
  const v = o || {};
  const addr = v.address || {};
  const items = (v.items && v.items.length) ? v.items : [{}];
  const taxPct = v.taxRate != null ? +(v.taxRate * 100).toFixed(2) : 8;
  const catalogueOpts = (state.products || [])
    .map((p) => `<option value="${escapeAttr(p.id)}">${escapeAttr(p.name)} — ₹${p.price}</option>`).join('');
  openModal(isEdit ? `Order ${v.id}` : 'New order', `
    <form id="order-form" class="form" autocomplete="off">
      ${isEdit ? `<p class="order-modal__meta">${statusBadge(v.status)} · Created ${escapeHtml(orderDate(v.createdAt))}${v.source === 'manual' ? ' · Manual order' : ' · Store order'}</p>` : ''}
      <div class="form-grid-2">
        <label class="field"><span class="field__label">Customer email *</span>
          <input type="email" name="email" required value="${escapeAttr(v.email || '')}" placeholder="customer@example.com"></label>
        <label class="field"><span class="field__label">Customer name</span>
          <input type="text" name="customerName" value="${escapeAttr(v.customerName || '')}" placeholder="Optional"></label>
      </div>

      <div class="field">
        <span class="field__label">Items</span>
        <div id="oitems">${items.map(orderItemRowHtml).join('')}</div>
        <div class="oitems__tools">
          <button type="button" class="btn btn--ghost btn--sm" id="oitem-add">+ Add item</button>
          ${catalogueOpts ? `<select id="oitem-catalogue" class="oitem-catalogue"><option value="">Add from catalogue…</option>${catalogueOpts}</select>` : ''}
        </div>
      </div>

      <div class="form-grid-3">
        <label class="field"><span class="field__label">Discount ₹</span>
          <input type="number" name="discount" min="0" step="1" value="${escapeAttr(v.discount || 0)}"></label>
        <label class="field"><span class="field__label">Delivery ₹</span>
          <input type="number" name="deliveryFee" min="0" step="1" value="${escapeAttr(v.deliveryFee ?? 99)}"></label>
        <label class="field"><span class="field__label">Tax %</span>
          <input type="number" name="taxRate" min="0" step="0.01" value="${escapeAttr(taxPct)}"></label>
      </div>

      <div class="order-totals" id="order-totals"></div>

      <label class="field"><span class="field__label">Status</span>
        <select name="status">
          ${ORDER_STATUS_OPTS.map((s) => `<option value="${s}"${(v.status || 'created') === s ? ' selected' : ''}>${ORDER_STATUS_META[s].label}</option>`).join('')}
        </select>
      </label>

      <details class="order-details"${(addr.line1 || addr.address || v.tracking) ? ' open' : ''}>
        <summary>Delivery address &amp; tracking</summary>
        <div class="form-grid-2">
          <label class="field"><span class="field__label">Name</span><input type="text" name="addr_name" value="${escapeAttr(addr.name || addr.title || '')}"></label>
          <label class="field"><span class="field__label">Address / line 1</span><input type="text" name="addr_line1" value="${escapeAttr(addr.line1 || addr.address || '')}"></label>
        </div>
        <label class="field"><span class="field__label">Line 2</span><input type="text" name="addr_line2" value="${escapeAttr(addr.line2 || '')}"></label>
        <div class="form-grid-3">
          <label class="field"><span class="field__label">City</span><input type="text" name="addr_city" value="${escapeAttr(addr.city || '')}"></label>
          <label class="field"><span class="field__label">State</span><input type="text" name="addr_state" value="${escapeAttr(addr.state || '')}"></label>
          <label class="field"><span class="field__label">Pincode</span><input type="text" name="addr_pincode" value="${escapeAttr(addr.pincode || '')}"></label>
        </div>
        <div class="form-grid-2">
          <label class="field"><span class="field__label">Tracking carrier</span><input type="text" name="track_carrier" value="${escapeAttr((v.tracking && v.tracking.carrier) || '')}"></label>
          <label class="field"><span class="field__label">Tracking number</span><input type="text" name="track_number" value="${escapeAttr((v.tracking && v.tracking.number) || '')}"></label>
        </div>
      </details>

      <label class="field"><span class="field__label">Internal notes</span>
        <textarea name="notes" rows="2" placeholder="Not shown to the customer">${escapeHtml(v.notes || '')}</textarea></label>

      ${isEdit ? `
      <div class="order-paylink" id="order-paylink">
        ${v.paymentLink && v.paymentLink.shortUrl && v.status !== 'paid'
          ? `<p class="order-paylink__has">Payment link: <a href="${escapeAttr(v.paymentLink.shortUrl)}" target="_blank" rel="noopener">${escapeHtml(v.paymentLink.shortUrl)}</a></p>` : ''}
        ${v.status === 'paid' ? '<p class="order-paylink__paid">✓ This order is paid.</p>'
          : `<button type="button" class="btn btn--ghost btn--sm" id="order-genlink">${v.paymentLink ? 'Copy payment link' : 'Generate payment link'}</button>`}
      </div>` : ''}

      <div class="form-actions">
        <button type="button" class="btn btn--ghost" data-modal-close>Cancel</button>
        <button type="submit" class="btn btn--primary">${isEdit ? 'Save changes' : 'Create order'}</button>
      </div>
    </form>
  `);

  const form = $('#order-form');
  const itemsWrap = $('#oitems');

  const recalc = () => {
    const its = collectOrderItems();
    const subtotal = its.reduce((s, i) => s + i.price * i.qty, 0);
    const el = (n) => form.elements[n];
    const discount = Math.min(subtotal, Math.max(0, Number(el('discount').value) || 0));
    const deliveryFee = Math.max(0, Number(el('deliveryFee').value) || 0);
    const rate = Math.max(0, Number(el('taxRate').value) || 0) / 100;
    const tax = Math.round((subtotal - discount) * rate);
    const total = subtotal - discount + tax + deliveryFee;
    $('#order-totals').innerHTML = `
      <div class="ot-row"><span>Subtotal</span><span>${money(subtotal)}</span></div>
      ${discount ? `<div class="ot-row"><span>Discount</span><span>-${money(discount)}</span></div>` : ''}
      <div class="ot-row"><span>Tax</span><span>${money(tax)}</span></div>
      <div class="ot-row"><span>Delivery</span><span>${money(deliveryFee)}</span></div>
      <div class="ot-row ot-row--total"><span>Total</span><span>${money(total)}</span></div>`;
  };

  $('#oitem-add').addEventListener('click', () => { itemsWrap.insertAdjacentHTML('beforeend', orderItemRowHtml()); recalc(); });
  const cat = $('#oitem-catalogue');
  if (cat) cat.addEventListener('change', () => {
    const p = (state.products || []).find((x) => x.id === cat.value);
    if (p) { itemsWrap.insertAdjacentHTML('beforeend', orderItemRowHtml({ name: p.name, price: p.price, qty: 1 })); recalc(); }
    cat.value = '';
  });
  itemsWrap.addEventListener('click', (e) => {
    const del = e.target.closest('[data-oitem-del]');
    if (!del) return;
    if ($$('#oitems [data-oitem]').length > 1) del.closest('[data-oitem]').remove();
    else toast('An order needs at least one item', true);
    recalc();
  });
  form.addEventListener('input', recalc);
  recalc();

  const genBtn = $('#order-genlink');
  if (genBtn) genBtn.addEventListener('click', () => generatePaymentLink(v.id, genBtn));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const its = collectOrderItems();
    if (!its.length) { toast('Add at least one line item', true); return; }
    const g = (n) => (form.elements[n] ? form.elements[n].value.trim() : '');
    const address = { name: g('addr_name'), line1: g('addr_line1'), line2: g('addr_line2'), city: g('addr_city'), state: g('addr_state'), pincode: g('addr_pincode') };
    const tracking = { carrier: g('track_carrier'), number: g('track_number') };
    const payload = {
      email: g('email'),
      customerName: g('customerName'),
      items: its,
      discount: Number(form.elements.discount.value) || 0,
      deliveryFee: Number(form.elements.deliveryFee.value) || 0,
      taxRate: Number(form.elements.taxRate.value) || 0,
      status: form.elements.status.value,
      address: Object.values(address).some(Boolean) ? address : null,
      tracking: Object.values(tracking).some(Boolean) ? tracking : null,
      notes: g('notes'),
    };
    try {
      if (isEdit) { await api('PUT', `/api/admin/orders/${encodeURIComponent(v.id)}`, payload); toast('Order updated'); }
      else { await api('POST', '/api/admin/orders', payload); toast('Order created'); }
      closeModal();
      loadOrders();
    } catch (err) { toast(err.message, true); }
  });
}

async function generatePaymentLink(id, btn) {
  const original = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Working…'; }
  try {
    const res = await api('POST', `/api/admin/orders/${encodeURIComponent(id)}/payment-link`);
    const url = res.paymentLink && res.paymentLink.shortUrl;
    if (!url) { toast('Could not create a payment link', true); return; }
    let copied = false;
    try { await navigator.clipboard.writeText(url); copied = true; } catch (_) {}
    toast(copied ? 'Payment link copied to clipboard' : 'Payment link ready');
    const o = state.orders.find((x) => x.id === id);
    if (o) o.paymentLink = res.paymentLink;
    const box = $('#order-paylink');
    if (box) {
      box.querySelector('.order-paylink__has')?.remove();
      box.insertAdjacentHTML('afterbegin', `<p class="order-paylink__has">Payment link: <a href="${escapeAttr(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a></p>`);
      const b = box.querySelector('#order-genlink');
      if (b) b.textContent = 'Copy payment link';
    }
    renderOrders();
  } catch (e) {
    toast(e.message, true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = original; }
  }
}

async function confirmDeleteOrder(id) {
  if (!confirm(`Delete order ${id}? This can't be undone.`)) return;
  try {
    await api('DELETE', `/api/admin/orders/${encodeURIComponent(id)}`);
    toast('Order deleted');
    loadOrders();
  } catch (e) {
    toast(e.message, true);
  }
}

// ---------- Admins ----------

async function loadAdmins() {
  try {
    state.admins = await api('GET', '/api/admin/admins');
    renderAdmins();
  } catch (e) {
    toast(e.message, true);
  }
}

function renderAdmins() {
  const wrap = $('#admins-list');
  if (!wrap) return;
  if (!state.admins.length) {
    wrap.innerHTML = emptyState('No admins yet.');
    return;
  }
  wrap.innerHTML = state.admins.map((a) => {
    const isSelf = a.email === state.email;
    const meta = [
      a.createdBy ? `added by ${escapeHtml(a.createdBy)}` : '',
      a.createdAt ? new Date(a.createdAt).toLocaleDateString() : '',
    ].filter(Boolean).join(' · ');
    return `
      <div class="admin-row">
        <div>
          <p class="admin-row__email">${escapeHtml(a.email)}${isSelf ? ' <span class="admin-row__you">you</span>' : ''}</p>
          ${meta ? `<p class="admin-row__meta">${meta}</p>` : ''}
        </div>
        <button class="btn btn--ghost btn--sm" data-del-admin="${escapeAttr(a.email)}"${isSelf ? ' disabled' : ''}>Remove</button>
      </div>`;
  }).join('');
}

$('#admins-list').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-del-admin]');
  if (btn && !btn.disabled) confirmDeleteAdmin(btn.dataset.delAdmin);
});

$('#add-admin-btn').addEventListener('click', () => {
  openModal('New admin', `
    <form id="admin-form" class="form" autocomplete="off">
      <label class="field">
        <span class="field__label">Email</span>
        <input type="email" name="email" required placeholder="name@rangmudra.com">
      </label>
      <label class="field">
        <span class="field__label">Password</span>
        <input type="password" name="password" required minlength="8" placeholder="At least 8 characters">
      </label>
      <p style="color:var(--sc-l3);font-size:13px;margin:0;">The new admin signs in with this email and password. Share the credentials securely.</p>
      <div class="form-actions">
        <button type="button" class="btn btn--ghost" data-modal-close>Cancel</button>
        <button type="submit" class="btn btn--primary">Create admin</button>
      </div>
    </form>
  `);
  $('#admin-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = {
      email: (fd.get('email') || '').toString().trim(),
      password: (fd.get('password') || '').toString(),
    };
    try {
      await api('POST', '/api/admin/admins', payload);
      closeModal();
      toast('Admin added');
      loadAdmins();
    } catch (err) {
      toast(err.message, true);
    }
  });
});

async function confirmDeleteAdmin(email) {
  if (!confirm(`Remove admin ${email}? They will no longer be able to sign in.`)) return;
  try {
    await api('DELETE', `/api/admin/admins/${encodeURIComponent(email)}`);
    toast('Admin removed');
    loadAdmins();
  } catch (e) {
    toast(e.message, true);
  }
}

// ---------- Modal ----------

function openModal(title, bodyHtml) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = bodyHtml;
  $('#modal-backdrop').hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeModal() {
  $('#modal-backdrop').hidden = true;
  $('#modal-body').innerHTML = '';
  document.body.style.overflow = '';
}
$('#modal-close').addEventListener('click', closeModal);
// Deliberately NO click-outside-to-close here. The edit modal holds a
// half-filled form, and dismissing it on a stray backdrop click loses the work
// silently. It closes only via the X button or an explicit Cancel
// ([data-modal-close]) — the latter is delegated through the backdrop, which is
// why this listener still exists.
$('#modal-backdrop').addEventListener('click', (e) => {
  if (e.target.closest('[data-modal-close]')) closeModal();
});

// Escape closes the gallery picker, which is a transient chooser with nothing
// to lose. The edit modal and the crop tool hold unsaved work, so they are
// dismissed only by an explicit button.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('#picker-backdrop').hidden) closePicker();
});

// ---------- Toast ----------

let toastTimer;
function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('toast--error', !!isError);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2800);
}

// ---------- Utils ----------

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
// A gallery record is a video when flagged `type:'video'` or (for older records
// predating that field) when its url has a known video extension.
function isVideoItem(g) {
  return (g && g.type === 'video') || /\.(mp4|webm|mov|ogg|ogv|mkv)$/i.test((g && g.url) || '');
}
function splitCSV(s) {
  return (s || '').toString().split(',').map((x) => x.trim()).filter(Boolean);
}
function emptyState(msg) {
  return `<p style="color:var(--sc-l3);grid-column:1/-1;text-align:center;padding:80px 24px;">${msg}</p>`;
}

// ---------- Boot ----------

if (state.token) {
  // verify session is still valid
  api('GET', '/api/admin/ping')
    .then((data) => {
      state.email = (data && data.email) || '';
      if (data && data.maxUploadMB) state.maxUploadMB = data.maxUploadMB;
      showApp();
    })
    .catch(showLogin);
} else {
  showLogin();
}
