// Rangmudra admin SPA — vanilla ES6 module.

const TOKEN_KEY = 'rangmudra_admin_token';
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const state = {
  token: localStorage.getItem(TOKEN_KEY) || '',
  tab: 'products',
  products: [],
  workshops: [],
  blogs: [],
  sections: null,
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
  const res = await fetch(path, { method, headers, body: payload });
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
  loadAll();
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const passcode = $('#login-passcode').value;
  const err = $('#login-error');
  err.hidden = true;
  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    state.token = data.token;
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
      fetch('/api/products').then((r) => r.json()),
      fetch('/api/workshops').then((r) => r.json()),
      fetch('/api/blogs').then((r) => r.json()),
      fetch('/api/sections').then((r) => r.json()),
    ]);
    state.products = products;
    state.workshops = workshops;
    state.blogs = blogs;
    state.sections = sections;
    renderProducts();
    renderWorkshops();
    renderBlogs();
    renderSections();
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

async function uploadFile(file) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await api('POST', '/api/admin/upload', fd, true);
  return res.url;
}

function wireUpload(rootSel) {
  const root = $(rootSel);
  if (!root) return;
  const trigger = $('[data-upload-trigger]', root);
  const clear = $('[data-upload-clear]', root);
  const fileInput = $('.upload__input', root);
  const preview = $('.upload__preview', root);
  const hidden = $('input[type="hidden"]', root);

  trigger?.addEventListener('click', () => fileInput.click());
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
      hidden.value = url;
      preview.style.backgroundImage = `url('${url}')`;
      preview.textContent = '';
      toast('Image uploaded');
    } catch (err) { toast(err.message, true); }
  });
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
  api('GET', '/api/admin/ping').then(showApp).catch(showLogin);
} else {
  showLogin();
}
