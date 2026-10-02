// One pinned flight through the gate. Each stop shapes the aperture from the logo:
// band = half-height of the dark slot as a fraction of half the viewport height,
// flat = half-width of the straight part as a fraction of half the viewport width,
// slope = how fast the wedges open toward the edges, glow = ember on the slot edges.
// Crystal: cx/cy as fractions of the half viewport, cs in min(width, height) units, cv visibility.
export const STOPS = [
  { id: 'hero', band: .3, flat: .42, slope: .26, glow: 1, blur: .03, cx: 0, cy: .95, cs: .07, cv: 0, n: { band: .25 } },
  { id: 'public', band: .022, flat: .96, slope: .02, glow: 1.6, blur: .01, cx: 0, cy: .5, cs: .085, cv: 1, n: { cx: .62, cy: .07, cs: .055 } },
  { id: 'deposit', band: .24, flat: .46, slope: .3, glow: 1.15, blur: .028, cx: .3, cy: 0, cs: .075, cv: 1, n: { band: .2, cx: .7, cs: .06 } },
  { id: 'inside', band: .84, flat: .96, slope: .04, glow: .95, blur: .02, cx: .3, cy: 0, cs: 0, cv: 0, n: { cx: .7 } },
  { id: 'withdraw', band: .2, flat: .46, slope: .3, glow: 1.15, blur: .028, cx: .46, cy: -.56, cs: .075, cv: 1, n: { cx: .66, cy: -.31, cs: .055 } },
  { id: 'vault', band: .36, flat: .6, slope: .22, glow: 1, blur: .026, cx: .46, cy: -1.3, cs: .05, cv: 0, n: { band: .26 } },
  { id: 'visible', band: .3, flat: .8, slope: .12, glow: .9, blur: .024, cx: 0, cy: -1.3, cs: .05, cv: 0 },
  { id: 'close', band: .3, flat: .42, slope: .26, glow: 1, blur: .03, cx: 0, cy: .95, cs: .07, cv: 0, n: { band: .25 } },
];

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
// Holds at each stop, eased travel between them.
const travel = x => { const k = clamp((x - .22) / .56); return k * k * k * (k * (k * 6 - 15) + 10); };

export function progressOf(track) {
  if (!track) return 0;
  const r = track.getBoundingClientRect(), span = r.height - innerHeight;
  return span > 0 ? clamp(-r.top / span) : 0;
}

// Reduced motion snaps from stop to stop instead of morphing between them. Narrow screens take a stop's n overrides.
export function stateAt(t, snap = false, narrow = false) {
  const f = clamp(t) * (STOPS.length - 1), i = Math.min(STOPS.length - 2, Math.floor(f));
  const a = STOPS[i], b = STOPS[i + 1], k = snap ? +(f - i >= .5) : travel(f - i), out = { f, snap };
  const at = (s, key) => narrow && s.n && key in s.n ? s.n[key] : s[key];
  for (const key of Object.keys(a)) if (typeof a[key] === 'number') out[key] = at(a, key) + (at(b, key) - at(a, key)) * k;
  return out;
}

// 1 while a chapter's stop holds, fading out before the gate starts to move.
export const activation = (f, i, snap) => snap ? +(Math.round(f) === i) : clamp(1 - (Math.abs(f - i) - .16) / .2);
