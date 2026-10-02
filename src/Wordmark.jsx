import { useEffect, useRef } from 'react';
import { WORDMARK } from './wordmark-path';

// The logo's own lettering (traced from the artwork). Near the pointer the letters come apart into
// particles that are pushed and swirled away, heat from white to ember, and spring back into place.
// At rest the canvas shows the exact lettering; reduced motion and no-canvas keep the plain SVG.
const BLEED_X = .3, BLEED_Y = 1.1;

export function WordmarkSvg({ className = '', title }) {
  return <svg className={className} viewBox={`0 0 ${WORDMARK.width} ${WORDMARK.height}`} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : 'true'} focusable="false">
    <path d={WORDMARK.d} fill="currentColor" fillRule="evenodd" />
  </svg>;
}

export default function Wordmark({ className = '', intro = false }) {
  const host = useRef(null), canvas = useRef(null);
  useEffect(() => {
    const el = host.current, cv = canvas.current, reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const ctx = cv?.getContext('2d');
    if (!ctx || reduced.matches) return;
    let n = 0, hx, hy, ox, oy, vx, vy, step = 2, dpr = 1, W = 0, H = 0, bx = 0, by = 0, text = null, fx = null, fxc = null;
    let last = 0, frame = 0, live = false, settled = true, pointer = { x: -1e4, y: -1e4, on: false }, burst = 0, introLeft = intro ? 1 : 0;
    const path = new Path2D(WORDMARK.d);

    const build = () => {
      const r = el.getBoundingClientRect(); if (!r.width) return;
      dpr = Math.min(devicePixelRatio || 1, 2);
      bx = Math.round(r.width * BLEED_X * dpr); by = Math.round(r.height * BLEED_Y * dpr);
      W = Math.round(r.width * dpr) + bx * 2; H = Math.round(r.height * dpr) + by * 2;
      cv.width = W; cv.height = H;
      text = document.createElement('canvas'); text.width = W; text.height = H;
      fx = document.createElement('canvas'); fx.width = W; fx.height = H; fxc = fx.getContext('2d');
      const t = text.getContext('2d'), s = r.width * dpr / WORDMARK.width;
      t.setTransform(s, 0, 0, s, bx, by); t.fillStyle = getComputedStyle(el).color; t.fill(path, 'evenodd');
      const px = t.getImageData(0, 0, W, H).data;
      step = Math.max(2, Math.round(1.7 * dpr));
      const xs = [], ys = [];
      // Every cell the lettering touches becomes a particle, so nothing of the letter stays behind when it moves.
      const a = (x, y) => px[(Math.min(H - 1, y) * W + Math.min(W - 1, x)) * 4 + 3];
      for (let y = by - step; y < H - by + step; y += step) for (let x = bx - step; x < W - bx + step; x += step) {
        if (Math.max(a(x, y), a(x + step - 1, y), a(x, y + step - 1), a(x + step - 1, y + step - 1), a(x + (step >> 1), y + (step >> 1))) > 24) { xs.push(x); ys.push(y); }
      }
      n = xs.length; hx = Float32Array.from(xs); hy = Float32Array.from(ys);
      ox = new Float32Array(n); oy = new Float32Array(n); vx = new Float32Array(n); vy = new Float32Array(n);
      if (introLeft > .9) for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, d = (.35 + Math.random() * .65); ox[i] = Math.cos(a) * d * W * .5; oy[i] = Math.sin(a) * d * H * .5; }
      el.dataset.particles = String(n);
      draw(); el.dataset.ready = 'true'; wake();
    };

    const COLORS = ['#f5f9ff', '#fff0d6', '#ffd9a0', '#ffc46b'];
    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      if (!text) return;
      ctx.drawImage(text, 0, 0);
      if (settled) return;
      // Lift the moved particles out of the lettering, then draw them where they are, coloured by speed.
      const buckets = [[], [], [], []];
      for (let i = 0; i < n; i++) {
        if (ox[i] === 0 && oy[i] === 0) continue;
        ctx.clearRect(hx[i], hy[i], step, step);
        const sp = Math.abs(vx[i]) + Math.abs(vy[i]) + (Math.abs(ox[i]) + Math.abs(oy[i])) * .04;
        buckets[sp < 1.2 ? 0 : sp < 3 ? 1 : sp < 6 ? 2 : 3].push(i);
      }
      // Particles overlap a little so a moving letter stays solid instead of breaking into stripes.
      const size = step * 1.15, off = (size - step) / 2;
      // Moving particles are drawn apart and laid back with a slight blur, so the letters bend softly instead of breaking into strands.
      fxc.clearRect(0, 0, W, H);
      buckets.forEach((list, b) => { fxc.fillStyle = COLORS[b]; for (const i of list) fxc.fillRect(hx[i] + ox[i] - off, hy[i] + oy[i] - off, size, size); });
      ctx.filter = `blur(${(.7 * dpr).toFixed(2)}px)`; ctx.drawImage(fx, 0, 0); ctx.filter = 'none';
    };

    const R = () => 140 * dpr;
    // Time based: one step per 60 Hz frame, so 120 Hz screens and slowed recordings move the same.
    const tick = now => {
      frame = 0;
      if (!live) return;
      const dt = last ? Math.min(3, Math.max(.25, (now - last) / 16.667)) : 1; last = now;
      const r2 = R() * R(), K = 1.9 * dpr, spring = introLeft ? .035 : .055, damp = (introLeft ? .88 : .87) ** dt;
      let moving = false;
      for (let i = 0; i < n; i++) {
        let ax = -ox[i] * spring, ay = -oy[i] * spring;
        if (pointer.on) {
          const dx = hx[i] + ox[i] - pointer.x, dy = hy[i] + oy[i] - pointer.y, d2 = dx * dx + dy * dy;
          if (d2 < r2) { const d = Math.sqrt(d2) + .01, f = (1 - d / R()) ** 2 * K * (1 + burst); ax += (dx / d) * f - (dy / d) * f * .14; ay += (dy / d) * f + (dx / d) * f * .14; }
        }
        vx[i] = (vx[i] + ax * dt) * damp; vy[i] = (vy[i] + ay * dt) * damp; ox[i] += vx[i] * dt; oy[i] += vy[i] * dt;
        if (Math.abs(ox[i]) + Math.abs(oy[i]) < .12 && Math.abs(vx[i]) + Math.abs(vy[i]) < .04) { ox[i] = oy[i] = vx[i] = vy[i] = 0; } else moving = true;
      }
      burst *= .9 ** dt; if (introLeft) introLeft = Math.max(0, introLeft - .012 * dt);
      settled = !moving;
      draw();
      el.toggleAttribute('data-moving', moving);
      if (moving || pointer.on) frame = requestAnimationFrame(tick); else { live = false; last = 0; }
    };
    const wake = () => { if (!live && n) { live = true; settled = false; frame = requestAnimationFrame(tick); } };

    const move = e => {
      const r = cv.getBoundingClientRect(), x = (e.clientX - r.left) * dpr, y = (e.clientY - r.top) * dpr;
      const near = x > -R() && y > -R() && x < W + R() && y < H + R() && el.closest('[data-on]') !== null;
      pointer = { x, y, on: near };
      if (near) wake();
    };
    const down = e => { move(e); if (pointer.on) { burst = 2.2; wake(); } };
    const leave = () => { pointer.on = false; };
    const sizing = new ResizeObserver(build); sizing.observe(el);
    addEventListener('pointermove', move, { passive: true }); addEventListener('pointerdown', down, { passive: true });
    document.addEventListener('pointerleave', leave); addEventListener('blur', leave);
    return () => { cancelAnimationFrame(frame); sizing.disconnect(); removeEventListener('pointermove', move); removeEventListener('pointerdown', down); document.removeEventListener('pointerleave', leave); removeEventListener('blur', leave); };
  }, [intro]);
  return <span className={'wordmark-mark ' + className} ref={host}>
    <WordmarkSvg className="wordmark-svg" />
    <canvas ref={canvas} className="wordmark-particles" aria-hidden="true" style={{ left: -BLEED_X * 100 + '%', top: -BLEED_Y * 100 + '%', width: (1 + BLEED_X * 2) * 100 + '%', height: (1 + BLEED_Y * 2) * 100 + '%' }} />
  </span>;
}
