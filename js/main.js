/**
 * ROSAS NAILS ART — Main JavaScript
 * Handles: navigation, scroll reveal, animations, mobile menu
 */

'use strict';

// ── Utility ──────────────────────────────────────
const $ = (s, ctx = document) => ctx.querySelector(s);
const $$ = (s, ctx = document) => [...ctx.querySelectorAll(s)];

// ── Navigation ───────────────────────────────────
function initNavigation() {
  const header  = $('#site-header');
  const burger  = $('#nav-burger');
  const drawer  = $('#nav-drawer');
  const navLinks = $$('.nav-link');

  // Sticky / scrolled state
  const observer = new IntersectionObserver(
    ([entry]) => header.classList.toggle('scrolled', !entry.isIntersecting),
    { threshold: 0, rootMargin: `-${getComputedStyle(document.documentElement).getPropertyValue('--nav-h')} 0px 0px 0px` }
  );

  const sentinel = document.createElement('div');
  sentinel.style.cssText = 'position:absolute;top:0;left:0;width:1px;height:1px;pointer-events:none';
  document.body.prepend(sentinel);
  observer.observe(sentinel);

  // Mobile burger
  if (burger && drawer) {
    burger.addEventListener('click', () => {
      const open = burger.classList.toggle('open');
      drawer.classList.toggle('open', open);
      burger.setAttribute('aria-expanded', open);
      document.body.style.overflow = open ? 'hidden' : '';
    });

    // Close drawer on link click
    $$('.nav-link', drawer).forEach(link => {
      link.addEventListener('click', () => {
        burger.classList.remove('open');
        drawer.classList.remove('open');
        burger.setAttribute('aria-expanded', false);
        document.body.style.overflow = '';
      });
    });
  }

  // Active page highlight
  const currentPath = window.location.pathname.split('/').pop() || 'index.html';
  navLinks.forEach(link => {
    const href = link.getAttribute('href') || '';
    if (href === currentPath || (currentPath === '' && href === 'index.html')) {
      link.classList.add('active');
    }
  });
}

// ── Scroll Reveal ────────────────────────────────
function initScrollReveal() {
  const items = $$('[data-reveal]');
  if (!items.length) return;

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const delay = entry.target.dataset.delay || 0;
          setTimeout(() => {
            entry.target.classList.add('revealed');
          }, Number(delay));
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
  );

  items.forEach(el => io.observe(el));
}

// ── Staggered reveal for grids ───────────────────
function initStaggerReveal() {
  $$('[data-stagger]').forEach(group => {
    const children = $$('[data-reveal]', group);
    children.forEach((child, i) => {
      child.dataset.delay = i * 80;
    });
  });
}

// ── Parallax Orbs ────────────────────────────────
function initParallax() {
  // Use scroll-driven animations if supported, else JS fallback
  const supportsScrollDriven = CSS.supports('animation-timeline', 'scroll()');
  if (supportsScrollDriven) return; // handled in CSS

  const orbs = $$('.parallax-orb');
  if (!orbs.length) return;

  let rafId;
  const handleScroll = () => {
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      const scrollY = window.scrollY;
      orbs.forEach(orb => {
        const rate = parseFloat(orb.dataset.rate || 0.15);
        orb.style.transform = `translateY(${scrollY * rate}px)`;
      });
    });
  };

  window.addEventListener('scroll', handleScroll, { passive: true });
}

// ── Marquee auto-pause on reduced motion ─────────
function initMarquee() {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  const tracks = $$('.marquee-track');
  
  const applyMotion = () => {
    tracks.forEach(t => {
      t.style.animationPlayState = mq.matches ? 'paused' : 'running';
    });
  };

  applyMotion();
  mq.addEventListener('change', applyMotion);
}

// ── Gallery filter ────────────────────────────────
function initGalleryFilter() {
  const filterBtns = $$('.filter-btn');
  if (!filterBtns.length) return;

  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const filter = btn.dataset.filter;
      $$('.gallery-masonry-item').forEach(item => {
        const show = filter === 'all' || item.dataset.category === filter;
        item.style.opacity = show ? '1' : '0.3';
        item.style.pointerEvents = show ? 'auto' : 'none';
      });
    });
  });
}

// ── Smooth page links ─────────────────────────────
function initSmoothScrollLinks() {
  $$('a[href^="#"]').forEach(link => {
    link.addEventListener('click', e => {
      const target = $(link.getAttribute('href'));
      if (!target) return;
      e.preventDefault();
      const top = target.getBoundingClientRect().top + window.scrollY
        - parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nav-h'));
      window.scrollTo({ top, behavior: 'smooth' });
    });
  });
}

// ── Cursor sparkle (subtle, optional) ─────────────
function initSparkle() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (window.matchMedia('(hover: none)').matches) return; // no sparkle on touch

  const colors = ['#e8c977', '#f784e6', '#a97e2f', '#ffedd5'];
  let last = 0;

  document.addEventListener('mousemove', ({ clientX: x, clientY: y }) => {
    const now = Date.now();
    if (now - last < 60) return;
    last = now;

    const dot = document.createElement('div');
    dot.style.cssText = `
      position: fixed;
      left: ${x}px;
      top: ${y}px;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: ${colors[Math.floor(Math.random() * colors.length)]};
      pointer-events: none;
      z-index: 9998;
      opacity: .8;
      transform: translate(-50%,-50%) scale(1);
      transition: transform 0.5s ease, opacity 0.5s ease;
    `;
    document.body.appendChild(dot);
    requestAnimationFrame(() => {
      dot.style.opacity = '0';
      dot.style.transform = `translate(-50%,-50%) scale(0) translateY(-${8 + Math.random() * 8}px)`;
    });
    setTimeout(() => dot.remove(), 500);
  });
}

// ── Init ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initStaggerReveal();
  initScrollReveal();
  initParallax();
  initMarquee();
  initGalleryFilter();
  initSmoothScrollLinks();
  initSparkle();
});
