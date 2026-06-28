import { useEffect, useRef, useState } from "react";

// Every soundscape is generated live with the Web Audio API — no files, all free, works offline.
// To swap in a real audio file for any track later, give it a `src` URL and the hook
// will stream that on loop instead of synthesizing (see the `src` branch in play()).
export type Sound = {
  id: string;
  name: string;
  hint: string;
  category: "Noise" | "Weather" | "Nature" | "Ambient";
  src?: string;
};

export const SOUNDS: Sound[] = [
  { id: "off", name: "Off", hint: "Silence", category: "Noise" },
  { id: "white", name: "White noise", hint: "Bright, full static", category: "Noise" },
  { id: "pink", name: "Pink noise", hint: "Balanced, softer hiss", category: "Noise" },
  { id: "brown", name: "Brown noise", hint: "Deep, even hush", category: "Noise" },
  { id: "rain", name: "Rain", hint: "Steady rainfall", category: "Weather" },
  { id: "heavyrain", name: "Heavy rain", hint: "Downpour on the roof", category: "Weather" },
  { id: "thunder", name: "Distant storm", hint: "Rain with rolling thunder", category: "Weather" },
  { id: "wind", name: "Wind", hint: "Open, gusting air", category: "Weather" },
  { id: "ocean", name: "Ocean", hint: "Slow rolling waves", category: "Nature" },
  { id: "stream", name: "Stream", hint: "Trickling water", category: "Nature" },
  { id: "forest", name: "Forest", hint: "Wind through leaves", category: "Nature" },
  { id: "birds", name: "Songbirds", hint: "Morning chirps", category: "Nature" },
  { id: "crickets", name: "Night crickets", hint: "Evening chorus", category: "Nature" },
  { id: "fire", name: "Campfire", hint: "Crackling embers", category: "Nature" },
  { id: "pad", name: "Warm pad", hint: "Soft ambient chord", category: "Ambient" },
  { id: "drone", name: "Deep drone", hint: "Low meditative hum", category: "Ambient" },
  { id: "cafe", name: "Café hum", hint: "Gentle room tone", category: "Ambient" },
  { id: "fan", name: "Box fan", hint: "Whirring motor", category: "Ambient" },
];

export const CATEGORIES: Sound["category"][] = ["Noise", "Weather", "Nature", "Ambient"];

type Nodes = { sources: AudioScheduledSourceNode[]; gain: GainNode; timers: number[]; el?: HTMLAudioElement };

// --- Noise buffers (long + seamless so loops don't tick) ---
const BUF_SECONDS = 8;

function whiteBuffer(ctx: AudioContext, stereo = true) {
  const ch = stereo ? 2 : 1;
  const buf = ctx.createBuffer(ch, ctx.sampleRate * BUF_SECONDS, ctx.sampleRate);
  for (let c = 0; c < ch; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return buf;
}

function pinkBuffer(ctx: AudioContext) {
  const buf = ctx.createBuffer(2, ctx.sampleRate * BUF_SECONDS, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  }
  return buf;
}

// True brown noise via leaky integration of white — far deeper/smoother than stacked lowpass.
function brownBuffer(ctx: AudioContext) {
  const buf = ctx.createBuffer(2, ctx.sampleRate * BUF_SECONDS, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5; // compensate for the level drop from integration
    }
  }
  return buf;
}

export function useSoundscape() {
  const ctxRef = useRef<AudioContext | null>(null);
  const masterRef = useRef<GainNode | null>(null);
  const currentRef = useRef<Nodes | null>(null);
  // Cache the heavy noise buffers so switching sounds is instant.
  const bufRef = useRef<{ white?: AudioBuffer; pink?: AudioBuffer; brown?: AudioBuffer }>({});
  const [activeId, setActiveId] = useState("off");
  const [volume, setVolume] = useState(0.6);

  const ensureCtx = () => {
    if (!ctxRef.current) {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      ctxRef.current = new Ctx();
      const master = ctxRef.current.createGain();
      master.gain.value = volume;
      master.connect(ctxRef.current.destination);
      masterRef.current = master;
    }
    return ctxRef.current;
  };

  const build = (ctx: AudioContext, id: string, master: GainNode): Nodes => {
    const sources: AudioScheduledSourceNode[] = [];
    const timers: number[] = [];
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(master);

    const getBuf = (kind: "white" | "pink" | "brown") => {
      if (!bufRef.current[kind]) {
        bufRef.current[kind] = kind === "white" ? whiteBuffer(ctx) : kind === "pink" ? pinkBuffer(ctx) : brownBuffer(ctx);
      }
      return bufRef.current[kind]!;
    };
    const noise = (kind: "white" | "pink" | "brown" = "white") => {
      const src = ctx.createBufferSource();
      src.buffer = getBuf(kind);
      src.loop = true;
      src.playbackRate.value = 0.96 + Math.random() * 0.08; // slight detune so layers don't phase-lock
      return src;
    };
    const filt = (type: BiquadFilterType, freq: number, q?: number) => {
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
      if (q !== undefined) f.Q.value = q;
      return f;
    };
    const tone = (out: AudioNode) => out; // readability helper

    switch (id) {
      case "white": {
        const s = noise("white"); const lp = filt("lowpass", 12000);
        s.connect(lp); lp.connect(gain); s.start(); sources.push(s); break;
      }
      case "pink": {
        const s = noise("pink"); s.connect(gain); s.start(); sources.push(s); break;
      }
      case "brown": {
        const s = noise("brown"); const lp = filt("lowpass", 350);
        s.connect(lp); lp.connect(gain); s.start(); sources.push(s); break;
      }
      case "rain": {
        // Two layers: fine hiss for droplets + a midband body, lightly modulated.
        const hiss = noise("white"); const hp = filt("highpass", 2000), lp = filt("lowpass", 9000);
        const hg = ctx.createGain(); hg.gain.value = 0.5;
        hiss.connect(hp); hp.connect(lp); lp.connect(hg); hg.connect(gain); hiss.start(); sources.push(hiss);
        const body = noise("pink"); const bp = filt("bandpass", 1200, 0.6);
        const bg = ctx.createGain(); bg.gain.value = 0.6;
        body.connect(bp); bp.connect(bg); bg.connect(gain); body.start(); sources.push(body);
        const lfo = ctx.createOscillator(); lfo.frequency.value = 0.3;
        const lfoG = ctx.createGain(); lfoG.gain.value = 600;
        lfo.connect(lfoG); lfoG.connect(lp.frequency); lfo.start(); sources.push(lfo); break;
      }
      case "heavyrain": {
        const hiss = noise("white"); const hp = filt("highpass", 1200), lp = filt("lowpass", 11000);
        hiss.connect(hp); hp.connect(lp); lp.connect(gain); hiss.start(); sources.push(hiss);
        const roof = noise("brown"); const rl = filt("lowpass", 700);
        const rg = ctx.createGain(); rg.gain.value = 0.7;
        roof.connect(rl); rl.connect(rg); rg.connect(gain); roof.start(); sources.push(roof); break;
      }
      case "thunder": {
        const hiss = noise("white"); const hp = filt("highpass", 1500), lp = filt("lowpass", 9000);
        hiss.connect(hp); hp.connect(lp); lp.connect(gain); hiss.start(); sources.push(hiss);
        const rumble = () => {
          const t = ctx.currentTime;
          const n = noise("brown"); const f = filt("lowpass", 90);
          const g = ctx.createGain(); g.gain.value = 0;
          n.connect(f); f.connect(g); g.connect(master); n.start();
          g.gain.linearRampToValueAtTime(0.55, t + 0.4);
          g.gain.exponentialRampToValueAtTime(0.001, t + 3.2);
          window.setTimeout(() => { try { n.stop(); } catch { /* noop */ } }, 3600);
        };
        timers.push(window.setInterval(() => { if (Math.random() < 0.5) rumble(); }, 9000)); break;
      }
      case "wind": {
        const s = noise("pink"); const bp = filt("bandpass", 450, 0.4);
        s.connect(bp); bp.connect(gain); s.start(); sources.push(s);
        // Two LFOs at different rates make the gusting feel organic, not periodic.
        const l1 = ctx.createOscillator(); l1.frequency.value = 0.07;
        const g1 = ctx.createGain(); g1.gain.value = 260; l1.connect(g1); g1.connect(bp.frequency); l1.start(); sources.push(l1);
        const l2 = ctx.createOscillator(); l2.frequency.value = 0.19;
        const g2 = ctx.createGain(); g2.gain.value = 0.25;
        const base = ctx.createConstantSource(); base.offset.value = 0.7;
        l2.connect(g2); g2.connect(gain.gain); base.connect(gain.gain); l2.start(); base.start(); sources.push(l2, base); break;
      }
      case "ocean": {
        const s = noise("pink"); const lp = filt("lowpass", 700);
        s.connect(lp); lp.connect(gain); s.start(); sources.push(s);
        // Wave swell: slow gain LFO + a synced brightness sweep so each wave "breaks".
        const lfo = ctx.createOscillator(); lfo.frequency.value = 0.11;
        const lfoG = ctx.createGain(); lfoG.gain.value = 0.45;
        const base = ctx.createConstantSource(); base.offset.value = 0.5;
        lfo.connect(lfoG); lfoG.connect(gain.gain); base.connect(gain.gain); lfo.start(); base.start(); sources.push(lfo, base);
        const sweep = ctx.createGain(); sweep.gain.value = 500;
        lfo.connect(sweep); sweep.connect(lp.frequency); break;
      }
      case "stream": {
        const s = noise("white"); const hp = filt("highpass", 1800), lp = filt("lowpass", 7000);
        s.connect(hp); hp.connect(lp); lp.connect(gain); s.start(); sources.push(s);
        // Layered fast wobbles = bubbling.
        [5, 8.5, 13].forEach((r, i) => {
          const lfo = ctx.createOscillator(); lfo.frequency.value = r;
          const g = ctx.createGain(); g.gain.value = 500 - i * 120;
          lfo.connect(g); g.connect(hp.frequency); lfo.start(); sources.push(lfo);
        }); break;
      }
      case "forest": {
        const s = noise("pink"); const bp = filt("bandpass", 550, 0.4);
        const sg = ctx.createGain(); sg.gain.value = 0.6;
        s.connect(bp); bp.connect(sg); sg.connect(gain); s.start(); sources.push(s);
        const lfo = ctx.createOscillator(); lfo.frequency.value = 0.09;
        const lg = ctx.createGain(); lg.gain.value = 180; lfo.connect(lg); lg.connect(bp.frequency); lfo.start(); sources.push(lfo);
        const chirp = () => {
          const t = ctx.currentTime;
          const o = ctx.createOscillator(); o.type = "sine";
          const f = 1900 + Math.random() * 1600; o.frequency.setValueAtTime(f, t);
          o.frequency.exponentialRampToValueAtTime(f * 1.25, t + 0.07);
          const g = ctx.createGain(); g.gain.value = 0;
          o.connect(g); g.connect(gain); o.start();
          g.gain.linearRampToValueAtTime(0.06, t + 0.02);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
          window.setTimeout(() => { try { o.stop(); } catch { /* noop */ } }, 220);
        };
        timers.push(window.setInterval(() => { if (Math.random() < 0.35) chirp(); }, 2800)); break;
      }
      case "birds": {
        // A faint air bed so it isn't silent between chirps.
        const bed = noise("pink"); const bl = filt("lowpass", 1500);
        const bg = ctx.createGain(); bg.gain.value = 0.06;
        bed.connect(bl); bl.connect(bg); bg.connect(gain); bed.start(); sources.push(bed);
        const chirp = (delay: number) => {
          const t = ctx.currentTime + delay;
          const o = ctx.createOscillator(); o.type = "sine";
          const f = 2200 + Math.random() * 2000;
          o.frequency.setValueAtTime(f, t);
          // Warble up then down for a more bird-like call.
          o.frequency.linearRampToValueAtTime(f * 1.4, t + 0.05);
          o.frequency.linearRampToValueAtTime(f * 1.1, t + 0.12);
          const g = ctx.createGain(); g.gain.value = 0;
          o.connect(g); g.connect(gain); o.start(t);
          g.gain.linearRampToValueAtTime(0.1, t + 0.02);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
          o.stop(t + 0.25);
        };
        timers.push(window.setInterval(() => {
          const burst = 1 + Math.floor(Math.random() * 4);
          for (let i = 0; i < burst; i++) chirp(i * 0.13);
        }, 2000)); break;
      }
      case "crickets": {
        // A bed of layered chirp pulses tuned to ~4.5kHz with fast tremolo.
        const s = noise("white"); const bp = filt("bandpass", 4600, 14);
        const trem = ctx.createGain(); trem.gain.value = 0;
        s.connect(bp); bp.connect(trem); trem.connect(gain); s.start(); sources.push(s);
        const lfo = ctx.createOscillator(); lfo.type = "square"; lfo.frequency.value = 22;
        const lg = ctx.createGain(); lg.gain.value = 0.5;
        const base = ctx.createConstantSource(); base.offset.value = 0.5;
        lfo.connect(lg); lg.connect(trem.gain); base.connect(trem.gain); lfo.start(); base.start(); sources.push(lfo, base); break;
      }
      case "fire": {
        const bed = noise("brown"); const bl = filt("lowpass", 900);
        const bg = ctx.createGain(); bg.gain.value = 0.5;
        bed.connect(bl); bl.connect(bg); bg.connect(gain); bed.start(); sources.push(bed);
        const pop = () => {
          const t = ctx.currentTime;
          const n = noise("white"); const hp = filt("highpass", 1500), lp = filt("lowpass", 6000);
          const g = ctx.createGain(); g.gain.value = 0;
          n.connect(hp); hp.connect(lp); lp.connect(g); g.connect(gain); n.start();
          const amp = 0.12 + Math.random() * 0.2;
          g.gain.linearRampToValueAtTime(amp, t + 0.004);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.05 + Math.random() * 0.06);
          window.setTimeout(() => { try { n.stop(); } catch { /* noop */ } }, 140);
        };
        timers.push(window.setInterval(() => {
          const n = 1 + Math.floor(Math.random() * 3);
          for (let i = 0; i < n; i++) window.setTimeout(pop, Math.random() * 300);
        }, 450)); break;
      }
      case "pad": {
        // Detuned sine triad with slow filter drift = warm, breathing chord.
        const out = filt("lowpass", 1400); out.connect(gain);
        [196, 261.6, 329.6, 392].forEach((f, i) => {
          const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = f; o.detune.value = i * 5 - 7;
          const g = ctx.createGain(); g.gain.value = 0.12;
          o.connect(g); g.connect(tone(out)); o.start(); sources.push(o);
        });
        const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05;
        const lg = ctx.createGain(); lg.gain.value = 500; lfo.connect(lg); lg.connect(out.frequency); lfo.start(); sources.push(lfo); break;
      }
      case "drone": {
        const out = filt("lowpass", 600); out.connect(gain);
        [55, 82.4, 110, 164.8].forEach((f, i) => {
          const o = ctx.createOscillator(); o.type = i < 2 ? "sine" : "triangle"; o.frequency.value = f; o.detune.value = i * 3;
          const g = ctx.createGain(); g.gain.value = 0.16;
          o.connect(g); g.connect(out); o.start(); sources.push(o);
        });
        break;
      }
      case "cafe": {
        // Low room rumble + filtered murmur band that wobbles like distant chatter.
        const rumble = noise("brown"); const rl = filt("lowpass", 250);
        const rg = ctx.createGain(); rg.gain.value = 0.5;
        rumble.connect(rl); rl.connect(rg); rg.connect(gain); rumble.start(); sources.push(rumble);
        const murmur = noise("pink"); const bp = filt("bandpass", 600, 0.8), lp = filt("lowpass", 1800);
        const mg = ctx.createGain(); mg.gain.value = 0.5;
        murmur.connect(bp); bp.connect(lp); lp.connect(mg); mg.connect(gain); murmur.start(); sources.push(murmur);
        const lfo = ctx.createOscillator(); lfo.frequency.value = 1.7;
        const lg = ctx.createGain(); lg.gain.value = 250; lfo.connect(lg); lg.connect(bp.frequency); lfo.start(); sources.push(lfo); break;
      }
      case "fan": {
        const s = noise("brown"); const lp = filt("lowpass", 1100);
        s.connect(lp); lp.connect(gain); s.start(); sources.push(s);
        const lfo = ctx.createOscillator(); lfo.type = "sine"; lfo.frequency.value = 23;
        const lg = ctx.createGain(); lg.gain.value = 0.1;
        const base = ctx.createConstantSource(); base.offset.value = 0.9;
        lfo.connect(lg); lg.connect(gain.gain); base.connect(gain.gain); lfo.start(); base.start(); sources.push(lfo, base); break;
      }
    }
    return { sources, gain, timers };
  };

  const stopCurrent = () => {
    const cur = currentRef.current;
    const ctx = ctxRef.current;
    if (!cur || !ctx) return;
    cur.gain.gain.cancelScheduledValues(ctx.currentTime);
    cur.gain.gain.setValueAtTime(cur.gain.gain.value, ctx.currentTime);
    cur.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4);
    const toStop = cur.sources; const toClear = cur.timers; const el = cur.el;
    window.setTimeout(() => {
      toStop.forEach((s) => { try { s.stop(); } catch { /* noop */ } });
      toClear.forEach((t) => clearInterval(t));
      if (el) { el.pause(); el.src = ""; }
    }, 450);
    currentRef.current = null;
  };

  // These manage their own gain envelope; skip the default fade-in ramp.
  const SELF_GAIN = new Set(["ocean", "fan", "wind", "crickets"]);

  const play = (id: string) => {
    const ctx = ensureCtx();
    if (ctx.state === "suspended") ctx.resume();
    stopCurrent();
    setActiveId(id);
    if (id === "off") return;

    const sound = SOUNDS.find((s) => s.id === id);
    if (sound?.src) {
      const el = new Audio(sound.src);
      el.loop = true; el.crossOrigin = "anonymous";
      const srcNode = ctx.createMediaElementSource(el);
      const g = ctx.createGain(); g.gain.value = 0;
      srcNode.connect(g); g.connect(masterRef.current!);
      el.play().catch(() => { /* autoplay blocked until gesture */ });
      g.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.6);
      currentRef.current = { sources: [], gain: g, timers: [], el };
      return;
    }

    const nodes = build(ctx, id, masterRef.current!);
    if (!SELF_GAIN.has(id)) {
      nodes.gain.gain.setValueAtTime(0, ctx.currentTime);
      nodes.gain.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.6);
    }
    currentRef.current = nodes;
  };

  const changeVolume = (v: number) => {
    setVolume(v);
    if (masterRef.current && ctxRef.current) {
      masterRef.current.gain.setTargetAtTime(v, ctxRef.current.currentTime, 0.05);
    }
  };

  useEffect(() => () => { try { ctxRef.current?.close(); } catch { /* noop */ } }, []);

  return { activeId, volume, play, changeVolume };
}
