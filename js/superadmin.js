/**
 * ROSAS NAILS ART — Superadmin panel (site content CMS)
 */
(function () {
'use strict';

const $ = (s, ctx = document) => ctx.querySelector(s);
const $$ = (s, ctx = document) => [...ctx.querySelectorAll(s)];

const SUPABASE_URL = 'https://ypezkqlcvwswkxblmasm.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlwZXprcWxjdndzd2t4YmxtYXNtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1MzIyNTgsImV4cCI6MjEwNDEwODI1OH0.oH3V8ZXcnfi2saEF-JQCQmD-EB_w97b1rj4AASlE4SI';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let content = {};

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj, path, value) {
  const keys = path.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (typeof cur[keys[i]] !== 'object' || cur[keys[i]] === null) cur[keys[i]] = {};
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
}
function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function authHeader() {
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}
async function apiFetch(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(await authHeader()), ...(options.headers || {}) };
  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error');
  return data;
}

// ── Auth ──────────────────────────────────────────
function showLoggedOut() {
  $('#admin-login').hidden = false;
  $('#admin-shell').hidden = true;
}
function showLoggedIn() {
  $('#admin-login').hidden = true;
  $('#admin-shell').hidden = false;
  loadContent();
}

async function initAuth() {
  const { data } = await sb.auth.getSession();
  if (data.session) showLoggedIn();
  else showLoggedOut();

  sb.auth.onAuthStateChange((_event, session) => {
    if (session) showLoggedIn();
    else showLoggedOut();
  });

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = $('#login-error');
    errorEl.hidden = true;
    const form = e.target;
    const { error } = await sb.auth.signInWithPassword({ email: form.email.value, password: form.password.value });
    if (error) {
      errorEl.textContent = 'Email o contraseña incorrectos.';
      errorEl.hidden = false;
    }
  });

  $('#btn-logout').addEventListener('click', () => sb.auth.signOut());
}

// ── Content loading ────────────────────────────────
async function loadContent() {
  try {
    const { content: c } = await apiFetch('/api/site-content');
    content = c || {};
  } catch (err) {
    content = {};
  }
  populateScalarFields();
  renderFeatures();
  renderGallery();
  renderTestimonials();
}

function populateScalarFields() {
  $$('[data-field]').forEach((el) => {
    const value = getPath(content, el.dataset.field);
    if (value != null) el.value = value;
  });
  $$('[data-preview]').forEach((img) => {
    const value = getPath(content, img.dataset.preview);
    if (value) {
      img.src = value;
      img.hidden = false;
    } else {
      img.hidden = true;
    }
  });
}

function collectScalarFields() {
  $$('[data-field]').forEach((el) => {
    if (el.value.trim()) setPath(content, el.dataset.field, el.value.trim());
  });
}

// ── Image upload (hero photo — static field) ──────
function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function uploadImage(file) {
  const fileBase64 = await readFileAsBase64(file);
  const { url } = await apiFetch('/api/site-content', {
    method: 'POST',
    body: JSON.stringify({ fileBase64, fileName: file.name, contentType: file.type }),
  });
  return url;
}

function initStaticImageUpload() {
  const btn = $('[data-upload-btn="hero.photoUrl"]');
  const input = $('[data-upload-input="hero.photoUrl"]');
  const preview = $('[data-preview="hero.photoUrl"]');
  btn.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      const url = await uploadImage(file);
      setPath(content, 'hero.photoUrl', url);
      preview.src = url;
      preview.hidden = false;
    } catch (err) {
      alert(err.message || 'No se pudo subir la imagen.');
    } finally {
      input.value = '';
    }
  });
}

// ── Repeatable lists ───────────────────────────────
function wireRepeatList(listEl, path, onRerender) {
  $$('.repeat-item', listEl).forEach((item) => {
    const idx = Number(item.dataset.index);
    $$('[data-list-field]', item).forEach((field) => {
      field.addEventListener('input', () => {
        const arr = getPath(content, path) || [];
        arr[idx] = { ...arr[idx], [field.dataset.listField]: field.value };
        setPath(content, path, arr);
      });
    });
    $('[data-remove]', item).addEventListener('click', () => {
      const arr = getPath(content, path) || [];
      arr.splice(idx, 1);
      setPath(content, path, arr);
      onRerender();
    });
  });
}

function renderFeatures() {
  const list = $('#features-list');
  const features = Array.isArray(content.why?.features) ? content.why.features : [];
  list.innerHTML = features
    .map(
      (f, i) => `
    <div class="repeat-item" data-index="${i}">
      <button type="button" class="repeat-item__remove" data-remove>Quitar</button>
      <div class="admin-form admin-form--inline">
        <label>Ícono (emoji)<input type="text" value="${escapeHtml(f.icon)}" data-list-field="icon"></label>
        <label>Título<input type="text" value="${escapeHtml(f.title)}" data-list-field="title"></label>
      </div>
      <label>Texto<textarea rows="2" data-list-field="text">${escapeHtml(f.text)}</textarea></label>
    </div>
  `
    )
    .join('');
  wireRepeatList(list, 'why.features', renderFeatures);
}

function renderGallery() {
  const list = $('#gallery-list');
  const items = Array.isArray(content.gallery) ? content.gallery : [];
  list.innerHTML = items
    .map(
      (g, i) => `
    <div class="repeat-item" data-index="${i}">
      <button type="button" class="repeat-item__remove" data-remove>Quitar</button>
      <div class="image-field">
        <div class="image-field__row">
          <img class="image-field__preview" src="${escapeHtml(g.imageUrl)}" ${g.imageUrl ? '' : 'hidden'} data-gallery-preview>
          <button type="button" class="btn btn--secondary" data-gallery-upload>Subir foto</button>
          <input type="file" accept="image/*" hidden data-gallery-file>
        </div>
      </div>
      <label>Descripción<input type="text" value="${escapeHtml(g.label)}" data-list-field="label"></label>
    </div>
  `
    )
    .join('');
  wireRepeatList(list, 'gallery', renderGallery);

  $$('[data-gallery-upload]', list).forEach((btn) => {
    const item = btn.closest('.repeat-item');
    const input = $('[data-gallery-file]', item);
    btn.addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      try {
        const url = await uploadImage(file);
        const idx = Number(item.dataset.index);
        content.gallery[idx] = { ...content.gallery[idx], imageUrl: url };
        const preview = $('[data-gallery-preview]', item);
        preview.src = url;
        preview.hidden = false;
      } catch (err) {
        alert(err.message || 'No se pudo subir la imagen.');
      } finally {
        input.value = '';
      }
    });
  });
}

function renderTestimonials() {
  const list = $('#testimonials-list');
  const items = Array.isArray(content.testimonials) ? content.testimonials : [];
  list.innerHTML = items
    .map(
      (t, i) => `
    <div class="repeat-item" data-index="${i}">
      <button type="button" class="repeat-item__remove" data-remove>Quitar</button>
      <label>Testimonio<textarea rows="2" data-list-field="quote">${escapeHtml(t.quote)}</textarea></label>
      <div class="admin-form admin-form--inline">
        <label>Nombre<input type="text" value="${escapeHtml(t.name)}" data-list-field="name"></label>
        <label>Servicio<input type="text" value="${escapeHtml(t.service)}" data-list-field="service"></label>
      </div>
    </div>
  `
    )
    .join('');
  wireRepeatList(list, 'testimonials', renderTestimonials);
}

function initAddButtons() {
  $('#btn-add-feature').addEventListener('click', () => {
    content.why = content.why || {};
    content.why.features = content.why.features || [];
    content.why.features.push({ icon: '✨', title: '', text: '' });
    renderFeatures();
  });
  $('#btn-add-gallery').addEventListener('click', () => {
    content.gallery = content.gallery || [];
    content.gallery.push({ imageUrl: '', label: '' });
    renderGallery();
  });
  $('#btn-add-testimonial').addEventListener('click', () => {
    content.testimonials = content.testimonials || [];
    content.testimonials.push({ quote: '', name: '', service: '' });
    renderTestimonials();
  });
}

function initSaveForm() {
  $('#content-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    collectScalarFields();
    const errorEl = $('#save-error');
    const successEl = $('#save-success');
    errorEl.hidden = true;
    successEl.hidden = true;
    try {
      await apiFetch('/api/site-content', { method: 'PUT', body: JSON.stringify({ content }) });
      successEl.hidden = false;
    } catch (err) {
      errorEl.textContent = err.message || 'No se pudo guardar el contenido.';
      errorEl.hidden = false;
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  if (!$('.admin-page')) return;
  initAuth();
  initStaticImageUpload();
  initAddButtons();
  initSaveForm();
});

})();
