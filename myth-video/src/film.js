/* Before Olympus — a deterministic 104 s film of the Greek creation myth.
   Styled after Attic pottery: terracotta clay and black glaze, figures in silhouette with incised
   cream detail, Greek-key (meander) bands, display lettering with Greek letterforms, and each
   figure's name in Greek. Everything is drawn on one 1920×1080 canvas from `t` alone: no timers,
   no requestAnimationFrame state, no Math.random (seeded noise only), so any frame renders the same. */
(() => {
  const W = 1920, H = 1080, DURATION = 106;
  const cv = document.getElementById('c');
  const ctx = cv.getContext('2d');

  // ---------- palette ----------
  const C = {
    black: [16, 11, 9], glaze: [26, 18, 14], clay: [184, 92, 44], clayDeep: [140, 62, 28], clayLight: [214, 132, 78],
    cream: [241, 226, 198], gold: [230, 184, 106], ember: [150, 42, 20], blood: [96, 22, 12], dawn: [246, 204, 140],
  };
  const rgba = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

  // ---------- maths ----------
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, k) => a + (b - a) * k;
  const prog = (t, a, b) => clamp((t - a) / (b - a));
  const ease = k => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
  const easeOut = k => 1 - Math.pow(1 - k, 3);
  // visibility window: fades in over [a, a+fi], out over [b-fo, b]
  const win = (t, a, b, fi = 1, fo = 1) => Math.min(ease(prog(t, a, a + fi)), 1 - ease(prog(t, b - fo, b)));
  function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }

  // ---------- narration timing (measured speech spans of audio/vo/*.wav) ----------
  const VO = [
    ['n01', 4.5, 6.47, 0.06, 6.24, 'Before Olympus. Before Zeus. Before even the sky and the sea... there was Chaos.',
      ['Before Olympus.', 'Before Zeus.', 'Before even the sky and the sea…', 'there was Chaos.']],
    ['n02', 12.0, 8.23, 0.02, 7.99, 'Not chaos as we know it, but a vast, silent emptiness. A darkness without shape, boundary, or time.',
      ['Not chaos as we know it,', 'but a vast, silent emptiness.', 'A darkness without shape, boundary, or time.']],
    ['n03', 21.4, 7.03, 0.05, 6.82, 'And from that endless void emerged Gaia, the Earth. Ancient, powerful, and alive.',
      ['And from that endless void emerged Gaia, the Earth.', 'Ancient, powerful, and alive.']],
    ['n04', 29.4, 6.07, 0.04, 5.80, 'From Gaia came Uranus, the star-filled Sky, stretching himself across the heavens.',
      ['From Gaia came Uranus, the star-filled Sky,', 'stretching himself across the heavens.']],
    ['n05', 36.6, 7.91, 0.05, 7.68, 'Together, Earth and Sky gave birth to mighty beings: the Titans, the Cyclopes, and the Hundred-Handed Ones.',
      ['Together, Earth and Sky gave birth to mighty beings:', 'the Titans, the Cyclopes, and the Hundred-Handed Ones.']],
    ['n06', 45.6, 6.07, 0.10, 5.78, 'But Uranus feared the power of his own children, and imprisoned them deep within the Earth.',
      ['But Uranus feared the power of his own children,', 'and imprisoned them deep within the Earth.']],
    ['n07', 52.8, 5.10, 0.09, 4.93, 'Gaia, tormented by their suffering, turned to her Titan son, Cronus.',
      ['Gaia, tormented by their suffering,', 'turned to her Titan son, Cronus.']],
    ['n08', 59.0, 6.15, 0.05, 5.92, 'Armed with a great sickle, Cronus overthrew his father, and seized control of creation.',
      ['Armed with a great sickle, Cronus overthrew his father,', 'and seized control of creation.']],
    ['n09', 66.4, 1.99, 0.08, 1.72, 'But power brought fear.', ['But power brought fear.'], 'center'],
    ['n10', 69.2, 7.67, 0.05, 7.47, 'A prophecy warned Cronus that one of his own children would overthrow him, just as he had overthrown Uranus.',
      ['A prophecy warned Cronus', 'that one of his own children would overthrow him,', 'just as he had overthrown Uranus.']],
    ['n11', 78.2, 3.43, 0.03, 3.01, 'So Cronus swallowed each child at birth.', ['So Cronus swallowed each child at birth.']],
    ['n12', 83.4, 1.91, 0.06, 1.67, 'Until one escaped.', ['Until one escaped.'], 'center'],
    ['n13', 86.6, 4.39, 0.04, 4.23, 'Hidden away by his mother, a child named Zeus opened his eyes.',
      ['Hidden away by his mother,', 'a child named Zeus opened his eyes.']],
    ['n14', 92.8, 4.07, 0.01, 3.89, 'And soon... the age of the Olympian gods would begin.', ['And soon…', 'the age of the Olympian gods would begin.'], 'center'],
  ].map(([id, at, dur, s0, s1, text, phrases, style]) => ({ id, at, dur, s0, s1, text, phrases, style: style || 'caption' }));
  const LINE = Object.fromEntries(VO.map(v => [v.id, v]));
  // Estimated time a word is spoken: its character position scaled across the measured speech span.
  function anchor(id, word) {
    const v = LINE[id], i = v.text.indexOf(word);
    if (i < 0) throw new Error(`anchor: "${word}" not in ${id}`);
    return v.at + v.s0 + (i / v.text.length) * (v.s1 - v.s0);
  }
  // Caption phrases with start/end times.
  const PHRASES = [];
  for (const v of VO) {
    let pos = 0; const norm = s => s.replace('…', '...');
    v.phrases.forEach((p, k) => {
      const i = v.text.indexOf(norm(p), pos); pos = i + norm(p).length;
      const start = v.at + v.s0 + (i / v.text.length) * (v.s1 - v.s0) - 0.15;
      PHRASES.push({ line: v, text: p, start, k });
    });
  }
  PHRASES.forEach((p, i) => {
    const next = PHRASES[i + 1];
    const lineEnd = p.line.at + p.line.s1 + 0.7;
    p.end = next && next.line === p.line ? next.start : Math.min(lineEnd, next ? next.start - 0.1 : lineEnd);
  });

  // ---------- key moments ----------
  const K = {
    chaosName: anchor('n01', 'Chaos'),
    gaiaName: anchor('n03', 'Gaia'),
    uranusName: anchor('n04', 'Uranus'),
    titans: anchor('n05', 'Titans'), cyclopes: anchor('n05', 'Cyclopes'), hundred: anchor('n05', 'Hundred'),
    imprison: anchor('n06', 'imprisoned'),
    cronusName: anchor('n07', 'Cronus'),
    sickle: anchor('n08', 'sickle'), overthrew: anchor('n08', 'overthrew'), seized: anchor('n08', 'seized'),
    overthrowHim: anchor('n10', 'overthrow him'),
    swallowed: anchor('n11', 'swallowed'),
    escaped: anchor('n12', 'escaped'),
    zeusName: anchor('n13', 'Zeus'), eyes: anchor('n13', 'opened'),
    olympians: anchor('n14', 'Olympian'),
  };
  K.bolt = K.eyes + 1.35;
  const HITS = [
    { kind: 'boom', at: 1.0 }, { kind: 'shimmer', at: K.chaosName - 0.2 }, { kind: 'rumble', at: 21.0 },
    { kind: 'shimmer', at: 29.4 }, { kind: 'boom', at: K.titans }, { kind: 'boom', at: K.cyclopes }, { kind: 'boom', at: K.hundred },
    { kind: 'rumble', at: K.imprison }, { kind: 'slash', at: K.overthrew }, { kind: 'boom', at: K.overthrew + 0.05 },
    { kind: 'rumble', at: K.swallowed }, { kind: 'shimmer', at: K.escaped }, { kind: 'thunder', at: K.bolt },
    { kind: 'swell', at: 92.0 }, { kind: 'boom', at: K.olympians },
  ];

  // ---------- textures ----------
  let grain;
  function makeGrain() {
    grain = document.createElement('canvas'); grain.width = grain.height = 512;
    const g = grain.getContext('2d'), img = g.createImageData(512, 512), r = rng(7);
    for (let i = 0; i < img.data.length; i += 4) { const v = r() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
    g.putImageData(img, 0, 0);
  }
  const R = rng(1234);
  const STARS = Array.from({ length: 420 }, () => ({ x: R() * W, y: 90 + R() * 620, r: 0.8 + R() * 2.2, p: R() * 6.28, s: 0.6 + R() * 2 }));
  const MOTES = Array.from({ length: 900 }, () => ({ a: R() * 6.28, r: 30 + Math.pow(R(), 0.7) * 700, w: 0.04 + R() * 0.12, j: R() * 6.28, s: 1.6 + R() * 3.4 }));
  const EMBERS = Array.from({ length: 160 }, () => ({ x: R(), v: 30 + R() * 90, o: R() * 20, s: 1 + R() * 2.5, w: R() * 6.28 }));

  // ---------- lettering ----------
  const DISPLAY = '"Cinzel", "GFS Didot", serif';
  const GREEK = '"GFS Didot", serif';
  const SERIF = '"Cormorant Garamond", Georgia, serif';
  // Greek-style display lettering: Latin capitals with A → Λ and E → Σ, the classic "mythology" letterform.
  const greekify = s => s.toUpperCase().replace(/A/g, 'Λ').replace(/E/g, 'Σ');
  function text(s, x, y, { font, size, color, alpha = 1, spacing = 0, align = 'center', weight = 500, italic = false, glow = 0, glowColor }) {
    if (alpha <= 0.001) return;
    ctx.save();
    ctx.font = `${italic ? 'italic ' : ''}${weight} ${size}px ${font}`;
    ctx.letterSpacing = `${spacing}px`;
    ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.globalAlpha = alpha;
    if (glow) { ctx.shadowColor = glowColor || rgba(color, 0.6); ctx.shadowBlur = glow; }
    ctx.fillStyle = rgba(color);
    // letterSpacing adds trailing space after the last glyph; shift so centred text stays centred
    ctx.fillText(s, align === 'center' ? x + spacing / 2 : x, y);
    ctx.restore();
  }
  function nameCard(latin, greek, t0, t1, y = 300, color = C.gold) {
    const t = now, a = win(t, t0, t1, 0.9, 0.9);
    if (a <= 0) return;
    const rise = (1 - easeOut(prog(t, t0, t0 + 1.4))) * 26;
    text(greekify(latin), W / 2, y + rise, { font: DISPLAY, size: 118, color, alpha: a, spacing: 26, glow: 34, glowColor: rgba(C.black, 0.8) });
    const rw = 170 * easeOut(prog(t, t0 + 0.3, t0 + 1.6));
    ctx.save(); ctx.globalAlpha = a * 0.85; ctx.strokeStyle = rgba(C.cream); ctx.lineWidth = 2;
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(W / 2 + s * 150, y + 88); ctx.lineTo(W / 2 + s * (150 + rw), y + 88); ctx.stroke(); }
    ctx.restore();
    text(greek, W / 2, y + 90, { font: GREEK, size: 40, color: C.cream, alpha: a * 0.95, spacing: 14 });
  }

  // ---------- meander (Greek key) bands ----------
  function meanderBand(y, h, reveal, alpha, flip) {
    if (alpha <= 0) return;
    const u = h * 0.62, pad = (h - u) / 2, g = u / 5, n = Math.ceil(W / u) + 1;
    ctx.save(); ctx.globalAlpha = alpha;
    ctx.fillStyle = rgba(C.black); ctx.fillRect(0, y, W * reveal, h);
    ctx.beginPath(); ctx.rect(0, y, W * reveal, h); ctx.clip();
    ctx.strokeStyle = rgba(C.clay); ctx.lineWidth = Math.max(3, g * 0.72); ctx.lineCap = 'square'; ctx.lineJoin = 'miter';
    const Y = v => (flip ? y + h - pad - v * g : y + pad + v * g);
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = i * u, X = v => x + v * g;
      // one fret: baseline, rise, run, and an inward square spiral
      ctx.moveTo(X(0), Y(5)); ctx.lineTo(X(5), Y(5));
      ctx.moveTo(X(0.5), Y(5)); ctx.lineTo(X(0.5), Y(0)); ctx.lineTo(X(4.5), Y(0)); ctx.lineTo(X(4.5), Y(3.5)); ctx.lineTo(X(2), Y(3.5)); ctx.lineTo(X(2), Y(1.7)); ctx.lineTo(X(3.2), Y(1.7));
    }
    ctx.stroke();
    // thin rules either side, like the bands on a vase
    ctx.lineWidth = 2; ctx.strokeStyle = rgba(C.clayLight, 0.8);
    ctx.beginPath(); ctx.moveTo(0, y + 5); ctx.lineTo(W, y + 5); ctx.moveTo(0, y + h - 5); ctx.lineTo(W, y + h - 5); ctx.stroke();
    ctx.restore();
  }

  // ---------- background: glaze black ↔ terracotta ↔ blood ↔ dawn ----------
  const GROUND = [
    [0, C.black, C.black], [20.6, C.black, C.glaze], [23.0, C.clayDeep, C.clay], [29.2, C.clayDeep, C.clay], [31.0, C.black, [60, 30, 22]],
    [36.2, C.black, [60, 30, 22]], [37.6, C.clayDeep, C.clay], [45.2, C.clayDeep, C.clay], [46.8, C.black, C.blood],
    [52.6, C.black, C.blood], [54.0, [70, 34, 20], C.clayDeep], [58.6, [70, 34, 20], C.clayDeep], [K.overthrew - 0.05, [70, 34, 20], C.clayDeep],
    [K.overthrew + 0.4, C.blood, C.ember], [65.8, C.blood, C.ember], [66.8, C.black, [30, 10, 8]], [77.8, C.black, [30, 10, 8]],
    [79.0, [6, 4, 4], [6, 4, 4]], [86.2, [6, 4, 4], [6, 4, 4]], [87.6, [12, 14, 26], [22, 20, 34]], [92.0, [12, 14, 26], [22, 20, 34]],
    [95.0, C.clayDeep, C.clay], [98.5, C.clay, C.dawn], [106, C.clay, C.dawn],
  ];
  function ground(t) {
    let i = 0; while (i < GROUND.length - 2 && GROUND[i + 1][0] <= t) i++;
    const [ta, a1, a2] = GROUND[i], [tb, b1, b2] = GROUND[i + 1];
    const k = ease(prog(t, ta, tb));
    return [mix(a1, b1, k), mix(a2, b2, k)];
  }

  // ---------- scene pieces ----------
  function chaosSwirl(t, a) {
    if (a <= 0) return;
    const cx = W / 2, cy = H / 2 - 20;
    ctx.save();
    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, 520);
    core.addColorStop(0, rgba(C.clay, 0.22 * a)); core.addColorStop(1, rgba(C.clay, 0));
    ctx.fillStyle = core; ctx.fillRect(0, 0, W, H);
    for (const m of MOTES) {
      const ang = m.a + t * m.w + Math.log(m.r) * 1.6;          // log spiral: arms curl inward
      const r = m.r * (1 + 0.05 * Math.sin(t * 0.7 + m.j));
      const x = cx + Math.cos(ang) * r * 1.5, y = cy + Math.sin(ang) * r * 0.62;
      const tw = 0.5 + 0.5 * Math.sin(t * m.s + m.j);
      ctx.globalAlpha = a * (0.25 + 0.75 * tw) * clamp(1.25 - m.r / 800);
      ctx.fillStyle = rgba(m.r < 260 ? C.clayLight : C.cream);
      ctx.fillRect(x, y, m.s, m.s);
    }
    ctx.restore();
  }
  function earth(t, rise, a, fill, incise = 1, pulse = 0) {
    if (a <= 0) return;
    const R0 = 1250, cx = W / 2, cy = H + R0 - 330 * rise + 60;
    const r = R0 * (1 + pulse * 0.006 * Math.sin(t * 5));
    ctx.save(); ctx.globalAlpha = a;
    ctx.fillStyle = rgba(fill);
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    // incised contour lines and a rim of mountains, scratched through the glaze
    ctx.globalAlpha = a * incise;
    ctx.strokeStyle = rgba(C.cream, 0.75); ctx.lineWidth = 2.5;
    for (const d of [26, 70, 130]) { ctx.beginPath(); ctx.arc(cx, cy, r - d, Math.PI * 1.08, Math.PI * 1.92); ctx.stroke(); }
    ctx.fillStyle = rgba(fill); ctx.strokeStyle = rgba(C.cream, 0.85); ctx.lineWidth = 2.5;
    const peaks = 17;
    for (let i = 0; i < peaks; i++) {
      const ang = Math.PI * 1.2 + (i / (peaks - 1)) * Math.PI * 0.6, hgt = 36 + ((i * 37) % 5) * 12;
      const bx = cx + Math.cos(ang) * r, by = cy + Math.sin(ang) * r;
      const nx = Math.cos(ang), ny = Math.sin(ang), tx = -ny, ty = nx;
      ctx.beginPath(); ctx.moveTo(bx - tx * 40, by - ty * 40); ctx.lineTo(bx + nx * hgt, by + ny * hgt); ctx.lineTo(bx + tx * 40, by + ty * 40); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    // rosettes, a pottery staple
    for (let i = 0; i < 5; i++) {
      const ang = Math.PI * 1.3 + i * Math.PI * 0.1, rr = r - 100;
      rosette(cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr, 16, a * incise);
    }
    ctx.restore();
    return { cx, cy, r };
  }
  function rosette(x, y, s, a) {
    ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = rgba(C.cream, 0.8);
    for (let k = 0; k < 8; k++) { const q = k * Math.PI / 4; ctx.beginPath(); ctx.ellipse(x + Math.cos(q) * s * 0.6, y + Math.sin(q) * s * 0.6, s * 0.45, s * 0.18, q, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }
  function stars(t, reveal, a, split = 0) {
    if (a <= 0) return;
    ctx.save();
    for (const s of STARS) {
      const edge = s.x / W; if (edge > reveal) continue;
      const fresh = clamp((reveal - edge) * 8);
      const tw = 0.55 + 0.45 * Math.sin(t * s.s + s.p);
      const dy = split ? (s.x > W / 2 ? -1 : 1) * split * 40 : 0;
      ctx.globalAlpha = a * fresh * tw; ctx.fillStyle = rgba(C.cream);
      ctx.beginPath(); ctx.arc(s.x, s.y + dy, s.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
  function skyDome(k, a) {
    if (a <= 0 || k <= 0) return;
    ctx.save(); ctx.globalAlpha = a; ctx.strokeStyle = rgba(C.gold, 0.8); ctx.lineWidth = 3; ctx.setLineDash([2, 14]); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.ellipse(W / 2, 760, 900, 620, 0, Math.PI, Math.PI + Math.PI * k); ctx.stroke();
    ctx.restore();
  }
  function roundel(x, y, r, a, kind, t, fill = C.black) {
    if (a <= 0) return;
    const s = 0.7 + 0.3 * easeOut(clamp(a * 1.4));
    ctx.save(); ctx.globalAlpha = clamp(a); ctx.translate(x, y); ctx.scale(s, s);
    ctx.fillStyle = rgba(fill); ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = rgba(C.cream, 0.9); ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, r - 12, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 0, r - 20, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = rgba(C.cream);
    if (kind === 'titan') {                      // a giant holding up the heavens
      ctx.beginPath(); ctx.arc(0, -64, 30, 0, Math.PI * 2); ctx.stroke();                  // sky orb
      ctx.beginPath(); ctx.arc(0, -8, 13, 0, Math.PI * 2); ctx.stroke();                   // head
      ctx.beginPath(); ctx.moveTo(-26, -58); ctx.lineTo(-30, 12); ctx.lineTo(30, 12); ctx.lineTo(26, -58);   // arms up
      ctx.moveTo(-22, 12); ctx.lineTo(-16, 64); ctx.lineTo(0, 30); ctx.lineTo(16, 64); ctx.lineTo(22, 12); ctx.stroke();
    } else if (kind === 'eye') {                 // the Cyclops' single eye
      const open = 0.25 + 0.75 * easeOut(clamp(a));
      ctx.beginPath(); ctx.moveTo(-80, 0); ctx.quadraticCurveTo(0, -70 * open, 80, 0); ctx.quadraticCurveTo(0, 70 * open, -80, 0); ctx.stroke();
      ctx.fillStyle = rgba(C.clay); ctx.beginPath(); ctx.arc(0, 0, 26 * open, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = rgba(C.black); ctx.beginPath(); ctx.arc(0, 0, 10 * open, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-50, -52); ctx.quadraticCurveTo(0, -84, 50, -52); ctx.stroke();   // brow
    } else if (kind === 'hands') {               // a hundred arms around one body
      ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI * 2); ctx.stroke();
      const n = 26;
      for (let i = 0; i < n; i++) {
        const q = (i / n) * Math.PI * 2 + 0.2 * Math.sin(t * 1.5 + i), r1 = 26, r2 = 70 + (i % 3) * 8;
        ctx.beginPath(); ctx.moveTo(Math.cos(q) * r1, Math.sin(q) * r1); ctx.lineTo(Math.cos(q) * r2, Math.sin(q) * r2); ctx.stroke();
        ctx.fillStyle = rgba(C.cream); ctx.beginPath(); ctx.arc(Math.cos(q) * (r2 + 5), Math.sin(q) * (r2 + 5), 5, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }
  function embers(t, a, x0, x1, yb) {
    if (a <= 0) return;
    ctx.save();
    for (const e of EMBERS) {
      const life = ((t + e.o) * e.v / 600) % 1;
      const x = lerp(x0, x1, e.x) + Math.sin(t * 1.3 + e.w) * 14, y = yb - life * 520;
      ctx.globalAlpha = a * Math.sin(life * Math.PI) * 0.9;
      ctx.fillStyle = rgba(life < 0.5 ? C.gold : C.clayLight);
      ctx.beginPath(); ctx.arc(x, y, e.s, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
  // Cronus' harpe: a hooked sickle blade on a straight haft.
  function harpe(t, draw, a, glow) {
    if (a <= 0) return;
    ctx.save(); ctx.globalAlpha = a;
    ctx.translate(W / 2 + 40, 470); ctx.rotate(-0.28 + (1 - easeOut(draw)) * -0.5);
    const blade = new Path2D('M-20 60 C -110 -140, 120 -290, 290 -170 C 150 -220, 20 -150, 20 60 Z');
    ctx.shadowColor = rgba(glow > 0 ? C.gold : C.ember, 0.9); ctx.shadowBlur = 30 + glow * 50;
    ctx.fillStyle = rgba(C.black); ctx.globalAlpha = a * easeOut(clamp(draw * 1.6 - 0.6)); ctx.fill(blade);
    ctx.globalAlpha = a; ctx.lineWidth = 6; ctx.lineJoin = 'round';
    ctx.strokeStyle = rgba(mix(C.cream, C.gold, glow)); ctx.setLineDash([1400]); ctx.lineDashOffset = 1400 * (1 - draw);
    ctx.stroke(blade);
    ctx.setLineDash([]); ctx.shadowBlur = 0;
    ctx.globalAlpha = a * easeOut(clamp(draw * 2 - 0.3));
    ctx.fillStyle = rgba(C.clayDeep); ctx.strokeStyle = rgba(C.cream, 0.8); ctx.lineWidth = 3;
    ctx.beginPath(); ctx.roundRect(-14, 56, 28, 300, 6); ctx.fill(); ctx.stroke();
    for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.moveTo(-14, 90 + i * 22); ctx.lineTo(14, 100 + i * 22); ctx.stroke(); }   // leather grip wrap
    ctx.restore();
  }
  function slash(t, t0) {
    const k = prog(t, t0 - 0.12, t0 + 0.18);
    if (k <= 0 || k >= 1) return 0;
    ctx.save(); ctx.globalAlpha = Math.sin(k * Math.PI);
    ctx.strokeStyle = rgba(C.cream); ctx.lineWidth = 10; ctx.shadowColor = rgba(C.gold); ctx.shadowBlur = 40; ctx.lineCap = 'round';
    const x0 = -100, y0 = 180, x1 = W + 100, y1 = 900, e = easeOut(k);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(lerp(x0, x1, e), lerp(y0, y1, e)); ctx.stroke();
    ctx.restore();
    return 1;
  }
  function tripod(t, a, crownFall) {
    if (a <= 0) return;
    const cx = W / 2, by = 820;
    ctx.save(); ctx.globalAlpha = a; ctx.strokeStyle = rgba(C.cream, 0.9); ctx.lineWidth = 4; ctx.lineCap = 'round';
    // smoke of the oracle
    for (let s = 0; s < 5; s++) {
      ctx.beginPath();
      for (let i = 0; i <= 60; i++) {
        const y = 560 - i * 7, amp = 10 + i * 1.3;
        const x = cx + (s - 2) * 14 + Math.sin(i * 0.16 - t * 1.4 + s) * amp;
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.globalAlpha = a * 0.28; ctx.stroke();
    }
    ctx.globalAlpha = a;
    // bowl and legs
    ctx.fillStyle = rgba(C.clay);
    ctx.beginPath(); ctx.moveTo(cx - 120, 580); ctx.quadraticCurveTo(cx, 700, cx + 120, 580); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - 90, 610); ctx.lineTo(cx - 150, by); ctx.moveTo(cx + 90, 610); ctx.lineTo(cx + 150, by); ctx.moveTo(cx, 640); ctx.lineTo(cx, by); ctx.stroke();
    // a crown in the smoke that tips and falls when the prophecy names the overthrow
    const f = easeOut(crownFall), cy = 330 + f * 420, rot = f * 1.1;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot); ctx.globalAlpha = a * (1 - clamp((crownFall - 0.7) * 3.3));
    ctx.fillStyle = rgba(C.gold); ctx.beginPath();
    ctx.moveTo(-70, 30); ctx.lineTo(-70, -20); ctx.lineTo(-40, 5); ctx.lineTo(0, -40); ctx.lineTo(40, 5); ctx.lineTo(70, -20); ctx.lineTo(70, 30); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.restore();
  }
  function orb(x, y, r, a, color = C.gold) {
    if (a <= 0) return;
    ctx.save(); ctx.globalAlpha = a;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 4);
    g.addColorStop(0, rgba(color, 0.9)); g.addColorStop(0.25, rgba(color, 0.35)); g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = rgba(C.cream); ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  function swallow(t, a) {
    if (a <= 0) return;
    const t0 = K.swallowed - 0.9, cx = W / 2, cy = 470;
    const maw = easeOut(prog(t, t0 + 0.3, t0 + 2.0)) * 250 * (1 - 0.35 * prog(t, 81.4, 82.8));
    ctx.save(); ctx.globalAlpha = a;
    if (maw > 1) {
      ctx.fillStyle = rgba(C.black); ctx.strokeStyle = rgba(C.clay); ctx.lineWidth = 8;
      ctx.beginPath(); ctx.arc(cx, cy, maw, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = rgba(C.clayDeep, 0.8); ctx.lineWidth = 3;
      for (let i = 0; i < 24; i++) { const q = i / 24 * Math.PI * 2 + t * 0.4; ctx.beginPath(); ctx.moveTo(cx + Math.cos(q) * maw, cy + Math.sin(q) * maw); ctx.lineTo(cx + Math.cos(q) * (maw + 22), cy + Math.sin(q) * (maw + 22)); ctx.stroke(); }
    }
    ctx.restore();
    // five children, pulled in one after another
    for (let i = 0; i < 5; i++) {
      const x0 = cx + (i - 2) * 250, y0 = 780;
      const born = win(t, t0 - 0.6 + i * 0.12, 200, 0.5, 0.1);
      const pull = ease(prog(t, t0 + 1.4 + i * 0.35, t0 + 2.2 + i * 0.35));
      orb(lerp(x0, cx, pull), lerp(y0, cy, pull), 9 * (1 - pull * 0.9), a * born * (1 - pull), C.cream);
    }
  }
  function eye(t, open, a) {
    if (a <= 0) return;
    const cx = W / 2, cy = 520, o = easeOut(open);
    ctx.save(); ctx.globalAlpha = a;
    ctx.strokeStyle = rgba(C.gold); ctx.lineWidth = 4; ctx.fillStyle = rgba(C.black);
    const lid = new Path2D(`M${cx - 260} ${cy} Q${cx} ${cy - 200 * o - 2} ${cx + 260} ${cy} Q${cx} ${cy + 200 * o + 2} ${cx - 260} ${cy} Z`);
    ctx.fill(lid); ctx.stroke(lid);
    ctx.save(); ctx.clip(lid);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 90);
    g.addColorStop(0, rgba([255, 255, 255])); g.addColorStop(0.3, rgba([190, 220, 255])); g.addColorStop(0.75, rgba([58, 120, 200])); g.addColorStop(1, rgba([12, 26, 51]));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, 90, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = rgba(C.black); ctx.beginPath(); ctx.arc(cx, cy, 30, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.beginPath(); ctx.arc(cx + 30, cy - 30, 12, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // lashes, incised pottery-style
    ctx.lineWidth = 3; ctx.strokeStyle = rgba(C.gold, 0.8 * o);
    for (let i = -4; i <= 4; i++) { const x = cx + i * 50, y = cy - 150 * o * (1 - Math.pow(i / 5.2, 2)); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + i * 6, y - 26 * o); ctx.stroke(); }
    ctx.restore();
  }
  // Zeus' thunderbolt, drawn as a jagged bolt from the top of frame
  function bolt(t, t0) {
    const k = prog(t, t0, t0 + 0.9);
    if (k <= 0 || k >= 1) return 0;
    const r = rng(99), pts = []; let x = W * 0.62, y = 60;
    while (y < 880) { pts.push([x, y]); x += (r() - 0.5) * 120; y += 50 + r() * 50; }
    ctx.save(); ctx.globalAlpha = 1 - k; ctx.strokeStyle = rgba([235, 240, 255]); ctx.lineWidth = 7; ctx.lineJoin = 'miter';
    ctx.shadowColor = 'rgba(170,200,255,1)'; ctx.shadowBlur = 50;
    ctx.beginPath(); pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py))); ctx.stroke();
    ctx.restore();
    return Math.pow(1 - k, 3);
  }
  function olympus(t, rise, a) {
    if (a <= 0) return;
    const e = easeOut(rise), base = H + 40, peakY = lerp(H + 300, 640, e), cx = W / 2;
    // sun with rays behind the mountain
    const sa = a * easeOut(prog(t, 92.6, 96.0)), sy = lerp(700, 560, easeOut(prog(t, 92.6, 101)));
    ctx.save(); ctx.globalAlpha = sa;
    ctx.fillStyle = rgba(C.dawn); ctx.strokeStyle = rgba(C.dawn, 0.5); ctx.lineWidth = 6;
    for (let i = 0; i < 24; i++) { const q = i / 24 * Math.PI * 2 + t * 0.03; ctx.beginPath(); ctx.moveTo(cx + Math.cos(q) * 170, sy + Math.sin(q) * 170); ctx.lineTo(cx + Math.cos(q) * 620, sy + Math.sin(q) * 620); ctx.stroke(); }
    ctx.beginPath(); ctx.arc(cx, sy, 140, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = rgba(C.black);
    ctx.beginPath(); ctx.moveTo(-50, base); ctx.lineTo(380, peakY + 260); ctx.lineTo(620, peakY + 150); ctx.lineTo(cx - 170, peakY);
    ctx.lineTo(cx + 170, peakY); ctx.lineTo(W - 600, peakY + 170); ctx.lineTo(W - 360, peakY + 230); ctx.lineTo(W + 50, base); ctx.closePath(); ctx.fill();
    // temple on the summit: stylobate, six columns, entablature, pediment
    const ty = peakY, tw = 300;
    ctx.fillRect(cx - tw / 2 - 20, ty - 18, tw + 40, 18);
    for (let i = 0; i < 6; i++) ctx.fillRect(cx - tw / 2 + i * (tw - 26) / 5, ty - 150, 26, 132);
    ctx.fillRect(cx - tw / 2 - 20, ty - 176, tw + 40, 26);
    ctx.beginPath(); ctx.moveTo(cx - tw / 2 - 30, ty - 176); ctx.lineTo(cx, ty - 250); ctx.lineTo(cx + tw / 2 + 30, ty - 176); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = rgba(C.clayLight, 0.7); ctx.lineWidth = 2.5;   // incised ridge lines
    ctx.beginPath(); ctx.moveTo(380, peakY + 290); ctx.lineTo(560, peakY + 200); ctx.moveTo(W - 380, peakY + 270); ctx.lineTo(W - 580, peakY + 210); ctx.stroke();
    ctx.restore();
  }

  // ---------- captions ----------
  function captions(t) {
    for (const p of PHRASES) {
      if (p.line.style === 'center') {
        // centred lines build up: every phrase stays on screen until the whole line has been spoken
        const multi = p.line.phrases.length > 1, lead = multi && p.k === 0;
        const a = win(t, p.start, p.line.at + p.line.s1 + 0.9, 0.4, 0.5);
        if (a <= 0) continue;
        const y = multi ? (lead ? 420 : 540) : 520;
        text(p.text, W / 2, y, { font: SERIF, size: lead ? 64 : 84, italic: true, color: C.cream, alpha: a, weight: 500, glow: 24, glowColor: 'rgba(0,0,0,.9)' });
      } else {
        const a = win(t, p.start, p.end, 0.35, 0.35);
        if (a <= 0) continue;
        const lift = (1 - easeOut(prog(t, p.start, p.start + 0.5))) * 10;
        ctx.save(); ctx.globalAlpha = a * 0.55; ctx.fillStyle = rgba(C.black);
        ctx.font = `italic 500 50px ${SERIF}`;
        const w = ctx.measureText(p.text).width + 90;
        ctx.beginPath(); ctx.roundRect(W / 2 - w / 2, 896 + lift, w, 74, 37); ctx.fill(); ctx.restore();
        text(p.text, W / 2, 931 + lift, { font: SERIF, size: 50, italic: true, color: C.cream, alpha: a, weight: 500 });
      }
    }
  }

  // ---------- frame ----------
  let now = 0;
  function renderAt(t) {
    now = t = clamp(t, 0, DURATION);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
    // camera shake on the sickle stroke and the thunderbolt
    const shake = Math.max(1 - prog(t, K.overthrew, K.overthrew + 0.6), 0) * (t >= K.overthrew ? 1 : 0) + Math.max(1 - prog(t, K.bolt, K.bolt + 0.7), 0) * (t >= K.bolt ? 1 : 0);
    const [top, bot] = ground(t);
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, rgba(top)); g.addColorStop(1, rgba(bot));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.save();
    if (shake > 0) ctx.translate(Math.sin(t * 90) * 14 * shake, Math.cos(t * 77) * 10 * shake);

    // Chaos → Void
    chaosSwirl(t, win(t, 3.0, 21.6, 2.5, 2.2) * (1 - 0.6 * prog(t, 13, 19)));
    nameCard('Chaos', 'ΧΑΟΣ', K.chaosName - 0.2, 12.6, 330, C.cream);

    // Gaia rises; stays through Uranus, the children and the prison
    const earthRise = ease(prog(t, 21.0, 26.5)) - ease(prog(t, 57.8, 60.0));
    const earthFill = t < 29.5 ? C.black : mix(C.black, C.clay, ease(prog(t, 29.5, 31.5)) * (1 - ease(prog(t, 36.4, 37.6))) + ease(prog(t, 45.4, 47.0)));
    earth(t, earthRise, win(t, 20.8, 60.0, 0.6, 1.2), earthFill, 1, t > 52.6 && t < 58 ? 1 : 0);
    nameCard('Gaia', 'ΓΑΙΑ', K.gaiaName - 0.1, 29.0, 300, C.cream);

    // Uranus: the sky spreads left to right, and returns over Cronus' red sky
    const starA = win(t, 29.2, 36.6, 0.8, 1.0) + win(t, 45.4, 58.8, 1.0, 1.0) * 0.5;
    stars(t, ease(prog(t, 29.6, 34.8)) + (t > 45 ? 1 : 0), clamp(starA));
    skyDome(ease(prog(t, 30.0, 35.0)), win(t, 29.6, 36.5, 0.6, 1.0));
    nameCard('Uranus', 'ΟΥΡΑΝΟΣ', K.uranusName - 0.1, 36.2, 300);

    // The children: Titans, Cyclopes, Hundred-Handed Ones
    const kids = [['titan', K.titans, 'Titans', 'ΤΙΤΑΝΕΣ'], ['eye', K.cyclopes, 'Cyclopes', 'ΚΥΚΛΩΠΕΣ'], ['hands', K.hundred, 'Hundred-Handed', 'ΕΚΑΤΟΓΧΕΙΡΕΣ']];
    const sink = ease(prog(t, K.imprison - 0.2, K.imprison + 1.6));
    kids.forEach(([kind, at, name, gr], i) => {
      const a = win(t, at - 0.3, 51.8, 0.8, 1.0);
      const x = lerp(W * (0.23 + i * 0.27), W / 2 + (i - 1) * 190, sink), y = lerp(430, 880, sink), s = 1 - sink * 0.55;
      ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.translate(-x, -y);
      roundel(x, y, 150, a, kind, t);
      text(greekify(name), x, y + 196, { font: DISPLAY, size: 40, color: C.cream, alpha: a * (1 - sink), spacing: 8 });
      text(gr, x, y + 240, { font: GREEK, size: 28, color: C.black, alpha: a * (1 - sink) * 0.9, spacing: 6 });
      ctx.restore();
    });
    // prison bars across the cavern
    const barsA = win(t, K.imprison + 0.8, 52.2, 0.6, 1.0);
    if (barsA > 0) {
      ctx.save(); ctx.globalAlpha = barsA; ctx.strokeStyle = rgba(C.cream, 0.9); ctx.lineWidth = 7;
      for (let i = 0; i < 11; i++) { const x = W / 2 - 400 + i * 80, dh = easeOut(prog(t, K.imprison + 0.8 + i * 0.05, K.imprison + 1.6 + i * 0.05)); ctx.beginPath(); ctx.moveTo(x, 760); ctx.lineTo(x, 760 + 260 * dh); ctx.stroke(); }
      ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(W / 2 - 430, 770); ctx.lineTo(W / 2 + 430, 770); ctx.stroke();
      ctx.restore();
    }
    embers(t, win(t, 46.0, 66.0, 1.2, 1.2), 200, W - 200, 1000);

    // Cronus
    nameCard('Cronus', 'ΚΡΟΝΟΣ', K.cronusName - 0.1, 60.2, 300);
    const draw = prog(t, K.sickle - 1.6, K.sickle + 0.8);
    harpe(t, draw, win(t, 59.0, 66.4, 0.5, 0.9), ease(prog(t, K.seized, K.seized + 1.0)));
    slash(t, K.overthrew);

    // The prophecy: the oracle's smoke, and a crown that falls
    tripod(t, win(t, 68.8, 78.2, 1.0, 0.9), prog(t, K.overthrowHim - 0.2, K.overthrowHim + 1.8));

    // Cronus swallows each child
    swallow(t, win(t, 77.6, 83.0, 0.4, 0.8));

    // Until one escaped: one light remains, rises, and becomes Zeus' eye
    const oneA = win(t, K.escaped - 1.0, K.eyes + 0.6, 0.8, 0.6);
    const oneY = lerp(760, 520, ease(prog(t, K.escaped, 88.2)));
    orb(W / 2, oneY, 10 + 6 * Math.sin(t * 3), oneA);
    nameCard('Zeus', 'ΖΕΥΣ', K.zeusName - 0.1, 92.0, 220);
    eye(t, prog(t, K.eyes, K.eyes + 1.4), win(t, K.eyes - 0.1, 92.4, 0.4, 0.8));
    const flash = bolt(t, K.bolt);

    // Olympus
    olympus(t, prog(t, 96.8, 100.6), win(t, 92.2, 120, 1.0, 1.0));
    const endA = win(t, 99.6, 120, 1.4, 1);
    if (endA > 0) {
      text(greekify('Olympus'), W / 2, 190, { font: DISPLAY, size: 132, color: C.black, alpha: endA, spacing: 30 });
      text('ΟΛΥΜΠΟΣ', W / 2, 290, { font: GREEK, size: 44, color: C.black, alpha: endA * 0.85, spacing: 18 });
    }
    ctx.restore();

    // Title card
    const titleA = win(t, 0.9, 5.2, 1.6, 1.0);
    text('ΘΕΟΓΟΝΙΑ  ·  THE BIRTH OF THE GODS', W / 2, 390, { font: DISPLAY, size: 30, color: C.clayLight, alpha: titleA, spacing: 12 });
    text(greekify('Before Olympus'), W / 2, 520, { font: DISPLAY, size: 150, color: C.gold, alpha: titleA, spacing: 30, glow: 40, glowColor: 'rgba(0,0,0,.8)' });
    const ruleW = 520 * easeOut(prog(t, 1.4, 3.2));
    if (titleA > 0) { ctx.save(); ctx.globalAlpha = titleA; ctx.fillStyle = rgba(C.clay); ctx.fillRect(W / 2 - ruleW, 628, ruleW * 2, 3); ctx.restore(); }

    captions(t);

    // Meander bands frame the whole film like the neck and foot of a vase
    const band = easeOut(prog(t, 0.2, 2.6));
    meanderBand(0, 72, band, 1, false);
    meanderBand(H - 72, 72, band, 1, true);

    // lightning flash, fired pottery grain, vignette, fade in/out
    if (flash > 0) { ctx.fillStyle = `rgba(230,236,255,${flash * 0.45})`; ctx.fillRect(0, 0, W, H); }
    ctx.save(); ctx.globalAlpha = 0.07; ctx.globalCompositeOperation = 'overlay';
    const f = Math.floor(t * 12), ox = (f * 131) % 512, oy = (f * 277) % 512;
    ctx.translate(-ox, -oy); ctx.fillStyle = ctx.createPattern(grain, 'repeat'); ctx.fillRect(0, 0, W + 512, H + 512);
    ctx.restore();
    const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 1.05);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.55)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
    const fade = Math.max(1 - prog(t, 0, 0.8), prog(t, 104, 106));
    if (fade > 0) { ctx.fillStyle = `rgba(0,0,0,${fade})`; ctx.fillRect(0, 0, W, H); }
  }

  // ---------- boot ----------
  async function loadFonts() {
    const faces = [
      new FontFace('Cinzel', 'url(fonts/Cinzel-latin.woff2)', { weight: '400 900' }),
      new FontFace('Cormorant Garamond', 'url(fonts/Cormorant-normal-latin.woff2)', { weight: '300 700' }),
      new FontFace('Cormorant Garamond', 'url(fonts/Cormorant-italic-latin.woff2)', { weight: '300 700', style: 'italic' }),
      new FontFace('GFS Didot', 'url(fonts/GFSDidot-greek.woff2)', { weight: '400' }),
    ];
    for (const f of faces) { await f.load(); document.fonts.add(f); }
  }
  const ready = (async () => { await loadFonts(); makeGrain(); })();
  window.renderAt = renderAt;
  window.FILM = { ready, duration: DURATION, cues: { vo: VO.map(v => ({ id: v.id, at: v.at })), hits: HITS }, K };

  const params = new URLSearchParams(location.search);
  ready.then(() => {
    renderAt(+params.get('t') || 0);
    if (params.get('render')) return;
    document.body.classList.add('preview');
    const ui = document.getElementById('preview'); ui.hidden = false;
    const scrub = document.getElementById('scrub'), time = document.getElementById('time'), play = document.getElementById('play'), audio = document.getElementById('mix');
    let playing = false, t0 = 0, s0 = 0;
    const show = t => { renderAt(t); scrub.value = t; time.textContent = t.toFixed(2); };
    scrub.oninput = () => { show(+scrub.value); if (playing) { s0 = +scrub.value; t0 = performance.now(); audio.currentTime = s0; } };
    play.onclick = () => {
      playing = !playing; play.textContent = playing ? '❚❚ Pause' : '▶︎ Play';
      if (playing) { s0 = +scrub.value; t0 = performance.now(); audio.currentTime = s0; audio.play().catch(() => {}); tick(); } else audio.pause();
    };
    function tick() { if (!playing) return; const t = s0 + (performance.now() - t0) / 1000; if (t >= DURATION) { play.click(); return; } show(t); requestAnimationFrame(tick); }
    show(+params.get('t') || 0);
  });
})();
