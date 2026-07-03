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
  state.products.forEach((p) => {
    const card = document.createElement('div');
    card.className = 'card';
    const img = p.images && p.images[0];
    card.innerHTML = `
      <div class="card__img" ${img ? `style="background-image:url('${img}')"` : ''}>
        ${p.featured ? '<span class="card__tag">Featured</span>' : ''}
      </div>
      <div class="card__body">
        <h3 class="card__title">${escapeHtml(p.name)}</h3>
        <p class="card__meta">${escapeHtml(p.category)} · ${escapeHtml(p.printType || '')}</p>
        <p class="card__price">₹${(p.price || 0).toLocaleString('en-IN')}</p>
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

function openProductModal(product) {
  const isEdit = !!product;
  const p = product || {
    name: '', slug: '', category: "Women's Wear", tags: [], price: 0,
    sizes: ['One Size'], printType: 'Block Printed', featured: false,
    available: true, images: [], description: '', features: [],
    measurements: '', care: '',
  };
  openModal(isEdit ? `Edit ${p.name}` : 'New product', `
    <form id="product-form" class="form-grid" autocomplete="off">
      <div class="upload" data-upload="product-image">
        <div class="upload__preview" style="${p.images[0] ? `background-image:url('${p.images[0]}')` : ''}">${p.images[0] ? '' : 'No image'}</div>
        <div class="upload__btns">
          <button type="button" class="btn btn--ghost btn--sm" data-upload-trigger>Upload image</button>
          <button type="button" class="btn btn--ghost btn--sm" data-upload-pick>Choose from gallery</button>
          ${p.images[0] ? '<button type="button" class="btn btn--danger btn--sm" data-upload-clear>Clear</button>' : ''}
        </div>
        <input type="file" accept="image/*" class="upload__input">
        <input type="hidden" name="image" value="${p.images[0] || ''}">
      </div>
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

  wireUpload('[data-upload="product-image"]');

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
      // The form only edits the primary (first) image. Preserve any additional
      // gallery images on the existing product so editing doesn't collapse a
      // multi-image product down to one.
      images: (() => {
        const primary = (fd.get('image') || '').toString().trim();
        const rest = isEdit ? (product.images || []).slice(1) : [];
        return primary ? [primary, ...rest] : rest;
      })(),
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
      <div class="upload" data-upload="workshop-image">
        <div class="upload__preview" style="${w.image ? `background-image:url('${w.image}')` : ''}">${w.image ? '' : 'No image'}</div>
        <div class="upload__btns">
          <button type="button" class="btn btn--ghost btn--sm" data-upload-trigger>Upload image</button>
          <button type="button" class="btn btn--ghost btn--sm" data-upload-pick>Choose from gallery</button>
          ${w.image ? '<button type="button" class="btn btn--danger btn--sm" data-upload-clear>Clear</button>' : ''}
        </div>
        <input type="file" accept="image/*" class="upload__input">
        <input type="hidden" name="image" value="${w.image || ''}">
      </div>
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
      <div class="form-actions">
        <button type="button" class="btn btn--ghost" data-modal-close>Cancel</button>
        <button type="submit" class="btn btn--primary">${isEdit ? 'Save changes' : 'Create workshop'}</button>
      </div>
    </form>
  `);

  wireUpload('[data-upload="workshop-image"]');

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
      image: fd.get('image'),
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
        const url = state.sections[pageKey][slotKey] || '';
        return `
          <div class="slot">
            <div class="slot__preview" style="${url ? `background-image:url('${url}')` : ''}"></div>
            <div class="slot__body">
              <p class="slot__name">${slotLabel}</p>
              <p class="slot__path">${url || '(not set)'}</p>
            </div>
            <div class="slot__actions">
              <button class="btn btn--gold btn--sm btn--block" data-action="replace-section" data-page="${pageKey}" data-slot="${slotKey}">Replace image</button>
              <button class="btn btn--ghost btn--sm btn--block" data-action="pick-section" data-page="${pageKey}" data-slot="${slotKey}">Choose from gallery</button>
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

$('#sections-list').addEventListener('click', async (e) => {
  const pickBtn = e.target.closest('[data-action="pick-section"]');
  if (pickBtn) {
    const { page, slot } = pickBtn.dataset;
    openGalleryPicker({ onSelect: async (item) => {
      try {
        await api('PUT', `/api/admin/sections/${page}/${slot}`, { url: item.url });
        toast('Section image updated');
        loadAll();
      } catch (err) { toast(err.message, true); }
    } });
    return;
  }
  const btn = e.target.closest('[data-action="replace-section"]');
  if (!btn) return;
  const { page, slot } = btn.dataset;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      const url = await uploadFile(file);
      await api('PUT', `/api/admin/sections/${page}/${slot}`, { url });
      toast('Section image updated');
      loadAll();
    } catch (err) { toast(err.message, true); }
  };
  input.click();
});

// ---------- Upload helper ----------

// Upload bytes only. Every upload auto-registers into the gallery library on the
// backend; here we just need the returned URL for the field being edited.
async function uploadFile(file) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await api('POST', '/api/admin/upload', fd, true);
  return res.url;
}

// Upload with metadata (used by the Gallery tab's own upload form). Returns the
// full { url, id, item } response so the caller gets the created library record.
async function uploadImage(file, meta = {}) {
  const fd = new FormData();
  fd.append('file', file);
  Object.entries(meta).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') fd.append(k, v);
  });
  return api('POST', '/api/admin/upload', fd, true);
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
      ? 'No images match your search.'
      : 'No images yet. Click <strong>+ Upload image</strong> to add one to the library.');
    return;
  }
  grid.innerHTML = items.map((g) => `
    <div class="card">
      <div class="card__img" style="${g.url ? `background-image:url('${escapeAttr(g.url)}')` : ''}">
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
  openModal(isEdit ? `Edit — ${g.title}` : 'Upload image', `
    <form id="gallery-form" class="form-grid" autocomplete="off">
      ${isEdit ? `
        <div class="upload">
          <div class="upload__preview" style="background-image:url('${escapeAttr(g.url)}')"></div>
        </div>
      ` : `
        <label class="field">
          <span class="field__label">Image file</span>
          <input type="file" accept="image/*" name="file" id="gallery-file" required>
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
        toast('Image uploaded to library');
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
    <div class="picker-item" style="background-image:url('${escapeAttr(g.url)}')" data-pick="${g.id}" title="${escapeAttr(g.title)}">
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
$('#modal-backdrop').addEventListener('click', (e) => {
  if (e.target === $('#modal-backdrop')) closeModal();
  if (e.target.matches('[data-modal-close]')) closeModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#modal-backdrop').hidden) closeModal();
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
    .then((data) => { state.email = (data && data.email) || ''; showApp(); })
    .catch(showLogin);
} else {
  showLogin();
}
