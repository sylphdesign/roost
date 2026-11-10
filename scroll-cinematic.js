/* Roost homepage — scroll-scrubbed canvas frame sequences + reveals + counters.
   Each clip is a folder of numbered JPGs; scroll position picks the frame. */
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function initScrub(cfg) {
  const section = document.querySelector(cfg.section);
  const canvas = section.querySelector('canvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  const lines = [...section.querySelectorAll('.reveal-line')];
  const fill = section.querySelector('.progress-fill');
  const images = [];
  let current = -1;
  let firstDrawn = false;

  // Load frame 1 first so something shows at once, then the rest.
  for (let i = 0; i < cfg.frameCount; i++) {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => { if (!firstDrawn && i === 0) { firstDrawn = true; draw(0); } };
    img.src = cfg.framePath(i + 1);
    images[i] = img;
    if (reduceMotion) break; // reduced motion: show the first frame only
  }

  function draw(index) {
    const img = images[index];
    if (!img || !img.complete || !img.naturalWidth) return;
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    const ir = img.naturalWidth / img.naturalHeight, cr = cw / ch;
    let dw, dh, dx, dy;
    if (ir > cr) { dh = ch; dw = ch * ir; dx = (cw - dw) / 2; dy = 0; } else { dw = cw; dh = cw / ir; dx = 0; dy = (ch - dh) / 2; }
    ctx.fillStyle = cfg.bg || '#00303a';
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(img, dx, dy, dw, dh);
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(current < 0 ? 0 : current);
  }

  function update() {
    const rect = section.getBoundingClientRect();
    if (rect.bottom < -window.innerHeight || rect.top > window.innerHeight) return;
    const scrollable = rect.height - window.innerHeight;
    const p = Math.min(Math.max(-rect.top / scrollable, 0), 1);
    const idx = reduceMotion ? 0 : Math.min(cfg.frameCount - 1, Math.floor(p * (cfg.frameCount - 1)));
    if (idx !== current) {
      // If the wanted frame is not loaded yet, keep the last one on screen.
      if (images[idx] && images[idx].complete) { current = idx; draw(idx); }
    }
    if (fill) fill.style.width = (p * 100).toFixed(2) + '%';
    for (const el of lines) {
      const a = parseFloat(el.dataset.in), b = parseFloat(el.dataset.out);
      const mid = (a + b) / 2, half = (b - a) / 2;
      const o = Math.max(0, Math.min(1, (1 - Math.abs(p - mid) / half) * 1.6));
      el.style.opacity = o.toFixed(3);
      el.style.transform = `translateY(${((1 - o) * 30).toFixed(1)}px)`;
      el.style.pointerEvents = o > 0.5 ? 'auto' : 'none';
    }
  }

  window.addEventListener('resize', resize);
  resize();
  return { update };
}

function animateCount(el) {
  const target = parseFloat(el.dataset.count), suffix = el.dataset.suffix || '';
  const dur = 1400, t0 = performance.now();
  function step(t) {
    const k = Math.min((t - t0) / dur, 1), eased = 1 - Math.pow(1 - k, 3);
    el.textContent = Math.round(target * eased) + suffix;
    if (k < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

document.addEventListener('DOMContentLoaded', () => {
  const scrubs = (window.SCRUB_SECTIONS || []).filter((c) => document.querySelector(c.section)).map(initScrub);

  const lenis = window.Lenis && !reduceMotion ? new window.Lenis({ lerp: 0.09, smoothWheel: true }) : null;
  function raf(t) { if (lenis) lenis.raf(t); scrubs.forEach((s) => s.update()); requestAnimationFrame(raf); }
  requestAnimationFrame(raf);

  // In-page links scroll smoothly through Lenis.
  document.querySelectorAll('a[href^="#"]').forEach((a) => a.addEventListener('click', (e) => {
    const target = document.querySelector(a.getAttribute('href'));
    if (!target) return;
    e.preventDefault();
    if (lenis) lenis.scrollTo(target, { offset: -60 }); else target.scrollIntoView();
  }));

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('in');
      const num = e.target.querySelector('.stat-num');
      if (num) animateCount(num);
      io.unobserve(e.target);
    }
  }, { threshold: 0.2 });
  document.querySelectorAll('.reveal').forEach((el) => io.observe(el));

  const hint = document.querySelector('.scroll-hint');
  window.addEventListener('scroll', () => { if (hint) hint.style.opacity = window.scrollY > 60 ? '0' : '1'; }, { passive: true });
});
