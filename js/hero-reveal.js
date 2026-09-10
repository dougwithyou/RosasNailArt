/**
 * ROSAS NAILS ART — Hero scroll reveal
 * The hero photo opens full-screen with a greeting; scrolling past the
 * first screen shrinks and docks it into its normal slot in the hero
 * grid. Respects prefers-reduced-motion by skipping straight to the
 * docked layout (the pre-existing, non-animated design).
 */
(function () {
  'use strict';

  const spacer = document.getElementById('hero-scroll-spacer');
  const photo = document.getElementById('hero-photo');
  const slot = document.getElementById('hero-photo-slot');
  if (!spacer || !photo || !slot) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (reduceMotion) {
    spacer.remove();
    photo.classList.add('hero-photo--static');
    slot.replaceWith(photo);
    const intro = photo.querySelector('.hero-photo__intro');
    const cue = photo.querySelector('.hero-photo__scrollcue');
    if (intro) intro.style.display = 'none';
    if (cue) cue.style.display = 'none';
    return;
  }

  const intro = photo.querySelector('.hero-photo__intro');
  const cue = photo.querySelector('.hero-photo__scrollcue');
  const chip = photo.querySelector('.hero-photo__chip');
  const badge = photo.querySelector('.hero-photo__badge');
  const header = document.getElementById('site-header');

  let spacerHeight = 0;
  let targetTop = 0;
  let targetLeft = 0;
  let targetWidth = 0;
  let targetHeight = 0;
  let targetRadius = 26;
  let docked = false;
  let ticking = false;

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function measure() {
    spacerHeight = spacer.offsetHeight;
    const r = slot.getBoundingClientRect();
    targetTop = r.top + window.scrollY - spacerHeight;
    targetLeft = r.left;
    targetWidth = r.width;
    targetHeight = r.height;
    targetRadius = parseFloat(getComputedStyle(slot).borderRadius) || 26;
  }

  function setHeaderHidden(hidden) {
    if (header) header.classList.toggle('hero-hidden', hidden);
  }

  function applyFixed(progress) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    setHeaderHidden(true);
    photo.style.position = 'fixed';
    photo.style.top = lerp(0, targetTop, progress) + 'px';
    photo.style.left = lerp(0, targetLeft, progress) + 'px';
    photo.style.width = lerp(vw, targetWidth, progress) + 'px';
    photo.style.height = lerp(vh, targetHeight, progress) + 'px';
    photo.style.borderRadius = lerp(0, targetRadius, progress) + 'px';

    const textFade = 1 - Math.min(progress / 0.55, 1);
    if (intro) intro.style.opacity = textFade;

    const cueFade = 1 - Math.min(progress / 0.12, 1);
    if (cue) {
      cue.style.opacity = cueFade;
      cue.style.pointerEvents = cueFade > 0.05 ? 'auto' : 'none';
    }

    const badgeFade = Math.max(0, (progress - 0.55) / 0.35);
    if (chip) chip.style.opacity = badgeFade;
    if (badge) badge.style.opacity = badgeFade;
  }

  function dock() {
    docked = true;
    setHeaderHidden(false);
    photo.style.position = 'absolute';
    photo.style.top = spacerHeight + targetTop + 'px';
    photo.style.left = targetLeft + 'px';
    photo.style.width = targetWidth + 'px';
    photo.style.height = targetHeight + 'px';
    photo.style.borderRadius = targetRadius + 'px';
    if (intro) intro.style.opacity = 0;
    if (cue) {
      cue.style.opacity = 0;
      cue.style.pointerEvents = 'none';
    }
    if (chip) chip.style.opacity = 1;
    if (badge) badge.style.opacity = 1;
  }

  function onScroll() {
    const progress = Math.max(0, Math.min(window.scrollY / spacerHeight, 1));
    if (progress >= 1) {
      if (!docked) dock();
    } else {
      docked = false;
      applyFixed(progress);
    }
    ticking = false;
  }

  function requestTick() {
    if (!ticking) {
      requestAnimationFrame(onScroll);
      ticking = true;
    }
  }

  measure();
  onScroll();
  window.addEventListener('scroll', requestTick, { passive: true });
  window.addEventListener('resize', () => {
    measure();
    onScroll();
  });
})();
