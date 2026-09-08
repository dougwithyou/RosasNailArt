/**
 * ROSAS NAILS ART — Landing page CMS hydration
 * Fetches editable content saved from superadmin.html and patches it into
 * the hardcoded defaults already in index.html. Anything missing/empty in
 * the saved content is simply left as-is, so the page never looks broken.
 */
(function () {
  'use strict';

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function setText(id, value) {
    if (!value) return;
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function applyContent(content) {
    const hero = content.hero || {};
    setText('hero-eyebrow', hero.eyebrow);
    setText('hero-title-main', hero.title);
    setText('hero-title-accent', hero.titleAccent);
    setText('hero-subtitle', hero.subtitle);
    if (hero.photoUrl) {
      const img = document.getElementById('hero-photo-img');
      if (img) {
        img.src = hero.photoUrl;
        img.hidden = false;
      }
    }

    const why = content.why || {};
    setText('why-paragraph', why.paragraph);
    if (Array.isArray(why.features) && why.features.length) {
      const wrap = document.getElementById('why-features');
      if (wrap) {
        wrap.innerHTML = why.features
          .map(
            (f) => `
          <div class="why-feature">
            <div class="why-feature__icon">${escapeHtml(f.icon || '✨')}</div>
            <div class="why-feature__body">
              <h4>${escapeHtml(f.title || '')}</h4>
              <p>${escapeHtml(f.text || '')}</p>
            </div>
          </div>
        `
          )
          .join('');
      }
    }

    if (Array.isArray(content.gallery) && content.gallery.length) {
      const grid = document.getElementById('gallery-grid');
      if (grid) {
        grid.innerHTML = content.gallery
          .map(
            (g) => `
          <div class="gallery-item">
            <div class="gallery-item__visual" style="background-image:url('${escapeHtml(g.imageUrl || '')}');background-size:cover;background-position:center"></div>
            <div class="gallery-item__overlay">
              <div class="gallery-item__label">${escapeHtml(g.label || '')}</div>
            </div>
          </div>
        `
          )
          .join('');
      }
    }

    if (Array.isArray(content.testimonials) && content.testimonials.length) {
      const grid = document.getElementById('testimonials-grid');
      if (grid) {
        grid.innerHTML = content.testimonials
          .map(
            (t) => `
          <div class="testimonial-card">
            <div class="testimonial-stars"><span>★</span><span>★</span><span>★</span><span>★</span><span>★</span></div>
            <p class="testimonial-quote">${escapeHtml(t.quote || '')}</p>
            <div class="testimonial-author">
              <div class="testimonial-avatar">${escapeHtml((t.name || '?').charAt(0))}</div>
              <div>
                <div class="testimonial-author__name">${escapeHtml(t.name || '')}</div>
                <div class="testimonial-author__service">${escapeHtml(t.service || '')}</div>
              </div>
            </div>
          </div>
        `
          )
          .join('');
      }
    }

    const footer = content.footer || {};
    setText('footer-about', footer.about);
    setText('footer-address', footer.address);
    setText('footer-hours', footer.hours);
    if (footer.phone) {
      const el = document.getElementById('footer-phone');
      if (el) {
        el.textContent = footer.phone;
        el.href = `tel:${footer.phone.replace(/[^\d+]/g, '')}`;
      }
    }
    if (footer.email) {
      const el = document.getElementById('footer-email');
      if (el) {
        el.textContent = footer.email;
        el.href = `mailto:${footer.email}`;
      }
    }
  }

  fetch('/api/site-content')
    .then((r) => r.json())
    .then(({ content }) => applyContent(content || {}))
    .catch(() => {
      /* keep the hardcoded defaults already in the page */
    });
})();
