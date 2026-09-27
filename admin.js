// Rangmudra admin SPA — vanilla ES6 module.

const TOKEN_KEY = 'rangmudra_admin_token';
// Origin of the backend API (set in config.js). Empty = same origin as this page.
const API_BASE = ((typeof window !== 'undefined' && window.RANGMUDRA_API_BASE) || '').replace(/\/$/, '');
const apiUrl = (path) => API_BASE + path;
// Store-wide fallback tax rate, mirrored from DEFAULT_TAX_PERCENT in
// backend/server.js. Products with no rate of their own are charged this.
const DEFAULT_TAX_PERCENT = 8;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const state = {
  token: localStorage.getItem(TOKEN_KEY) || '',
  email: '',
  tab: 'pages',
  // Which website page the "Website page design" group is showing.
  page: 'homepage',
  content: null,
  shippingConfig: null,
  testimonials: null,
  faqs: null,
  products: [],
  workshops: [],
  blogs: [],
  sections: null,
  admins: [],
  discounts: [],
  orders: [],
  orderStatusFilter: 'all',
  enquiries: [],
  enquirySearch: '',
  enquiryTypeFilter: 'all',
  enquiryStatusFilter: 'all',
  gallery: [],
  gallerySearch: '',
  workshopCategoryFilter: 'all',
  productSearch: '',
  productCategoryFilter: 'all',
  productPrintFilter: 'all',
  // Server-side upload ceiling, refreshed from /api/admin/ping so the client can
  // reject an oversized file before spending minutes sending it.
  maxUploadMB: 100,
  // Whether the server can hand out presigned S3 PUTs (also from /ping). When
  // true, files go browser → S3 directly; the first CORS/network failure flips
  // this off for the session and everything falls back to the proxied POST.
  directUpload: false,
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
  if (!res.ok) {
    // A 413 with no JSON body never reached the app: the web server in front of
    // it (nginx) refused the upload for size before our own limit applied. Say
    // so, rather than a bare "HTTP 413" that reads like a broken upload.
    if (res.status === 413 && !data.error) {
      throw new Error('This file is larger than the web server currently accepts. '
        + 'Try a smaller or compressed file, or ask your developer to raise the server upload limit.');
    }
    throw new Error(data.error || `HTTP ${res.status}`);
  }
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
    // Pick up the upload limits/capabilities the boot path gets from /ping.
    api('GET', '/api/admin/ping').then((p) => {
      if (p && p.maxUploadMB) state.maxUploadMB = p.maxUploadMB;
      state.directUpload = !!(p && p.directUpload);
    }).catch(() => {});
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

// Show a panel. `page` is only meaningful for the shared "pages" panel, whose
// content depends on which website page the sidebar entry pointed at.
function showTab(tab, page) {
  const go = () => {
    state.tab = tab;
    if (page) state.page = page;
    $$('.admin-tab').forEach((b) => {
      const active = b.dataset.tab === tab
        && (b.dataset.tab !== 'pages' || b.dataset.page === state.page);
      b.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    $$('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== tab; });
    if (tab === 'pages') renderPage();
    if (tab === 'shipping') renderShipping();
    if (tab === 'process') renderProcessMedia();
  };
  // Leaving an open editor runs the unsaved-changes guard first; the switch
  // only happens once it actually closes.
  if (editorIsOpen()) closeEditor({ then: go });
  else go();
}

$$('.admin-tab').forEach((btn) => {
  btn.addEventListener('click', () => showTab(btn.dataset.tab, btn.dataset.page));
});

// "← Back to page design" on the record panels, which are reached from a page
// rather than from the sidebar.
$$('[data-goto-page]').forEach((btn) => {
  btn.addEventListener('click', () => showTab('pages', btn.dataset.gotoPage));
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
    loadEnquiries();
    loadGallery();
    loadContent();
    loadShipping();
    loadProcessMedia();
    loadTestimonials();
    loadFaqs();
  } catch (e) {
    toast(e.message, true);
  }
}

// ---------- Website page design ----------

// One entry per item in the sidebar's "Website page design" group, in the same
// order as the public site's navigation.
//
//   content  — key in /api/content whose fields this page edits
//   sections — key in SECTION_LABELS whose image slots this page owns
//   only     — narrow the slots/fields to a subset of a page (contentOnly /
//              sectionsOnly)
//   records  — an existing panel this page's list content lives in
//   patrons / faqs — show the shared patron list / the FAQ list manager
const PAGES = {
  homepage: {
    title: 'Home', url: '/index.html', content: 'homepage', sections: 'homepage',
    patrons: true,
    subtitle: 'The landing page — hero, introduction, promos, patron testimonials, gallery teaser and Quick Reads.',
  },
  shop: {
    title: 'Shop', url: '/shop.html', content: 'shop', sections: 'shop',
    records: { tab: 'products', label: 'Manage products' },
    subtitle: 'The Collection page. Individual products live under Admin features → Products.',
  },
  workshops: {
    title: 'Workshops', url: '/workshops.html', content: 'workshops', sections: 'workshops',
    records: { tab: 'workshops', label: 'Manage workshops' },
    // The Corporate page is no longer in the site menu; it is reached from its
    // category card here, so its copy and banner live with the other two.
    subtitle: 'The workshops landing page and the three category pages (Experience, Corporate, Curated) opened from its category cards.',
  },
  gallery: {
    title: 'Gallery', url: '/gallery.html', content: 'gallery', sections: 'gallery',
    records: { tab: 'gallery', label: 'Manage the media library' },
    subtitle: 'The design gallery. Images shown here are the library entries marked Public.',
  },
  blogs: {
    title: 'Blogs', url: '/blogs.html', content: 'blogs', sections: 'blogs',
    records: { tab: 'blogs', label: 'Manage blog posts' },
    subtitle: 'The Blogs landing page. Posts also feed the Quick Reads strip on the home page.',
  },
  about: {
    title: 'About Us', url: '/about.html', content: 'about', sections: 'about',
    // The same shared list as the home page — edited in either place, shown in
    // both, so the two bands can never fall out of sync.
    patrons: true,
    faqs: true,
    subtitle: 'Our story, sustainability, the team, the patron testimonials, and the FAQ.',
  },
  enquire: {
    title: 'Enquire', url: '/enquire.html', content: 'enquire', sections: 'enquire',
    subtitle: 'Connect With Us — the craft carousel, contact cards and enquiry form.',
  },
  footer: {
    title: 'Footer', url: '/index.html#footer', content: 'footer',
    subtitle: 'The footer on every page, plus the WhatsApp button and the bottom strip.',
  },
  // The three pages linked from the footer's bottom strip.
  privacy: {
    title: 'Privacy Policy', url: '/privacy.html', content: 'privacy', richText: true,
    subtitle: 'Linked from the footer on every page.',
  },
  terms: {
    title: 'Terms of Service', url: '/terms.html', content: 'terms', richText: true,
    subtitle: 'Linked from the footer on every page.',
  },
  'shipping-policy': {
    title: 'Shipping Policy', url: '/shipping.html', content: 'shipping', richText: true,
    subtitle: 'Linked from the footer on every page. Delivery prices themselves are set under Admin features → Shipping.',
  },
};

// Shown above the page-text form on pages whose long copy is formatted.
const RICH_TEXT_HINT = 'Formatting: start a line with <code>## </code> for a section heading and <code>- </code> for a bullet; leave a blank line between paragraphs. '
  + 'Inside a paragraph, <code>**bold**</code>, <code>*italic*</code> and <code>[link text](https://…)</code> work, and email addresses and web links become clickable on their own.';

// Friendly names for the copy fields. Anything missing falls back to the key
// itself with dashes turned into spaces, so a new field is still editable the
// moment it is added to content.json.
const CONTENT_LABELS = {
  'intro-heading': 'Introduction heading',
  'intro-body-1': 'Introduction paragraph 1',
  'intro-body-2': 'Introduction paragraph 2',
  'workshops-promo-cta': 'Workshops promo — button',
  'workshops-promo-meta': 'Workshops promo — caption',
  'shop-promo-cta': 'Shop promo — button',
  'shop-promo-meta': 'Shop promo — caption',
  'testimonials-heading': 'Testimonials heading (one line per line break)',
  'gallery-heading': 'Gallery teaser — heading',
  'gallery-body': 'Gallery teaser — paragraph',
  'gallery-cta': 'Gallery teaser — button',
  'reads-heading': 'Quick Reads heading',
  'reads-link': 'Quick Reads — view-all link',
  'hero-tagline': 'Hero strapline (under the wordmark)',
  'hero-eyebrow': 'Hero eyebrow',
  'hero-title': 'Hero heading',
  'hero-subtitle': 'Hero paragraph',
  'toolbar-label': 'Toolbar label',
  'experience-eyebrow': 'Experience — eyebrow',
  'experience-title': 'Experience — heading',
  'experience-desc': 'Experience — description',
  'corporate-eyebrow': 'Corporate — eyebrow',
  'corporate-title': 'Corporate — heading',
  'corporate-desc': 'Corporate — description',
  'curated-eyebrow': 'Curated — eyebrow',
  'curated-title': 'Curated — heading',
  'curated-desc': 'Curated — description',
  'enquire-panel-title': 'Enquiry panel heading',
  'story-eyebrow': 'Our Story — eyebrow',
  'story-heading': 'Our Story — heading',
  'story-body-1': 'Our Story — paragraph 1',
  'story-body-2': 'Our Story — paragraph 2',
  'story-body-3': 'Our Story — paragraph 3',
  'sustainability-heading': 'Sustainability — heading',
  'sustainability-body-1': 'Sustainability — paragraph 1',
  'sustainability-body-2': 'Sustainability — paragraph 2',
  'sustainability-body-3': 'Sustainability — paragraph 3',
  'team-eyebrow': 'Our Team — eyebrow',
  'team-heading': 'Our Team — heading',
  'team-body-1': 'Our Team — paragraph 1',
  'team-body-2': 'Our Team — paragraph 2',
  'faq-heading': 'FAQ heading',
  'featured-eyebrow': 'Featured label',
  'recent-eyebrow': 'Recent posts label',
  'empty-text': 'Empty-results message',
  'scroll-label': 'Scroll hint',
  'craft-eyebrow': 'Craft carousel — eyebrow',
  'craft-heading': 'Craft carousel — heading',
  'craft-subtitle': 'Craft carousel — intro line',
  'form-eyebrow': 'Form — eyebrow',
  'form-heading': 'Form — heading',
  'form-subtitle': 'Form — paragraph',
  'card-visit-title': 'Visit card — title',
  'card-visit-line-1': 'Visit card — line 1',
  'card-visit-line-2': 'Visit card — line 2',
  'card-call-title': 'Call card — title',
  'card-call-line-1': 'Call card — line 1',
  'card-call-line-2': 'Call card — line 2',
  'card-email-title': 'Email card — title',
  'card-email-line-1': 'Email card — line 1',
  'card-email-line-2': 'Email card — line 2',
  tagline: 'Strapline (under the wordmark)',
  'instagram-url': 'Instagram link',
  'facebook-url': 'Facebook link',
  'youtube-url': 'YouTube link',
  'x-url': 'X (Twitter) link',
  'col-1-title': 'Column 1 heading',
  'col-2-title': 'Column 2 heading',
  'col-3-title': 'Column 3 heading',
  address: 'Studio address (one line per line break)',
  phone: 'Phone number',
  'phone-note': 'Phone — note below',
  email: 'Email address',
  'email-note': 'Email — note below',
  'whatsapp-link': 'WhatsApp button link (wa.me/…)',
  'newsletter-title': 'Newsletter heading',
  'newsletter-placeholder': 'Newsletter input placeholder',
  copyright: 'Copyright line',
  title: 'Page title',
  body: 'Page text',
};

function contentLabel(key) {
  return CONTENT_LABELS[key] || key.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

// Long copy gets a textarea, one-liners an input. 60 characters is roughly
// where a heading stops being a heading.
function isLongCopy(value) {
  return String(value || '').length > 60 || String(value || '').includes('\n');
}

// A paragraph gets a few rows; a whole policy page gets room to be read.
function textareaRows(value) {
  const text = String(value || '');
  const lines = text.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 90)), 0);
  const cap = text.length > 1500 ? 28 : 8;
  return Math.min(cap, Math.max(3, lines));
}

async function loadContent() {
  state.content = await api('GET', '/api/content');
  if (state.tab === 'pages') renderPage();
}

function renderPage() {
  const cfg = PAGES[state.page] || PAGES.homepage;
  const titleEl = $('#page-title');
  const subEl = $('#page-subtitle');
  const linkEl = $('#page-view-link');
  const body = $('#page-body');
  if (!body) return;

  titleEl.textContent = cfg.title;
  subEl.textContent = cfg.subtitle || '';
  linkEl.href = cfg.url;

  const fields = (state.content && state.content[cfg.content]) || null;
  const keys = fields
    ? Object.keys(fields).filter((k) => !cfg.contentOnly || cfg.contentOnly.includes(k))
    : [];

  const textCard = !state.content
    ? '<div class="page-card"><p class="slot__meta">Loading page text…</p></div>'
    : `
    <div class="page-card">
      <div class="page-card__head">
        <h3 class="page-card__title">Text &amp; headings</h3>
        <p class="page-card__hint">Edit any wording on this page. Changes go live as soon as you save — no redeploy.</p>
        ${cfg.richText ? `<p class="page-card__hint">${RICH_TEXT_HINT}</p>` : ''}
      </div>
      ${keys.length ? `
      <form id="page-content-form" class="page-fields" autocomplete="off">
        ${keys.map((k) => {
          const v = fields[k] ?? '';
          const id = `content-${cfg.content}-${k}`;
          // A whole document (the policy pages) gets the full width to read in.
          const wide = String(v).length > 1500 ? ' field--wide' : '';
          return `
            <label class="field${wide}">
              <span class="field__label">${escapeHtml(contentLabel(k))}</span>
              ${isLongCopy(v)
                ? `<textarea id="${id}" name="${escapeHtml(k)}" rows="${textareaRows(v)}">${escapeHtml(v)}</textarea>`
                : `<input type="text" id="${id}" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`}
            </label>`;
        }).join('')}
        <div class="form-actions">
          <button type="button" class="btn btn--ghost" id="page-content-reset">Undo changes</button>
          <button type="submit" class="btn btn--primary">Save text</button>
        </div>
      </form>` : '<p class="slot__meta">This page has no editable text yet.</p>'}
    </div>`;

  const slots = cfg.sections ? sectionSlotsHTML(cfg.sections, cfg.sectionsOnly) : '';
  const imagesCard = slots ? `
    <div class="page-card">
      <div class="page-card__head">
        <h3 class="page-card__title">Images &amp; video</h3>
        <p class="page-card__hint">Every picture on this page. Upload a new one, pick one from the media library, or adjust how it is cropped.</p>
      </div>
      <div class="section-slots">${slots}</div>
    </div>` : '';

  const recordsCard = cfg.records ? `
    <div class="page-card page-card--link">
      <div>
        <h3 class="page-card__title">${escapeHtml(cfg.records.label)}</h3>
        <p class="page-card__hint">The individual entries this page lists.</p>
      </div>
      <button class="btn btn--primary" data-goto-tab="${cfg.records.tab}">${escapeHtml(cfg.records.label)} →</button>
    </div>` : '';

  const patronsCard = cfg.patrons ? testimonialsCardHTML() : '';
  const faqsCard = cfg.faqs ? faqsCardHTML() : '';

  body.innerHTML = textCard + patronsCard + faqsCard + imagesCard + recordsCard;

  if (cfg.patrons) wirePatronCard(body);
  if (cfg.faqs) wireFaqCard(body);

  const form = $('#page-content-form');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {};
      keys.forEach((k) => {
        const el = form.elements[k];
        if (el) payload[k] = el.value;
      });
      try {
        const res = await api('PUT', `/api/admin/content/${encodeURIComponent(cfg.content)}`, { fields: payload });
        state.content[cfg.content] = res.fields;
        toast('Page text saved');
      } catch (err) {
        toast(err.message, true);
      }
    });
    $('#page-content-reset').addEventListener('click', renderPage);
  }

  body.querySelectorAll('[data-goto-tab]').forEach((btn) => {
    btn.addEventListener('click', () => showTab(btn.dataset.gotoTab));
  });
}

// ---------- FAQ (About page) ----------
//
// The About page's question list. Same pattern as the patron list below: one
// row per entry with reorder / edit / delete, and a modal editor.

async function loadFaqs() {
  state.faqs = await api('GET', '/api/admin/faqs');
  if (state.tab === 'pages') renderPage();
}

function faqsCardHTML() {
  const list = state.faqs;
  if (!list) return '<div class="page-card"><p class="slot__meta">Loading questions…</p></div>';
  const rows = list.length ? list.map((f, i) => `
      <div class="patron-row${f.published === false ? ' patron-row--hidden' : ''}">
        <div class="patron-row__body">
          <p class="patron-row__quote"><strong>${escapeHtml(f.question || '')}</strong></p>
          <p class="patron-row__meta">${escapeHtml(String(f.answer || '').slice(0, 200))}${String(f.answer || '').length > 200 ? '…' : ''}${f.published === false ? ' · <strong>hidden</strong>' : ''}</p>
        </div>
        <div class="patron-row__actions">
          <div class="patron-row__move">
            <button class="btn btn--ghost btn--sm" data-faq-move="up" data-id="${escapeAttr(f.id)}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
            <button class="btn btn--ghost btn--sm" data-faq-move="down" data-id="${escapeAttr(f.id)}" ${i === list.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
          </div>
          <button class="btn btn--ghost btn--sm" data-faq-edit="${escapeAttr(f.id)}">Edit</button>
          <button class="btn btn--danger btn--sm" data-faq-delete="${escapeAttr(f.id)}">Delete</button>
        </div>
      </div>`).join('') : '<p class="slot__meta">No questions yet. Add the first one.</p>';

  return `
    <div class="page-card">
      <div class="page-card__head page-card__head--row">
        <div>
          <h3 class="page-card__title">Frequently asked questions</h3>
          <p class="page-card__hint">The FAQ at the bottom of About Us, in this order. Hide a question to take it off the site without deleting it. The section heading is under Text &amp; headings above.</p>
        </div>
        <button class="btn btn--primary" data-faq-new>+ Add question</button>
      </div>
      <div class="patron-list">${rows}</div>
    </div>`;
}

function wireFaqCard(root) {
  root.querySelector('[data-faq-new]')?.addEventListener('click', () => openFaqEditor(null));
  root.querySelectorAll('[data-faq-edit]').forEach((b) => b.addEventListener('click', () =>
    openFaqEditor(state.faqs.find((f) => f.id === b.dataset.faqEdit))));
  root.querySelectorAll('[data-faq-delete]').forEach((b) => b.addEventListener('click', async () => {
    const f = state.faqs.find((x) => x.id === b.dataset.faqDelete);
    if (!confirm(`Delete the question "${f?.question || ''}"?`)) return;
    try {
      await api('DELETE', `/api/admin/faqs/${encodeURIComponent(b.dataset.faqDelete)}`);
      toast('Question deleted');
      await loadFaqs();
    } catch (e) { toast(e.message, true); }
  }));
  root.querySelectorAll('[data-faq-move]').forEach((b) => b.addEventListener('click', async () => {
    const ids = state.faqs.map((f) => f.id);
    const i = ids.indexOf(b.dataset.id);
    const j = b.dataset.faqMove === 'up' ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    try {
      await api('PUT', '/api/admin/faqs-order', { ids });
      await loadFaqs();
    } catch (e) { toast(e.message, true); }
  }));
}

function openFaqEditor(faq) {
  const isEdit = !!faq;
  const f = faq || { question: '', answer: '', published: true };
  openEditor(isEdit ? 'Edit question' : 'Add question', `
    <form id="faq-form" class="form-grid" autocomplete="off">
      <label class="field">
        <span class="field__label">Question</span>
        <input name="question" required maxlength="300" value="${escapeAttr(f.question || '')}" placeholder="e.g. Do I need any prior experience?">
      </label>
      <label class="field">
        <span class="field__label">Answer</span>
        <textarea name="answer" required rows="6" maxlength="3000">${escapeHtml(f.answer || '')}</textarea>
      </label>
      <div class="checkbox-row">
        <input type="checkbox" id="faq-published" name="published" ${f.published === false ? '' : 'checked'}>
        <label for="faq-published">Show on the site</label>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn btn--primary">${isEdit ? 'Save changes' : 'Add question'}</button>
      </div>
    </form>
  `);

  $('#faq-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload = {
      question: fd.get('question'),
      answer: fd.get('answer'),
      published: fd.get('published') === 'on',
    };
    try {
      if (isEdit) {
        await api('PUT', `/api/admin/faqs/${encodeURIComponent(f.id)}`, payload);
        toast('Question updated');
      } else {
        await api('POST', '/api/admin/faqs', payload);
        toast('Question added');
      }
      closeEditor({ force: true });
      await loadFaqs();
    } catch (err) {
      toast(err.message, true);
    }
  });
}

// ---------- Patron testimonials ----------
//
// One shared list behind every "What our patrons say" band. It is edited from
// the Home page tab because that is where the section lives, and the About page
// renders the same list — add a patron once and it appears in both.

async function loadTestimonials() {
  state.testimonials = await api('GET', '/api/admin/testimonials');
  if (state.tab === 'pages') renderPage();
}

// The card list that sits on the Home and About page tabs.
function testimonialsCardHTML() {
  const list = state.testimonials;
  if (!list) return '<div class="page-card"><p class="slot__meta">Loading patrons…</p></div>';
  const rows = list.length ? list.map((t, i) => {
    const m = normalizeMedia((t.media && t.media[0]) || t.image);
    return `
      <div class="patron-row${t.published === false ? ' patron-row--hidden' : ''}">
        <div class="patron-row__thumb">${m ? mediaThumbHTML(m, 'patron-row__media') : '<span class="slot__empty">No photo</span>'}</div>
        <div class="patron-row__body">
          <p class="patron-row__quote">${escapeHtml(String(t.quote || '').slice(0, 180))}${String(t.quote || '').length > 180 ? '…' : ''}</p>
          <p class="patron-row__meta">
            ${escapeHtml([t.author, t.location].filter(Boolean).join(', ')) || 'Unnamed'}
            · ${'★'.repeat(Math.max(0, Math.min(5, Number(t.rating) || 0))) || 'no rating'}
            ${t.published === false ? ' · <strong>hidden</strong>' : ''}
          </p>
        </div>
        <div class="patron-row__actions">
          <div class="patron-row__move">
            <button class="btn btn--ghost btn--sm" data-patron-move="up" data-id="${escapeAttr(t.id)}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
            <button class="btn btn--ghost btn--sm" data-patron-move="down" data-id="${escapeAttr(t.id)}" ${i === list.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
          </div>
          <button class="btn btn--ghost btn--sm" data-patron-edit="${escapeAttr(t.id)}">Edit</button>
          <button class="btn btn--danger btn--sm" data-patron-delete="${escapeAttr(t.id)}">Delete</button>
        </div>
      </div>`;
  }).join('') : '<p class="slot__meta">No patrons yet. Add the first one.</p>';

  return `
    <div class="page-card">
      <div class="page-card__head page-card__head--row">
        <div>
          <h3 class="page-card__title">Patron testimonials</h3>
          <p class="page-card__hint">The "What our patrons say" band. This is one shared list — it appears on the home page and on About Us, so a patron added here shows up in both. Each patron can have their own photo or video, which moves with their quote as the carousel advances.</p>
        </div>
        <button class="btn btn--primary" data-patron-new>+ Add patron</button>
      </div>
      <div class="patron-list">${rows}</div>
    </div>`;
}

function wirePatronCard(root) {
  root.querySelector('[data-patron-new]')?.addEventListener('click', () => openPatronEditor(null));
  root.querySelectorAll('[data-patron-edit]').forEach((b) => b.addEventListener('click', () =>
    openPatronEditor(state.testimonials.find((t) => t.id === b.dataset.patronEdit))));
  root.querySelectorAll('[data-patron-delete]').forEach((b) => b.addEventListener('click', async () => {
    const t = state.testimonials.find((x) => x.id === b.dataset.patronDelete);
    if (!confirm(`Remove ${t?.author || 'this patron'} from the testimonials?`)) return;
    try {
      await api('DELETE', `/api/admin/testimonials/${encodeURIComponent(b.dataset.patronDelete)}`);
      toast('Patron removed');
      await loadTestimonials();
    } catch (e) { toast(e.message, true); }
  }));
  root.querySelectorAll('[data-patron-move]').forEach((b) => b.addEventListener('click', async () => {
    const ids = state.testimonials.map((t) => t.id);
    const i = ids.indexOf(b.dataset.id);
    const j = b.dataset.patronMove === 'up' ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    try {
      await api('PUT', '/api/admin/testimonials-order', { ids });
      await loadTestimonials();
    } catch (e) { toast(e.message, true); }
  }));
}

function openPatronEditor(patron) {
  const isEdit = !!patron;
  const t = patron || { quote: '', author: '', location: '', rating: 5, published: true, media: [] };
  openEditor(isEdit ? `Edit — ${t.author || 'patron'}` : 'Add patron', `
    <form id="patron-form" class="form-grid" autocomplete="off">
      <div id="patron-media"></div>
      <label class="field">
        <span class="field__label">Quote</span>
        <textarea name="quote" required rows="4" maxlength="1000">${escapeHtml(t.quote || '')}</textarea>
        <span class="field__hint">What the patron said. Quotation marks are added by the page — just type the words.</span>
      </label>
      <div class="field-row">
        <label class="field">
          <span class="field__label">Name</span>
          <input name="author" required value="${escapeAttr(t.author || '')}" placeholder="e.g. Priya M.">
        </label>
        <label class="field">
          <span class="field__label">City (optional)</span>
          <input name="location" value="${escapeAttr(t.location || '')}" placeholder="e.g. Bangalore">
        </label>
        <label class="field">
          <span class="field__label">Stars</span>
          <select name="rating">
            ${[5, 4, 3, 2, 1, 0].map((n) =>
              `<option value="${n}" ${Number(t.rating) === n ? 'selected' : ''}>${n ? '★'.repeat(n) : 'No stars'}</option>`).join('')}
          </select>
        </label>
      </div>
      <div class="checkbox-row">
        <input type="checkbox" id="patron-published" name="published" ${t.published === false ? '' : 'checked'}>
        <label for="patron-published">Show on the site</label>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn btn--primary">${isEdit ? 'Save changes' : 'Add patron'}</button>
      </div>
    </form>
  `);

  // Same media editor as products and workshops: upload or pick from the
  // library, then crop/reposition. `fit` and `position` ride along to the site,
  // so a portrait photo, a landscape still and a video all sit correctly in the
  // band's fixed frame.
  const media = mountMediaEditor($('#patron-media'), entityMedia(t, 'image'), {
    label: 'Photo or video',
    hint: 'Shown beside the quote. Use “Edit photo” to choose which part stays in frame — the band is a portrait 5:6 box.',
  });

  $('#patron-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload = {
      quote: fd.get('quote'),
      author: fd.get('author'),
      location: fd.get('location'),
      rating: Number(fd.get('rating')),
      published: fd.get('published') === 'on',
      media: media.getValue(),
    };
    try {
      if (isEdit) {
        await api('PUT', `/api/admin/testimonials/${encodeURIComponent(t.id)}`, payload);
        toast('Patron updated');
      } else {
        await api('POST', '/api/admin/testimonials', payload);
        toast('Patron added');
      }
      closeEditor({ force: true });
      await loadTestimonials();
    } catch (err) {
      toast(err.message, true);
    }
  });
}

// ---------- The Process (product page photo strip, per category) ----------

const PROCESS_CATEGORIES = ["Women's Wear", "Men's Wear", 'Home Decor', 'Accessories'];

async function loadProcessMedia() {
  try {
    state.processMedia = await api('GET', '/api/process-media');
  } catch (e) {
    state.processMedia = { error: e.message };
  }
  if (state.tab === 'process') renderProcessMedia();
}

function renderProcessMedia() {
  const body = $('#process-body');
  if (!body) return;
  const data = state.processMedia;
  if (!data) { body.innerHTML = '<p class="slot__meta">Loading…</p>'; return; }
  if (data.error) { body.innerHTML = `<p class="slot__meta">Could not load The Process photos: ${escapeHtml(data.error)}</p>`; return; }

  const categories = data.categories || {};
  const counts = (cat) => state.products.filter((p) => p.category === cat).length;
  const overrides = (cat) => state.products.filter((p) => p.category === cat && (p.processMedia || []).length).length;

  body.innerHTML = `
    <form id="process-form">
      ${PROCESS_CATEGORIES.map((cat, n) => `
        <div class="page-card">
          <div class="page-card__head">
            <h3 class="page-card__title">${escapeHtml(cat)}</h3>
            <p class="page-card__hint">${counts(cat)} product${counts(cat) === 1 ? '' : 's'}${overrides(cat) ? ` · ${overrides(cat)} with their own Process photos (set in the product)` : ''}</p>
          </div>
          <div data-process-cat="${n}"></div>
        </div>`).join('')}
      <div class="form-actions">
        <button type="button" class="btn btn--ghost" id="process-reset">Undo changes</button>
        <button type="submit" class="btn btn--primary">Save The Process photos</button>
      </div>
    </form>
  `;

  const editors = PROCESS_CATEGORIES.map((cat, n) => mountMediaEditor($(`[data-process-cat="${n}"]`, body), categories[cat] || [], {
    label: 'Photos & videos',
    hint: 'Shown left to right in "The Process" on every product page in this category — 3–4 work best. Leave empty to use the site-wide Process photos.',
    itemLabel: (i) => `Step ${i + 1}`,
  }));

  $('#process-reset').addEventListener('click', renderProcessMedia);
  $('#process-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = { categories: {} };
    PROCESS_CATEGORIES.forEach((cat, n) => { payload.categories[cat] = editors[n].getValue(); });
    try {
      state.processMedia = await api('PUT', '/api/admin/process-media', payload);
      toast('The Process photos saved');
      renderProcessMedia();
    } catch (err) {
      toast(err.message, true);
    }
  });
}

// ---------- Shipping ----------

async function loadShipping() {
  try {
    state.shippingConfig = await api('GET', '/api/admin/shipping');
    if (state.tab === 'shipping') renderShipping();
  } catch (e) {
    // Not fatal — the panel shows the error when it is opened.
    state.shippingConfig = { error: e.message };
  }
}

function renderShipping() {
  const body = $('#shipping-body');
  if (!body) return;
  const data = state.shippingConfig;
  if (!data) { body.innerHTML = '<p class="slot__meta">Loading…</p>'; return; }
  if (data.error) { body.innerHTML = `<p class="slot__meta">Could not load shipping settings: ${escapeHtml(data.error)}</p>`; return; }

  const c = data.config;
  const d = data.defaults;
  // Every category the catalogue actually uses, plus whatever is already
  // configured, so a new category is weighable the moment a product uses it.
  const cats = [...new Set([
    ...Object.keys(c.categoryWeights),
    ...state.products.map((p) => String(p.category || '').toLowerCase()).filter(Boolean),
  ])].sort();

  body.innerHTML = `
    <form id="shipping-form" class="form" autocomplete="off">
      <div class="page-card">
        <div class="page-card__head">
          <h3 class="page-card__title">Dispatch &amp; packaging</h3>
          <p class="page-card__hint">The PIN code parcels are booked from. Distance to the customer's PIN sets the Speed Post slab.</p>
        </div>
        <div class="field-row">
          <label class="field">
            <span class="field__label">Dispatch PIN code</span>
            <input name="originPincode" value="${escapeAttr(c.originPincode)}" pattern="[1-9][0-9]{5}" placeholder="${escapeAttr(d.originPincode)}">
          </label>
          <label class="field">
            <span class="field__label">Packaging weight (grams)</span>
            <input name="packagingWeightGrams" type="number" min="0" step="1" value="${c.packagingWeightGrams}">
            <span class="field__hint">Box, tissue, invoice and tape — added once per order.</span>
          </label>
          <label class="field">
            <span class="field__label">Default item weight (grams)</span>
            <input name="defaultItemWeightGrams" type="number" min="1" step="1" value="${c.defaultItemWeightGrams}">
            <span class="field__hint">Used when a product has neither its own weight nor a category weight.</span>
          </label>
        </div>
      </div>

      <div class="page-card">
        <div class="page-card__head">
          <h3 class="page-card__title">Package size</h3>
          <p class="page-card__hint">India Post bills actual weight, so this is off by default. Set a courier's volumetric divisor (commonly 5000, i.e. L×W×H cm ÷ 5000 = kg) and the heavier of actual vs volumetric weight is charged. Each product's own L×W×H is set on its product page.</p>
        </div>
        <div class="field-row">
          <label class="field">
            <span class="field__label">Volumetric divisor</span>
            <input name="volumetricDivisor" type="number" min="0" step="1" value="${c.volumetricDivisor}" placeholder="0 = off">
          </label>
          <label class="field">
            <span class="field__label">Handling fee (₹ per order)</span>
            <input name="handlingFee" type="number" min="0" step="1" value="${c.handlingFee}">
          </label>
          <label class="field">
            <span class="field__label">GST on postage (%)</span>
            <input name="gstPercent" type="number" min="0" max="100" step="0.1" value="${c.gstPercent}">
          </label>
        </div>
      </div>

      <div class="page-card">
        <div class="page-card__head">
          <h3 class="page-card__title">Weight per category</h3>
          <p class="page-card__hint">The fallback weight for a product that has no weight of its own. Grams per piece.</p>
        </div>
        <div class="field-row field-row--wrap">
          ${cats.map((cat) => `
            <label class="field">
              <span class="field__label">${escapeHtml(cat)}</span>
              <input data-cat-weight="${escapeAttr(cat)}" type="number" min="1" step="1"
                     value="${c.categoryWeights[cat] ?? ''}" placeholder="${c.defaultItemWeightGrams}">
            </label>`).join('')}
        </div>
      </div>

      <div class="form-actions">
        <button type="button" class="btn btn--ghost" id="shipping-reset">Undo changes</button>
        <button type="submit" class="btn btn--primary">Save shipping settings</button>
      </div>
    </form>

    <div class="page-card">
      <div class="page-card__head">
        <h3 class="page-card__title">Test a PIN code</h3>
        <p class="page-card__hint">Prices a real delivery with the settings currently saved — the same code the checkout uses.</p>
      </div>
      <div class="field-row">
        <label class="field">
          <span class="field__label">Destination PIN code</span>
          <input id="ship-test-pin" inputmode="numeric" maxlength="6" placeholder="e.g. 110001">
        </label>
        <label class="field">
          <span class="field__label">Parcel weight (grams)</span>
          <input id="ship-test-weight" type="number" min="1" step="1" placeholder="${c.defaultItemWeightGrams + c.packagingWeightGrams}">
        </label>
        <div class="field" style="justify-content:flex-end;">
          <button type="button" class="btn btn--gold" id="ship-test-btn">Get quote</button>
        </div>
      </div>
      <div id="ship-test-result"></div>
    </div>
  `;

  $('#shipping-reset').addEventListener('click', renderShipping);

  $('#shipping-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const num = (name) => Number(form.elements[name].value);
    const categoryWeights = {};
    form.querySelectorAll('[data-cat-weight]').forEach((input) => {
      const v = Number(input.value);
      if (v > 0) categoryWeights[input.dataset.catWeight] = v;
    });
    const patch = {
      originPincode: form.elements.originPincode.value.trim(),
      packagingWeightGrams: num('packagingWeightGrams'),
      defaultItemWeightGrams: num('defaultItemWeightGrams'),
      volumetricDivisor: num('volumetricDivisor'),
      handlingFee: num('handlingFee'),
      gstPercent: num('gstPercent'),
      categoryWeights,
    };
    try {
      const res = await api('PUT', '/api/admin/shipping', patch);
      state.shippingConfig = { ...state.shippingConfig, config: res.config };
      toast('Shipping settings saved');
      renderShipping();
    } catch (err) {
      toast(err.message, true);
    }
  });

  const runQuote = async () => {
    const out = $('#ship-test-result');
    const pin = $('#ship-test-pin').value.trim();
    const weight = $('#ship-test-weight').value.trim();
    out.innerHTML = '<p class="slot__meta">Checking…</p>';
    try {
      const qs = new URLSearchParams({ pincode: pin });
      if (weight) qs.set('weight', weight);
      const res = await fetch(apiUrl(`/api/shipping/quote?${qs}`));
      const q = await res.json();
      if (!res.ok) throw new Error(q.error || 'Could not price that PIN code');
      out.innerHTML = `
        <table class="ship-quote">
          <tr><th>Destination</th><td>${escapeHtml([q.office, q.district, q.state].filter(Boolean).join(', ')) || q.pincode}</td></tr>
          <tr><th>From</th><td>${escapeHtml(q.origin)}</td></tr>
          <tr><th>Zone</th><td>${escapeHtml(q.zoneLabel)}${q.distanceKm ? ` · ~${q.distanceKm} km` : ''}</td></tr>
          <tr><th>Billed weight</th><td>${q.weightGrams} g</td></tr>
          <tr><th>Postage</th><td>₹${q.postage}</td></tr>
          <tr><th>GST (${q.gstPercent}%)</th><td>₹${q.gst}</td></tr>
          <tr class="ship-quote__total"><th>Delivery fee</th><td>₹${q.deliveryFee}</td></tr>
        </table>
        ${q.deliverable === false ? '<p class="slot__meta">India Post lists this PIN as non-delivery.</p>' : ''}`;
    } catch (err) {
      out.innerHTML = `<p class="slot__meta">${escapeHtml(err.message)}</p>`;
    }
  };
  $('#ship-test-btn').addEventListener('click', runQuote);
  $('#ship-test-pin').addEventListener('keydown', (e) => { if (e.key === 'Enter') runQuote(); });
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
    // Only worth showing when it differs from the store default.
    const taxLabel = (p.taxPercent !== null && p.taxPercent !== undefined && Number(p.taxPercent) !== DEFAULT_TAX_PERCENT)
      ? `${+Number(p.taxPercent).toFixed(2)}% tax` : '';
    const priceHtml = disc
      ? `<span class="card__price-was">₹${price.toLocaleString('en-IN')}</span> ₹${now.toLocaleString('en-IN')}`
      : `₹${price.toLocaleString('en-IN')}`;
    card.innerHTML = `
      <div class="card__img card__img--fit card__img--product">
        ${img ? `<img class="card__media" src="${escapeAttr(img)}" alt="">` : '<span class="card__img-empty">No photo</span>'}
        ${p.featured ? '<span class="card__tag">Featured</span>' : ''}
        ${disc ? `<span class="card__tag card__tag--sale">${discLabel}</span>` : ''}
        ${p.available === false ? '<span class="card__tag card__tag--soldout">Sold out</span>' : ''}
      </div>
      <div class="card__body">
        <h3 class="card__title">${escapeHtml(p.name)}</h3>
        <p class="card__meta">${escapeHtml(p.category)} · ${escapeHtml(p.printType || '')}${taxLabel ? ` · ${taxLabel}` : ''}</p>
        ${p.available === false ? `<p class="card__meta card__meta--soldout">Out of stock${p.soldOutAt ? ` · sold ${new Date(p.soldOutAt).toLocaleDateString('en-IN')}` : ''}${p.soldOutOrderId ? ` · ${escapeHtml(p.soldOutOrderId)}` : ''}</p>` : ''}
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

// Keep a create form's `slug` input in step with its title field until the admin
// edits the slug themselves. Also normalizes whatever they type, so a slug typed
// as "Flora Set" still submits as `flora-set` rather than tripping the pattern.
function bindSlugField(form, sourceName) {
  const source = form.elements[sourceName];
  const slug = form.elements.slug;
  if (!source || !slug) return;
  // A prefilled slug (duplicating an existing record) is already the admin's.
  let linked = !slug.value.trim();

  source.addEventListener('input', () => {
    if (linked) slug.value = slugify(source.value);
  });
  slug.addEventListener('input', () => {
    linked = false;
  });
  // Normalize on the way out rather than per-keystroke, so a trailing hyphen
  // mid-word doesn't get eaten while typing.
  slug.addEventListener('blur', () => {
    const clean = slugify(slug.value);
    if (clean !== slug.value) slug.value = clean;
    // Emptied by hand — hand it back to the name.
    if (!clean) {
      linked = true;
      slug.value = slugify(source.value);
    }
  });
}

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
  // Blank means "use the store default" — not 0%, which would be tax-free.
  const taxPct = (p.taxPercent === null || p.taxPercent === undefined) ? '' : p.taxPercent;
  openEditor(isEdit ? `Edit — ${p.name}` : 'New product', `
    <form id="product-form" class="form-grid" autocomplete="off">
      <div id="product-media"></div>
      <div class="field-row">
        <label class="field">
          <span class="field__label">Name</span>
          <input name="name" required value="${escapeAttr(p.name)}">
        </label>
        <label class="field">
          <span class="field__label">Slug${isEdit ? '' : ' (the /shop/… web address)'}</span>
          <input name="slug" required ${isEdit ? 'readonly' : ''} value="${escapeAttr(p.slug)}" pattern="[a-z0-9-]+">
          ${isEdit
            ? '<span class="field__hint">The slug is the product\u2019s address and can\u2019t change once created.</span>'
            : '<span class="field__hint">Filled in from the name — type here to set your own. Lowercase letters, numbers and hyphens.</span>'}
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
      <div class="field-row">
        <label class="field">
          <span class="field__label">Tax rate (%)</span>
          <input name="taxPercent" type="number" min="0" max="100" step="0.01" value="${taxPct}" placeholder="Store default (${DEFAULT_TAX_PERCENT}%)">
          <span class="field__hint">Leave blank to charge the store default of ${DEFAULT_TAX_PERCENT}%. Enter 0 for a tax-free item.</span>
        </label>
        <label class="field">
          <span class="field__label">Shipping weight (grams)</span>
          <input name="weightGrams" type="number" min="0" step="1" value="${p.weightGrams ?? ''}" placeholder="Category default">
          <span class="field__hint">What the packed piece weighs. Leave blank to use the category weight set under Shipping.</span>
        </label>
      </div>
      <div class="field-row">
        <label class="field">
          <span class="field__label">Package length (cm)</span>
          <input name="dimLength" type="number" min="0" step="0.1" value="${p.dimensionsCm?.length ?? ''}" placeholder="e.g. 30">
        </label>
        <label class="field">
          <span class="field__label">Package width (cm)</span>
          <input name="dimWidth" type="number" min="0" step="0.1" value="${p.dimensionsCm?.width ?? ''}" placeholder="e.g. 22">
        </label>
        <label class="field">
          <span class="field__label">Package height (cm)</span>
          <input name="dimHeight" type="number" min="0" step="0.1" value="${p.dimensionsCm?.height ?? ''}" placeholder="e.g. 6">
        </label>
      </div>
      <p class="field__hint">Package size only changes the price when a volumetric divisor is set under Admin features → Shipping (India Post bills actual weight, couriers bill the greater of the two).</p>
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
      <div id="product-process-media"></div>
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

  const processEditor = mountMediaEditor($('#product-process-media'), p.processMedia, {
    label: 'The Process — this product only (optional)',
    hint: 'Leave empty to use the category\'s Process photos (set under The Process). Add 3–4 here to show different ones on this product\'s page.',
    itemLabel: (i) => `Step ${i + 1}`,
  });

  // On a new product the slug tracks the name, so it's there without being
  // asked for — but it's a plain editable field: the moment the admin types in
  // it, it's theirs and the name stops overwriting it.
  if (!isEdit) bindSlugField($('#product-form'), 'name');

  $('#product-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const slug = slugify(fd.get('slug'));
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
      // Per-product tax rate as a percentage. null = fall back to the store
      // default; 0 is a real, tax-free rate and is kept as such.
      taxPercent: (() => {
        const raw = (fd.get('taxPercent') || '').toString().trim();
        if (raw === '') return null;
        const v = Number(raw);
        return Number.isFinite(v) && v >= 0 ? Math.min(100, v) : null;
      })(),
      // Delivery inputs. Blank = fall back to the category weight / no size.
      weightGrams: (() => {
        const raw = (fd.get('weightGrams') || '').toString().trim();
        const v = Number(raw);
        return raw !== '' && Number.isFinite(v) && v > 0 ? v : null;
      })(),
      dimensionsCm: (() => {
        const n = (k) => Number((fd.get(k) || '').toString().trim());
        const d = { length: n('dimLength'), width: n('dimWidth'), height: n('dimHeight') };
        return d.length > 0 && d.width > 0 && d.height > 0 ? d : null;
      })(),
      // The full ordered gallery. The server derives `images` from it, so the
      // two fields can't drift apart.
      media: mediaEditor.getValue(),
      processMedia: processEditor.getValue(),
    };
    try {
      if (isEdit) {
        await api('PUT', `/api/admin/products/${product.id}`, payload);
        toast('Product updated');
      } else {
        await api('POST', '/api/admin/products', payload);
        toast('Product created');
      }
      closeEditor({ force: true });
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
      <div class="card__img card__img--fit card__img--workshop">
        ${w.image ? `<img class="card__media" src="${escapeAttr(w.image)}" alt="">` : '<span class="card__img-empty">No photo</span>'}
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
  openEditor(isEdit ? `Edit — ${w.title}` : 'New workshop', `
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
      closeEditor({ force: true });
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
    if (block.type === 'img' || block.type === 'video') {
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
      // Same line syntax for both — a video file's extension makes it a video.
      const img = { type: VIDEO_URL_RE.test(src.trim()) ? 'video' : 'img', src: src.trim() };
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
      <div class="card__img card__img--fit card__img--blog">
        ${b.image ? `<img class="card__media" src="${escapeAttr(b.image)}" alt="">` : '<span class="card__img-empty">No photo</span>'}
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
  openEditor(isEdit ? `Edit — ${b.title}` : 'New blog', `
    <form id="blog-form" class="form-grid" autocomplete="off">
      <div class="upload" data-upload="blog-image">
        <div class="upload__preview" style="${b.image ? `background-image:url('${b.image}')` : ''}">${b.image ? '' : 'No image'}</div>
        <div class="upload__btns">
          <button type="button" class="btn btn--ghost btn--sm" data-upload-trigger>Upload image</button>
          <button type="button" class="btn btn--ghost btn--sm" data-upload-pick>Choose from gallery</button>
          <button type="button" class="btn btn--gold btn--sm" data-upload-edit ${b.image ? '' : 'disabled'}>Edit photo</button>
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
        <p class="field__hint">This box uses a few simple Markdown-style marks — that is what the special characters are:</p>
        <ul class="field__hint blog-format-help">
          <li>Leave a blank line between paragraphs.</li>
          <li><code>## Heading</code> — a line starting with <code>## </code> becomes a section heading.</li>
          <li><code>- item</code> — lines starting with <code>- </code> become a bullet list.</li>
          <li><code>**bold**</code>, <code>*italic*</code> and <code>[link text](https://…)</code> work inside a paragraph or bullet.</li>
          <li><code>![alt | caption](url)</code> on its own line places a photo or video. Use the buttons below rather than typing it.</li>
        </ul>
        <div class="upload__btns" style="margin-bottom:8px;">
          <button type="button" class="btn btn--ghost btn--sm" data-insert-image>+ Insert image</button>
          <button type="button" class="btn btn--ghost btn--sm" data-insert-video>+ Insert video</button>
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

  // Videos go through the same upload path as every other file (direct to
  // storage, with progress), then drop in as a block like an image does.
  $('[data-insert-video]')?.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/*';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      try {
        const { items: [m], errors } = await uploadFiles([file], (done, total, f, frac) => {
          toast(`Uploading ${f.name}…${frac ? ` ${Math.round(frac * 100)}%` : ''}`);
        });
        if (!m) throw new Error(errors[0].message);
        insertContentBlock(`![ | ](${m.url})`);
        toast('Video inserted — add a caption if you like');
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
      closeEditor({ force: true });
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

// Ordered to match the public site's navigation — Home, Shop, Workshops,
// Gallery, Blogs, About Us, Enquire — so a missing section is easy to spot
// against the live menu. Patron photos are not slots: each patron carries their
// own, edited under Home → Patron testimonials.
const SECTION_LABELS = {
  homepage: {
    _title: 'Home',
    _file: 'index.html',
    hero: 'Hero (full-bleed background)',
    introduction: 'Introduction still-life',
    'workshops-promo': 'Workshops promo banner',
    'shop-promo': 'Shop promo banner',
    gallery: 'Gallery teaser photo',
  },
  shop: {
    _title: 'Shop',
    _file: 'shop.html + product.html',
    hero: 'Shop hero (hanging fabrics)',
    'process-1': 'Product page — The Process 1',
    'process-2': 'Product page — The Process 2',
    'process-3': 'Product page — The Process 3',
  },
  workshops: {
    _title: 'Workshops',
    _file: 'workshops.html + workshop-category.html',
    hero: 'Hero band',
    'category-experience': 'Category card — Experience',
    'category-corporate': 'Category card — Corporate',
    'category-curated': 'Category card — Curated',
    'category-hero-experience': 'Experience landing page — banner',
    'category-hero-corporate': 'Corporate landing page — banner',
    'category-hero-curated': 'Curated landing page — banner',
    divider: 'Section divider — printed border strip between the workshop sections',
  },
  gallery: {
    _title: 'Gallery',
    _file: 'gallery.html',
    hero: 'Gallery hero banner',
  },
  blogs: {
    _title: 'Blogs',
    _file: 'blogs.html',
    hero: 'Blogs landing page — banner',
  },
  about: {
    _title: 'About Us',
    _file: 'about.html',
    hero: 'Hero block image',
    story: 'Our Story',
    sustainability: 'Sustainability',
    'team-hero': 'Our Team — primary',
    'team-secondary': 'Our Team — secondary',
    'team-video': 'Our Team — video (the PLAY NOW button)',
    'faq-decor': 'FAQ decorative',
  },
  enquire: {
    _title: 'Enquire',
    _file: 'enquire.html',
    hero: 'Enquire hero',
    'carousel-1': 'Artistic Experience slide 1',
    'carousel-2': 'Artistic Experience slide 2',
    'carousel-3': 'Artistic Experience slide 3',
  },
};

// Width ÷ height of each slot as the public page draws it on a 1440px desktop
// screen, measured from the live layout. The crop tool locks to this, so it
// must match the page: when it didn't (banners cropped at 3:1 or 16:9 but shown
// at 4:1), the framing chosen here was not the framing visitors saw. The
// 360px-tall page banners widen a little on bigger screens and turn nearly
// square on phones, so frame the subject near the centre of those.
const SECTION_SHAPES = {
  'homepage.hero': [1.6, 'Full-screen hero (16:10)'],
  'homepage.introduction': [0.92, 'Still-life column (~11:12)'],
  'homepage.workshops-promo': [2.4, 'Promo banner (12:5)'],
  'homepage.shop-promo': [2.4, 'Promo banner (12:5)'],
  'homepage.gallery': [2, 'Gallery teaser (2:1)'],
  'about.hero': [4, 'Page banner (4:1)'],
  'about.story': [0.92, 'Story image (~11:12)'],
  'about.sustainability': [0.92, 'Sustainability image (~11:12)'],
  'about.team-hero': [2.1, 'Team primary (~21:10)'],
  'about.team-secondary': [1.38, 'Team secondary (~11:8)'],
  'about.team-video': [1.7778, 'Team video (16:9)'],
  'about.faq-decor': [1.1, 'FAQ decoration (~11:10)'],
  'workshops.hero': [4, 'Page banner (4:1)'],
  'workshops.category-experience': [0.8, 'Category card (4:5)'],
  'workshops.category-corporate': [0.8, 'Category card (4:5)'],
  'workshops.category-curated': [0.8, 'Category card (4:5)'],
  'workshops.category-hero-experience': [4, 'Page banner (4:1)'],
  'workshops.category-hero-corporate': [4, 'Page banner (4:1)'],
  'workshops.category-hero-curated': [4, 'Page banner (4:1)'],
  'workshops.divider': [6.5, 'Divider strip (~13:2)'],
  'shop.hero': [4, 'Page banner (4:1)'],
  'shop.process-1': [0.714, 'Process card (5:7)'],
  'shop.process-2': [0.714, 'Process card (5:7)'],
  'shop.process-3': [0.714, 'Process card (5:7)'],
  'enquire.hero': [2.5, 'Enquire hero (5:2)'],
  'enquire.carousel-1': [2.28, 'Carousel slide (~16:7)'],
  'enquire.carousel-2': [2.28, 'Carousel slide (~16:7)'],
  'enquire.carousel-3': [2.28, 'Carousel slide (~16:7)'],
  'blogs.hero': [4, 'Page banner (4:1)'],
  'gallery.hero': [4, 'Page banner (4:1)'],
};

const DEFAULT_SHAPE = [1.6, 'Section band (16:10)'];

// Slots whose shape is not fixed by the layout: the admin picks one and the
// public page renders that box. The first entry is the site's default, used
// whenever the slot has no stored `aspect`. Everything not listed here keeps
// the single shape its layout dictates. (The homepage testimonial slots that
// used this have been retired — patrons carry their own media now.)
const SECTION_ASPECTS = {};

// The shape to draw the slot preview at and lock the crop tool to: the admin's
// stored choice where the slot allows one, otherwise the layout's fixed shape.
function sectionShape(page, slot, media) {
  const key = `${page}.${slot}`;
  const options = SECTION_ASPECTS[key];
  if (options) {
    const chosen = media && media.aspect ? media.aspect : options[0][0];
    const match = options.find(([r]) => Math.abs(r - chosen) < 0.005);
    return match || [chosen, `Custom (${chosen.toFixed(2)}:1)`];
  }
  return SECTION_SHAPES[key] || DEFAULT_SHAPE;
}

// One slot card. Shared by the standalone "Section images" panel and by each
// website page's own Images card.
function sectionSlotHTML(pageKey, slotKey, slotLabel) {
  const pageSlots = (state.sections && state.sections[pageKey]) || {};
  // A slot value is a media entry; records saved before the media model
  // are bare URL strings, which normalizeMedia() upgrades on read.
  const m = normalizeMedia(pageSlots[slotKey]);
  const [ratio, shapeLabel] = sectionShape(pageKey, slotKey, m);
  const aspectOptions = SECTION_ASPECTS[`${pageKey}.${slotKey}`];
  const preview = m
    ? mediaThumbHTML(m, 'slot__media')
    : '<span class="slot__empty">Not set</span>';
  // A slot as wide as a banner is unreadable squeezed into one grid
  // column, and the point of the preview is to show the real proportion.
  const wide = ratio >= 2 ? ' slot--wide' : '';
  // The preview is the natural thing to click to change the framing.
  const previewTag = m && m.type === 'image'
    ? `<button type="button" class="slot__preview slot__preview--live" style="aspect-ratio:${ratio};"
         data-action="frame-section" data-page="${pageKey}" data-slot="${slotKey}"
         title="Adjust how this photo sits in the slot">${preview}<span class="slot__preview-hint">Adjust framing</span></button>`
    : `<div class="slot__preview" style="aspect-ratio:${ratio};">${preview}</div>`;
  return `
    <div class="slot${wide}">
      ${previewTag}
      <div class="slot__body">
        <p class="slot__name">${slotLabel}</p>
        ${aspectOptions ? `
          <label class="slot__shape-pick">
            <span class="sr-only">Shape for ${slotLabel}</span>
            <select data-aspect-select data-page="${pageKey}" data-slot="${slotKey}" ${m ? '' : 'disabled'}>
              ${aspectOptions.map(([r, label]) =>
                `<option value="${r}" ${Math.abs(r - ratio) < 0.005 ? 'selected' : ''}>${label}</option>`).join('')}
            </select>
          </label>
          ${m ? '' : '<p class="slot__meta">Upload a photo to choose its shape.</p>'}
        ` : `<p class="slot__shape">${shapeLabel}</p>`}
        <p class="slot__meta">${m ? `${m.type === 'video' ? 'Video' : 'Photo'} · ${m.fit === 'contain' ? 'Whole image shown' : 'Fills the slot'}` : 'Empty'}</p>
      </div>
      <div class="slot__actions">
        ${m && m.type === 'image'
          ? `<button class="btn btn--gold btn--sm btn--block" data-action="frame-section" data-page="${pageKey}" data-slot="${slotKey}">Edit photo</button>`
          : ''}
        ${m && m.type === 'video'
          ? `<button class="btn btn--gold btn--sm btn--block" data-action="fit-section" data-page="${pageKey}" data-slot="${slotKey}">${m.fit === 'contain' ? 'Fill the slot' : 'Show whole video'}</button>`
          : ''}
        <div class="slot__actions-row">
          <button class="btn btn--ghost btn--sm" data-action="replace-section" data-page="${pageKey}" data-slot="${slotKey}">Upload</button>
          <button class="btn btn--ghost btn--sm" data-action="pick-section" data-page="${pageKey}" data-slot="${slotKey}">Library</button>
        </div>
      </div>
    </div>
  `;
}

// All the slots of one page, optionally narrowed to a named subset (the
// Corporates entry shows only the corporate slots of the workshops page).
function sectionSlotsHTML(pageKey, only) {
  const labels = SECTION_LABELS[pageKey];
  if (!labels) return '';
  return Object.entries(labels)
    .filter(([k]) => !k.startsWith('_'))
    .filter(([k]) => !only || only.includes(k))
    .map(([slotKey, slotLabel]) => sectionSlotHTML(pageKey, slotKey, slotLabel))
    .join('');
}

function renderSections() {
  const container = $('#sections-list');
  if (!container) return;
  container.innerHTML = '';
  Object.entries(SECTION_LABELS).forEach(([pageKey, labels]) => {
    const group = document.createElement('div');
    group.className = 'section-group';
    group.innerHTML = `
      <h3 class="section-group__title">${labels._title}</h3>
      <p class="section-group__subtitle">${labels._file || `${pageKey}.html`}</p>
      <div class="section-slots">${sectionSlotsHTML(pageKey)}</div>
    `;
    container.appendChild(group);
  });
  // The page tabs show the same slots, so they have to redraw too.
  if (state.tab === 'pages') renderPage();
}

// Save a slot. Fields omitted from `patch` keep their stored value, so framing
// survives a photo swap only when the caller means it to.
async function saveSection(page, slot, patch) {
  await api('PUT', `/api/admin/sections/${page}/${slot}`, patch);
  toast('Section updated');
  loadAll();
}

// Shape picker (only on slots listed in SECTION_ASPECTS). Saving the ratio
// re-renders the slot, so the preview and the crop tool immediately reflect the
// box the public page will now draw.
$('#sections-list').addEventListener('change', async (e) => {
  const select = e.target.closest('[data-aspect-select]');
  if (!select) return;
  const { page, slot } = select.dataset;
  try {
    await saveSection(page, slot, { aspect: Number(select.value) });
  } catch (err) { toast(err.message, true); }
});

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
          await saveSection(page, slot, { url: item.url, type: item.type, fit: 'cover', position: '50% 50%', edit: null });
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
          const { items: [m], errors } = await uploadFiles([file]);
          if (!m) throw new Error(errors[0].message);
          await saveSection(page, slot, { url: m.url, type: m.type, fit: 'cover', position: '50% 50%', edit: null });
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
      }, (() => {
        const [ratio, label] = sectionShape(page, slot, current);
        return { aspect: String(ratio), aspectLabel: label, lockAspect: true };
      })());
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
    // Only set on slots that offer a choice of shapes (see SECTION_ASPECTS).
    aspect: Number(o.aspect) > 0 ? Number(o.aspect) : null,
    // The photo editor's memory — see openFrameModal. Absent on most entries.
    ...(o.edit && typeof o.edit === 'object' ? { edit: o.edit } : {}),
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

// Replacing an image in place keeps its URL, so the browser happily shows the
// bytes it already cached. This records what was replaced during this admin
// session and cache-busts only the previews rendered here — the stored URL must
// stay untouched, or in-place replacement would stop being in-place.
const replacedVersions = new Map();   // url -> version stamp

function notePlaceReplacement(url, version) {
  replacedVersions.set(url, version || Date.now());
}

function previewSrc(url) {
  const v = replacedVersions.get(url);
  if (!v) return url;
  return `${url}${url.includes('?') ? '&' : '?'}v=${v}`;
}

function mediaThumbHTML(m, cls) {
  return m.type === 'video'
    ? `<video class="${cls}" src="${escapeAttr(m.url)}#t=0.1" style="${mediaFitStyle(m)}" muted playsinline preload="metadata"></video>`
    : `<img class="${cls}" src="${escapeAttr(previewSrc(m.url))}" alt="" style="${mediaFitStyle(m)}">`;
}

// ---------- Media list editor ----------
//
// Multi-item photo/video editor used by the product and workshop forms (and for
// a workshop's mosaic gallery). Mount it on a container, read it back with
// `getValue()` when the form submits.
//
//   mountMediaEditor(container, items, { label, hint, itemLabel })

function mountMediaEditor(container, initial, {
  label = 'Media', hint = '',
  // Caption on each row; the default names the first item as the primary photo.
  itemLabel = (i) => (i === 0 ? 'Primary — used on cards and in the cart' : `Item ${i + 1}`),
} = {}) {
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
          <p class="media-item__role">${escapeHtml(itemLabel(i))}</p>
          <p class="media-item__meta">${m.type === 'video' ? 'Video' : 'Photo'} · ${m.fit === 'contain' ? 'Fit whole frame' : 'Fill frame'} · ${escapeHtml(m.position)}</p>
          <p class="media-item__url">${escapeHtml(m.url)}</p>
        </div>
        <div class="media-item__actions">
          <button type="button" class="btn btn--ghost btn--sm" data-media-up ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
          <button type="button" class="btn btn--ghost btn--sm" data-media-down ${i === items.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
          ${m.type === 'image' ? '<button type="button" class="btn btn--gold btn--sm" data-media-frame>Edit photo</button>' : ''}
          ${m.type === 'video' ? `<button type="button" class="btn btn--gold btn--sm" data-media-fit>${m.fit === 'contain' ? 'Fill the frame' : 'Show whole video'}</button>` : ''}
          <button type="button" class="btn btn--danger btn--sm" data-media-remove>Remove</button>
        </div>
      </div>
    `).join('');
  };

  // Reordering, removing and cropping never fire an input event, so the media
  // list tells the editor it is dirty itself.
  const touched = () => { markEditorDirty(); render(); };
  const add = (added) => { items = items.concat(added.filter(Boolean)); touched(); };

  $('[data-media-add]', container).addEventListener('click', () => fileInput.click());
  $('[data-media-pick]', container).addEventListener('click', () => {
    openGalleryPicker({ onSelect: (item) => add([normalizeMedia({ url: item.url, type: item.type })]) });
  });

  fileInput.addEventListener('change', async () => {
    const files = Array.from(fileInput.files || []);
    fileInput.value = '';
    if (!files.length) return;
    const { items, errors } = await uploadFiles(files, (done, total, file, frac) => {
      const pct = frac ? ` ${Math.round(frac * 100)}%` : '';
      toast(total === 1 ? `Uploading ${file.name}…${pct}` : `Uploading ${done + 1} of ${total} — ${file.name}…${pct}`);
    });
    if (items.length) add(items);
    reportUploadResult(items.length, errors);
  });

  list.addEventListener('click', (e) => {
    const row = e.target.closest('[data-index]');
    if (!row) return;
    const i = Number(row.dataset.index);
    if (e.target.closest('[data-media-up]')) {
      [items[i - 1], items[i]] = [items[i], items[i - 1]];
      touched();
    } else if (e.target.closest('[data-media-down]')) {
      [items[i + 1], items[i]] = [items[i], items[i + 1]];
      touched();
    } else if (e.target.closest('[data-media-remove]')) {
      items.splice(i, 1);
      touched();
    } else if (e.target.closest('[data-media-frame]')) {
      openFrameModal(items[i], (updated) => { items[i] = updated; touched(); });
    } else if (e.target.closest('[data-media-fit]')) {
      // Videos can't go through the crop tool, so they get the same fill /
      // show-whole toggle the section slots offer.
      items[i] = { ...items[i], fit: items[i].fit === 'contain' ? 'cover' : 'contain' };
      touched();
    }
  });

  render();
  return { getValue: () => items.slice() };
}

// Aspect presets, used when the caller doesn't already know the slot's shape.
// Values are width ÷ height. 'free' unlocks the box entirely.
const FRAME_ASPECTS = [
  ['0.8', 'Product / workshop card (4:5)'],
  ['0.75', 'Portrait (3:4)'],
  ['1', 'Square (1:1)'],
  ['1.3333', 'Landscape (4:3)'],
  ['1.6', 'Section band (16:10)'],
  ['1.7778', 'Wide banner (16:9)'],
  ['3.2', 'Hero strip (16:5)'],
  ['free', 'Free — any shape'],
];

// Fetch the bytes and hand back a same-origin blob URL.
//
// Why not just point an <img> at the remote URL: S3 returns
// `Access-Control-Allow-Origin` ONLY when the request carries an `Origin`
// header, and serves objects `immutable, max-age=31536000`. A plain <img> load
// (no Origin) populates the HTTP cache with a header-less response, and a later
// crossOrigin request for the same URL is served from that same cache entry —
// so the canvas taints even though the bucket is configured correctly. Going
// through fetch + blob sidesteps the image cache entirely, and a blob: URL is
// same-origin so the canvas is always readable.
async function loadCroppableImage(url) {
  const res = await fetch(url, { mode: 'cors', cache: 'reload' });
  if (!res.ok) throw new Error(`Could not load the file (HTTP ${res.status})`);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error('That file could not be decoded as an image'));
    img.src = objectUrl;
  });
  return { img, objectUrl };
}

// ---------- Frame tool (crop & position) ----------
//
// A photo-editor surface: the whole image is shown, the part that will be kept
// is bright, and everything outside it is dimmed. Drag the box to move it, drag
// a corner to resize. The box is locked to the shape of the slot the media is
// going into, so what you see is what that slot will show.
//
// Two ways to save, both reachable from the primary button:
//   Save framing — non-destructive, stores a focal point the site applies in
//                  CSS. Only exact while the box is at full size, because CSS
//                  `object-fit: cover` always shows the largest region that
//                  fits; a shrunken box means you zoomed, which CSS can't express.
//   Crop a copy  — renders the box to a canvas and uploads it as a new file.
// Shrinking the box therefore doesn't take the primary button away: it retargets
// it at the crop route, which is the one that can honour the zoom.

// The frame tool gets its own backdrop rather than reusing #modal-backdrop: it
// is opened from inside the product/workshop form, and sharing the single modal
// would wipe out the half-filled form underneath it.
function openFrameLayer(bodyHtml) {
  $('#frame-body').innerHTML = bodyHtml;
  $('#frame-backdrop').hidden = false;
}

// The crop tool decodes the source into a blob URL; release it whenever the
// layer closes, however it was closed.
let frameObjectUrl = null;

function closeFrameLayer() {
  $('#frame-backdrop').hidden = true;
  $('#frame-body').innerHTML = '';
  if (frameObjectUrl) {
    URL.revokeObjectURL(frameObjectUrl);
    frameObjectUrl = null;
  }
}

$('#frame-close')?.addEventListener('click', closeFrameLayer);
// Same rule as the edit modal: an in-progress crop is unsaved work, so only the
// X button and Cancel dismiss it.
$('#frame-backdrop')?.addEventListener('click', (e) => {
  if (e.target.closest('[data-frame-close]')) closeFrameLayer();
});

// The photo editor. Opened on any stored image, from any field that holds one.
//
// Two kinds of edit, and the difference matters:
//
//   Framing      — non-destructive. Stores `fit` + a focal point the public CSS
//                  applies. The file is untouched, so it can be re-framed for a
//                  different slot forever. Only expressible while the box is at
//                  full size and no pixels are being altered.
//   A real edit  — rotate, straighten, flip, brightness/contrast/saturation, or
//                  a zoomed/free crop. CSS cannot express any of these, so the
//                  pixels are re-rendered and stored, either as a new copy or
//                  over the original.
//
// Everything is previewed by baking the edit into a canvas at preview scale and
// showing that canvas, rather than by CSS-transforming an <img>. It costs a
// redraw per control change and buys the thing that actually matters: the crop
// box is measured against the same pixels the save path renders, so what the
// box surrounds is exactly what comes out.
//
// Reading the pixels needs the file to be canvas-readable (see
// loadCroppableImage). When a host blocks that, every pixel-altering control is
// disabled and framing — which needs no pixel access — is still offered.

// Longest edge of the preview bake. Small enough to redraw on a slider drag.
const FRAME_PREVIEW_MAX = 1400;
// Longest edge of the stage a save renders from, before the crop is taken.
const FRAME_OUTPUT_MAX = 3000;
// How far the frame can close in. Past this the crop is mostly interpolation.
const FRAME_ZOOM_MAX = 4;
// Straighten range, in degrees each way. Kept under 45° so the inscribed-crop
// maths below stays well-conditioned.
const STRAIGHTEN_MAX = 15;

// Does this browser's canvas honour ctx.filter? Safari <16 and older Firefox
// don't, and silently dropping the adjustments would save a photo that looks
// nothing like the preview.
let canvasFilterSupport = null;
function supportsCanvasFilter() {
  if (canvasFilterSupport !== null) return canvasFilterSupport;
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.filter = 'brightness(0.5)';
    canvasFilterSupport = ctx.filter !== 'none' && ctx.filter !== '';
  } catch {
    canvasFilterSupport = false;
  }
  return canvasFilterSupport;
}

function openFrameModal(media, onSave, { aspect = '0.8', aspectLabel = '', lockAspect = false } = {}) {
  const m = normalizeMedia(media);
  // What the editor remembers about this photo (see normalizeMediaEdit on the
  // server): the crop shape chosen last time and, for an edited copy, the
  // untouched original plus the crop and adjustments that made the copy.
  // Re-opening an edited copy starts from that original with everything as it
  // was left, instead of from the already-cropped pixels at the defaults.
  const remembered = m.edit || {};
  if (!lockAspect && remembered.shape
    && FRAME_ASPECTS.some(([v]) => v === remembered.shape)) aspect = remembered.shape;
  let sourceMode = !!remembered.source && remembered.source !== m.url;
  const filtersUsable = supportsCanvasFilter();
  // Both save routes re-encode in the original's format (see renderCrop).
  const outMime = outputMimeFor(m.url);
  // The shape the preview is drawn at. A slot-locked crop keeps the slot's
  // shape whatever the box does — a free crop still ends up inside that slot,
  // so previewing the crop's own shape would show something the page never
  // renders. Everywhere else there is no fixed destination, so the preview
  // follows whatever shape is being cut.
  const slotRatio = Number(aspect) > 0 ? Number(aspect) : 1.6;
  const previewLabel = aspectLabel;

  openFrameLayer(`
    <div class="frame-tool">
      <div class="frame-stage">
      <div class="frame-ws" id="frame-ws" tabindex="0" aria-label="Framing workspace: drag to move the frame, arrow keys to nudge">
        <canvas class="frame-ws__img" id="frame-canvas" hidden></canvas>
        <img class="frame-ws__img" id="frame-img" alt="" draggable="false" hidden>
        <div class="frame-crop" id="frame-crop" hidden>
          <span class="frame-crop__handle" data-handle="nw"></span>
          <span class="frame-crop__handle" data-handle="ne"></span>
          <span class="frame-crop__handle" data-handle="se"></span>
          <span class="frame-crop__handle" data-handle="sw"></span>
        </div>
        <p class="frame-ws__loading" id="frame-loading">Loading…</p>
      </div>

      <!-- What the slot will actually show. Drawn from the same pixels the save
           path renders, at the slot's own shape, so it is a preview and not an
           approximation. -->
      <figure class="frame-preview" id="frame-preview">
        <figcaption class="frame-preview__label">On the page${previewLabel ? ` — ${escapeHtml(previewLabel)}` : ''}</figcaption>
        <div class="frame-preview__box" id="frame-preview-box" style="--r:${slotRatio}">
          <canvas id="frame-preview-canvas"></canvas>
        </div>
      </figure>
      </div>

      <div class="frame-tools frame-tools--zoom" id="frame-zoom-row">
        <label class="frame-slider">
          <span class="frame-slider__label">Zoom <output id="out-zoom">100%</output></span>
          <input type="range" id="in-zoom" min="100" max="${FRAME_ZOOM_MAX * 100}" step="1" value="100">
        </label>
        <button type="button" class="btn btn--ghost btn--sm" id="frame-zoom-reset">Fit the whole width</button>
      </div>

      <div class="frame-tools" id="frame-tools">
        <div class="frame-tools__group">
          <span class="frame-tools__label">Rotate</span>
          <button type="button" class="btn btn--ghost btn--sm" data-rot="-1" aria-label="Rotate left">↺ 90°</button>
          <button type="button" class="btn btn--ghost btn--sm" data-rot="1" aria-label="Rotate right">↻ 90°</button>
        </div>
        <div class="frame-tools__group">
          <span class="frame-tools__label">Flip</span>
          <button type="button" class="btn btn--ghost btn--sm" data-flip="h" aria-pressed="false">Horizontal</button>
          <button type="button" class="btn btn--ghost btn--sm" data-flip="v" aria-pressed="false">Vertical</button>
        </div>
        <label class="frame-slider">
          <span class="frame-slider__label">Straighten <output id="out-straighten">0°</output></span>
          <input type="range" id="in-straighten" min="${-STRAIGHTEN_MAX}" max="${STRAIGHTEN_MAX}" step="0.5" value="0">
        </label>
      </div>

      <div class="frame-tools frame-tools--adjust" id="frame-adjust">
        <label class="frame-slider">
          <span class="frame-slider__label">Brightness <output id="out-brightness">100%</output></span>
          <input type="range" id="in-brightness" min="50" max="150" step="1" value="100">
        </label>
        <label class="frame-slider">
          <span class="frame-slider__label">Contrast <output id="out-contrast">100%</output></span>
          <input type="range" id="in-contrast" min="50" max="150" step="1" value="100">
        </label>
        <label class="frame-slider">
          <span class="frame-slider__label">Saturation <output id="out-saturate">100%</output></span>
          <input type="range" id="in-saturate" min="0" max="200" step="1" value="100">
        </label>
      </div>

      <div class="frame-controls">
        <label class="field">
          <span class="field__label">How it fills the slot</span>
          <select id="frame-fit">
            <option value="cover" ${m.fit === 'cover' ? 'selected' : ''}>Fill the slot — choose what stays in view</option>
            <option value="contain" ${m.fit === 'contain' ? 'selected' : ''}>Fit the whole photo — leaves empty space</option>
          </select>
        </label>
        ${lockAspect ? `
          <div class="field">
            <span class="field__label">Crop shape</span>
            <p class="frame-shape-fixed">${escapeHtml(aspectLabel || 'Fixed by this slot')} — <button type="button" class="frame-link" id="frame-unlock">crop freely instead</button></p>
          </div>
        ` : `
          <label class="field">
            <span class="field__label">Crop shape</span>
            <select id="frame-aspect">
              ${FRAME_ASPECTS.map(([v, l]) => `<option value="${v}" ${v === aspect ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
          </label>
        `}
      </div>

      <p class="field__hint" id="frame-hint">Drag the bright box to choose what stays in view. Drag a corner to zoom in.</p>

      <div class="form-actions">
        <button type="button" class="btn btn--ghost btn--sm" id="frame-reset">Reset everything</button>
        <span class="form-actions__spacer"></span>
        <button type="button" class="btn btn--ghost" data-frame-close>Cancel</button>
        <button type="button" class="btn btn--ghost" id="frame-replace">Replace original</button>
        <button type="button" class="btn btn--primary" id="frame-save">Save framing</button>
      </div>
    </div>
  `);

  const ws = $('#frame-ws');
  const canvas = $('#frame-canvas');
  const img = $('#frame-img');
  const cropBox = $('#frame-crop');
  const fitSelect = $('#frame-fit');
  const aspectSelect = $('#frame-aspect');
  const zoomRow = $('#frame-zoom-row');
  const zoomInput = $('#in-zoom');
  const pvBox = $('#frame-preview-box');
  const pvCanvas = $('#frame-preview-canvas');
  const replaceBtn = $('#frame-replace');
  const saveBtn = $('#frame-save');

  // Pixel-altering edits. All of them are baked at save time.
  const ed = { quarters: 0, straighten: 0, flipH: false, flipV: false, brightness: 1, contrast: 1, saturate: 1 };
  // Geometry, all in workspace pixels. box{} is the kept region; disp{} is
  // where the whole (already-edited) stage is drawn.
  const g = { dispX: 0, dispY: 0, dispW: 0, dispH: 0, boxX: 0, boxY: 0, boxW: 0, boxH: 0,
    nw: 0, nh: 0, srcW: 1, srcH: 1 };
  let source = null;          // { img, objectUrl } once the readable copy loads
  let croppable = false;
  let freeCrop = false;       // set by the shape select / unlock link
  let zoomed = false;         // box shrunk below full size — set by paint()

  const edited = () => ed.quarters !== 0 || ed.straighten !== 0 || ed.flipH || ed.flipV
    || ed.brightness !== 1 || ed.contrast !== 1 || ed.saturate !== 1;

  const ratio = () => {
    if (freeCrop) return null;
    const raw = aspectSelect ? aspectSelect.value : aspect;
    if (raw === 'free') return null;
    return Number(raw) || 0.8;
  };

  const filterString = () =>
    `brightness(${ed.brightness}) contrast(${ed.contrast}) saturate(${ed.saturate})`;

  // ---- the stage: the source with every pixel edit applied ----

  // Size of the edited image, in source pixels. A quarter turn swaps the axes;
  // straightening crops back to the largest rectangle of that same shape which
  // still lies wholly inside the rotated image, so the corners never show
  // empty wedges (the auto-crop every photo app does after a straighten).
  const stageDims = () => {
    const swap = ed.quarters % 2 !== 0;
    const w = swap ? g.srcH : g.srcW;
    const h = swap ? g.srcW : g.srcH;
    if (!ed.straighten) return { w, h };
    const a = Math.abs(ed.straighten) * Math.PI / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const denom = cos * cos - sin * sin;          // cos(2a); > 0 below 45°
    const iw = (w * cos - h * sin) / denom;
    const ih = (h * cos - w * sin) / denom;
    // A very wide or tall image can have no inscribed rectangle of its own
    // shape at this angle; fall back to the full rotated bounds in that case.
    if (!(iw > 8 && ih > 8)) return { w: w * cos + h * sin, h: w * sin + h * cos };
    return { w: iw, h: ih };
  };

  // Draw the stage into `target` at `maxEdge`. Returns the canvas' pixel size.
  const bake = (target, maxEdge) => {
    const dims = stageDims();
    const scale = Math.min(1, maxEdge / Math.max(dims.w, dims.h));
    const cw = Math.max(1, Math.round(dims.w * scale));
    const ch = Math.max(1, Math.round(dims.h * scale));
    target.width = cw;
    target.height = ch;
    const ctx = target.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.filter = 'none';
    ctx.clearRect(0, 0, cw, ch);
    // A rotation or a straighten can leave the corners uncovered. PNG/WebP keep
    // them transparent; a JPEG has no alpha, so they get the same white the
    // public site letterboxes uncropped photography against.
    if (!keepsAlpha(outMime)) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, cw, ch);
    }
    if (filtersUsable) ctx.filter = filterString();
    const angle = (ed.quarters * 90 + ed.straighten) * Math.PI / 180;
    ctx.translate(cw / 2, ch / 2);
    ctx.rotate(angle);
    ctx.scale(ed.flipH ? -1 : 1, ed.flipV ? -1 : 1);
    // Source drawn centred, scaled to the stage: the flip applies in source
    // space and the rotation after it, which is the order that reads naturally.
    const dw = g.srcW * scale;
    const dh = g.srcH * scale;
    ctx.drawImage(source.img, -dw / 2, -dh / 2, dw, dh);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.filter = 'none';
    return { w: cw, h: ch };
  };

  // ---- workspace layout + painting ----

  const layout = () => {
    const dims = croppable ? stageDims() : { w: g.srcW, h: g.srcH };
    g.nw = dims.w;
    g.nh = dims.h;
    const scale = Math.min(ws.clientWidth / g.nw, ws.clientHeight / g.nh);
    g.dispW = g.nw * scale;
    g.dispH = g.nh * scale;
    g.dispX = (ws.clientWidth - g.dispW) / 2;
    g.dispY = (ws.clientHeight - g.dispH) / 2;
    const el = croppable ? canvas : img;
    Object.assign(el.style, {
      left: `${g.dispX}px`, top: `${g.dispY}px`,
      width: `${g.dispW}px`, height: `${g.dispH}px`,
    });
  };

  // Largest box of the current aspect that fits inside the displayed image.
  const maxBox = () => {
    const a = ratio();
    if (!a) return { w: g.dispW, h: g.dispH };
    return g.dispW / g.dispH > a
      ? { w: a * g.dispH, h: g.dispH }
      : { w: g.dispW, h: g.dispW / a };
  };

  // How far in the frame is, as a multiple of the largest box that fits.
  // 1 = the whole width of the photo is in view.
  const zoomLevel = () => {
    const max = maxBox();
    return max.w > 0 && g.boxW > 0 ? max.w / g.boxW : 1;
  };

  // Close in or pull back around the frame's own centre, the way a crop app's
  // zoom does — the framed subject stays put instead of drifting to a corner.
  const applyZoom = (z) => {
    const max = maxBox();
    const level = Math.max(1, Math.min(FRAME_ZOOM_MAX, z));
    const cx = g.boxX + g.boxW / 2;
    const cy = g.boxY + g.boxH / 2;
    const a = ratio();
    g.boxW = max.w / level;
    g.boxH = a ? g.boxW / a : max.h / level;
    g.boxX = cx - g.boxW / 2;
    g.boxY = cy - g.boxH / 2;
    clampBox();
    paint();
  };

  // The slot, drawn from the same pixels a save renders. `cover` semantics
  // match the public CSS: the framed region fills the slot and any difference
  // in shape is cropped off centre, never squashed.
  // What the preview box is shaped like right now (see slotRatio).
  const previewRatio = () => {
    if (lockAspect) return slotRatio;
    const a = ratio();
    if (a) return a;
    return g.boxH > 0 ? g.boxW / g.boxH : slotRatio;
  };

  const drawPreview = () => {
    const src = croppable ? canvas : img;
    const sw0 = croppable ? canvas.width : (img.naturalWidth || 0);
    const sh0 = croppable ? canvas.height : (img.naturalHeight || 0);
    if (!sw0 || !sh0 || !g.dispW || !g.dispH) return;
    const pr = previewRatio();
    pvBox.style.setProperty('--r', String(pr));
    const cw = 640;
    const ch = Math.max(1, Math.round(cw / pr));
    if (pvCanvas.width !== cw || pvCanvas.height !== ch) {
      pvCanvas.width = cw;
      pvCanvas.height = ch;
    }
    const ctx = pvCanvas.getContext('2d');
    ctx.clearRect(0, 0, cw, ch);
    if (fitSelect.value === 'contain') {
      // Letterboxed: the box's own background stands in for the page's, which
      // is what shows around a contained photo.
      const s = Math.min(cw / sw0, ch / sh0);
      ctx.drawImage(src, (cw - sw0 * s) / 2, (ch - sh0 * s) / 2, sw0 * s, sh0 * s);
      return;
    }
    let sx = (g.boxX / g.dispW) * sw0;
    let sy = (g.boxY / g.dispH) * sh0;
    let sw = (g.boxW / g.dispW) * sw0;
    let sh = (g.boxH / g.dispH) * sh0;
    // Cover the slot with the framed region (a no-op while the frame is locked
    // to the slot's shape, which is the usual case).
    if (sw / sh > pr) {
      const w = sh * pr;
      sx += (sw - w) / 2;
      sw = w;
    } else {
      const h = sw / pr;
      sy += (sh - h) / 2;
      sh = h;
    }
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, cw, ch);
  };

  const paint = () => {
    const contain = fitSelect.value === 'contain';
    cropBox.hidden = contain;
    if (!contain) {
      Object.assign(cropBox.style, {
        left: `${g.dispX + g.boxX}px`,
        top: `${g.dispY + g.boxY}px`,
        width: `${g.boxW}px`,
        height: `${g.boxH}px`,
      });
    }
    const max = maxBox();
    zoomed = !contain && (g.boxW < max.w - 1 || g.boxH < max.h - 1);
    // Framing is only available while nothing about the pixels has changed and
    // the box still surrounds everything CSS would show. Working from an edited
    // copy's original is always a re-render: the stored file is the copy.
    const destructive = edited() || zoomed || sourceMode;
    saveBtn.textContent = destructive ? 'Save a copy' : 'Save framing';
    saveBtn.disabled = destructive && !croppable;
    saveBtn.title = saveBtn.disabled
      ? 'This file’s host blocks reading the pixels, so an edited copy can’t be rendered. '
        + 'Undo the edits to save framing instead.'
      : '';
    replaceBtn.disabled = !croppable || !destructive;
    replaceBtn.title = !croppable
      ? 'This file’s host blocks reading the pixels, so it can’t be re-rendered.'
      : !destructive
        ? 'Nothing to bake in yet — rotate, crop, flip or adjust first.'
        : 'Overwrites the stored file. Every product, workshop, section and blog '
          + 'using this image shows the edit.';
    $('#frame-hint').textContent = contain
      ? 'The whole photo will be shown, with empty space around it. Nothing to position.'
      : sourceMode
        ? 'Editing from the original photo, with the crop and adjustments you saved last time. '
          + 'Save a copy to keep the original, or replace this photo everywhere it is used.'
      : destructive
        ? croppable
          ? 'Saving re-renders the pixels: a copy leaves the original alone, replacing overwrites it everywhere.'
          : 'This file’s host blocks reading its pixels, so nothing can be re-rendered. Undo the edits to save framing.'
        : 'Drag anywhere to move the frame. Scroll or use Zoom to close in, arrow keys to nudge.';
    // Zoom is a framing control: there is nothing to close in on when the whole
    // photo is being shown, and nothing savable when the pixels can't be read.
    zoomRow.hidden = contain || !croppable;
    const level = zoomLevel();
    if (Math.abs(Number(zoomInput.value) - level * 100) > 0.5) {
      zoomInput.value = String(Math.round(level * 100));
    }
    $('#out-zoom').textContent = `${Math.round(level * 100)}%`;
    drawPreview();
  };

  // Re-bake the preview and repaint. Called on every pixel-edit change.
  const refresh = ({ keepBox = false } = {}) => {
    if (croppable) bake(canvas, FRAME_PREVIEW_MAX);
    const focal = keepBox ? focalString() : null;
    layout();
    if (keepBox) resetBox(focal); else resetBox();
  };

  // Keep the box inside the image and on-aspect.
  const clampBox = () => {
    const a = ratio();
    const max = maxBox();
    g.boxW = Math.min(g.boxW, max.w);
    if (a) {
      g.boxH = g.boxW / a;
      if (g.boxH > g.dispH) { g.boxH = g.dispH; g.boxW = g.boxH * a; }
    } else {
      g.boxH = Math.min(g.boxH, g.dispH);
    }
    g.boxX = Math.max(0, Math.min(g.dispW - g.boxW, g.boxX));
    g.boxY = Math.max(0, Math.min(g.dispH - g.boxH, g.boxY));
  };

  // Place the box at full size, honouring the entry's stored focal point.
  const resetBox = (focal) => {
    const max = maxBox();
    g.boxW = max.w;
    g.boxH = max.h;
    const [px, py] = String(focal || m.position).split(' ');
    const fx = (parseFloat(px) || 50) / 100;
    const fy = (parseFloat(py) || 50) / 100;
    g.boxX = fx * (g.dispW - g.boxW);
    g.boxY = fy * (g.dispH - g.boxH);
    clampBox();
    paint();
  };

  // Put the editor back the way it was left when this copy was saved.
  const restoreRemembered = () => {
    Object.assign(ed, {
      quarters: remembered.quarters || 0,
      straighten: remembered.straighten || 0,
      flipH: !!remembered.flipH,
      flipV: !!remembered.flipV,
      brightness: remembered.brightness ?? 1,
      contrast: remembered.contrast ?? 1,
      saturate: remembered.saturate ?? 1,
    });
    $('#in-straighten').value = String(ed.straighten);
    $('#out-straighten').textContent = `${ed.straighten}°`;
    [['brightness', ed.brightness], ['contrast', ed.contrast], ['saturate', ed.saturate]].forEach(([k, v]) => {
      $(`#in-${k}`).value = String(Math.round(v * 100));
      $(`#out-${k}`).textContent = `${Math.round(v * 100)}%`;
    });
    $('#frame-tools').querySelectorAll('[data-flip]').forEach((b) => {
      const on = b.dataset.flip === 'h' ? ed.flipH : ed.flipV;
      b.setAttribute('aria-pressed', String(on));
      b.classList.toggle('btn--gold', on);
    });
    refresh();
    if (Array.isArray(remembered.box) && remembered.box.length === 4) {
      const [fx, fy, fw, fh] = remembered.box;
      g.boxX = fx * g.dispW;
      g.boxY = fy * g.dispH;
      g.boxW = fw * g.dispW;
      g.boxH = fh * g.dispH;
      clampBox();
      paint();
    }
  };

  // Load a readable copy; fall back to a plain preview if the host blocks it.
  (async () => {
    try {
      if (sourceMode) {
        try {
          source = await loadCroppableImage(remembered.source);
        } catch (_) {
          // The original has gone (deleted from storage) — edit the copy itself.
          sourceMode = false;
        }
      }
      if (!source) source = await loadCroppableImage(m.url);
      croppable = true;
      canvas.hidden = false;
      frameObjectUrl = source.objectUrl;   // released by closeFrameLayer()
      g.srcW = source.img.naturalWidth || 1;
      g.srcH = source.img.naturalHeight || 1;
      $('#frame-loading').hidden = true;
      if (!filtersUsable) {
        $('#frame-adjust').hidden = true;
      }
      if (sourceMode) restoreRemembered();
      else refresh();
    } catch (_) {
      // No pixel access: preview only, and every pixel-altering control goes.
      croppable = false;
      sourceMode = false;
      img.hidden = false;
      img.src = m.url;
      $('#frame-tools').hidden = true;
      $('#frame-adjust').hidden = true;
      const start = () => {
        g.srcW = img.naturalWidth || 1;
        g.srcH = img.naturalHeight || 1;
        $('#frame-loading').hidden = true;
        layout();
        resetBox();
      };
      if (img.complete && img.naturalWidth) start();
      else img.addEventListener('load', start, { once: true });
    }
  })();

  // ---- pointer interaction: drag to move, corner to resize ----
  let drag = null;
  ws.addEventListener('pointerdown', (e) => {
    if (cropBox.hidden) return;
    const handle = e.target.closest('[data-handle]');
    // Anywhere in the workspace moves the frame. Having to land on the box
    // exactly is the thing that makes a crop tool feel stiff; the corners keep
    // their own job because they resize rather than move.
    ws.focus({ preventScroll: true });
    drag = {
      handle: handle ? handle.dataset.handle : null,
      x: e.clientX, y: e.clientY,
      boxX: g.boxX, boxY: g.boxY, boxW: g.boxW, boxH: g.boxH,
    };
    ws.setPointerCapture(e.pointerId);
    ws.classList.add('is-dragging');
    e.preventDefault();
  });

  ws.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.handle) {
      g.boxX = drag.boxX + dx;
      g.boxY = drag.boxY + dy;
    } else {
      // Resize from the grabbed corner, keeping the opposite corner pinned.
      const west = drag.handle.includes('w');
      const north = drag.handle.includes('n');
      const rightEdge = drag.boxX + drag.boxW;
      const bottomEdge = drag.boxY + drag.boxH;
      const a = ratio();
      let w = west ? drag.boxW - dx : drag.boxW + dx;
      w = Math.max(40, w);
      // Locked to a shape, height follows width; cropping freely, each edge
      // follows its own corner.
      let h = a ? w / a : Math.max(40, north ? drag.boxH - dy : drag.boxH + dy);
      if (west) g.boxX = rightEdge - w; else g.boxX = drag.boxX;
      if (north) g.boxY = bottomEdge - h; else g.boxY = drag.boxY;
      g.boxW = w;
      g.boxH = h;
      // Don't let a resize push the box off the image.
      if (g.boxX < 0 || g.boxY < 0 || g.boxX + w > g.dispW || g.boxY + h > g.dispH) {
        g.boxW = drag.boxW; g.boxH = drag.boxH; g.boxX = drag.boxX; g.boxY = drag.boxY;
      }
    }
    clampBox();
    paint();
  });
  ['pointerup', 'pointercancel'].forEach((ev) => ws.addEventListener(ev, () => {
    drag = null;
    ws.classList.remove('is-dragging');
  }));

  // Wheel / trackpad pinch closes in on the pointer's own position, so the
  // detail under the cursor is what you end up framed on.
  ws.addEventListener('wheel', (e) => {
    if (cropBox.hidden || !croppable) return;
    e.preventDefault();
    const step = e.deltaY < 0 ? 1.08 : 1 / 1.08;
    applyZoom(zoomLevel() * step);
  }, { passive: false });

  // Nudge the frame a pixel at a time — the last few pixels of a crop are hard
  // to hit with a pointer. Shift moves in bigger steps.
  ws.addEventListener('keydown', (e) => {
    if (cropBox.hidden) return;
    const step = e.shiftKey ? 10 : 1;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const move = moves[e.key];
    if (!move) return;
    e.preventDefault();
    g.boxX += move[0];
    g.boxY += move[1];
    clampBox();
    paint();
  });

  // ---- controls ----

  fitSelect.addEventListener('change', paint);
  zoomInput.addEventListener('input', () => applyZoom(Number(zoomInput.value) / 100));
  $('#frame-zoom-reset').addEventListener('click', () => applyZoom(1));
  aspectSelect?.addEventListener('change', () => {
    freeCrop = aspectSelect.value === 'free';
    resetBox(focalString());
  });
  // A slot-locked crop can still be cut freely — the result is a new file, so
  // it is no longer bound to the slot's shape.
  $('#frame-unlock')?.addEventListener('click', (e) => {
    freeCrop = !freeCrop;
    e.currentTarget.textContent = freeCrop ? 'go back to the slot’s shape' : 'crop freely instead';
    resetBox(focalString());
  });

  $('#frame-tools').addEventListener('click', (e) => {
    const rot = e.target.closest('[data-rot]');
    const flip = e.target.closest('[data-flip]');
    if (rot) {
      ed.quarters = (ed.quarters + Number(rot.dataset.rot) + 4) % 4;
      refresh();
    } else if (flip) {
      const axis = flip.dataset.flip === 'h' ? 'flipH' : 'flipV';
      ed[axis] = !ed[axis];
      flip.setAttribute('aria-pressed', String(ed[axis]));
      flip.classList.toggle('btn--gold', ed[axis]);
      refresh({ keepBox: true });
    }
  });

  const straighten = $('#in-straighten');
  straighten.addEventListener('input', () => {
    ed.straighten = Number(straighten.value);
    $('#out-straighten').textContent = `${ed.straighten}°`;
    refresh();
  });

  // Adjustments only change colour, so the box is left exactly where it is.
  const adjust = (id, key, fmt) => {
    const input = $(`#in-${id}`);
    input.addEventListener('input', () => {
      ed[key] = Number(input.value) / 100;
      $(`#out-${id}`).textContent = fmt(input.value);
      if (croppable) bake(canvas, FRAME_PREVIEW_MAX);
      paint();
    });
  };
  adjust('brightness', 'brightness', (v) => `${v}%`);
  adjust('contrast', 'contrast', (v) => `${v}%`);
  adjust('saturate', 'saturate', (v) => `${v}%`);

  $('#frame-reset').addEventListener('click', () => {
    Object.assign(ed, { quarters: 0, straighten: 0, flipH: false, flipV: false, brightness: 1, contrast: 1, saturate: 1 });
    straighten.value = 0;
    $('#out-straighten').textContent = '0°';
    ['brightness', 'contrast', 'saturate'].forEach((k) => {
      $(`#in-${k}`).value = 100;
      $(`#out-${k}`).textContent = '100%';
    });
    $('#frame-tools').querySelectorAll('[data-flip]').forEach((b) => {
      b.setAttribute('aria-pressed', 'false');
      b.classList.remove('btn--gold');
    });
    refresh();
  });

  // The box's position within the image, as the percentages object-position uses.
  const focalString = () => {
    const fx = g.dispW > g.boxW ? (g.boxX / (g.dispW - g.boxW)) * 100 : 50;
    const fy = g.dispH > g.boxH ? (g.boxY / (g.dispH - g.boxH)) * 100 : 50;
    return `${fx.toFixed(1)}% ${fy.toFixed(1)}%`;
  };

  // The shape last chosen, remembered so the next edit opens on it.
  const shapeChoice = () => (aspectSelect ? aspectSelect.value : (freeCrop ? 'free' : String(aspect)));

  // Everything needed to rebuild this edit later from the untouched original.
  const editRecord = (sourceUrl) => {
    const cropping = fitSelect.value !== 'contain';
    return {
      shape: shapeChoice(),
      source: sourceUrl,
      box: cropping ? [g.boxX / g.dispW, g.boxY / g.dispH, g.boxW / g.dispW, g.boxH / g.dispH] : [0, 0, 1, 1],
      ...ed,
    };
  };

  const saveFraming = () => {
    onSave({
      ...m,
      fit: fitSelect.value,
      position: fitSelect.value === 'contain' ? '50% 50%' : focalString(),
      edit: { shape: shapeChoice() },
    });
    closeFrameLayer();
    toast('Framing saved');
  };

  // Bake the edit at output scale and cut the box out of it. The box is stored
  // as a fraction of the displayed stage, so it survives the change of scale
  // between the preview bake and this one.
  const renderEdited = async () => {
    const fx = g.boxX / g.dispW;
    const fy = g.boxY / g.dispH;
    const fw = g.boxW / g.dispW;
    const fh = g.boxH / g.dispH;
    const stage = document.createElement('canvas');
    const { w, h } = bake(stage, FRAME_OUTPUT_MAX);
    const cropping = fitSelect.value !== 'contain';
    return renderCrop(stage, cropping
      ? { sx: fx * w, sy: fy * h, sw: fw * w, sh: fh * h }
      : { sx: 0, sy: 0, sw: w, sh: h }, outMime);
  };

  // Two save routes for a real edit. Both re-render the pixels; they differ only
  // in where the bytes land.
  const saveCopy = async (btn) => {
    btn.disabled = true;
    try {
      const url = await uploadFile(await renderEdited());
      // The copy remembers the original it was cut from — which is the
      // remembered original again when this was itself re-edited from one.
      onSave({ ...m, url, fit: 'cover', position: '50% 50%',
        edit: editRecord(sourceMode ? remembered.source : m.url) });
      closeFrameLayer();
      toast('Edited copy uploaded');
    } catch (err) {
      btn.disabled = false;
      toast(err.message, true);
    }
  };

  const saveOverOriginal = async (btn) => {
    if (!confirm('Overwrite the original file? Every product, workshop, section and blog using '
      + 'this image will show the edited version. This cannot be undone.')) return;
    btn.disabled = true;
    try {
      const { version } = await replaceStoredImage(m.url, await renderEdited());
      notePlaceReplacement(m.url, version);
      // The URL is unchanged — that is the point — so the entry keeps it and
      // only the framing is reset, the crop now being baked into the file.
      // Re-rendered from a remembered original, that original is still intact
      // and stays the starting point; otherwise the original pixels are gone.
      onSave({ ...m, fit: 'cover', position: '50% 50%',
        edit: sourceMode ? editRecord(remembered.source) : { shape: shapeChoice() } });
      closeFrameLayer();
      toast('Original replaced everywhere it is used');
    } catch (err) {
      btn.disabled = false;
      toast(err.message, true);
    }
  };

  saveBtn.addEventListener('click', (e) => {
    if ((edited() || zoomed || sourceMode) && croppable) saveCopy(e.currentTarget);
    else saveFraming();
  });
  replaceBtn.addEventListener('click', (e) => saveOverOriginal(e.currentTarget));
}

// Render a source rectangle to a File. Output is capped so a 6000px phone photo
// doesn't become a 6000px web asset.
//
// The format follows the original's rather than always being JPEG: replacing an
// image in place keeps its URL, so a `.png` that came back as JPEG bytes would
// be served under the wrong content type — and a PNG re-encoded as JPEG loses
// its transparency to a white box.
const CROP_MAX_EDGE = 2400;

const OUTPUT_MIMES = {
  png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg',
};
const EXT_FOR_MIME = { 'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg' };

// Alpha-capable formats keep their transparency; a JPEG has to land on something,
// and white matches the letterboxing the public site uses behind photography.
const keepsAlpha = (mime) => mime === 'image/png' || mime === 'image/webp';

function outputMimeFor(url) {
  const ext = (String(url).split('?')[0].match(/\.([a-z0-9]+)$/i) || [])[1] || '';
  return OUTPUT_MIMES[ext.toLowerCase()] || 'image/jpeg';
}

async function renderCrop(img, { sx, sy, sw, sh }, mime = 'image/jpeg') {
  const outScale = Math.min(1, CROP_MAX_EDGE / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw * outScale));
  canvas.height = Math.max(1, Math.round(sh * outScale));
  const ctx = canvas.getContext('2d');
  if (!keepsAlpha(mime)) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not render the crop'))), mime, 0.9);
  });
  return new File([blob], `edited.${EXT_FOR_MIME[mime] || 'jpg'}`, { type: mime });
}

// ---------- Upload helper ----------

// HEIC has to travel through the server: it is transcoded to JPEG there, which
// can only happen if the bytes pass through. Everything else can go straight to
// S3.
const HEIC_FILE_RE = /\.(heic|heif)$/i;
const needsServerTranscode = (file) =>
  HEIC_FILE_RE.test(file.name || '') || /^image\/hei[cf]$/i.test(file.type || '');

// PUT the file straight at S3 with a presigned URL, reporting real progress.
//
// fetch() can't report upload progress, so this is XHR. A CORS-blocked or
// dropped PUT surfaces as a status-0 error, which the caller treats as "direct
// upload isn't usable here" and falls back to the proxied route.
function putToS3(uploadUrl, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl, true);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    // Must match the CacheControl that was signed, or S3 rejects the signature.
    xhr.setRequestHeader('Cache-Control', 'public, max-age=31536000, immutable');
    xhr.upload.addEventListener('progress', (e) => {
      if (onProgress && e.lengthComputable) onProgress(e.loaded / e.total);
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(Object.assign(new Error(`S3 refused the upload (HTTP ${xhr.status})`), { direct: true }));
    });
    xhr.addEventListener('error', () => reject(Object.assign(
      new Error('Could not reach S3 directly'), { direct: true })));
    xhr.addEventListener('abort', () => reject(Object.assign(
      new Error('Upload cancelled'), { direct: true })));
    xhr.send(file);
  });
}

// The one upload path everything else calls. Returns the same
// { url, id, item } shape whichever route it took.
//
//   direct  — presign → browser PUTs to S3 → register the library record.
//             The bytes skip this app and its reverse proxy entirely, which is
//             what makes big videos reliable.
//   proxied — multipart POST to /api/admin/upload (the original route). Used
//             for HEIC, when S3 isn't configured, and as the fallback whenever
//             a direct attempt fails for a reason that isn't the file itself.
async function uploadOne(file, meta = {}, onProgress) {
  checkUploadSize(file);

  if (state.directUpload && !needsServerTranscode(file)) {
    try {
      const signed = await api('POST', '/api/admin/upload-url', {
        filename: file.name,
        contentType: file.type || '',
        size: file.size,
      });
      await putToS3(signed.uploadUrl, file, onProgress);
      return await api('POST', '/api/admin/upload-register', { key: signed.key, ...meta });
    } catch (err) {
      // A rejection from S3 itself (CORS not set, network wall) means direct
      // upload isn't usable from this browser — stop trying for the session and
      // fall through. A rejection from our own API (413 too large, 415 wrong
      // type) is about the file, so let it stand.
      if (!err.direct) throw err;
      console.warn('[upload] direct-to-S3 failed, falling back to the server route:', err.message);
      state.directUpload = false;
    }
  }

  if (onProgress) onProgress(0);
  const fd = new FormData();
  fd.append('file', file);
  Object.entries(meta).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') fd.append(k, v);
  });
  return api('POST', '/api/admin/upload', fd, true);
}

// Upload bytes only. Every upload auto-registers into the gallery library;
// here we just need the returned URL for the field being edited.
async function uploadFile(file) {
  const res = await uploadOne(file);
  return res.url;
}

// Overwrite the bytes behind an existing URL. Unlike every other upload this
// creates no new file and no new library record: the URL stays exactly as it is,
// which is what lets one edit reach every record already pointing at it.
//
// Always the proxied route — the presigned direct PUT signs a fresh key, and the
// server is the only place that can check the key we are overwriting is really
// ours and really exists.
async function replaceStoredImage(url, file) {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('url', url);
  return api('POST', '/api/admin/upload-replace', fd, true);
}

// Upload with metadata (used by the Gallery tab's own upload form). Returns the
// full { url, id, item } response so the caller gets the created library record.
async function uploadImage(file, meta = {}, onProgress) {
  return uploadOne(file, meta, onProgress);
}

// Upload several files in sequence. Each one still registers itself in the
// gallery library, so a batch added to a product also lands in the central
// library.
//
// A batch never throws: one bad file (oversized, unreadable, a network blip)
// must not throw away the files that already uploaded, so failures are
// collected and returned alongside the successes. `onProgress(doneCount,
// total, file)` fires before each file starts.
async function uploadFiles(files, onProgress) {
  const items = [];
  const errors = [];
  let done = 0;
  for (const file of files) {
    if (onProgress) onProgress(done, files.length, file, 0);
    try {
      const res = await uploadOne(file, {}, (frac) => {
        if (onProgress) onProgress(done, files.length, file, frac);
      });
      items.push(normalizeMedia({ url: res.url, type: (res.item && res.item.type) || undefined }));
    } catch (err) {
      errors.push({ file, message: err.message });
    }
    done += 1;
  }
  return { items, errors };
}

// One toast for a whole batch: silent success, the single message when only one
// file failed, and a partial-success summary when some got through.
function reportUploadResult(okCount, errors, { done = 'uploaded to the library' } = {}) {
  if (errors.length && !okCount) {
    toast(errors.length === 1 ? errors[0].message : `All ${errors.length} files failed — ${errors[0].message}`, true);
  } else if (errors.length) {
    toast(`${okCount} ${done} · ${errors.length} failed — ${errors[0].message}`, true);
  } else {
    toast(okCount === 1 ? `1 file ${done}` : `${okCount} files ${done}`);
  }
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
  const edit = $('[data-upload-edit]', root);
  const clear = $('[data-upload-clear]', root);
  const fileInput = $('.upload__input', root);
  const preview = $('.upload__preview', root);
  const hidden = $('input[type="hidden"]', root);

  const setImage = (url) => {
    hidden.value = url;
    // previewSrc so an in-place replacement is visible here immediately rather
    // than showing the bytes the browser already cached for this URL.
    preview.style.backgroundImage = `url('${previewSrc(url)}')`;
    preview.textContent = '';
    if (edit) edit.disabled = !url;
  };

  trigger?.addEventListener('click', () => fileInput.click());
  pick?.addEventListener('click', () => {
    openGalleryPicker({ onSelect: (item) => { setImage(item.url); toast('Image selected'); } });
  });
  // Single-image fields get the same editor the media lists and section slots
  // have — there is no reason a blog's cover photo should be the one image on
  // the site that can't be straightened or cropped.
  edit?.addEventListener('click', () => {
    if (!hidden.value) return;
    openFrameModal({ url: hidden.value, type: 'image' }, (updated) => {
      // Only the URL matters here: this field stores a bare URL string, so a
      // focal point has nowhere to live and a copy is what changes anything.
      setImage(updated.url || hidden.value);
    }, { aspect: '1.6' });
  });
  clear?.addEventListener('click', () => {
    hidden.value = '';
    preview.style.backgroundImage = '';
    preview.textContent = 'No image';
    if (edit) edit.disabled = true;
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

// ---------- Enquiries ----------
//
// The read side of every lead the site collects. The content a customer sent is
// never editable here — only the status and the studio's own notes — so the row
// stays a faithful record of what arrived.

const ENQUIRY_TYPE_META = {
  contact: { label: 'Contact form' },
  workshop: { label: 'Workshop' },
  newsletter: { label: 'Newsletter' },
};
const ENQUIRY_STATUS_META = {
  new: { label: 'New', cls: 'ostatus--created' },
  contacted: { label: 'Contacted', cls: 'ostatus--shipped' },
  closed: { label: 'Closed', cls: 'ostatus--delivered' },
};

function enquiryStatusBadge(status) {
  const m = ENQUIRY_STATUS_META[status] || { label: status || 'New', cls: '' };
  return `<span class="ostatus ${m.cls}">${escapeHtml(m.label)}</span>`;
}

// Date AND time — two enquiries on the same day are common, and knowing which
// came first matters when you're calling people back.
function enquiryDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

async function loadEnquiries() {
  try {
    state.enquiries = await api('GET', '/api/admin/enquiries');
    renderEnquiries();
  } catch (e) {
    toast(e.message, true);
  }
}

function enquiryMatches(e, q) {
  if (!q) return true;
  return [e.name, e.email, e.phone, e.company, e.workshopTitle, e.message]
    .join(' ').toLowerCase().includes(q);
}

function renderEnquiries() {
  const wrap = $('#enquiries-list');
  if (!wrap) return;
  const q = state.enquirySearch.trim().toLowerCase();
  const list = state.enquiries.filter((e) =>
    (state.enquiryTypeFilter === 'all' || e.type === state.enquiryTypeFilter)
    && (state.enquiryStatusFilter === 'all' || (e.status || 'new') === state.enquiryStatusFilter)
    && enquiryMatches(e, q));

  if (!list.length) {
    wrap.innerHTML = emptyState(state.enquiries.length
      ? 'No enquiries match these filters.'
      : 'No enquiries yet. Submissions from the contact form, workshop booking panel, and newsletter box land here.');
    return;
  }

  wrap.innerHTML = list.map((e) => {
    const type = (ENQUIRY_TYPE_META[e.type] || { label: e.type || 'Enquiry' }).label;
    const who = [e.name, e.email].filter(Boolean).map(escapeHtml).join(' · ') || '—';
    const about = e.type === 'workshop' && e.workshopTitle
      ? ` · <strong>${escapeHtml(e.workshopTitle)}</strong>`
      : '';
    // A lead nobody was emailed about is the one that gets missed — call it out.
    const unmailed = e.emailed === false
      ? '<span class="order-tag" title="The studio notification email did not go out">Email failed</span>'
      : '';
    const preview = (e.message || '').replace(/\s+/g, ' ').slice(0, 140);
    return `
      <div class="admin-row order-row">
        <div class="order-row__main">
          <p class="order-row__title"><strong>${escapeHtml(type)}</strong> ${enquiryStatusBadge(e.status || 'new')} ${unmailed}</p>
          <p class="admin-row__meta">${who}${about} · ${escapeHtml(enquiryDate(e.createdAt))}</p>
          ${preview ? `<p class="admin-row__meta">${escapeHtml(preview)}${(e.message || '').length > 140 ? '…' : ''}</p>` : ''}
        </div>
        <div class="order-row__actions">
          <button class="btn btn--ghost btn--sm" data-view-enquiry="${escapeAttr(e.id)}">View</button>
          <button class="btn btn--ghost btn--sm" data-del-enquiry="${escapeAttr(e.id)}">Delete</button>
        </div>
      </div>`;
  }).join('');
}

$('#enquiries-list')?.addEventListener('click', (ev) => {
  const view = ev.target.closest('[data-view-enquiry]');
  if (view) {
    const e = state.enquiries.find((x) => x.id === view.dataset.viewEnquiry);
    if (e) openEnquiryModal(e);
    return;
  }
  const del = ev.target.closest('[data-del-enquiry]');
  if (del) confirmDeleteEnquiry(del.dataset.delEnquiry);
});

$('#enquiries-search')?.addEventListener('input', (e) => {
  state.enquirySearch = e.target.value;
  renderEnquiries();
});

$('#enquiry-type-filter')?.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  state.enquiryTypeFilter = chip.dataset.type;
  $$('#enquiry-type-filter .chip').forEach((c) => c.classList.toggle('active', c === chip));
  renderEnquiries();
});

$('#enquiry-status-filter')?.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  state.enquiryStatusFilter = chip.dataset.status;
  $$('#enquiry-status-filter .chip').forEach((c) => c.classList.toggle('active', c === chip));
  renderEnquiries();
});

function enquiryDetailRow(label, value, href) {
  if (!value) return '';
  const shown = href
    ? `<a class="link-quiet" href="${escapeAttr(href)}">${escapeHtml(value)}</a>`
    : escapeHtml(value);
  return `<p class="admin-row__meta" style="margin-bottom:6px;"><strong>${escapeHtml(label)}:</strong> ${shown}</p>`;
}

function openEnquiryModal(e) {
  const type = (ENQUIRY_TYPE_META[e.type] || { label: e.type || 'Enquiry' }).label;
  openModal(`${type} — ${e.name || e.email || 'Enquiry'}`, `
    <div class="form-grid">
      <div>
        ${enquiryDetailRow('Received', enquiryDate(e.createdAt))}
        ${enquiryDetailRow('Name', e.name)}
        ${enquiryDetailRow('Email', e.email, e.email ? `mailto:${e.email}` : '')}
        ${enquiryDetailRow('Phone', e.phone, e.phone ? `tel:${e.phone.replace(/\s+/g, '')}` : '')}
        ${enquiryDetailRow('Company', e.company)}
        ${enquiryDetailRow('Workshop', e.workshopTitle)}
        ${enquiryDetailRow('Group size', e.groupSize && String(e.groupSize))}
        ${enquiryDetailRow('Preferred date', e.date)}
        ${e.emailed === false ? `<p class="field__error">The studio notification email failed to send${e.emailError ? ` — ${escapeHtml(e.emailError)}` : ''}. The enquiry itself was saved.</p>` : ''}
      </div>
      ${e.message ? `
        <div class="field">
          <span class="field__label">Message</span>
          <p class="admin-row__meta" style="white-space:pre-wrap;">${escapeHtml(e.message)}</p>
        </div>
      ` : ''}
      <label class="field">
        <span class="field__label">Status</span>
        <select id="enq-status">
          ${Object.entries(ENQUIRY_STATUS_META).map(([v, m]) =>
            `<option value="${v}" ${(e.status || 'new') === v ? 'selected' : ''}>${m.label}</option>`).join('')}
        </select>
      </label>
      <label class="field">
        <span class="field__label">Internal notes (not sent to the customer)</span>
        <textarea id="enq-notes" rows="4">${escapeHtml(e.notes || '')}</textarea>
      </label>
      <div class="form-actions">
        <button type="button" class="btn btn--ghost" data-modal-close>Close</button>
        <button type="button" class="btn btn--primary" id="enq-save">Save</button>
      </div>
    </div>
  `);

  $('#enq-save').addEventListener('click', async () => {
    const btn = $('#enq-save');
    btn.disabled = true;
    try {
      const updated = await api('PUT', `/api/admin/enquiries/${e.id}`, {
        status: $('#enq-status').value,
        notes: $('#enq-notes').value,
      });
      const i = state.enquiries.findIndex((x) => x.id === e.id);
      if (i !== -1) state.enquiries[i] = updated;
      renderEnquiries();
      closeModal();
      toast('Enquiry updated');
    } catch (err) {
      toast(err.message, true);
      btn.disabled = false;
    }
  });
}

function confirmDeleteEnquiry(id) {
  const e = state.enquiries.find((x) => x.id === id);
  openModal('Delete enquiry', `
    <p style="color:var(--sc-l3);margin-bottom:24px;">Delete the enquiry from <strong>${escapeHtml((e && (e.name || e.email)) || 'this sender')}</strong>? This removes the only record of it.</p>
    <div class="form-actions">
      <button type="button" class="btn btn--ghost" data-modal-close>Cancel</button>
      <button type="button" class="btn btn--danger" id="confirm-del-enquiry">Delete</button>
    </div>
  `);
  $('#confirm-del-enquiry').addEventListener('click', async () => {
    try {
      await api('DELETE', `/api/admin/enquiries/${id}`);
      state.enquiries = state.enquiries.filter((x) => x.id !== id);
      renderEnquiries();
      closeModal();
      toast('Enquiry deleted');
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
          : `<img class="card__media" src="${escapeAttr(previewSrc(g.url))}" alt="">`}
        <span class="card__tag ${g.public ? 'card__tag--public' : 'card__tag--private'}">${g.public ? 'Public' : 'Private'}</span>
      </div>
      <div class="card__body">
        <h3 class="card__title">${escapeHtml(g.title)}</h3>
        <p class="card__meta">${escapeHtml((g.tags || []).join(' · ')) || '—'}</p>
      </div>
      <div class="card__actions">
        <button class="btn btn--ghost btn--sm" data-gallery-edit="${g.id}">Edit</button>
        ${isVideoItem(g)
          ? ''
          : `<button class="btn btn--gold btn--sm" data-gallery-photo="${g.id}">Edit photo</button>`}
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
  const photoBtn = e.target.closest('[data-gallery-photo]');
  const delBtn = e.target.closest('[data-gallery-del]');
  if (editBtn) openGalleryForm(state.gallery.find((g) => g.id === editBtn.dataset.galleryEdit));
  if (delBtn) confirmDeleteGallery(delBtn.dataset.galleryDel);
  if (photoBtn) {
    // Editing at the source. A library image is the one place where replacing
    // the original is usually what you want — every record borrowing it picks
    // the fix up — so the editor opens unlocked, with no slot shape to obey.
    const item = state.gallery.find((g) => g.id === photoBtn.dataset.galleryPhoto);
    if (!item) return;
    openFrameModal({ url: item.url, type: 'image' }, async (updated) => {
      // A copy is a new file with its own auto-registered record, so the only
      // thing to persist here is a URL that actually changed.
      if (updated.url && updated.url !== item.url) {
        try {
          await api('PUT', `/api/admin/gallery/${item.id}`, { url: updated.url });
        } catch (err) { toast(err.message, true); }
      }
      loadAll();
    }, { aspect: 'free' });
  }
});

$('#add-gallery-btn')?.addEventListener('click', () => openGalleryForm(null));

// New = upload form (file required). Edit = metadata only (delete + re-upload to
// change the image). Both flows keep a single library record per image.
// HEIC can't be decoded by Chrome or Firefox (Safari can), so a preview is not
// always possible — say so rather than showing a broken image. The file is
// transcoded to JPEG server-side on upload either way.
const HEIC_RE = /\.(heic|heif)$/i;

let filePreviewUrl = null;

function releaseFilePreview() {
  if (filePreviewUrl) {
    URL.revokeObjectURL(filePreviewUrl);
    filePreviewUrl = null;
  }
}

function wireGalleryFilePreview() {
  const input = $('#gallery-file');
  const box = $('#gallery-preview');
  const nameEl = $('#gallery-file-name');
  const errEl = $('#gallery-file-error');

  $('#gallery-file-btn').addEventListener('click', () => input.click());

  input.addEventListener('change', () => {
    releaseFilePreview();
    errEl.hidden = true;
    const files = Array.from(input.files || []);
    const file = files[0];
    if (!file) {
      box.innerHTML = '<span class="file-preview__empty">Nothing chosen yet</span>';
      nameEl.textContent = 'No files chosen';
      return;
    }

    // Only the first file gets a visual preview — the label carries the count.
    const size = (bytes) => (bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);
    const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
    nameEl.textContent = files.length === 1
      ? `${file.name} · ${size(file.size)}`
      : `${files.length} files · ${size(totalBytes)} · previewing ${file.name}`;

    // Flag oversized files now instead of after a long failed upload.
    const tooBig = files.filter((f) => f.size / 1024 / 1024 > state.maxUploadMB);
    if (tooBig.length) {
      errEl.textContent = tooBig.length === 1
        ? `"${tooBig[0].name}" is ${(tooBig[0].size / 1024 / 1024).toFixed(1)} MB — the limit is ${state.maxUploadMB} MB. Compress it and choose again.`
        : `${tooBig.length} of these files are over the ${state.maxUploadMB} MB limit and will be skipped.`;
      errEl.hidden = false;
    }

    const isVideo = file.type.startsWith('video/') || VIDEO_URL_RE.test(file.name);
    const isHeic = HEIC_RE.test(file.name) || /^image\/hei[cf]$/i.test(file.type);
    filePreviewUrl = URL.createObjectURL(file);

    if (isVideo) {
      box.innerHTML = `<video class="file-preview__media" src="${filePreviewUrl}" controls muted playsinline preload="metadata"></video>`;
      return;
    }
    if (isHeic) {
      box.innerHTML = '<span class="file-preview__empty">HEIC selected — this browser can\'t preview it.'
        + '<br>It will be converted to JPEG when you upload.</span>';
      releaseFilePreview();
      return;
    }
    const img = document.createElement('img');
    img.className = 'file-preview__media';
    img.alt = '';
    img.onerror = () => { box.innerHTML = '<span class="file-preview__empty">This file can\'t be previewed.</span>'; };
    img.src = filePreviewUrl;
    box.innerHTML = '';
    box.appendChild(img);
  });
}

function openGalleryForm(item) {
  const isEdit = !!item;
  // New uploads are public by default — the library is the site's design
  // gallery, so hiding is the exception you opt into, not the default.
  const g = item || { title: '', description: '', alt: '', tags: [], public: true };
  openEditor(isEdit ? `Edit — ${g.title}` : 'Upload media', `
    <form id="gallery-form" class="form-grid" autocomplete="off">
      ${isEdit ? `
        <div class="upload">
          ${isVideoItem(g)
            ? `<video class="upload__preview" src="${escapeAttr(g.url)}" controls muted playsinline preload="metadata"></video>`
            : `<div class="upload__preview" style="background-image:url('${escapeAttr(g.url)}')"></div>`}
        </div>
      ` : `
        <div class="field">
          <span class="field__label">Image or video files</span>
          <div class="upload__preview file-preview" id="gallery-preview">
            <span class="file-preview__empty">Nothing chosen yet</span>
          </div>
          <div class="file-preview__bar">
            <button type="button" class="btn btn--ghost btn--sm" id="gallery-file-btn">Choose files</button>
            <span class="file-preview__name" id="gallery-file-name">No files chosen</span>
          </div>
          <input type="file" accept="image/*,video/*,.heic,.heif" name="file" id="gallery-file" multiple required hidden>
          <span class="field__hint">Pick several at once — each becomes its own library record. Images, HEIC (auto-converted to JPEG), and video up to ${state.maxUploadMB} MB each.</span>
          <p class="field__error" id="gallery-file-error" hidden></p>
        </div>
      `}
      <label class="field">
        <span class="field__label">Title</span>
        <input name="title" required value="${escapeAttr(g.title)}">
        ${isEdit ? '' : '<span class="field__hint">With several files, each record is numbered — "Indigo saree 1", "Indigo saree 2", and so on.</span>'}
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
        <label for="g-public">Public — show in the consumer design gallery. Uncheck to keep ${isEdit ? 'it' : 'them'} hidden.</label>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn--ghost" data-modal-close>Cancel</button>
        <button type="submit" class="btn btn--primary">${isEdit ? 'Save changes' : 'Upload'}</button>
      </div>
    </form>
  `);

  // Live preview of the chosen file, so you can see what you're about to add
  // rather than trusting a filename. The bytes never leave the browser here —
  // it's a blob URL over the local File.
  if (!isEdit) wireGalleryFilePreview();

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
        const files = Array.from($('#gallery-file').files || []);
        if (!files.length) { toast('Choose at least one file', true); submitBtn.disabled = false; return; }
        // One request per file — the API takes a single file — but the metadata
        // typed once applies to all of them, with the title numbered per file.
        const errors = [];
        let ok = 0;
        for (const [i, file] of files.entries()) {
          const head = files.length === 1 ? `Uploading ${file.name}` : `Uploading ${i + 1} of ${files.length} — ${file.name}`;
          toast(`${head}…`);
          try {
            const dims = await readImageDims(file); // uploadImage size-checks
            await uploadImage(file, {
              ...meta,
              title: files.length > 1 ? `${meta.title} ${i + 1}` : meta.title,
              width: dims.width || '',
              height: dims.height || '',
            }, (frac) => toast(`${head}… ${Math.round(frac * 100)}%`));
            ok += 1;
          } catch (err) {
            errors.push({ file, message: err.message });
          }
        }
        if (!ok) {
          reportUploadResult(0, errors);
          submitBtn.disabled = false;
          loadGallery();
          return;
        }
        reportUploadResult(ok, errors);
      }
      closeEditor({ force: true });
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
  openEditor(isEdit ? `Edit — ${v.code}` : 'New discount code', `
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
      closeEditor({ force: true });
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
  openEditor(isEdit ? `Order ${v.id}` : 'New order', `
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
      closeEditor({ force: true });
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
  openEditor('New admin', `
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
      closeEditor({ force: true });
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

// ---------- Full-page editor ----------
//
// Editors take over the content area rather than opening a dialog. The sticky
// bar drives the form underneath it, so `Save` is always reachable on a long
// form. Small confirmations (delete, discard) still use the centred modal.

let editor = null;   // { dirty, backLabel } while an editor is open

const editorIsOpen = () => !$('#editor-view').hidden;

// Any edit anywhere in the body marks the editor dirty. Form fields report
// themselves; the media list calls markEditorDirty() directly, since reordering
// or cropping never fires an input event.
function markEditorDirty() {
  if (editor) editor.dirty = true;
}

// An editor is always opened from the list it belongs to, so the back label is
// derived rather than repeated at every call site.
const TAB_LABELS = {
  products: 'Products', orders: 'Orders', workshops: 'Workshops', blogs: 'Blogs',
  sections: 'All images', gallery: 'Gallery', discounts: 'Discounts', admins: 'Admins',
  shipping: 'Shipping', enquiries: 'Enquiries', process: 'The Process',
  // The page-design panel names itself after the page being edited.
  pages: 'page design',
};

function openEditor(title, bodyHtml) {
  $('#editor-title').textContent = title;
  $('#editor-back-label').textContent = TAB_LABELS[state.tab] || 'Back';
  $('#editor-body').innerHTML = bodyHtml;
  $$('[data-panel]').forEach((p) => { p.hidden = true; });
  $('#editor-view').hidden = false;

  // Mirror the form's own submit label into the sticky bar, so "Create product"
  // vs "Save changes" still reads correctly.
  const submit = $('#editor-body form button[type="submit"]');
  $('#editor-save').textContent = submit ? submit.textContent.trim() : 'Save';
  $('#editor-save').disabled = false;

  editor = { dirty: false };
  $('.admin-main')?.scrollTo?.({ top: 0 });
  window.scrollTo({ top: 0 });
}

// `force` skips the unsaved-changes guard — used after a successful save.
function closeEditor({ force = false, then = null } = {}) {
  if (!force && editor && editor.dirty) {
    confirmDiscard(() => closeEditor({ force: true, then }));
    return;
  }
  $('#editor-view').hidden = true;
  $('#editor-body').innerHTML = '';
  releaseFilePreview();
  editor = null;
  if (then) { then(); return; }
  // Restore whichever list the editor was opened from.
  $$('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== state.tab; });
}

function confirmDiscard(onDiscard) {
  openModal('Discard changes?', `
    <p style="color:var(--sc-l3);margin-bottom:24px;">Your edits haven't been saved. Leaving now loses them.</p>
    <div class="form-actions">
      <button type="button" class="btn btn--ghost" data-modal-close>Keep editing</button>
      <button type="button" class="btn btn--danger" id="confirm-discard">Discard</button>
    </div>
  `);
  $('#confirm-discard').addEventListener('click', () => {
    closeModal();
    onDiscard();
  });
}

$('#editor-back')?.addEventListener('click', () => closeEditor());
$('#editor-cancel')?.addEventListener('click', () => closeEditor());
$('#editor-save')?.addEventListener('click', () => {
  // Drive the form rather than duplicating its submit logic — requestSubmit
  // runs native validation first, exactly as the in-form button did.
  $('#editor-body form')?.requestSubmit();
});

// While a save is in flight the bar reports it. Every editor form either closes
// on success or raises an error toast on failure, so those two signals are
// enough to drive the button without each form having to manage it.
$('#editor-body')?.addEventListener('submit', () => {
  const btn = $('#editor-save');
  editor && (editor.saveLabel = btn.textContent);
  btn.disabled = true;
  btn.textContent = 'Saving…';
});

function resetEditorSaveButton() {
  if (!editor || !editor.saveLabel) return;
  const btn = $('#editor-save');
  btn.disabled = false;
  btn.textContent = editor.saveLabel;
  editor.saveLabel = null;
}

// A Cancel inside the form body means the same thing as the bar's Cancel.
$('#editor-body')?.addEventListener('click', (e) => {
  if (e.target.closest('[data-modal-close]')) closeEditor();
});
['input', 'change'].forEach((ev) =>
  $('#editor-body')?.addEventListener(ev, markEditorDirty));

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
  // A failed save leaves the editor open — put its button back.
  if (isError) resetEditorSaveButton();
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
// Kebab-case a name into a URL-safe slug — matches the `[a-z0-9-]+` the slug
// inputs are patterned on, and the shape the storefront's /shop/<slug> expects.
function slugify(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // é → e
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
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
      state.directUpload = !!(data && data.directUpload);
      showApp();
    })
    .catch(showLogin);
} else {
  showLogin();
}
