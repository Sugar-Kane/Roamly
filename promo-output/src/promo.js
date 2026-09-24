/* Roamly Flow — 60 s promo. Pure, deterministic, seekable.
 * renderAt(t) sets every element from t alone: no timers, no rAF state, no randomness at draw time.
 * Formats: ?format=vertical (1080x1920) | ?format=wide (1920x1080). Layouts are recomposed per format.
 */
(() => {
'use strict';

// ------------------------------------------------------------------ setup
const Q = new URLSearchParams(location.search);
const FORMAT = Q.get('format') === 'wide' ? 'wide' : 'vertical';
const V = FORMAT === 'vertical';
const W = V ? 1080 : 1920, H = V ? 1920 : 1080;
const L = (v, w) => (V ? v : w);
const DUR = 60;
const RENDER = Q.has('render');

// ------------------------------------------------------------------ math
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const prog = (t, a, b) => clamp((t - a) / (b - a));
const E = {
  lin: x => x,
  inCubic: x => x * x * x,
  outCubic: x => 1 - (1 - x) ** 3,
  outQuart: x => 1 - (1 - x) ** 4,
  outQuint: x => 1 - (1 - x) ** 5,
  inOutCubic: x => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2),
  inOutQuint: x => (x < 0.5 ? 16 * x ** 5 : 1 - (-2 * x + 2) ** 5 / 2),
  inOutSine: x => -(Math.cos(Math.PI * x) - 1) / 2,
  outSine: x => Math.sin((x * Math.PI) / 2),
  inQuad: x => x * x,
  outExpo: x => (x >= 1 ? 1 : 1 - 2 ** (-10 * x)),
  outBack: x => { const c = 1.45; return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2; },
  outBackSoft: x => { const c = 0.9; return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2; },
  // organic "paper settle": fast in, tiny overshoot, damped
  settle: x => (x >= 1 ? 1 : 1 - Math.exp(-7 * x) * Math.cos(9 * x)),
};
function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hash = (i, j = 0) => { const r = rng((i * 73856093) ^ (j * 19349663)); r(); return r(); };
// smooth value noise in 1D for handheld/jitter
function vnoise(x, seed = 0) { const i = Math.floor(x), f = x - i; const a = hash(i, seed), b = hash(i + 1, seed); const u = f * f * (3 - 2 * f); return (a + (b - a) * u) * 2 - 1; }

// keyframe tracks: [[time, {x,y,r,s,o,...}, ease]] — ease belongs to the segment ending at that key
function mix(a, b, e) { const o = {}; for (const k in a) o[k] = a[k]; for (const k in b) { const av = a[k] === undefined ? b[k] : a[k]; o[k] = av + (b[k] - av) * e; } return o; }
function sample(keys, t) {
  if (t <= keys[0][0]) return { ...keys[0][1] };
  for (let i = 1; i < keys.length; i++) {
    if (t < keys[i][0]) {
      const [t0, a] = keys[i - 1], [t1, b, ez] = keys[i];
      return mix(a, b, (ez || E.inOutCubic)((t - t0) / (t1 - t0)));
    }
  }
  let acc = {}; for (const k of keys) acc = { ...acc, ...k[1] }; return acc;
}
// fill missing props forward so every key has full state
function norm(keys) { let s = { x: 0, y: 0, r: 0, s: 1, o: 1 }; return keys.map(([t, v, e]) => { s = { ...s, ...v }; return [t, s, e]; }); }

// ------------------------------------------------------------------ timeline (seconds)
const T = {
  clock: 0.35, lecture: 1.15, flash: 1.6, renal: 2.05, book: 2.45, thought1: 1.75,
  calendar: 2.95, circle: 3.35, thought2: 3.4, coffee: 3.85, phone: 4.15,
  stickies: [2.75, 4.55, 6.05, 7.4], timer: 5.0, thought3: 6.55,
  notifs: [4.45, 5.9, 7.1, 7.95, 8.6, 9.2, 9.6],
  freeze: 10.0, line0: 10.625, line1: 12.5, logo: 12.5, word: 12.85,
  unfold: 15.0, tasks: 17.5, upFly: 17.9, upDrop: 18.9, upRead: 19.45, upDone: 21.3, method: 23.3, flip: 24.0, start: 25.0,
  block1: 28.8, resume1: 29.3, breakEnd: 32.2,
  room: 33.0, join: 34.6, roomIn: 35.0, lapse0: 38.6, rbreak: 40.0, payoff: 45.0, rw: [46.3, 47.6, 48.8], cta: 50.0, tagA: 50.7, tagB: 52.45, ring: 52.3, final: 55.0, end: 60,
};

// SFX cue sheet (consumed by tools/build-audio.py). id → synth recipe name.
const CUES = [];
const cue = (t, id, g = 1, extra = {}) => CUES.push({ t: +t.toFixed(4), id, g, ...extra });

// ------------------------------------------------------------------ DOM helpers
const $ = (tag, cls, parent, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; if (parent) parent.appendChild(e); return e; };
const SVGNS = 'http://www.w3.org/2000/svg';
const S = (tag, attrs, parent) => { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
const px = n => `${n.toFixed(2)}px`;
function place(node, st, w, h) {
  // centers node (w×h) at (x,y)
  const o = st.o === undefined ? 1 : st.o;
  node.style.opacity = o <= 0.001 ? 0 : o.toFixed(3);
  node.style.visibility = o <= 0.001 ? 'hidden' : 'visible';
  node.style.transform = `translate(${px(st.x - w / 2)},${px(st.y - h / 2)}) rotate(${(st.r || 0).toFixed(3)}deg) scale(${(st.s === undefined ? 1 : st.s).toFixed(4)})`;
}
const show = (node, o) => { node.style.opacity = o.toFixed(3); node.style.visibility = o <= 0.001 ? 'hidden' : 'visible'; };
const setText = (node, s) => { if (node.__t !== s) { node.textContent = s; node.__t = s; } };
const setHTML = (node, s) => { if (node.__h !== s) { node.innerHTML = s; node.__h = s; } };
const setCls = (node, c, on) => { if (node.classList.contains(c) !== on) node.classList.toggle(c, on); };

// ------------------------------------------------------------------ icons (lucide geometry)
const I = {
  play: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  pause: '<svg viewBox="0 0 24 24" width="18" height="18"><rect x="6" y="4.5" width="4" height="15" rx="1.2" fill="currentColor"/><rect x="14" y="4.5" width="4" height="15" rx="1.2" fill="currentColor"/></svg>',
  skip: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"><path d="M6 5l10 7-10 7z"/><path d="M19 5v14"/></svg>',
  x: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  pip: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><rect x="12" y="12" width="7" height="5" rx="1"/></svg>',
  sliders: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>',
  timer: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="14" r="7"/><path d="M12 14l3-3M10 3h4"/></svg>',
  flame: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-6 1-9z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  chev: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
  info: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5" stroke-linecap="round"/></svg>',
  drop: '<svg viewBox="0 0 24 24" width="11" height="11"><path d="M12 3c3 4.5 6 7.5 6 11a6 6 0 0 1-12 0c0-3.5 3-6.5 6-11z" fill="#5fb4f0"/></svg>',
  checkG: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  navFocus: '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="14" r="7"/><path d="M12 14l2.5-2.5M10 3h4"/></svg>',
  navTasks: '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6l1.5 1.5L7 5M3 13l1.5 1.5L7 12M11 6h10M11 13h10M11 19h10"/></svg>',
  navRooms: '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.5 3-6 6-6s6 2.5 6 6M16 4.5a3.5 3.5 0 0 1 0 7M18 14c2 .8 3 3 3 6"/></svg>',
  navGarden: '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M12 21v-9M12 12c0-3 2-5 6-5 0 3-2 5-6 5zM12 14c0-3-2-5-6-5 0 3 2 5 6 5zM7 21h10"/></svg>',
  navAn: '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 20h16M7 17V9M12 17V5M17 17v-6"/></svg>',
  crown: '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"/></svg>',
  sparkles: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M10 3l1.8 5.2L17 10l-5.2 1.8L10 17l-1.8-5.2L3 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>',
  file: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/></svg>',
  users: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.5 3-6 6-6s6 2.5 6 6M16 4.5a3.5 3.5 0 0 1 0 7M18 14c2 .8 3 3 3 6"/></svg>',
  inf: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-3px"><path d="M12 12c-2-2.5-4-4-6-4a4 4 0 0 0 0 8c2 0 4-1.5 6-4zm0 0c2 2.5 4 4 6 4a4 4 0 0 0 0-8c-2 0-4 1.5-6 4z"/></svg>',
  send: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/></svg>',
  userPlus: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6M19 8v6M16 11h6"/></svg>',
  logout: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>',
  maximize: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>',
  msg: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M21 12a8.5 8.5 0 0 1-12.5 7.5L3 21l1.5-5.5A8.5 8.5 0 1 1 21 12z"/></svg>',
  lock: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  moon: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>',
};
const sprout = '<svg viewBox="0 0 40 44" width="30" height="33"><path d="M20 42V22" stroke="#5c8f3a" stroke-width="3" stroke-linecap="round"/><path d="M20 24C20 14 13 9 4 9c0 9 7 15 16 15z" fill="#79b547"/><path d="M20 22c0-9 6-14 15-14 0 8-6 14-15 14z" fill="#95cc5c"/><ellipse cx="20" cy="42" rx="7" ry="2" fill="rgba(40,25,10,.35)"/></svg>';
const logoSVG = (ring = '#886044', dot = ring) => `<svg viewBox="0 0 32 32" width="100%" height="100%"><rect width="32" height="32" rx="7" fill="#16181D"/><circle cx="16" cy="16" r="9" fill="none" stroke="${ring}" stroke-width="2.5" stroke-dasharray="42 14" stroke-linecap="round"/><circle cx="16" cy="16" r="2.5" fill="${dot}"/></svg>`;

// ------------------------------------------------------------------ stage & layers
const stage = document.getElementById('stage');
stage.style.width = W + 'px'; stage.style.height = H + 'px';
const scene = $('div', 'layer', stage); // wraps camera-driven content (for freeze filter)
scene.style.width = W + 'px'; scene.style.height = H + 'px';
const bg = $('canvas', 'full', scene); bg.width = W; bg.height = H; const bgx = bg.getContext('2d');
const world = $('div', 'layer', scene);
const propsL = $('div', 'layer', world);
const uiL = $('div', 'layer', world);
const inkSvg = S('svg', { width: 10, height: 10, style: 'position:absolute;left:0;top:0;overflow:visible' }, world);
const topL = $('div', 'layer', world); // thoughts & stamps above ink
const hud = $('div', 'layer', stage);
const fx = $('canvas', 'full', stage); fx.width = W; fx.height = H; const fxx = fx.getContext('2d');
const vig = $('div', 'full', stage); vig.style.cssText = `position:absolute;left:0;top:0;width:${W}px;height:${H}px;pointer-events:none`;
const grain = $('canvas', 'full', stage); grain.width = W / 2; grain.height = H / 2; grain.style.width = W + 'px'; grain.style.height = H + 'px'; grain.style.opacity = '0.075'; grain.style.mixBlendMode = 'multiply';
const gx = grain.getContext('2d');
const fadeEl = $('div', 'full', stage); fadeEl.style.cssText = `position:absolute;left:0;top:0;width:${W}px;height:${H}px;background:#f3eadb;pointer-events:none;opacity:0`;

// ------------------------------------------------------------------ textures
let NOISE_URL = '';
function makeNoise() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
  const d = x.createImageData(256, 256); const r = rng(7);
  for (let i = 0; i < d.data.length; i += 4) { const v = 128 + (r() - 0.5) * 36; d.data[i] = v; d.data[i + 1] = v * 0.97; d.data[i + 2] = v * 0.9; d.data[i + 3] = 30; }
  x.putImageData(d, 0, 0);
  // paper fibres
  x.strokeStyle = 'rgba(120,95,60,.08)'; x.lineWidth = 0.7;
  for (let i = 0; i < 70; i++) { const a = r() * 6.28, cx = r() * 256, cy = r() * 256, l = 4 + r() * 12; x.beginPath(); x.moveTo(cx, cy); x.quadraticCurveTo(cx + Math.cos(a) * l * .5 + r() * 3, cy + Math.sin(a) * l * .5, cx + Math.cos(a) * l, cy + Math.sin(a) * l); x.stroke(); }
  NOISE_URL = `url(${c.toDataURL()})`;
  stage.style.setProperty('--noise', NOISE_URL);
}
// world paper, drawn once
const PAPER = { x0: -1700, y0: L(-3000, -2400), w: 3400, h: L(4400, 3400) };
const paperC = document.createElement('canvas');
function makePaper() {
  paperC.width = PAPER.w; paperC.height = PAPER.h; const x = paperC.getContext('2d');
  x.fillStyle = '#f5eddf'; x.fillRect(0, 0, PAPER.w, PAPER.h);
  const r = rng(11);
  // large soft tonal blotches (lamp falloff baked into paper)
  for (let i = 0; i < 60; i++) { const cx = r() * PAPER.w, cy = r() * PAPER.h, rad = 200 + r() * 500; const g = x.createRadialGradient(cx, cy, 0, cx, cy, rad); const a = 0.035 * r(); g.addColorStop(0, `rgba(${r() < .5 ? '255,250,238' : '214,196,168'},${a})`); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(cx - rad, cy - rad, rad * 2, rad * 2); }
  // rules
  const ox = -PAPER.x0, oy = -PAPER.y0;
  for (let y = -2990; y < 1400; y += 64) { x.strokeStyle = 'rgba(110,150,205,.30)'; x.lineWidth = 2; x.beginPath(); x.moveTo(0, oy + y); for (let xx = 0; xx <= PAPER.w; xx += 200) x.lineTo(xx, oy + y + Math.sin((xx + y) * .003) * .8); x.stroke(); }
  const mx = ox + L(-400, -760);
  x.strokeStyle = 'rgba(220,110,110,.42)'; x.lineWidth = 2.2; for (const d of [0, 7]) { x.beginPath(); x.moveTo(mx + d, 0); x.lineTo(mx + d, PAPER.h); x.stroke(); }
  // grain
  const tile = document.createElement('canvas'); tile.width = tile.height = 512; const tx = tile.getContext('2d'); const id = tx.createImageData(512, 512);
  for (let i = 0; i < id.data.length; i += 4) { const v = (r() - .5) * 26; id.data[i] = 120 + v; id.data[i + 1] = 100 + v; id.data[i + 2] = 70 + v; id.data[i + 3] = 18; }
  tx.putImageData(id, 0, 0); x.fillStyle = x.createPattern(tile, 'repeat'); x.fillRect(0, 0, PAPER.w, PAPER.h);
  // faint pencil study-scribbles in the margins (this notebook has been used)
  x.fillStyle = 'rgba(80,70,65,.20)'; x.font = '600 40px Caveat';
  const notes = ['CO = HR × SV', 'preload ↑ → SV ↑ (Frank–Starling)', 'K⁺ channel blockers → QT ↑', 'GFR ≈ 125 mL/min', 'afterload', 'BNP > 100 ?', 'loop → NKCC2', 'EF < 40% = HFrEF'];
  const spots = V ? [[-470, -880], [120, -930], [-420, 820], [60, 880], [-470, -1650], [150, -2200], [-300, -2500], [200, 700]] : [[-930, -480], [300, -500], [-900, 470], [450, 480], [-850, -1500], [300, -1900], [-400, -2100], [700, 430]];
  notes.forEach((n, i) => { x.save(); x.translate(ox + spots[i][0], oy + spots[i][1]); x.rotate((r() - .5) * .12); x.fillText(n, 0, 0); x.restore(); });
  // old coffee ring
  const ring = (cx, cy, rad, a) => { x.strokeStyle = `rgba(150,100,55,${a})`; x.lineWidth = 5; x.beginPath(); for (let k = 0; k <= 64; k++) { const an = k / 64 * 6.283, rr = rad + (vnoise(k * .4, 3) * 5); x.lineTo(cx + Math.cos(an) * rr, cy + Math.sin(an) * rr); } x.stroke(); x.lineWidth = 2; x.stroke(); };
  ring(ox + L(310, 700), oy + L(740, -380), 88, .10); ring(ox + L(-200, -300), oy + L(-2300, -1800), 92, .07);
}
// grain frames
const grainFrames = [];
function makeGrain() {
  for (let f = 0; f < 6; f++) { const c = document.createElement('canvas'); c.width = W / 2; c.height = H / 2; const x = c.getContext('2d'); const d = x.createImageData(c.width, c.height); const r = rng(100 + f); for (let i = 0; i < d.data.length; i += 4) { const v = 150 + r() * 105; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; } x.putImageData(d, 0, 0); grainFrames.push(c); }
}

// ------------------------------------------------------------------ hand-drawn ink helpers
function catmull(pts, seg = 12) { // pts [[x,y]...] → dense polyline
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    for (let s = 0; s < seg; s++) { const t = s / seg, t2 = t * t, t3 = t2 * t;
      out.push([0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)]); }
  }
  out.push(pts[pts.length - 1]); return out;
}
const toD = pts => 'M' + pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('L');
function wobble(pts, amp, seed) { return pts.map((p, i) => [p[0] + vnoise(i * 0.35, seed) * amp, p[1] + vnoise(i * 0.35, seed + 9) * amp]); }
function inkPath(parent, d, color, width, extra = {}) { return S('path', { d, fill: 'none', stroke: color, 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', ...extra }, parent); }
function reveal(path, p) { const len = path.__len || (path.__len = path.getTotalLength()); path.style.strokeDasharray = `${len} ${len}`; path.style.strokeDashoffset = (len * (1 - clamp(p))).toFixed(1); path.style.opacity = p <= 0 ? 0 : 1; }

// ------------------------------------------------------------------ PROPS
const PROPS = {};
let NOTIFS = [];
function prop(name, w, h, cls, html, layer = propsL) {
  const wrap = $('div', 'abs', layer); wrap.style.width = w + 'px'; wrap.style.height = h + 'px';
  const inner = $('div', cls, wrap, html); inner.style.width = w + 'px'; inner.style.height = h + 'px'; inner.style.position = 'relative';
  return (PROPS[name] = { name, wrap, inner, w, h, keys: null });
}
function buildProps() {
  prop('lecture', 520, 310, 'paper slide', `<div class="bar"></div><h4>Lecture 12 — Heart Failure</h4><div class="sub">Cardiovascular II · Dr. Alvarez</div>
    <ul><li>HFrEF vs HFpEF (EF &lt; 40%)</li><li>↓ CO → RAAS activation</li><li>BNP, JVD, S3, pitting edema</li></ul><div class="num">12 / 64</div>
    <svg class="doodle" width="120" height="70" viewBox="0 0 120 70"><path d="M2 40h28l6-14 8 30 9-44 7 28h58" fill="none" stroke="#c44" stroke-width="3" stroke-linejoin="round"/></svg>`);
  PROPS.lecture.stamp = S('path', { d: 'M150 175 L215 240 L390 60', fill: 'none', stroke: '#c0392b', 'stroke-width': 26, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: 0 }, S('svg', { width: 520, height: 310, style: 'position:absolute;left:0;top:0;overflow:visible' }, PROPS.lecture.inner));
  prop('renal', 480, 285, 'paper slide renal', `<div class="bar"></div><h4>Renal Physiology</h4><div class="sub">Lecture 9 · The nephron</div>
    <ul><li>GFR &amp; autoregulation</li><li>PCT: ~65% Na⁺ reabsorbed</li><li>Loop diuretics → NKCC2</li></ul><div class="num">9 / 48</div>
    <svg class="doodle" width="110" height="110" viewBox="0 0 110 110"><path d="M20 10c30 0 30 30 10 40s-10 40 20 40 30-40 40-60" fill="none" stroke="#3d9a8f" stroke-width="4" stroke-linecap="round"/><circle cx="20" cy="12" r="9" fill="none" stroke="#3d9a8f" stroke-width="4"/></svg>`);
  const fc = (q, tag, rot, dx, dy) => `<div class="paper flash" style="position:absolute;left:${dx}px;top:${dy}px;transform:rotate(${rot}deg)"><div class="redline"></div><div class="tag">${tag}</div><div class="q" style="margin-top:22px">${q}</div></div>`;
  prop('flash', 400, 270, '', fc('Class IV antiarrhythmic?', 'PHARM · 118 due', -9, 10, 30) + fc('Amiodarone — side effects?', 'PHARM · 118 due', 5, 30, 10) + fc('Which drug class prolongs the QT?', 'PHARM · 118 due', -2, 20, 22));
  prop('book', 460, 600, 'paper book', `<h5>Chapter 18 · Antiarrhythmic Drugs</h5>
    <p>Class III agents block potassium channels, prolonging repolarization and the effective refractory period. <mark data-hl="0">Amiodarone has class I, II, III and IV properties</mark>, which accounts for its broad efficacy and its long list of adverse effects.</p>
    <p>Monitor thyroid, liver and pulmonary function. <mark data-hl="1">QT prolongation is dose-dependent</mark>; torsades is uncommon but serious. Sotalol also has β-blocking activity.</p>
    <p>Class IV agents (verapamil, diltiazem) slow AV nodal conduction and are used for rate control. <mark data-hl="2">Avoid in HFrEF.</mark></p><div class="pg">— 412 —</div>`);
  prop('calendar', 440, 440, 'paper calendar', `<div class="rings"><i></i><i></i><i></i><i></i><i></i></div><div class="mon">OCTOBER</div><div class="grid">${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(d => `<span class="h">${d}</span>`).join('')}${Array.from({ length: 35 }, (_, i) => { const d = i - 2; return `<span>${d > 0 && d <= 31 ? d : ''}</span>`; }).join('')}</div>`);
  // exam circle + label inside calendar as ink
  const cal = PROPS.calendar.inner;
  const csvg = S('svg', { width: 440, height: 440, style: 'position:absolute;left:0;top:0;overflow:visible' }, cal);
  // "17" sits in row 3 (0-based), col 5 → approximate grid cell center
  const cx = 20 + (400 / 7) * 5.5, cy = 20 + 30 + 12 + 22 + 4 + (46 + 4) * 3.5 - 2;
  const circ = []; for (let k = 0; k <= 60; k++) { const a = -0.6 + k / 60 * 7.0; const rr = 34 + k * 0.12; circ.push([cx + Math.cos(a) * rr * 1.18, cy + Math.sin(a) * rr]); }
  PROPS.calendar.circle = inkPath(csvg, toD(wobble(circ, 1.6, 4)), '#d23a2e', 6);
  const ex = $('div', 'exam', cal, 'EXAM!'); ex.style.left = (cx - 44) + 'px'; ex.style.top = (cy + 30) + 'px'; ex.style.transform = 'rotate(-8deg)';
  PROPS.calendar.examLbl = ex;

  const st = (n, c, txt, rot = 0) => prop(n, 230, 230, `sticky ${c}`, `<div style="transform:rotate(${rot}deg)">${txt}</div>`);
  st('stickyA', 'y', 'PANCE Qs<br>40 / day??', -2); st('stickyB', 'p', 'ECG<br>rhythms!!', 2); st('stickyC', 'b', 'renal<br>quiz fri', -1); st('stickyD', 'g', 'cranial<br>nerves ✗', 1);
  prop('coffee', 250, 250, 'mug', `<svg viewBox="0 0 250 250" width="250" height="250"><defs><radialGradient id="cof" cx=".45" cy=".4"><stop offset="0" stop-color="#8a5a36"/><stop offset=".75" stop-color="#5a3620"/><stop offset="1" stop-color="#3f2414"/></radialGradient></defs>
    <ellipse cx="128" cy="132" rx="104" ry="104" fill="rgba(60,40,20,.22)" filter="blur(6px)"/>
    <path d="M205 105c40 0 40 50 0 50" fill="none" stroke="#e9e3da" stroke-width="18" stroke-linecap="round"/>
    <circle cx="120" cy="125" r="96" fill="#f2ede4"/><circle cx="120" cy="125" r="96" fill="none" stroke="#d9d1c3" stroke-width="3"/>
    <circle cx="120" cy="125" r="80" fill="url(#cof)"/><ellipse cx="96" cy="100" rx="26" ry="10" fill="rgba(255,235,210,.22)" transform="rotate(-30 96 100)"/></svg>`);
  prop('phone', 250, 510, 'phone', `<div class="scr"><div class="clock">10:47</div><div class="date">Wednesday, October 8</div></div>`);
  prop('gtimer', 420, 280, 'gtimer', `<div class="lcd">25:00</div><div class="lbl">TIMER</div>`);
  PROPS.gtimer.lcd = PROPS.gtimer.inner.querySelector('.lcd');

  const notifs = [
    ['#34c759', 'Messages', 'Study group: who’s doing the pharm review??'],
    ['#ff9f0a', 'Reminder', 'Renal quiz — Friday 8:00 AM'],
    ['#0a84ff', 'Mail', 'Syllabus updated: Cardio II'],
    ['#ff375f', 'Calendar', 'EXAM in 9 days'],
    ['#34c759', 'Messages', '3 new messages'],
    ['#5e5ce6', 'Flashcards', '118 cards due today'],
    ['#34c759', 'Messages', 'u still up?'],
  ];
  NOTIFS = notifs.map((n, i) => prop('notif' + i, 330, 74, 'notif', `<div class="ic" style="background:${n[0]}"></div><div><b>${n[1]}</b>${n[2]}</div>`));
}

// thoughts (handwritten strips) + their payoff replies
const THOUGHTS = [];
function thought(txt, big, reply) {
  const wrap = $('div', 'abs', topL);
  const strip = $('div', 'thought shadowwrap' + (big ? ' big' : ''), wrap, `<div class="hl"></div><div class="txt">${txt}</div>`);
  strip.style.position = 'relative'; strip.style.display = 'inline-block'; strip.style.clipPath = torn(1, 7);
  const ssvg = S('svg', { style: 'position:absolute;left:0;top:0;overflow:visible;width:10px;height:10px' }, strip);
  const rep = $('div', 'abs', topL);
  const rstrip = $('div', 'thought shadowwrap', rep, `<div class="txt" style="color:#a0521f">${reply}</div>`);
  rstrip.style.display = 'inline-block'; rstrip.style.background = '#fff7cf'; rstrip.style.fontSize = '60px';
  const th = { wrap, strip, txt: strip.querySelector('.txt'), hl: strip.querySelector('.hl'), ssvg, rep, rstrip, rtxt: rstrip.querySelector('.txt') };
  THOUGHTS.push(th); return th;
}
function torn(seed, n = 6) { // jagged top/bottom edges
  const r = rng(seed); const pts = [];
  for (let i = 0; i <= n; i++) pts.push(`${(i / n * 100).toFixed(1)}% ${(r() * 7).toFixed(1)}px`);
  for (let i = n; i >= 0; i--) pts.push(`${(i / n * 100).toFixed(1)}% calc(100% - ${(r() * 7).toFixed(1)}px)`);
  return `polygon(${pts.join(',')})`;
}

// ------------------------------------------------------------------ APP UI (rebuilt from ref/*.png)
const UI = {};
// Group session: production "Deep Work Hall" (always-on, 50/10) — member names are fictional.
const ROOM_MEMBERS = ['alex', 'maya.r', 'devin', 'sofia_l', 'theo', 'priya', 'jordan.k', 'sam'];
const ROOM_JOIN = [0.3, 0.5, 0.65, 0.8, 0.93, 1.05, 1.17, 1.3]; // seconds after T.roomIn each member chip pops in
// The AI upload's result for "Lecture 12 — Heart Failure" (SAMPLE output that follows api/generate-tasks'
// rules; see room-harness/sample-ai-tasks.json). Colours = production tagColor() for these subjects.
const CARD = '#CA8A04', PHARM = '#65A30D';
const TASKS = [
  { title: 'Review HFrEF vs HFpEF definitions and EF cutoffs', subj: 'Cardiology', color: CARD, est: 1, bit: 'HFrEF vs HFpEF' },
  { title: 'Map RAAS and sympathetic activation in heart failure', subj: 'Cardiology', color: CARD, est: 1, bit: '↓ CO → RAAS' },
  { title: 'Learn HF signs: JVD, S3, pitting edema, BNP', subj: 'Cardiology', color: CARD, est: 1, bit: 'JVD · S3 · BNP' },
  { title: 'Memorize GDMT drug classes for HFrEF', subj: 'Pharmacology', color: PHARM, est: 2, bit: 'GDMT' },
  { title: 'Practice 15 questions on heart failure management', subj: 'Cardiology', color: CARD, est: 1, bit: '15 Qs' },
];
// grouped like the app: subject headers in order of first appearance
const LIST = [{ grp: 'Cardiology', n: 4, color: CARD }, { task: 0 }, { task: 1 }, { task: 2 }, { task: 4 }, { grp: 'Pharmacology', n: 1, color: PHARM }, { task: 3 }];
function hdrHTML() { return `<div class="hdr"><div class="lg" style="width:34px;height:34px">${logoSVG()}</div><div class="word">Roamly Flow</div><div class="sp"></div>
  <div class="chip streak" style="background:hsl(33 30% 88%);color:hsl(var(--muted-foreground));opacity:0">${I.flame} 1 day</div></div>`; }
function buildUI() {
  // ---------- TASKS CARD
  const tc = $('div', 'abs app appcard', uiL);
  tc.style.overflow = 'hidden';
  tc.innerHTML = `${hdrHTML()}
    <div class="t-h1">Tasks</div><div class="t-sub">Queue what you'll study. Pick one to focus on. <span style="vertical-align:-3px">${I.info}</span></div>
    <div class="t-prog"><span class="pt">0 of 5 done</span><div class="t-bar"><i></i></div></div>
    <div class="up">
      <div class="up-c"><div class="up-box"><span class="up-ic">${I.sparkles}</span><span>Upload study material and AI will create editable tasks for you</span><span class="btn grad up-btn">Choose file</span></div>
        <p class="up-left">You have <span class="ul">3 uploads</span> left <span class="up-top">Top up</span> ${I.info}</p></div>
      <div class="up-o"><div class="up-h"><span>Upload notes, slides, or a photo</span>${I.x}</div>
        <p class="up-d">Roamly Flow AI reads your PDF, Word file, PowerPoint, text, screenshot, or photo and creates editable study tasks from the material. Files can be up to 12 MB; scans use OCR automatically and handwriting is best effort.</p>
        <div class="up-file">${I.file} Lecture-12-Heart-Failure.pdf</div>
        <div class="up-bar"><i></i></div><p class="up-st"></p></div>
    </div>
    <div class="list" style="position:relative"></div>`;
  if (!V) tc.style.width = '640px';
  const list = tc.querySelector('.list');
  const rows = LIST.map((it) => {
    const g = $('div', '', list); g.style.overflow = 'hidden';
    if (it.grp) g.innerHTML = `<div class="grp"><i style="background:${it.color}"></i>${it.grp.toUpperCase()} · ${it.n}</div>`;
    else { const t = TASKS[it.task]; g.innerHTML = `<div class="trow" style="margin-bottom:7px"><div class="cb"></div><div class="tt">${t.title}</div><span class="pill" style="background:${t.color}1f;color:${t.color}">${t.subj}</span><span style="color:hsl(var(--muted-foreground))">${I.play}</span><span class="cnt">0/${t.est}</span></div>`; }
    return g;
  });
  // method sheet
  const sh = $('div', 'sheet', tc);
  sh.style.cssText += 'position:absolute;left:0;right:0;bottom:0;';
  const M = [['Classic 25/5', 'The original. 25 on, 5 off.'], ['Deep Work 50/10', 'Longer blocks for dense material like pharmacology.'], ['Clinical 90/20', 'Ultradian rhythm. Mirrors a focused rotation block.'], ['Sprint 15/3', 'Short bursts for flashcards and quick review.'], ['Anatomy 45/15', 'Balanced blocks for systems and structures.']];
  sh.innerHTML = `<h3>Timer method <span class="muted">${I.info}</span><span style="flex:1"></span><span class="muted">${I.x}</span></h3>` + M.map((m, i) => `<div class="mcard${i === 0 ? ' sel' : ''}"><b>${m[0]}</b><span>${m[1]}</span></div>`).join('');
  const mcards = [...sh.querySelectorAll('.mcard')];
  // highlighter behind Deep Work description
  const hlm = $('div', '', mcards[1].querySelector('span')); hlm.style.cssText = 'position:absolute;left:-3px;right:-3px;top:1px;bottom:-1px;background:rgba(255,214,74,.62);z-index:-1;transform-origin:0 50%;border-radius:3px';
  mcards[1].querySelector('span').style.zIndex = 0; mcards[1].querySelector('span').style.isolation = 'isolate';
  UI.tasks = { el: tc, list, rows, sheet: sh, mcards, hlm, pt: tc.querySelector('.pt'), prog: tc.querySelector('.t-prog'), up: tc.querySelector('.up'), upC: tc.querySelector('.up-c'), upO: tc.querySelector('.up-o'), upBtn: tc.querySelector('.up-btn'), ul: tc.querySelector('.ul'),
    upBar: tc.querySelector('.up-bar i'), upSt: tc.querySelector('.up-st'), lg: tc.querySelector('.lg'), word: tc.querySelector('.word') };
  // lecture bullets that lift off the printout and land as tasks
  UI.bits = TASKS.map(t => { const d = $('div', 'abs bit', topL, t.bit); return d; });

  // ---------- FOCUS CORE
  const fc = $('div', 'abs app appcard', uiL);
  fc.innerHTML = `<div class="fc-top"><span class="lbl-mono top">FOCUS MODE</span><span class="chip" style="border:1px solid hsl(var(--border));background:hsl(var(--card));padding:6px 12px">${I.x} Exit</span></div>
    <div class="card garden"><div class="lbl-mono" style="font-size:10.5px;letter-spacing:.2em">GARDEN</div>
      <div class="scene"><div class="sky"></div><canvas class="rain" width="700" height="170" style="position:absolute;left:0;top:0;width:100%;height:100%"></canvas>
      <div class="sp" style="position:absolute;left:50%;bottom:12px;transform:translateX(-50%)">${sprout}</div><div class="soil"></div><div class="tagw">Watering ${I.drop}</div></div></div>
    <div class="fc-lab">FOCUS</div><div class="fc-dig">50:00</div>
    <div class="fc-task">Cardio lecture 12: heart failure</div><div class="fc-meth">Deep Work 50/10</div>
    <div class="fc-line">Depth over coverage. Leave this session knowing one thing better than when you started.</div>
    <div class="fc-bar"><i style="width:0"></i></div><div class="pips"><i></i><i></i><i></i><i></i></div>
    <div class="fc-hint">Eyes here. Notifications quiet themselves in your device's Focus mode.</div>
    <div class="fc-btns"><div class="btn primary main">${I.play} <span class="ml">Start</span></div><div class="btn ghost sq">${I.skip}</div></div>
    <div class="fc-btns" style="margin-top:8px"><div class="btn ghost" style="height:44px;padding:0 14px">${I.pip} Pop out timer</div><div class="btn ghost" style="height:44px;padding:0 14px">${I.sliders} Customize Session</div></div>`;
  const q = s => fc.querySelector(s);
  UI.core = { el: fc, top: q('.top'), exit: q('.fc-top .chip'), sky: q('.sky'), rain: q('.rain'), rx: q('.rain').getContext('2d'), tagw: q('.tagw'), lab: q('.fc-lab'), dig: q('.fc-dig'), task: q('.fc-task'), line: q('.fc-line'), bar: q('.fc-bar i'), pips: [...fc.querySelectorAll('.pips i')], hint: q('.fc-hint'), main: q('.main'), ml: q('.ml'), mainIc: q('.main svg'), meth: q('.fc-meth'), sp: q('.sp') };

  // ---------- page chrome around core (hidden by Focus mode)
  const ct = $('div', 'abs app', uiL);
  ct.innerHTML = `${hdrHTML()}<div class="selbar" style="margin-top:16px"><span style="display:flex;gap:8px;align-items:center">${I.timer} Select timer</span><span style="display:flex;gap:6px;align-items:center">Deep Work 50/10 ${I.chev}</span></div>`;
  const cb = $('div', 'abs app', uiL);
  cb.innerHTML = `<div class="card" style="padding:12px 14px;font:400 13px/1.4 Inter;color:hsl(var(--muted-foreground));margin-bottom:12px">Save your sessions and track progress toward upcoming exams. <span class="chip" style="background:linear-gradient(135deg,hsl(var(--roamly-purple)),hsl(var(--roamly-blue)));color:#fff;font-weight:600;margin-top:6px">Create free account</span></div>
    <div class="navbar" style="border-radius:18px"><div class="on">${I.navFocus}Focus</div><div>${I.navTasks}Tasks</div><div>${I.navRooms}Rooms</div><div>${I.navGarden}Garden</div><div>${I.navAn}Analytics</div></div>`;
  UI.chromeTop = ct; UI.chromeBot = cb;

  // ---------- STUDYING / ON A BREAK card
  const sc = $('div', 'abs app appcard', uiL);
  sc.style.padding = '16px';
  sc.innerHTML = `<div class="lbl-mono sh" style="font-size:11px">STUDYING</div>
    <div class="brk"><div class="trow" style="margin-top:10px;background:hsl(150 15% 94%);border-color:hsl(157 16% 72%)"><div class="cb"></div><div class="tt">Slow breaths</div><span class="pill" style="background:hsl(150 20% 88%);color:hsl(157 20% 38%)">Optional</span></div>
      <div class="trow" style="margin-top:8px;background:hsl(150 15% 94%);border-color:hsl(157 16% 72%)"><div class="cb"></div><div class="tt">Gentle back stretch</div><span class="pill" style="background:hsl(150 20% 88%);color:hsl(157 20% 38%)">Optional</span></div></div>
    <div class="sl" style="position:relative"></div>`;
  const sl = sc.querySelector('.sl');
  const srows = TASKS.slice(0, 3).map((t, i) => { const r = $('div', 'trow', sl); r.style.marginTop = '8px';
    r.innerHTML = `<div class="cb"></div><div class="tt">${t.title}</div><span class="focusing">${I.timer} Focusing</span><span class="cnt">0/${t.est}</span>`; return { el: r, cb: r.querySelector('.cb'), foc: r.querySelector('.focusing'), cnt: r.querySelector('.cnt'), tt: r.querySelector('.tt') }; });
  UI.stud = { el: sc, sh: sc.querySelector('.sh'), brk: sc.querySelector('.brk'), rows: srows };

  // ---------- ANALYTICS card (Your progress)
  const an = $('div', 'abs app appcard an', uiL);
  an.style.padding = '18px';
  an.innerHTML = `<div class="row"><h4>Your progress <span class="muted">${I.info}</span></h4><span class="chip" style="padding:0;color:hsl(var(--muted-foreground));font-size:13px">${I.flame} 1-day streak</span></div>
    <div class="row" style="margin-top:14px"><span style="font:400 15px Inter;color:hsl(var(--muted-foreground))">Today</span><span class="mono am" style="font-size:15px">75 / 120 min</span></div>
    <div class="bar"><i style="width:62.5%"></i></div>
    <div class="row" style="margin-top:14px"><span style="font:400 15px Inter;color:hsl(var(--muted-foreground))">Daily goal</span><span class="step"><i>−</i><span>120 min</span><i>+</i></span></div>`;
  UI.an = { el: an, bar: an.querySelector('.bar i'), am: an.querySelector('.am') };
  // ---------- ROOM (group session) — rebuilt from ref/31-room-*-mobile.png (production RoomsLive, harness-rendered)
  const rm = $('div', 'abs app appcard', uiL);
  rm.innerHTML = `<div class="rm-h1">Deep Work Hall</div><div class="rm-sub">Always on · 50/10 rhythm · study anything</div>
    <div style="display:flex;gap:8px;margin-top:10px"><span class="chip" style="border:1px solid hsl(var(--border));background:hsl(var(--card))">${I.userPlus} Invite</span><span class="chip" style="border:1px solid hsl(var(--border));background:hsl(var(--card))">${I.logout} Leave</span></div>
    <div class="card rm-card"><div class="rm-lab">FOCUS · BLOCK 2/3</div><div class="rm-dig">31:06</div><div class="rm-bar"><i></i></div>
      <div class="rm-note">Everyone in this room sees the same timer.</div>
      <div class="rm-chips">${ROOM_MEMBERS.map((m, i) => `<span class="rm-chip${i === 0 ? ' me' : ''}"><b>${m.slice(0, 2).toUpperCase()}</b>${m}${i === 0 ? ' (you)' : ''}</span>`).join('')}</div>
      <div class="rm-btns"><span class="btn grad" style="height:44px;padding:0 18px;border-radius:999px">${I.maximize} Focus mode</span><span class="btn ghost" style="height:44px;padding:0 16px;border-radius:999px">${I.pip} Pop out timer</span></div></div>`;
  // ---------- ROOMS LOBBY — rebuilt from ref/30-room-lobby-mobile.png
  const lb = $('div', 'abs app appcard', uiL);
  const LOBBY = [['The Grind Hall', '25/5', 14, 250], ['Deep Work Hall', '50/10', 7, 1870], ['Sprint Studio', '15/3', 6, 190], ['Marathon Library', '90/20', 3, 1450]];
  lb.innerHTML = `<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px"><div><div class="rm-h1" style="font-size:34px">Rooms <span class="muted" style="vertical-align:4px">${I.info}</span></div>
      <div class="rm-sub" style="font-size:14.5px;margin-top:4px">Focus alongside other PA students in real time.</div></div>
      <div style="display:flex;gap:6px;flex:none;margin-top:6px"><span class="chip" style="border:1px solid hsl(var(--border));background:hsl(var(--card))">${I.users} Friends</span><span class="chip btn grad" style="padding:6px 12px">${I.plus} Host</span></div></div>
    <div class="lbl-mono" style="margin:18px 2px 10px;font-size:11px">${I.inf} ALWAYS-ON ROOMS</div>
    ${LOBBY.map(r => `<div class="card lb-card"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px"><div><div class="lb-n">${r[0]}</div><div class="lb-s">${r[1]} rhythm · always on</div></div>
      <span class="lb-ph">Focus · <span class="lb-t mono">00:00</span></span></div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px"><span class="lb-m">${I.users} <span class="lb-c">${r[2]}/50</span> &nbsp; ${r[1]}</span><span class="btn grad lb-j">Join</span></div></div>`).join('')}`;
  UI.lobby = { el: lb, times: [...lb.querySelectorAll('.lb-t')], secs: LOBBY.map(r => r[3]), counts: [...lb.querySelectorAll('.lb-c')], join: lb.querySelectorAll('.lb-j')[1], card: lb.querySelectorAll('.lb-card')[1] };
  const chipsSvg = S('svg', { width: 10, height: 10, style: 'position:absolute;left:0;top:0;overflow:visible;pointer-events:none' }, rm.querySelector('.rm-card'));
  const rc = $('div', 'abs app appcard', uiL);
  rc.style.padding = '16px';
  const MSGS = [['maya.r', 'block 2 done. heart failure makes sense now lol'], ['sofia_l', 'same. stretching then pharm cards'], ['priya', 'see you all next block']];
  rc.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px"><span style="display:flex;align-items:center;gap:7px;font:600 16px Inter">${I.msg} Break-time chat</span>
      <span class="chip ch-lock" style="background:hsl(var(--secondary));color:hsl(var(--muted-foreground));font-size:12px">${I.lock} Opens at break · <span class="rcd mono">31:06</span></span>
      <span class="chip ch-open" style="background:hsl(var(--roamly-green) / .1);color:hsl(var(--roamly-green));font-size:12px;display:none">Open, it's break time</span></div>
    <div class="ch-box"><div class="ch-empty">No messages yet. Say hi at the next break.</div>${MSGS.map(m => `<div class="ch-msg"><b>${m[0]}</b>${m[1]}</div>`).join('')}</div>
    <div style="display:flex;gap:8px;margin-top:10px"><div class="field ph ch-in" style="flex:1;height:42px"><span>Chat opens in 31:06. Keep focusing</span></div><div class="btn" style="width:46px;height:42px;background:hsl(var(--secondary));color:#fff">${I.send}</div></div>
    <div style="margin-top:8px;font:400 11.5px/1.4 Inter;color:hsl(var(--muted-foreground))">Chat unlocks during short and long breaks, then locks again when focus starts.</div>`;
  UI.room = { el: rm, dig: rm.querySelector('.rm-dig'), bar: rm.querySelector('.rm-bar i'), lab: rm.querySelector('.rm-lab'), chips: [...rm.querySelectorAll('.rm-chip')], chipsBox: rm.querySelector('.rm-chips'), svg: chipsSvg, chat: rc, cd: rc.querySelector('.rcd'),
    lock: rc.querySelector('.ch-lock'), open: rc.querySelector('.ch-open'), empty: rc.querySelector('.ch-empty'), msgs: [...rc.querySelectorAll('.ch-msg')], inp: rc.querySelector('.ch-in span') };
  // phone bezel for payoff (behind core)
  UI.bezel = $('div', 'abs bezel', uiL); uiL.insertBefore(UI.bezel, fc);
}

// ------------------------------------------------------------------ ink layer: the line, strike, logo
const INK = {};
const LOGO = V ? { x: 0, y: -80, r: 150 } : { x: -430, y: -10, r: 135 };
function buildInk() {
  // logo tile (behind the ring)
  const side = LOGO.r * 32 / 9;
  INK.tile = S('rect', { x: LOGO.x - side / 2, y: LOGO.y - side / 2, width: side, height: side, rx: side * 7 / 32, fill: '#16181D' }, inkSvg);
  INK.tileSide = side;
  // the hand-drawn line: weaves through the chaos, ends as the logo arc (3 o'clock → clockwise 270° → 12 o'clock)
  const way = V
    ? [[-640, -300], [-420, -470], [-150, -420], [120, -300], [250, -130], [330, 60], [180, 330], [-60, 420], [-250, 200], [-330, -60], [-180, -150], [LOGO.x + LOGO.r + 60, LOGO.y - 40]]
    : [[-1040, 60], [-800, -300], [-520, -200], [-160, -330], [240, -300], [560, -120], [800, 230], [340, 260], [110, 360], [-250, 360], [-640, 250], [-560, 30], [LOGO.x + LOGO.r + 70, LOGO.y - 40]];
  const lead = catmull(way, 14);
  const arc = []; for (let k = 0; k <= 72; k++) { const a = k / 72 * 1.5 * Math.PI; const rr = LOGO.r * (1 + 0.05 * Math.sin(k * .5) * (1 - k / 72)); arc.push([LOGO.x + Math.cos(a) * rr, LOGO.y + Math.sin(a) * rr]); }
  const lp = wobble(lead, 3, 21).concat(arc.slice(1));
  // join lead end smoothly into arc start
  const all = catmull([...way.slice(0, -1), [LOGO.x + LOGO.r, LOGO.y - 6], ...arc.filter((_, i) => i % 6 === 0).slice(1)], 10);
  INK.linePts = wobble(all, 2.2, 21);
  INK.line = inkPath(inkSvg, toD(INK.linePts), '#E8A33D', 15, { opacity: 0 });
  INK.lineShadow = inkPath(inkSvg, toD(INK.linePts.map(p => [p[0] + 2, p[1] + 3])), 'rgba(120,70,20,.18)', 15, { opacity: 0 });
  inkSvg.insertBefore(INK.lineShadow, INK.line);
  // clean logo ring (crossfades in over the hand-drawn arc)
  const C = 2 * Math.PI * LOGO.r, sw = LOGO.r * 2.5 / 9;
  INK.ring = S('circle', { cx: LOGO.x, cy: LOGO.y, r: LOGO.r, fill: 'none', stroke: '#E8A33D', 'stroke-width': sw, 'stroke-linecap': 'round', 'stroke-dasharray': `${C * 42 / 56.55} ${C * 14 / 56.55}`, opacity: 0 }, inkSvg);
  INK.dot = S('circle', { cx: LOGO.x, cy: LOGO.y, r: LOGO.r * 2.5 / 9, fill: '#F2C078', opacity: 0 }, inkSvg);
  // strike across the generic timer
  INK.strike1 = inkPath(inkSvg, '', '#d23a2e', 12, { opacity: 0 });
  INK.strike2 = inkPath(inkSvg, '', '#d23a2e', 12, { opacity: 0 });
  // margin progress path (fills per finished session) — dotted trail with 2 segments
  INK.trail = S('g', {}, inkSvg);
  // opening pencil note, underneath everything
  INK.clock = $('div', 'abs', propsL, '10:47 pm'); propsL.insertBefore(INK.clock, propsL.firstChild);
  INK.clock.style.cssText += 'font:700 118px Caveat;color:rgba(70,62,58,.78);white-space:nowrap';
  INK.nib = S('circle', { r: 11, fill: '#fff6e0', stroke: '#E8A33D', 'stroke-width': 5, opacity: 0 }, inkSvg);
  // wordmark (world)
  INK.word = $('div', 'abs cta-word', topL, 'Roamly Flow');
  INK.word.style.fontSize = L(130, 150) + 'px';
}

// CTA HUD
const CTA = {};
function buildHUD() {
  const kin = (html, size) => { const d = $('div', 'abs kin', hud, html); d.style.fontSize = size + 'px'; return d; };
  const words = s => s.split(' ').map(w => `<span class="mask" style="display:inline-block"><span class="w">${w}</span></span>`).join(' ');
  CTA.a = kin(`${words("DON'T JUST")}<br>${words('STUDY LONGER.')}`, L(104, 100));
  CTA.b = kin(words('STUDY WITH') + ' ' + `<span class="mask" style="display:inline-block"><span class="w"><em>FLOW.</em></span></span>`, L(104, 100));
  CTA.aw = [...CTA.a.querySelectorAll('.w')]; CTA.bw = [...CTA.b.querySelectorAll('.w')];
  CTA.bUnder = S('svg', { width: 10, height: 10, style: 'position:absolute;left:0;top:0;overflow:visible' }, CTA.b);
  CTA.logo = $('div', 'abs', hud, logoSVG('#E8A33D', '#F2C078'));
  CTA.word = $('div', 'abs cta-word', hud, 'Roamly Flow');
  CTA.sub = $('div', 'abs ctasub', hud, 'Start your next study session free.');
  CTA.hand = $('div', 'abs ctahand', hud, 'Free account: AI note uploads + study rooms.');
  CTA.url = $('div', 'abs url', hud, `roamlyflow.com <span style="font-size:.8em">→</span>`);
  CTA.sp = S('svg', { width: 10, height: 10, style: 'position:absolute;left:0;top:0;overflow:visible' }, hud);
  CTA.sparks = [0, 1, 2].map(() => inkPath(CTA.sp, '', '#E8A33D', 7));
  CTA.ul = S('svg', { width: 10, height: 10, style: 'position:absolute;left:0;top:0;overflow:visible' }, hud);
  CTA.ulPath = inkPath(CTA.ul, '', '#E8A33D', 9);
}

// ------------------------------------------------------------------ layout: prop tracks per format
const P = (x, y, r = 0, s = 1, o = 1) => ({ x, y, r, s, o });
function drop(t, at, from = {}) { // entrance: slap onto the paper
  return [[t - 0.001, { ...at, ...from, s: (at.s || 1) * 1.22, o: 0, r: (at.r || 0) + (from.dr || 8) }], [t + 0.05, { o: 1 }, E.lin], [t + 0.42, at, E.settle]];
}
let MORPH = {}; // filled after UI layout: world targets of task rows
function buildTracks() {
  const pos = V ? {
    lecture: P(-150, -420, -7), flash: P(-250, 175, 11, .95), renal: P(175, 355, -5, .92), book: P(250, -130, 8, .88),
    calendar: P(225, -575, 5, .78), stickyA: P(-340, -120, -14, .9), stickyB: P(345, 140, 16, .9), stickyC: P(-60, 470, -9, .9), stickyD: P(-370, -640, 8, .88),
    coffee: P(-330, 540, 0, 1), phone: P(355, 560, -12, 1), gtimer: P(0, -40, -3, 1.08),
  } : {
    lecture: P(-520, -200, -7), flash: P(-640, 255, 11, .95), renal: P(335, 255, -5, .9), book: P(575, -130, 8, .84),
    calendar: P(-150, -300, 5, .72), stickyA: P(-800, -330, -14, .85), stickyB: P(110, 330, 16, .85), stickyC: P(-250, 380, -9, .85), stickyD: P(820, 300, 8, .85),
    coffee: P(-880, 420, 0, .95), phone: P(840, 150, -12, .95), gtimer: P(0, -10, -3, 1.05),
  };
  // tidy (after the line passes): two neat margin columns around the logo
  const tidy = V ? {
    lecture: P(-345, -600, -2, .44), flash: P(-345, -380, 1, .5), stickyA: P(-360, -175, -3, .48), stickyD: P(-360, 30, 2, .44), coffee: P(-350, 470, 0, .6),
    calendar: P(350, -600, 2, .42), book: P(350, -330, -1, .36), stickyB: P(360, -80, 3, .46), renal: P(345, 180, 1, .46), stickyC: P(360, 470, -2, .46), phone: P(0, 880, 0, .7),
  } : {
    lecture: P(-800, -330, -2, .42), flash: P(-800, -110, 1, .45), stickyA: P(-800, 110, -3, .45), coffee: P(-790, 350, 0, .6),
    calendar: P(800, -330, 2, .42), book: P(800, -100, -1, .34), renal: P(800, 130, 1, .42), stickyB: P(640, 360, 3, .42), stickyD: P(-620, 380, 2, .42), stickyC: P(90, 360, -2, .38), phone: P(0, 700, 0, .7),
  };
  // tidy order == line reveal order (seconds)
  const tidyAt = V
    ? { lecture: 10.86, book: 11.08, stickyB: 11.22, renal: 11.36, stickyC: 11.46, flash: 11.56, stickyA: 11.7, calendar: 11.0, stickyD: 11.78, coffee: 11.5, phone: 11.25, gtimer: 10.95 }
    : { lecture: 10.84, calendar: 10.98, book: 11.12, stickyD: 11.26, renal: 11.36, stickyB: 11.44, stickyC: 11.52, flash: 11.64, stickyA: 11.74, coffee: 11.68, phone: 11.3, gtimer: 11.05 };
  // product phase: margin "peeks" (things still on the desk around the app)
  const peek = V ? {
    flash: P(-540, 560, 12, .6), renal: P(540, -640, -8, .6), coffee: P(-400, 830, 0, .8), phone: P(380, 800, -14, .95), stickyA: P(410, -840, 12, .85), calendar: P(-330, -880, -6, .7), stickyB: P(-440, 700, -10, .8), stickyD: P(460, 420, 14, .7), book: P(560, -300, 6, .7), stickyC: P(-560, -200, -8, .8),
  } : {
    flash: P(-1010, -240, 10, .6), renal: P(1010, -150, -8, .6), coffee: P(-880, 400, 0, .85), phone: P(890, 330, -14, .9), stickyA: P(-900, -380, 12, .8), calendar: P(880, -360, -6, .6), stickyB: P(780, 520, -10, .7), stickyD: P(-760, 540, 14, .7), book: P(1040, 0, 6, .7), stickyC: P(-1050, 60, -8, .8),
  };
  // payoff: organized desk
  const pay = V ? {
    calendar: P(-335, -555, -2, .44), lecture: P(-15, -560, 1, .5), renal: P(-5, -548, -2, .5), book: P(-10, -550, 0, .001, 0), flash: P(320, -555, 2, .5), stickyA: P(-430, 700, -3, .5), stickyB: P(-170, 740, 2, .5), stickyC: P(80, 760, -1, .5), stickyD: P(460, -800, 3, .5), coffee: P(390, 720, 0, .66), phone: P(0, 1100, 0, .6, 0), gtimer: P(0, 1400, 0, 1, 0),
  } : {
    calendar: P(-760, -320, -2, .42), lecture: P(-760, -40, 1, .46), renal: P(-752, -30, -2, .46), book: P(-760, -40, 0, .001, 0), flash: P(-760, 240, 2, .46), stickyA: P(840, -400, -3, .42), stickyB: P(870, 60, 2, .42), stickyC: P(-440, 470, -1, .42), stickyD: P(830, 440, 3, .42), coffee: P(-920, 470, 0, .6), phone: P(0, 1100, 0, .6, 0), gtimer: P(0, 1400, 0, 1, 0),
  };
  // CTA ring (screen center of ring converted to world later)
  const enter = { lecture: T.lecture, flash: T.flash, renal: T.renal, book: T.book, calendar: T.calendar, stickyA: T.stickies[0], stickyB: T.stickies[1], stickyC: T.stickies[2], stickyD: T.stickies[3], coffee: T.coffee, phone: T.phone, gtimer: T.timer };
  const ringOrder = ['calendar', 'lecture', 'stickyA', 'flash', 'stickyB', 'renal', 'stickyC', 'stickyD'];
  const RC = ringCenterWorld();
  for (const n of Object.keys(pos)) {
    const p = PROPS[n]; const k = [];
    const ch = pos[n];
    k.push(...drop(enter[n], ch, n === 'coffee' ? { dr: 0 } : n === 'gtimer' ? { dr: -6 } : {}));
    if (n === 'gtimer') {
      k.push([T.freeze + 1.05, ch], [T.freeze + 1.55, { ...ch, x: ch.x + L(60, 90), y: ch.y + L(1300, 900), r: 38, s: .95 }, E.inCubic]);
      p.keys = norm(k); continue;
    }
    const ts = tidyAt[n];
    k.push([ts, ch], [ts + 0.55, tidy[n], E.outBack]);
    const isMorph = n === 'lecture';
    if (isMorph) {
      // leave toward the margin, then get pulled into the queue when its row is typed
      const m = MORPH[n]; const off = V ? P(tidy[n].x < 0 ? -760 : 760, tidy[n].y, 0, .5) : P(tidy[n].x < 0 ? -1200 : 1200, tidy[n].y, 0, .5);
      k.push([15.0, tidy[n]], [15.9, off, E.inCubic], [m.t0, { ...m.from, o: 1 }], [m.t0 + 0.45, m.hover, E.outCubic], [m.t1, m.hover], [m.t1 + 0.32, { ...m.to, o: 0 }, E.inCubic]);
      k.push([T.payoff + 0.3, { ...pay[n], o: 0, s: pay[n].s * 1.3, y: pay[n].y - 60 }], [T.payoff + 1.0, pay[n], E.settle]);
    } else if (n === 'book') {
      k.push([15.0, tidy[n]], [16.1, peek[n], E.inOutCubic], [T.start, peek[n]], [T.start + 0.55, { ...peek[n], x: peek[n].x * 1.9, y: peek[n].y * 1.2, r: peek[n].r + 25, o: 0 }, E.inCubic]);
      k.push([T.payoff + 0.3, { ...pay[n], o: 0 }]);
    } else {
      k.push([15.0, tidy[n]], [16.1, peek[n], E.inOutCubic], [T.start + 0.02 + hash(n.length) * .15, peek[n]]);
      const away = { ...peek[n], x: peek[n].x * L(2.4, 1.9), y: peek[n].y * L(2.0, 2.2), r: peek[n].r + (peek[n].x > 0 ? 40 : -40), o: 1 };
      k.push([T.start + 0.6 + hash(n.length) * .15, away, E.inCubic]);
      k.push([T.payoff + 0.2, { ...pay[n], o: pay[n].o, x: pay[n].x * 1.5, y: pay[n].y * 1.3, r: pay[n].r + 20 }], [T.payoff + 1.1 + hash(n.length + 3) * .3, pay[n], E.settle]);
    }
    // CTA: fly into the ring (or clear out)
    const idx = ringOrder.indexOf(n);
    const last = k[k.length - 1][1];
    if (idx >= 0) {
      const a = (idx / (ringOrder.length - 1)) * 1.5 * Math.PI; // 3 o'clock → 12 o'clock, clockwise
      const rp = P(RC.x + Math.cos(a) * RC.r, RC.y + Math.sin(a) * RC.r, (a * 180 / Math.PI) + 90, .36);
      k.push([T.cta + 0.05 + idx * 0.07, last], [T.cta + 1.35 + idx * 0.07, rp, E.inOutCubic], [T.ring + 0.5, rp], [T.ring + 1.0, { ...rp, s: .22, o: 0 }, E.inCubic]);
    } else if (n === 'coffee') {
      k.push([T.cta + 0.2, last], [T.cta + 1.5, P(RC.x, RC.y, 0, .36), E.inOutCubic], [T.ring + 0.6, P(RC.x, RC.y, 0, .36)], [T.ring + 1.05, P(RC.x, RC.y, 0, .12, 0), E.inCubic]);
    } else {
      k.push([T.cta, last], [T.cta + 0.8, { ...last, y: last.y + 900, o: 0 }, E.inCubic]);
    }
    p.keys = norm(k);
  }
  // notifications pop + stack; blown away on the freeze→line
  const npos = V ? [[-130, -260], [160, 20], [-150, 390], [140, -470], [10, 170], [-170, -20], [150, 300]] : [[-300, -80], [300, 60], [-120, 280], [380, -330], [620, 380], [-640, -40], [60, -260]];
  NOTIFS.forEach((p, i) => {
    const at = P(npos[i][0], npos[i][1], (hash(i, 4) - .5) * 8, 1);
    const t0 = T.notifs[i];
    p.keys = norm([[t0 - .001, { ...at, s: .6, o: 0, y: at.y + 30 }], [t0 + .28, at, E.outBack], [10.72 + i * .05, at], [11.1 + i * .05, { ...at, s: .5, o: 0, x: at.x * 1.5 }, E.inCubic]]);
  });
}
function ringCenterWorld() { // CTA ring is framed by a camera at (0, CTAY)
  const sx = L(540, 1400), sy = L(1030, 560);
  return { x: sx - W / 2, y: sy - H / 2 + CTAY, r: L(170, 170) };
}
const CTAY = L(-1500, -1300);

// ------------------------------------------------------------------ UI layout (world positions)
const LAY = {};
function layoutUI() {
  const tc = UI.tasks.el, fc = UI.core.el;
  // measure natural sizes (unscaled CSS px)
  UI.tasks.rows.forEach(r => (r.style.height = 'auto')); UI.tasks.upO.style.display = 'none';
  const th = tc.offsetHeight + 3 * 0; // rows included at full height
  const fh = fc.offsetHeight, sh = UI.stud.el.offsetHeight, ah = UI.an.el.offsetHeight;
  LAY.tasksH = th; LAY.coreH = fh; LAY.studH = sh; LAY.anH = ah;
  UI.tasks.rowH = UI.tasks.rows.map(r => r.offsetHeight);
  // vertical: fit the tasks card and the core into the safe band (y 250–1520 → world -710..560)
  if (V) {
    LAY.tasks = { x: 0, top: -700, s: Math.min(2.2, 1250 / th) };
    LAY.core = { x: 0, y: -80, s: Math.min(2.15, 1250 / fh) };
    LAY.stud = { x: 0, y: 300, s: 2.02 };
  } else {
    { const s_ = Math.min(1.95, 880 / th); LAY.tasks = { x: 0, top: Math.max(-th * s_ / 2, -470), s: s_ }; }
    LAY.core = { x: -330, y: 0, s: Math.min(1.5, 980 / fh) };
    LAY.stud = { x: 390, y: 0, s: 1.5 };
  }
  LAY.chromeTop = { x: LAY.core.x, y: 0, s: LAY.core.s };
  // payoff: core becomes a phone on the desk
  LAY.roomH = UI.room.el.offsetHeight; LAY.rchatH = UI.room.chat.offsetHeight;
  LAY.room = V ? { x: 0, y: -290, s: Math.min(1.95, 800 / LAY.roomH) } : { x: -200, y: -10, s: Math.min(1.75, 900 / LAY.roomH) };
  LAY.rchat = V ? { x: 0, y: -290 + LAY.roomH * LAY.room.s / 2 + 30 + LAY.rchatH * 1.9 / 2, s: 1.9 } : { x: 470, y: 60, s: 1.5 };
  LAY.pcore = V ? { x: -190, y: -95, s: 0.9 } : { x: -330, y: -10, s: 0.9 };
  LAY.an = V ? { x: 0, y: 425, s: 1.95 } : { x: 330, y: 335, s: 1.35 };
  // the lecture printout is dropped into the upload panel's "Choose file"
  LAY.tasksW = tc.offsetWidth; const S_ = LAY.tasks.s, cx0 = LAY.tasks.x - LAY.tasksW / 2 * S_, cy0 = LAY.tasks.top;
  const btn = UI.tasks.upBtn, box = btn.parentNode;
  const bx = cx0 + (UI.tasks.up.offsetLeft + box.offsetLeft + btn.offsetLeft + btn.offsetWidth / 2) * S_, by = cy0 + (UI.tasks.up.offsetTop + box.offsetTop + btn.offsetTop + btn.offsetHeight / 2) * S_;
  MORPH.lecture = { t0: T.upFly, t1: T.upDrop - 0.28, from: V ? P(760, 400, 0, .5) : P(1200, 200, 0, .5), hover: V ? P(90, 170, 5, .9) : P(560, 200, 6, .75), to: P(bx, by, 0, .06) };
  // lobby + room chat layout
  LAY.lobbyH = UI.lobby.el.offsetHeight;
  LAY.lobby = V ? { x: 0, y: -60, s: Math.min(2.05, 1240 / LAY.lobbyH) } : { x: 0, y: 0, s: Math.min(1.45, 960 / LAY.lobbyH) };
  UI.room.msgs.forEach(m => (m.style.display = 'block')); UI.room.empty.style.display = 'none'; LAY.rchatOpenH = UI.room.chat.offsetHeight;
  UI.room.msgs.forEach(m => (m.style.display = 'none')); UI.room.empty.style.display = 'block';
  if (V) LAY.rchat.yBreak = 560 - LAY.rchatOpenH * LAY.rchat.s / 2 + 40;
}

// ------------------------------------------------------------------ camera
function camera(t) {
  const tc = Math.min(t, T.freeze) + Math.max(0, t - T.line0); // time frozen during the silence beat
  let x = 0, y = 0, z = 1, r = 0;
  // chaos: slow drift + building nervous shake
  const ch = t < T.line0 ? 1 : 1 - prog(t, T.line0, T.line0 + 0.5);
  const drift = prog(t, 0, T.freeze);
  z = lerp(1.06, 0.97, E.inOutSine(drift));
  y = lerp(-20, 20, E.inOutSine(drift));
  const shakeA = (prog(Math.min(t, T.freeze), 3, 10) ** 1.6) * 7 * ch;
  x += vnoise(Math.min(t, T.freeze) * 9, 1) * shakeA; y += vnoise(Math.min(t, T.freeze) * 9, 2) * shakeA; r += vnoise(Math.min(t, T.freeze) * 5, 3) * shakeA * 0.08;
  // line → logo: push in
  const lp = E.inOutCubic(prog(t, T.line0, 13.2));
  x = lerp(x, LOGO.x * 0.35, lp); y = lerp(y, LOGO.y * 0.5 + L(40, 0), lp); z = lerp(z, L(1.04, 1.06), lp);
  // unfold to UI
  const up = E.inOutCubic(prog(t, 15.0, 16.4));
  x = lerp(x, 0, up); y = lerp(y, 0, up); z = lerp(z, 1.0, up);
  // focus push-in, break relax, second block
  z *= 1 + 0.035 * E.inOutCubic(prog(t, T.start, T.start + 1.2)) - 0.045 * E.inOutSine(prog(t, T.block1, T.block1 + 1.4)) + 0.045 * E.inOutSine(prog(t, T.breakEnd - .4, T.room + .3));
  // vertical: pan to the STUDYING card when a task is completed
  // payoff pull-back
  const pb = E.inOutCubic(prog(t, T.payoff, T.payoff + 1.6));
  z = lerp(z, 1.0 + 0.045 * E.inOutSine(prog(t, T.payoff + 1.2, T.cta)), pb);
  // gentle handheld (always on, very small)
  x += vnoise(t * 0.35, 7) * 4; y += vnoise(t * 0.3, 8) * 4; r += vnoise(t * 0.25, 9) * 0.12;
  // CTA: rise off the desk
  const cu = E.inOutQuint(prog(t, T.cta, T.cta + 2.0));
  y = lerp(y, CTAY, cu); z = lerp(z, 1, cu); r = lerp(r, 0, cu);
  return { x, y, z, r };
}

// ------------------------------------------------------------------ helpers for timer text
const mmss = s => { s = Math.max(0, Math.round(s)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
// time-lapse: real-feeling first second, then accelerate, land on 00:00
function lapse(t, t0, t1, total) { const p = prog(t, t0, t1); const e = p < 0.12 ? p * 0.02 / 0.12 : 0.02 + 0.98 * E.inOutCubic((p - 0.12) / 0.88); return total * (1 - e); }

// ------------------------------------------------------------------ render
let lastCueBuild = false;
function renderAt(t) {
  t = clamp(t, 0, DUR - 1e-6);
  const cam = camera(t);
  const frozen = t >= T.freeze && t < T.line0;
  // world + background
  world.style.transform = `translate(${W / 2}px,${H / 2}px) rotate(${cam.r}deg) scale(${cam.z}) translate(${-cam.x}px,${-cam.y}px)`;
  bgx.setTransform(1, 0, 0, 1, 0, 0); bgx.fillStyle = '#efe5d3'; bgx.fillRect(0, 0, W, H);
  bgx.translate(W / 2, H / 2); bgx.rotate(cam.r * Math.PI / 180); bgx.scale(cam.z, cam.z); bgx.translate(-cam.x, -cam.y);
  bgx.drawImage(paperC, PAPER.x0, PAPER.y0);
  // freeze look
  const fz = t >= T.freeze ? 1 - prog(t, T.line0 + 0.1, T.line0 + 0.8) : 0;
  scene.style.filter = fz > 0.001 ? `saturate(${(1 - 0.55 * fz).toFixed(3)}) contrast(${(1 - 0.06 * fz).toFixed(3)}) brightness(${(1 - 0.04 * fz).toFixed(3)})` : 'none';

  const tj = Math.min(t, T.freeze); // jitter time (freezes)
  // ---------- props
  for (const n in PROPS) {
    const p = PROPS[n]; if (!p.keys) continue;
    const st = sample(p.keys, t);
    if (t < T.line0 + 1.2) { // restless chaos
      const i = n.length * 7 + n.charCodeAt(0);
      const a = prog(tj, 2, 10) * (t < T.line0 ? 1 : 1 - prog(t, T.line0, T.line0 + 0.8));
      st.x += vnoise(tj * 0.9 + i, i) * 7 * a; st.y += vnoise(tj * 0.8 + i, i + 1) * 6 * a; st.r += vnoise(tj * 0.7 + i, i + 2) * 2.2 * a;
    }
    place(p.wrap, st, p.w, p.h);
  }
  reveal(PROPS.lecture.stamp, prog(t, T.payoff + 1.3, T.payoff + 1.65));
  // calendar circle + label
  reveal(PROPS.calendar.circle, prog(t, T.circle, T.circle + 0.55));
  show(PROPS.calendar.examLbl, prog(t, T.circle + 0.45, T.circle + 0.6));
  // highlighter strokes in the book
  PROPS.book.inner.querySelectorAll('mark').forEach((m, i) => m.style.setProperty('--hl', (E.outCubic(prog(t, T.book + 0.5 + i * 0.5, T.book + 0.8 + i * 0.5)) * 100).toFixed(1) + '%'));
  // generic timer countdown (ticks every second, frozen at 10 s)
  const gt = tj < T.timer + 0.45 ? 1500 : 1500 - Math.floor(tj - (T.timer + 0.45)) - 1;
  setText(PROPS.gtimer.lcd, mmss(gt));
  // phone screen lights up with each notification
  PROPS.phone.inner.querySelector('.scr').style.filter = `brightness(${(0.6 + 0.4 * Math.max(...T.notifs.map(n => Math.exp(-Math.max(0, tj - n) * 3) * (tj >= n ? 1 : 0)), 0)).toFixed(3)})`;

  // ---------- ink: the line
  const lr = E.inOutSine(prog(t, T.line0, T.line1));
  reveal(INK.line, lr); reveal(INK.lineShadow, lr);
  if (lr > 0 && lr < 1) { const L_ = INK.line.__len; const pt = INK.line.getPointAtLength(L_ * lr); INK.nib.setAttribute('cx', pt.x); INK.nib.setAttribute('cy', pt.y); INK.nib.style.opacity = 1; } else INK.nib.style.opacity = 0;
  { const cw = INK.clock.offsetWidth, chh = INK.clock.offsetHeight; place(INK.clock, { x: L(-40, -120), y: L(-430, -210), r: -4, s: 1, o: 1 - prog(t, 10.7, 11.2) }, cw, chh);
    INK.clock.style.clipPath = `inset(-20% ${((1 - prog(t, T.clock, T.clock + 0.65)) * 100).toFixed(2)}% -20% 0)`; }
  // lead part of the line fades once the logo lands; arc crossfades to the clean ring
  const lf = prog(t, T.logo + 0.1, T.logo + 0.7);
  INK.line.style.opacity = lr > 0 ? (1 - lf).toFixed(3) : 0; INK.lineShadow.style.opacity = lr > 0 ? ((1 - lf) * .9).toFixed(3) : 0;
  const lg = E.outBack(prog(t, T.logo, T.logo + 0.55));
  const logoOut = prog(t, 15.0, 15.85);
  // logo group transform: fly to the tasks card header logo
  const hdr = headerLogoWorld();
  const fl = E.inOutCubic(logoOut);
  const lx = lerp(LOGO.x, hdr.x, fl), ly = lerp(LOGO.y, hdr.y, fl), ls = lerp(1, hdr.s, fl);
  const logoXf = `translate(${lx - LOGO.x * ls} ${ly - LOGO.y * ls}) scale(${ls})`;
  for (const e of [INK.tile, INK.ring, INK.dot]) e.setAttribute('transform', logoXf);
  const tileS = clamp(lg, 0, 1.2);
  INK.tile.setAttribute('transform', `${logoXf} translate(${LOGO.x} ${LOGO.y}) scale(${tileS.toFixed(4)}) translate(${-LOGO.x} ${-LOGO.y})`);
  const logoVis = t < 15.86 ? 1 : 0;
  INK.tile.style.opacity = (t >= T.logo ? 1 : 0) * logoVis;
  INK.ring.style.opacity = (prog(t, T.logo + 0.05, T.logo + 0.45) * logoVis).toFixed(3);
  INK.ring.setAttribute('stroke-width', lerp(15, LOGO.r * 2.5 / 9, E.outCubic(prog(t, T.logo, T.logo + .5))));
  INK.dot.style.opacity = (t >= T.logo + 0.25 ? 1 : 0) * logoVis;
  INK.dot.setAttribute('r', (LOGO.r * 2.5 / 9 * E.outBack(prog(t, T.logo + 0.25, T.logo + 0.6))).toFixed(2));
  // wordmark: wipe on, then fly into the header word
  const wr = E.outCubic(prog(t, T.word, T.word + 0.7));
  const wHome = V ? P(0, 330) : P(230, -10);
  const ww = INK.word.offsetWidth || 800, wh = INK.word.offsetHeight || 160;
  const wd = headerWordWorld();
  const wst = { x: lerp(wHome.x, wd.x, fl), y: lerp(wHome.y, wd.y, fl), s: lerp(1, wd.s, fl), o: t < 15.86 ? 1 : 0 };
  place(INK.word, { ...wst, r: 0 }, ww, wh);
  INK.word.style.clipPath = `inset(-20% ${((1 - wr) * 100).toFixed(2)}% -30% 0)`;
  // strike through the generic timer
  const gp = sample(PROPS.gtimer.keys, t);
  if (t > T.freeze + 0.5 && t < T.freeze + 1.6) {
    const s1 = [[gp.x - 190, gp.y - 110], [gp.x + 190, gp.y + 110]], s2 = [[gp.x + 180, gp.y - 115], [gp.x - 185, gp.y + 105]];
    INK.strike1.setAttribute('d', toD(wobble(catmull(s1, 16), 2, 5))); INK.strike2.setAttribute('d', toD(wobble(catmull(s2, 16), 2, 6)));
    INK.strike1.__len = 0; INK.strike2.__len = 0;
    reveal(INK.strike1, prog(t, 10.75, 10.9)); reveal(INK.strike2, prog(t, 10.88, 11.02));
  } else { INK.strike1.style.opacity = 0; INK.strike2.style.opacity = 0; }

  // ---------- thoughts
  renderThoughts(t, tj);
  // ---------- app UI
  renderUI(t);
  // ---------- HUD (CTA)
  renderCTA(t);
  // ---------- fx: confetti + vignette + grain + final fade
  fxx.clearRect(0, 0, W, H);
  confetti(t, T.block1 + 0.02, 1, UI.core.dig); confetti(t, T.rbreak + 0.02, 2, UI.room.dig);
  const chaosVig = t < T.line0 ? 0.25 + 0.35 * prog(tj, 3, 10) : lerp(0.6, 0.18, prog(t, T.line0, 13));
  vig.style.background = `radial-gradient(ellipse ${L('90% 70%', '80% 85%')} at 50% 48%, rgba(0,0,0,0) 55%, rgba(70,40,15,${(t > 13 ? 0.18 : chaosVig).toFixed(3)}) 100%)`;
  gx.clearRect(0, 0, grain.width, grain.height); gx.drawImage(grainFrames[Math.floor(t * 24) % grainFrames.length], 0, 0);
  fadeEl.style.opacity = (prog(t, 59.3, 60) * 0.0).toFixed(3) + (t < 0.25 ? '' : '');
  fadeEl.style.background = '#f3eadb';
  fadeEl.style.opacity = Math.max(1 - prog(t, 0, 0.35), 0).toFixed(3);
  return t;
}

// world position of the tasks-card header logo / word (for the match cut)
function headerLogoWorld() { const s = LAY.tasks.s; return { x: LAY.tasks.x + (-LAY.tasksW / 2 + 18 + 17) * s, y: LAY.tasks.top + (18 + 17) * s, s: (34 * s) / (INK.tileSide) }; }
function headerWordWorld() { const s = LAY.tasks.s; const hw = UI.tasks.word.offsetWidth; const wd = INK.word.offsetWidth || 800; return { x: LAY.tasks.x + (-LAY.tasksW / 2 + 18 + 34 + 10 + hw / 2) * s, y: LAY.tasks.top + (18 + 17) * s, s: (hw * s) / (wd * 0.94) }; }

function renderThoughts(t, tj) {
  const defs = V ? [[-10, -650, -3, 1], [40, -300, 3, 1], [0, 330, -2, 1]] : [[-380, -440, -3, .92], [430, -410, 3, .92], [20, 400, -2, .95]];
  const payDefs = V ? [[225, -330, -2, .56], [225, -150, 2, .56], [225, 50, -1.5, .5]] : [[300, -380, -2, .62], [300, -200, 2, .62], [300, -10, -1.5, .56]];
  const repDefs = V ? [[250, -270, 2, .62], [255, -90, -2, .62], [255, 150, 2, .6]] : [[330, -318, 2, .66], [335, -138, -2, .66], [335, 95, 2, .64]];
  const starts = [T.thought1, T.thought2, T.thought3];
  const durs = [0.9, 1.0, 1.5];
  THOUGHTS.forEach((th, i) => {
    const w = th.strip.offsetWidth, h = th.strip.offsetHeight;
    const d = defs[i]; const pd = payDefs[i]; const t0 = starts[i];
    const keys = norm([[t0 - 0.001, { x: d[0], y: d[1] + 20, r: d[2] - 4, s: d[3] * 1.1, o: 0 }], [t0 + 0.25, { x: d[0], y: d[1], r: d[2], s: d[3], o: 1 }, E.outBack],
      [10.62 + i * 0.1, { x: d[0], y: d[1], r: d[2], s: d[3] }], [11.2 + i * 0.1, { x: d[0] + (i === 1 ? 700 : -700), y: d[1] - 80, r: d[2] - 15, s: d[3] * .8, o: 0 }, E.inCubic],
      [T.payoff + 0.45 + i * 0.2, { x: pd[0], y: pd[1] - 40, r: pd[2] + 6, s: pd[3] * 1.15, o: 0 }], [T.payoff + 0.8 + i * 0.2, { x: pd[0], y: pd[1], r: pd[2], s: pd[3], o: 1 }, E.outBack],
      [T.cta, { x: pd[0], y: pd[1], r: pd[2], s: pd[3], o: 1 }], [T.cta + 0.7, { x: pd[0], y: pd[1] + 700, r: pd[2], s: pd[3], o: 0 }, E.inCubic]]);
    let st = sample(keys, t);
    if (t < 11.3) { st.x += vnoise(tj * 1.3, 40 + i) * 3 * prog(tj, 2, 10); st.r += vnoise(tj, 50 + i) * 1.2 * prog(tj, 3, 10); }
    // anchor left-middle
    th.wrap.style.width = w + 'px'; th.wrap.style.height = h + 'px';
    place(th.wrap, st, w, h);
    const wp = prog(t, t0 + 0.05, t0 + 0.05 + durs[i]);
    th.wrap.style.clipPath = t >= T.payoff ? 'none' : `inset(-30% ${((1 - wp) * 100).toFixed(2)}% -30% -5%)`;
    th.hl.style.transform = `scaleX(${E.outCubic(prog(t, t0 + durs[i] * 0.6, t0 + durs[i] + 0.35)).toFixed(3)})`;
    // payoff strike + reply
    const sp = prog(t, T.rw[i] - 0.05, T.rw[i] + 0.3);
    if (!th.strike) { const pts = []; const n = 7; for (let k = 0; k <= n; k++) pts.push([16 + (w - 32) * k / n, h * 0.5 + (k % 2 ? -h * 0.2 : h * 0.18)]); th.strike = inkPath(th.ssvg, toD(wobble(catmull(pts, 6), 1.5, 60 + i)), '#c0392b', 7); }
    reveal(th.strike, t >= T.payoff ? sp : 0);
    const rw = th.rstrip.offsetWidth, rh = th.rstrip.offsetHeight; const rd = repDefs[i];
    th.rep.style.width = rw + 'px'; th.rep.style.height = rh + 'px';
    const ro = prog(t, T.rw[i] + 0.25, T.rw[i] + 0.4) * (1 - prog(t, T.cta, T.cta + 0.5));
    const rst = { x: rd[0], y: rd[1] + (1 - E.outBack(prog(t, T.rw[i] + 0.25, T.rw[i] + 0.6))) * 30 + E.inCubic(prog(t, T.cta, T.cta + 0.7)) * 700, r: rd[2], s: rd[3], o: ro };
    place(th.rep, rst, rw, rh);
    th.rtxt.style.clipPath = `inset(-20% ${((1 - prog(t, T.rw[i] + 0.3, T.rw[i] + 1.1)) * 100).toFixed(2)}% -20% 0)`;
  });
}

function renderUI(t) {
  const U = UI.tasks;
  show(U.lg, t >= 15.86 ? 1 : 0); show(U.word, t >= 15.86 ? 1 : 0);
  // ---------- AI note upload (production UploadTasksPanel states)
  const open = t >= T.upDrop && t < T.upDone + 0.55;
  U.upC.style.display = open ? 'none' : 'block'; U.upO.style.display = open ? 'block' : 'none';
  U.upBtn.style.transform = `scale(${(1 - 0.1 * clamp(1 - Math.abs(t - T.upDrop) / 0.12)).toFixed(3)})`;
  setText(U.ul, t >= T.upDone + 0.55 ? '2 uploads' : '3 uploads');
  let pr = 0, st = '';
  if (t < T.upRead) { pr = 15; st = 'Uploading your file…'; }
  else if (t < T.upDone) { pr = Math.min(90, 40 + 3 * Math.floor((t - T.upRead) / 0.35)); st = 'Reading text and using OCR only if needed…'; }
  else { pr = 100; st = `<span style="color:hsl(var(--roamly-green));display:grid">${I.checkG}</span> Done: 5 tasks added.`; }
  U.upBar.style.width = pr + '%'; setHTML(U.upSt, st);
  const rowAt = j => T.upDone + 0.65 + j * 0.11;
  U.rows.forEach((r, j) => {
    const p = E.outCubic(prog(t, rowAt(j), rowAt(j) + 0.32));
    r.style.height = t >= rowAt(j) ? (U.rowH[j] * p).toFixed(1) + 'px' : '0px';
    r.style.opacity = p.toFixed(3);
  });
  { const L1 = LAY.tasks; const tw = LAY.tasksW, th = U.el.offsetHeight;
    const unf = E.outCubic(prog(t, 15.8, 16.65));
    const flipOut = prog(t, T.flip, T.flip + 0.3);
    const tst = { x: L1.x, y: L1.top + th * L1.s / 2 + (1 - unf) * 60, s: L1.s * (0.94 + 0.06 * unf), o: t < 15.8 || t > T.flip + 0.31 ? 0 : clamp(unf * 4) };
    place(U.el, tst, tw, th);
    U.el.style.transform += ` perspective(1600px) rotateX(${((1 - unf) * -82).toFixed(2)}deg) rotateY(${(E.inCubic(flipOut) * -90).toFixed(2)}deg)`;
    U.el.style.transformOrigin = '50% 50%';
    // lecture bullets fly out of the upload and land as task rows
    const S_ = L1.s, cx = L1.x - tw / 2 * S_, cy = L1.top;
    const upY = cy + (U.up.offsetTop + 30) * S_;
    let n = 0;
    LIST.forEach((it, j) => {
      if (it.grp) return;
      const el = UI.bits[it.task], k = n++;
      const t1 = rowAt(j) + 0.08, t0 = t1 - 0.62;
      const row = U.rows[j]; const ry = cy + (U.list.offsetTop + row.offsetTop + U.rowH[j] * 0.45) * S_;
      const pz = E.inOutCubic(prog(t, t0, t1));
      const w = el.offsetWidth, h = el.offsetHeight;
      const x0 = L1.x + (k - 2) * L(120, 150), x1 = cx + L(150, 190) * S_;
      const arc = Math.sin(Math.PI * pz) * L(-160, -120);
      place(el, { x: lerp(x0, x1, pz), y: lerp(upY, ry, pz) + arc, r: lerp((k % 2 ? 6 : -5), 0, pz), s: lerp(L(1.45, 1.25), 0.6, pz), o: t >= t0 && t < t1 + 0.12 ? (1 - prog(t, t1 - 0.02, t1 + 0.12)) : 0 }, w, h);
    });
  }
  // method sheet (quick)
  const shIn = E.outCubic(prog(t, T.method, T.method + 0.25)), shOut = E.inCubic(prog(t, 23.82, 23.98));
  U.sheet.style.transform = `translateY(${((1 - shIn + shOut) * 105).toFixed(2)}%)`;
  U.sheet.style.visibility = t < T.method || t > 23.99 ? 'hidden' : 'visible';
  U.hlm.style.transform = `scaleX(${E.outCubic(prog(t, 23.45, 23.63)).toFixed(3)})`;
  const sel = t >= 23.68; setCls(U.mcards[0], 'sel', !sel); setCls(U.mcards[1], 'sel', sel);
  U.mcards[1].style.transform = `scale(${(1 - 0.03 * clamp(1 - Math.abs(t - 23.66) / 0.1)).toFixed(3)})`;
  tapRipple(t, [T.upDrop], U.upBtn); tapRipple(t, [23.66], U.mcards[1]);
  U.prog.style.display = t >= rowAt(0) ? 'block' : 'none';

  // ---------- focus core
  const C = UI.core; const Lc = LAY.core; const fh = LAY.coreH;
  const flipIn = prog(t, T.flip + 0.3, T.flip + 0.62);
  const docked = t >= T.room + 0.3;
  const hidden = t >= T.room + 0.3 && t < T.payoff - 0.05;
  let cst = { x: Lc.x, y: Lc.y, s: Lc.s, o: t >= T.flip + 0.3 && t < T.cta + 0.9 && !hidden ? (t >= T.payoff - 0.05 ? prog(t, T.payoff - 0.05, T.payoff + 0.12) : 1) : 0 };
  if (docked) cst = { ...cst, x: LAY.pcore.x, y: LAY.pcore.y, s: LAY.pcore.s };
  const cOut = E.inCubic(prog(t, T.cta, T.cta + 0.8)); cst.y += cOut * 1200; cst.r = cOut * 8;
  place(C.el, cst, 390, fh);
  const turnOut = E.inCubic(prog(t, T.room, T.room + 0.3));
  C.el.style.transform += ` perspective(1400px) rotateY(${((1 - E.outCubic(flipIn)) * 90 + (t < T.room + 0.3 ? turnOut * -90 : 0)).toFixed(2)}deg)`;
  C.el.style.transformOrigin = '50% 50%';
  C.el.style.borderRadius = (docked ? 44 : 26) + 'px';
  const bz = UI.bezel; const bw = 390 + 26, bh = fh + 26;
  bz.style.width = bw + 'px'; bz.style.height = bh + 'px';
  place(bz, { ...cst, o: prog(t, T.payoff, T.payoff + 0.3) * (t < T.cta + 0.9 ? 1 : 0) }, bw, bh);
  bz.style.borderRadius = '56px';
  // state machine (Deep Work 50/10; task 1 is a 1-session task, so it auto-completes at the end of block 1)
  let dig = 'Start', digits = '50:00', barP = 0, taskI = 0, lab = 'FOCUS', sage = false, rain = 0;
  if (t < T.start) { digits = '50:00'; dig = 'Start'; }
  else if (t < T.block1) { const r = lapse(t, T.start + 0.1, T.block1, 3000); digits = mmss(r); dig = 'Pause'; barP = 1 - r / 3000; }
  else if (t < T.resume1) { digits = '10:00'; dig = 'Resume'; lab = 'SHORT BREAK'; sage = true; rain = 1; taskI = 1; }
  else if (t < T.breakEnd) { const r = lapse(t, T.resume1 + 0.05, T.breakEnd, 600); digits = mmss(r); dig = 'Pause'; lab = 'SHORT BREAK'; sage = true; rain = 1; barP = 1 - r / 600; taskI = 1; }
  else if (t < T.payoff) { digits = '50:00'; dig = 'Resume'; taskI = 1; }
  else { const e = t - T.payoff; digits = mmss(3000 - 95 - e); dig = 'Pause'; taskI = 1; barP = (95 + e) / 3000; }
  setText(C.dig, digits); setText(C.lab, lab);
  setHTML(C.main, `${dig === 'Pause' ? I.pause : I.play} <span class="ml">${dig}</span>`);
  C.main.style.background = sage ? 'hsl(157 16% 55%)' : 'hsl(24 33% 40%)';
  C.main.style.width = dig === 'Start' ? '124px' : '136px';
  C.lab.style.color = sage ? 'hsl(157 20% 45%)' : 'hsl(var(--muted-foreground))';
  setText(C.top, sage ? 'ON A BREAK' : 'FOCUS MODE'); C.top.style.color = sage ? 'hsl(157 20% 45%)' : 'hsl(var(--muted-foreground))';
  const fm = prog(t, T.start + 0.1, T.start + 0.5); show(C.top, fm); show(C.exit, fm);
  C.bar.style.width = (clamp(barP) * 100).toFixed(2) + '%';
  C.bar.style.background = sage ? 'hsl(157 16% 55%)' : 'hsl(24 33% 40%)';
  C.pips.forEach((p, i) => { p.style.background = i === 0 && t >= T.start ? (sage ? 'hsl(157 16% 55%)' : 'hsl(24 33% 40%)') : 'hsl(var(--border))'; });
  setText(C.task, TASKS[taskI].title);
  setText(C.hint, sage ? 'Break time. Look away, stretch, breathe. Your alerts are back on.' : 'Eyes here. Notifications quiet themselves in your device\'s Focus mode.');
  show(C.hint, t >= T.start ? 1 : 0); show(C.line, sage ? 0 : 1);
  const rk = rain ? clamp(Math.min(prog(t, T.block1, T.block1 + 0.6), 1 - prog(t, T.breakEnd - 0.2, T.breakEnd + 0.3))) : 0;
  C.sky.style.background = `linear-gradient(180deg, ${mixc('#dfeaf1', '#b9c6cf', rk)}, ${mixc('#f0f1ea', '#cbd3d3', rk)})`;
  show(C.tagw, rk);
  const rx = C.rx; rx.clearRect(0, 0, 700, 170);
  if (rk > 0) { rx.strokeStyle = `rgba(110,170,215,${(0.75 * rk).toFixed(3)})`; rx.lineWidth = 2.2; for (let i = 0; i < 46; i++) { const sx = hash(i, 5) * 720, sp = 260 + hash(i, 6) * 160, ph = hash(i, 7); const y = ((t * sp / 170 + ph) % 1) * 200 - 20; rx.beginPath(); rx.moveTo(sx - y * 0.08, y); rx.lineTo(sx - y * 0.08 - 2, y + 16); rx.stroke(); } }
  C.sp.style.transform = `translateX(-50%) scale(${(1 + 0.08 * rk * (0.5 + 0.5 * Math.sin(t * 5))).toFixed(3)})`;
  tapRipple(t, [T.start, T.resume1], C.main);

  // ---------- page chrome (above/below the core), blown away by Focus mode
  const chOn = t >= T.flip + 0.35 && t < T.start + 0.9;
  const cto = prog(t, T.flip + 0.4, T.flip + 0.65);
  const blow = E.inCubic(prog(t, T.start + 0.08, T.start + 0.7));
  place(UI.chromeTop, { x: Lc.x + (V ? 0 : -8), y: Lc.y - fh / 2 * Lc.s - L(118, 85) * Lc.s * 0.72 - blow * 500, s: Lc.s * 0.72, r: blow * -12, o: chOn ? cto : 0 }, 390, UI.chromeTop.offsetHeight);
  place(UI.chromeBot, { x: Lc.x, y: Lc.y + fh / 2 * Lc.s + L(98, 80) * Lc.s * 0.72 + blow * 600, s: Lc.s * 0.72, r: blow * 10, o: chOn ? cto : 0 }, 390, UI.chromeBot.offsetHeight);

  // ---------- STUDYING / ON A BREAK card
  const SD = UI.stud; const Ls = LAY.stud; const sh = SD.el.offsetHeight;
  let so = 0, sy = Ls.y, sx = Ls.x;
  if (V) {
    const k = E.outCubic(prog(t, T.resume1 + 0.15, T.resume1 + 0.6)) - E.inCubic(prog(t, T.breakEnd - 0.3, T.breakEnd + 0.1));
    so = k > 0.001 ? 1 : 0; sy = lerp(1200, 640 - sh * Ls.s / 2 + 250, k);
  } else {
    so = prog(t, T.start + 0.3, T.start + 0.8) * (1 - prog(t, T.room, T.room + .35));
    sx = Ls.x + (1 - E.outCubic(prog(t, T.start + 0.3, T.start + 0.9))) * 500 + E.inCubic(prog(t, T.room, T.room + .45)) * 700;
  }
  place(SD.el, { x: sx, y: sy, s: Ls.s, o: so }, 390, sh);
  const onBreak = t >= T.block1 && t < T.breakEnd;
  SD.brk.style.display = onBreak ? 'block' : 'none';
  setText(SD.sh, onBreak ? 'ON A BREAK' : 'STUDYING'); SD.sh.style.color = onBreak ? 'hsl(157 20% 45%)' : 'hsl(var(--muted-foreground))';
  const done0 = t >= T.block1 + 0.3;
  SD.rows.forEach((r, i) => {
    setText(r.cnt, `${i === 0 && t >= T.block1 ? 1 : 0}/${TASKS[i].est}`);
    const active = i === taskI; setCls(r.el, 'active', active); r.foc.style.display = active ? 'inline-flex' : 'none';
    if (i === 0) { setCls(r.cb, 'on', done0); setHTML(r.cb, done0 ? I.check : ''); r.tt.style.textDecoration = done0 ? 'line-through' : 'none'; r.tt.style.color = done0 ? 'hsl(var(--muted-foreground))' : ''; }
  });

  // ---------- ROOMS LOBBY (33.3 → 35.0)
  { const Lb = UI.lobby, Ll = LAY.lobby;
    const inT = E.outCubic(prog(t, T.room + 0.3, T.room + 0.6)), outT = E.inCubic(prog(t, T.join + 0.12, T.roomIn));
    place(Lb.el, { x: Ll.x, y: Ll.y, s: Ll.s, o: t >= T.room + 0.3 && t < T.roomIn ? 1 : 0 }, 390, LAY.lobbyH);
    Lb.el.style.transform += ` perspective(1400px) rotateY(${((1 - inT) * 90 - outT * 90).toFixed(2)}deg)`;
    const el = Math.floor(Math.max(0, t - (T.room + 0.3)));
    Lb.times.forEach((x, i) => setText(x, mmss(Lb.secs[i] - el)));
    setText(Lb.counts[1], t >= T.join ? '8/50' : '7/50');
    Lb.card.style.boxShadow = t >= T.join - 0.3 ? `0 0 0 ${(2 * clamp((t - T.join + 0.3) / 0.2)).toFixed(2)}px hsl(var(--primary) / .55)` : 'none';
    tapRipple(t, [T.join], Lb.join);
  }
  // ---------- ROOM: the group session (35.0 → 45.0)
  { const R = UI.room, Lr = LAY.room, rh = LAY.roomH;
    const inT = E.outCubic(prog(t, T.roomIn, T.roomIn + 0.32));
    const toPhone = E.inOutCubic(prog(t, T.payoff - 0.45, T.payoff));
    const vis = t >= T.roomIn && t < T.payoff ? 1 : 0;
    const brk = t >= T.rbreak;
    const lift = V ? E.inOutCubic(prog(t, T.rbreak - 0.1, T.rbreak + 0.5)) * -150 : 0;
    const st = { x: lerp(Lr.x, LAY.pcore.x, toPhone), y: lerp(Lr.y + lift, LAY.pcore.y, toPhone), s: lerp(Lr.s, LAY.pcore.s * 0.9, toPhone), o: vis * (1 - prog(t, T.payoff - 0.15, T.payoff)) };
    place(R.el, st, 390, rh);
    R.el.style.transform += ` perspective(1400px) rotateY(${((1 - inT) * 90).toFixed(2)}deg)`;
    // shared timer: live seconds, then a time-lapse to the break
    const live = 1868 - Math.floor(Math.max(0, t - T.roomIn));
    let secs = live, total = 3000;
    if (t >= T.lapse0 && t < T.rbreak) { const l0 = 1868 - Math.floor(T.lapse0 - T.roomIn); secs = Math.round(l0 * (1 - E.inCubic(prog(t, T.lapse0, T.rbreak)))); }
    if (brk) { secs = 600 - Math.floor(t - T.rbreak); total = 600; }
    setText(R.dig, mmss(secs)); setText(R.cd, mmss(secs));
    setText(R.lab, brk ? 'SHORT BREAK · BLOCK 2/3' : 'FOCUS · BLOCK 2/3');
    const col = brk ? 'hsl(var(--roamly-green))' : 'hsl(var(--primary))';
    R.lab.style.color = col; R.bar.style.background = col;
    R.bar.style.width = ((1 - secs / total) * 100).toFixed(2) + '%';
    R.chips.forEach((c, i) => { const k = E.outBack(prog(t, T.roomIn + ROOM_JOIN[i], T.roomIn + ROOM_JOIN[i] + 0.3)); c.style.opacity = clamp(k * 1.5).toFixed(3); c.style.transform = `scale(${(0.6 + 0.4 * k).toFixed(3)})`; });
    if (!R.ring && R.chipsBox.offsetWidth) { const bx = R.chipsBox.offsetLeft, by = R.chipsBox.offsetTop, bw = R.chipsBox.offsetWidth, bh2 = R.chipsBox.offsetHeight;
      const pts = []; for (let k = 0; k <= 64; k++) { const a = -2.2 + k / 64 * 6.9; pts.push([bx + bw / 2 + Math.cos(a) * (bw / 2 + 10) * (1 + k * 0.0015), by + bh2 / 2 + Math.sin(a) * (bh2 / 2 + 12)]); }
      R.ring = inkPath(R.svg, toD(wobble(pts, 1.2, 99)), '#E8A33D', 3.2); }
    if (R.ring) reveal(R.ring, prog(t, T.roomIn + 1.45, T.roomIn + 2.0) * (t < T.lapse0 ? 1 : 1 - prog(t, T.lapse0, T.lapse0 + 0.3)));
    // break-time chat: locked during focus, opens on the break
    show(R.lock, brk ? 0 : 1); R.lock.style.display = brk ? 'none' : 'inline-flex'; R.open.style.display = brk ? 'inline-flex' : 'none';
    R.empty.style.display = brk && t >= T.rbreak + 0.45 ? 'none' : 'block';
    R.msgs.forEach((m, i) => { const t0 = T.rbreak + 0.45 + i * 0.5; const k = E.outBack(prog(t, t0, t0 + 0.3)); m.style.display = t >= t0 ? 'block' : 'none'; m.style.opacity = clamp(k * 1.4).toFixed(3); m.style.transform = `translateY(${((1 - k) * 14).toFixed(1)}px) scale(${(0.92 + 0.08 * k).toFixed(3)})`; });
    setText(R.inp, brk ? 'Message the room…' : `Chat opens in ${mmss(secs)}. Keep focusing`);
    const cin = E.outCubic(prog(t, T.roomIn + 1.9, T.roomIn + 2.3));
    const cy2 = V ? lerp(LAY.rchat.y, LAY.rchat.yBreak, E.inOutCubic(prog(t, T.rbreak - 0.1, T.rbreak + 0.5))) : LAY.rchat.y;
    const ch = R.chat.offsetHeight;
    place(R.chat, { x: LAY.rchat.x, y: cy2 + (1 - cin) * 60 + (V ? 0 : 0), s: LAY.rchat.s, r: V ? 1 : -1, o: cin * vis * (1 - prog(t, T.payoff - 0.75, T.payoff - 0.5)) }, 390, ch);
  }
  // ---------- analytics card on payoff
  const A = UI.an; const La = LAY.an; const ah = LAY.anH;
  const ain = E.outBack(prog(t, T.payoff + 0.7, T.payoff + 1.3)); const aout = E.inCubic(prog(t, T.cta, T.cta + 0.7));
  place(A.el, { x: La.x, y: La.y + (1 - ain) * 80 + aout * 900, s: La.s * (0.9 + 0.1 * ain), r: V ? -1.2 : 1.5, o: t >= T.payoff + 0.7 && t < T.cta + 0.8 ? clamp(ain) : 0 }, 390, ah);
  A.bar.style.width = (62.5 * E.outCubic(prog(t, T.payoff + 1.1, T.payoff + 2.1))).toFixed(2) + '%';
  setText(A.am, `${Math.round(75 * E.outCubic(prog(t, T.payoff + 1.1, T.payoff + 2.1)))} / 120 min`);
}
const mixc = (a, b, k) => { const pa = [1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16)), pb = [1, 3, 5].map(i => parseInt(b.slice(i, i + 2), 16)); return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * k)).join(',')})`; };

// tap ripple over a button (drawn on fx canvas in screen space)
function tapRipple(t, times, btn) {
  for (const t0 of times) {
    const p = prog(t, t0 - 0.12, t0 + 0.45); if (p <= 0 || p >= 1) continue;
    const r = btn.getBoundingClientRect(), sr = stage.getBoundingClientRect(), k = sr.width / W;
    const cx = (r.left + r.width / 2 - sr.left) / k, cy = (r.top + r.height / 2 - sr.top) / k;
    // fingertip-ish press: filled dot then ring
    const q = prog(t, t0 - 0.12, t0);
    fxx.save();
    fxx.fillStyle = `rgba(255,255,255,${(0.35 * Math.sin(Math.PI * clamp(q))).toFixed(3)})`; fxx.beginPath(); fxx.arc(cx, cy, 30 * (0.6 + 0.4 * q), 0, 6.283); fxx.fill();
    const rp = prog(t, t0, t0 + 0.45);
    if (rp > 0) { fxx.strokeStyle = `rgba(255,255,255,${(0.7 * (1 - rp)).toFixed(3)})`; fxx.lineWidth = 6 * (1 - rp) + 1; fxx.beginPath(); fxx.arc(cx, cy, 30 + 120 * E.outCubic(rp), 0, 6.283); fxx.stroke(); }
    fxx.restore();
  }
}
function confetti(t, t0, seed, el) {
  const age = t - t0; if (age < 0 || age > 2.2) return;
  const r = el.getBoundingClientRect(), sr = stage.getBoundingClientRect(), k = sr.width / W;
  const cx = (r.left + r.width / 2 - sr.left) / k, cy = (r.top + r.height * 0.4 - sr.top) / k;
  const cols = ['#E8A33D', '#886044', '#7fa393', '#d9785a', '#f2c078', '#6d8fb8'];
  for (let i = 0; i < 110; i++) {
    const R = rng(seed * 1000 + i); const a = -Math.PI / 2 + (R() - 0.5) * 2.6, v = 900 + R() * 900, g = 1500;
    const x = cx + Math.cos(a) * v * age * 0.9 + Math.sin(age * 6 + i) * 18, y = cy + Math.sin(a) * v * age + 0.5 * g * age * age;
    const o = 1 - prog(age, 1.3, 2.2); fxx.save(); fxx.globalAlpha = o; fxx.translate(x, y); fxx.rotate(age * (4 + R() * 8) + i); fxx.fillStyle = cols[i % cols.length];
    const w = 10 + R() * 10, h = 6 + R() * 8; fxx.scale(1, Math.cos(age * (6 + R() * 6))); fxx.fillRect(-w / 2, -h / 2, w, h); fxx.restore();
  }
}

// ------------------------------------------------------------------ CTA
function renderCTA(t) {
  const rise = (els, t0, stagger = 0.07) => els.forEach((w, i) => { const p = E.outQuint(prog(t, t0 + i * stagger, t0 + i * stagger + 0.6)); w.style.transform = `translateY(${((1 - p) * 110).toFixed(1)}%)`; });
  const out = E.inCubic(prog(t, T.final - 0.1, T.final + 0.45));
  const A = CTA.a, B = CTA.b;
  const aw = A.offsetWidth, ah = A.offsetHeight, bw = B.offsetWidth, bh = B.offsetHeight;
  const posA = V ? P(540, 400) : P(600, 390), posB = V ? P(540, 640) : P(600, 650);
  place(A, { x: posA.x, y: posA.y - out * 120, o: (t >= T.tagA ? 1 : 0) * (1 - out) }, aw, ah); rise(CTA.aw, T.tagA);
  place(B, { x: posB.x, y: posB.y - out * 120, o: (t >= T.tagB ? 1 : 0) * (1 - out) }, bw, bh); rise(CTA.bw, T.tagB);
  // underline under FLOW
  const em = B.querySelector('em'); if (!CTA.bPath && em.offsetWidth) { const x0 = em.offsetLeft + em.parentNode.parentNode.offsetLeft, y0 = bh * 0.92; const pts = []; for (let k = 0; k <= 10; k++) pts.push([x0 + em.offsetWidth * k / 10, y0 + Math.sin(k * 0.9) * 5]); CTA.bPath = inkPath(CTA.bUnder, toD(catmull(pts, 4)), '#E8A33D', 10); }
  if (CTA.bPath) reveal(CTA.bPath, prog(t, T.tagB + 0.45, T.tagB + 0.85));
  // logo: the ring drawn over the orbiting materials, then the tile; then it settles into the CTA lockup
  const RC = ringCenterWorld();
  const scr = { x: RC.x + W / 2, y: RC.y - CTAY + H / 2 };
  const side0 = RC.r * 32 / 9;
  const fin = E.inOutCubic(prog(t, T.final, T.final + 0.9));
  const endSide = L(340, 360), endPos = V ? P(540, 580) : P(520, 530);
  const side = lerp(side0, endSide, fin);
  const lp = { x: lerp(scr.x, endPos.x, fin), y: lerp(scr.y, endPos.y, fin) };
  const lo = prog(t, T.ring, T.ring + 0.4);
  CTA.logo.style.width = CTA.logo.style.height = side + 'px';
  place(CTA.logo, { x: lp.x, y: lp.y, s: 1, o: t >= T.ring ? 1 : 0 }, side, side);
  // draw-on of the ring inside the logo svg + tile scale
  const svg = CTA.logo.querySelector('svg'); const rect = svg.querySelector('rect'), ring = svg.querySelectorAll('circle')[0], dot = svg.querySelectorAll('circle')[1];
  const tileP = E.outBack(prog(t, T.ring + 0.45, T.ring + 0.95));
  rect.setAttribute('transform', `translate(16 16) scale(${clamp(tileP, 0, 1.2).toFixed(4)}) translate(-16 -16)`);
  const C = 2 * Math.PI * 9, rp = E.inOutCubic(prog(t, T.ring, T.ring + 0.55));
  ring.setAttribute('stroke-dasharray', rp < 1 ? `${(42 * rp).toFixed(2)} ${C}` : '42 14');
  dot.setAttribute('r', (2.5 * E.outBack(prog(t, T.ring + 0.5, T.ring + 0.85))).toFixed(3));
  // lockup text
  const txt = [[CTA.word, V ? P(540, 905) : P(1260, 350), T.final + 0.75], [CTA.sub, V ? P(540, 1080) : P(1260, 520), T.final + 0.95], [CTA.hand, V ? P(540, 1195) : P(1260, 615), T.final + 1.2], [CTA.url, V ? P(540, 1385) : P(1260, 785), T.final + 1.45]];
  for (const [el, p, t0] of txt) {
    const k = E.outQuint(prog(t, t0, t0 + 0.8)); const w = el.offsetWidth, h = el.offsetHeight;
    place(el, { x: p.x, y: p.y + (1 - k) * 40, o: k, s: el === CTA.url ? lerp(0.92, 1, E.outBack(prog(t, t0, t0 + 0.6))) : 1 }, w, h);
  }
  CTA.word.style.fontSize = L(150, 150) + 'px'; CTA.sub.style.fontSize = L(50, 48) + 'px'; CTA.hand.style.fontSize = L(54, 56) + 'px'; CTA.url.style.fontSize = L(58, 54) + 'px';
  CTA.hand.style.clipPath = `inset(-30% ${((1 - prog(t, T.final + 0.95, T.final + 1.9)) * 100).toFixed(2)}% -30% 0)`;
  // hand-drawn arrow/underline pointing at the URL
  const u = CTA.url; const uw = u.offsetWidth, uh = u.offsetHeight; const up = V ? P(540, 1385) : P(1260, 785);
  if (!CTA.ulBuilt && uw) { const pts = []; for (let k = 0; k <= 12; k++) pts.push([up.x - uw / 2 + 20 + (uw - 40) * k / 12, up.y + uh / 2 + 22 + Math.sin(k * 0.8) * 4]); CTA.ulPath.setAttribute('d', toD(wobble(catmull(pts, 4), 1.2, 77))); CTA.ulBuilt = 1; }
  reveal(CTA.ulPath, prog(t, T.final + 1.9, T.final + 2.5));
  // hand-drawn sparkles around the final logo
  const sp = V ? [[350, 430, 1], [735, 455, .8], [730, 720, .6]] : [[330, 380, 1], [700, 360, .8], [720, 660, .6]];
  CTA.sparks.forEach((pth, i) => { const [x, y, k] = sp[i]; const r = 26 * k;
    if (!pth.__b) { const d = []; for (let a = 0; a < 4; a++) { const an = a * Math.PI / 2; d.push(`M${(x + Math.cos(an) * r * .25).toFixed(1)},${(y + Math.sin(an) * r * .25).toFixed(1)}L${(x + Math.cos(an) * r).toFixed(1)},${(y + Math.sin(an) * r).toFixed(1)}`); } pth.setAttribute('d', d.join('')); pth.__b = 1; }
    reveal(pth, prog(t, T.final + 1.1 + i * 0.15, T.final + 1.5 + i * 0.15)); });
  // subtle breathing on the final hold
  const br = 1 + 0.012 * Math.sin(Math.max(0, t - 57) * 1.6) * prog(t, 57, 58);
  hud.style.transform = `translate(${W / 2}px,${H / 2}px) scale(${br.toFixed(4)}) translate(${-W / 2}px,${-H / 2}px)`;
}

// ------------------------------------------------------------------ cue sheet (sound design synced to picture)
function buildCues() {
  CUES.length = 0;
  cue(0.0, 'roomtone', 1, { dur: 60 });
  cue(T.clock, 'pencil', .7, { dur: 0.6 });
  [['lecture', 1], ['flash', .8], ['renal', .9], ['book', 1]].forEach(([n, g]) => cue(T[n] + 0.02, 'paperSlap', g));
  cue(T.flash + 0.05, 'cardFlick', .6);
  cue(T.thought1 + 0.05, 'pencil', .8, { dur: 0.9 });
  cue(T.calendar, 'paperSlap', .9); cue(T.circle, 'marker', .9, { dur: 0.55 });
  cue(T.thought2 + 0.05, 'pencil', .85, { dur: 1.0 });
  cue(T.coffee, 'mug', 1); cue(T.phone, 'buzz', .8);
  T.stickies.forEach((s, i) => cue(s, 'sticky', .7 + i * .05));
  T.notifs.forEach((n, i) => { cue(n, i % 2 ? 'ping2' : 'ping', .55 + i * .06); if (i % 3 === 1) cue(n + .05, 'buzz', .5 + i * .05); });
  cue(T.book + 0.5, 'highlighter', .6, { dur: 0.3 }); cue(T.book + 1.0, 'highlighter', .55, { dur: 0.3 }); cue(T.book + 1.5, 'highlighter', .6, { dur: 0.3 });
  cue(T.timer, 'paperSlap', 1.1); cue(T.timer + 0.05, 'timerClunk', 1);
  for (let s = T.timer + 0.45; s < T.freeze - 0.02; s += 0.5) cue(s, 'tick', 0.5 + 0.4 * prog(s, 5, 10));
  cue(3.2, 'typing', .5, { dur: 6.8, ramp: 1 }); cue(6.0, 'typing', .45, { dur: 4.0, ramp: 1, seed: 2 });
  cue(T.thought3 + 0.05, 'pencil', 1, { dur: 1.5 });
  cue(5.5, 'pageTurn', .5); cue(7.8, 'pageTurn', .6); cue(8.9, 'paperShuffle', .7); cue(9.4, 'pageTurn', .55);
  cue(4.0, 'chaosBed', 1, { dur: 6.0 });
  // silence 10.0 → 10.625
  cue(T.line0, 'pencilLong', 1, { dur: 1.9 });
  cue(10.76, 'marker', .7, { dur: .16 }); cue(10.88, 'marker', .7, { dur: .16 }); cue(11.12, 'fall', .8);
  [10.86, 11.0, 11.08, 11.22, 11.36, 11.46, 11.56, 11.7, 11.78].forEach((s, i) => cue(s + .35, 'settle', .45 + (i % 3) * .08));
  cue(T.logo, 'logoBloom', 1); cue(T.word, 'swish', .6);
  cue(15.05, 'whoosh', .8); cue(15.4, 'paperFold', .9);
  // AI note upload: the printout flies in and drops into the panel, the file is read, tasks land
  cue(T.upFly, 'whooshSoft', .6); cue(T.upDrop - 0.3, 'paperFold', .6); cue(T.upDrop, 'uiTap', .9);
  cue(T.upRead, 'highlighter', .45, { dur: .5 }); cue(T.upRead + 0.7, 'highlighter', .4, { dur: .5 }); cue(T.upRead + 1.4, 'highlighter', .45, { dur: .5 });
  cue(T.upDone, 'chime', .55, { alt: 1 });
  [1, 2, 3, 4, 6].forEach((j, i) => { cue(T.upDone + 0.65 + j * 0.11 - 0.45, 'swish', .3); cue(T.upDone + 0.65 + j * 0.11, 'pop', .5 + i * .04); });
  cue(T.method, 'sheet', .6); cue(23.45, 'highlighter', .6, { dur: .2 }); cue(23.66, 'uiTap', .9); cue(23.8, 'sheet', .45);
  cue(T.flip, 'pageTurn', .9); cue(T.flip + 0.3, 'pageTurn', .5);
  cue(T.start - 0.02, 'uiTapBig', 1); cue(T.start + 0.1, 'whooshAway', 1); cue(T.start + 0.35, 'paperShuffle', .6);
  cue(T.block1, 'chime', 1); cue(T.block1 + 0.02, 'confetti', .6); cue(T.block1 + 0.3, 'check', .7);
  cue(T.block1 + 0.2, 'rain', .5, { dur: T.breakEnd - T.block1 });
  cue(T.resume1, 'uiTap', .8); cue(T.breakEnd - 0.05, 'chime', .5, { alt: 1 });
  // group session (Rooms): lobby → join → shared timer → break chat
  cue(T.room, 'pageTurn', .9); cue(T.room + 0.3, 'pageTurn', .5);
  cue(T.join, 'uiTap', .9); cue(T.join + 0.12, 'pageTurn', .7); cue(T.roomIn, 'pageTurn', .45);
  ROOM_JOIN.forEach((s, i) => cue(T.roomIn + s, 'pop', .45 + (i % 3) * .08));
  cue(T.roomIn + 1.45, 'pencil', .6, { dur: .55 }); cue(T.roomIn + 1.9, 'sheet', .4);
  cue(T.lapse0, 'riser', .45, { dur: T.rbreak - T.lapse0 });
  cue(T.rbreak, 'chime', .9); cue(T.rbreak + 0.02, 'confetti', .5);
  [0, 1, 2].forEach(i => cue(T.rbreak + 0.45 + i * 0.5, 'ping2', .45));
  cue(T.payoff - 0.35, 'whooshSoft', .6);
  cue(T.payoff, 'whoosh', .7); [0.3, 0.45, 0.62, 0.8, 1.0].forEach((s, i) => cue(T.payoff + s + .5, 'settle', .45 + (i % 2) * .1));
  cue(T.payoff + 1.05, 'paperSlap', .6); cue(T.payoff + 1.1, 'tape', .6);
  T.rw.forEach(s => { cue(s - 0.05, 'scribble', .8, { dur: .35 }); cue(s + 0.3, 'pencil', .75, { dur: .8 }); });
  cue(T.cta, 'riser', .8, { dur: 2.3 }); cue(T.cta + 0.1, 'whooshUp', .9);
  cue(T.ring, 'pencilLong', .6, { dur: .55 }); cue(T.ring + 0.5, 'logoBloom', .8);
  cue(T.tagA, 'swish', .5); cue(T.tagB, 'swish', .55); cue(T.tagB + 0.45, 'marker', .5, { dur: .35 });
  cue(T.final + 0.75, 'whooshSoft', .5); cue(T.final + 1.2, 'pencil', .6, { dur: .9 }); cue(T.final + 1.45, 'pop', .7); cue(T.final + 1.9, 'marker', .5, { dur: .5 }); cue(T.final + 1.1, 'pencil', .35, { dur: .6 });
  CUES.sort((a, b) => a.t - b.t);
  return CUES;
}

// ------------------------------------------------------------------ boot
async function boot() {
  await document.fonts.load('600 40px Caveat'); await document.fonts.load('500 40px Fraunces'); await document.fonts.load('400 40px Inter'); await document.fonts.load('500 20px "IBM Plex Mono"'); await document.fonts.load('700 40px Caveat'); await document.fonts.load('italic 600 40px Fraunces');
  await document.fonts.ready;
  makeNoise(); makePaper(); makeGrain();
  buildProps();
  thought('Where do I even start?', false, 'start here ↓');
  thought('Did I actually learn that?', false, '1 of 5 done ✓');
  thought('Wait… I’ve been studying<br>for THREE HOURS?', true, '75 min. on purpose.');
  buildUI(); buildInk(); buildHUD();
  layoutUI(); buildTracks(); buildCues();
  // pre-layout: render a few times so offsets settle
  renderAt(0); renderAt(30); renderAt(0);
}
window.PROMO = { W, H, FORMAT, DUR, T, cues: () => CUES, ready: boot() };
window.renderAt = renderAt;

// ------------------------------------------------------------------ preview (not used for final output)
window.PROMO.ready.then(() => {
  const t0 = parseFloat(Q.get('t') || '0'); renderAt(t0);
  if (RENDER) return;
  const pv = document.getElementById('preview'); pv.hidden = false;
  const fit = () => { const k = Math.min(innerWidth / W, (innerHeight - 44) / H); stage.style.transform = `scale(${k})`; document.body.style.height = '100vh'; };
  fit(); addEventListener('resize', fit);
  const scrub = document.getElementById('scrub'), tl = document.getElementById('time'), audio = document.getElementById('mix');
  const fmt = document.getElementById('fmt'); fmt.textContent = V ? 'switch to wide' : 'switch to vertical'; fmt.href = `?format=${V ? 'wide' : 'vertical'}`;
  let playing = false, start = 0, base = t0;
  const draw = x => { renderAt(x); scrub.value = x; tl.textContent = x.toFixed(2); };
  scrub.oninput = () => { base = +scrub.value; draw(base); if (playing) { audio.currentTime = base; start = performance.now(); } };
  document.getElementById('play').onclick = () => { playing = !playing; if (playing) { start = performance.now(); audio.currentTime = base; audio.play().catch(() => {}); loop(); } else { audio.pause(); base = +scrub.value; } };
  function loop() { if (!playing) return; const x = base + (performance.now() - start) / 1000; if (x >= DUR) { playing = false; audio.pause(); return; } draw(x); requestAnimationFrame(loop); }
});
})();
