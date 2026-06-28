import { useEffect, useRef, useState } from "react";

// Every soundscape is generated live with the Web Audio API — no files, all free, works offline.
// To swap in a real audio file for any track later, give it a `src` URL and the hook
// will stream that on loop instead of synthesizing (see the `src` branch in play()).
export type Sound = {
  id: string;
  name: string;
  hint: string;
  category: "Noise" | "Weather" | "Nature" | "Ambient";
  src?: string; // optional: real audio file URL (mp3/ogg). If set, it's streamed on loop.
};

export const SOUNDS: Sound[] = [
  { id: "off", name: "Off", hint: "Silence", category: "Noise" },
  // Noise colors
  { id: "white", name: "White noise", hint: "Bright, full static", category: "Noise" },
  { id: "pink", name: "Pink noise", hint: "Balanced, softer hiss", category: "Noise" },
  { id: "brown", name: "Brown noise", hint: "Deep, even hush", category: "Noise" },
  // Weather
  { id: "rain", name: "Rain", hint: "Steady rainfall", category: "Weather" },
  { id: "heavyrain", name: "Heavy rain", hint: "Downpour on the roof", category: "Weather" },
  { id: "thunder", name: "Distant storm", hint: "Rain with rolling thunder", category: "Weather" },
  { id: "wind", name: "Wind", hint: "Open, gusting air", category: "Weather" },
  // Nature
  { id: "ocean", name: "Ocean", hint: "Slow rolling waves", category: "Nature" },
  { id: "stream", name: "Stream", hint: "Trickling water", category: "Nature" },
  { id: "forest", name: "Forest", hint: "Wind through leaves", category: "Nature" },
  { id: "birds", name: "Songbirds", hint: "Morning chirps", category: "Nature" },
  { id: "crickets", name: "Night crickets", hint: "Evening chorus", category: "Nature" },
  { id: "fire", name: "Campfire", hint: "Crackling embers", category: "Nature" },
  // Ambient
  { id: "pad", name: "Warm pad", hint: "Soft ambient chord", category: "Ambient" },
  { id: "drone", name: "Deep drone", hint: "Low meditative hum", category: "Ambient" },
  { id: "cafe", name: "Café hum", hint: "Gentle room tone", category: "Ambient" },
  { id: "fan", name: "Box fan", hint: "Whirring motor", category: "Ambient" },
];

export const CATEGORIES: Sound["category"][] = ["Noise", "Weather", "Nature", "Ambient"];

type Nodes = { sources: AudioScheduledSourceNode[]; gain: GainNode; timers: number[]; el?: HTMLAudioElement };

// A reusable buffer of white noise we shape into the different textures.
function makeNoiseBuffer(ctx: AudioContext, seconds = 2) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

// Pink-ish noise via a known IIR approximation (Paul Kellet's filter).
function makePinkBuffer(ctx: AudioContext, seconds = 2) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < data.length; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  return buf;
}

function buildSound(ctx: AudioContext, id: string, master: GainNode): Nodes {
  const sources: AudioScheduledSourceNode[] = [];
  const timers: number[] = [];
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(master);

  const noise = (pink = false) => {
    const src = ctx.createBufferSource();
    src.buffer = pink ? makePinkBuffer(ctx) : makeNoiseBuffer(ctx);
    src.loop = true;
    return src;
  };
  const filter = (type: BiquadFilterType, freq: number, q?: number) => {
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    if (q !== undefined) f.Q.value = q;
    return f;
  };

  switch (id) {
    case "white": {
      const src = noise(); src.connect(gain); src.start(); sources.push(src); break;
    }
    case "pink": {
      const src = noise(true); src.connect(gain); src.start(); sources.push(src); break;
    }
    case "brown": {
      const src = noise();
      const a = filter("lowpass", 500), b = filter("lowpass", 200);
      src.connect(a); a.connect(b); b.connect(gain); src.start(); sources.push(src); break;
    }
    case "rain": {
      const src = noise();
      const hp = filter("highpass", 1000), lp = filter("lowpass", 7000);
      src.connect(hp); hp.connect(lp); lp.connect(gain); src.start(); sources.push(src); break;
    }
    case "heavyrain": {
      const src = noise();
      const hp = filter("highpass", 400), lp = filter("lowpass", 9000);
      src.connect(hp); hp.connect(lp); lp.connect(gain); src.start(); sources.push(src);
      // A second low layer for body on the roof.
      const low = noise(); const ll = filter("lowpass", 600);
      low.connect(ll); ll.connect(gain); low.start(); sources.push(low); break;
    }
    case "thunder": {
      // Rain bed + occasional low thunder swells.
      const src = noise(); const hp = filter("highpass", 800), lp = filter("lowpass", 7000);
      src.connect(hp); hp.connect(lp); lp.connect(gain); src.start(); sources.push(src);
      const rumble = () => {
        const t = ctx.currentTime;
        const n = noise(); const f = filter("lowpass", 120);
        const g = ctx.createGain(); g.gain.value = 0;
        n.connect(f); f.connect(g); g.connect(master);
        n.start();
        g.gain.linearRampToValueAtTime(0.6, t + 0.3);
        g.gain.exponentialRampToValueAtTime(0.001, t + 2.5);
        window.setTimeout(() => { try { n.stop(); } catch { /* noop */ } }, 3000);
      };
      const id2 = window.setInterval(() => { if (Math.random() < 0.5) rumble(); }, 8000);
      timers.push(id2); break;
    }
    case "wind": {
      const src = noise(); const bp = filter("bandpass", 500, 0.5);
      src.connect(bp); bp.connect(gain); src.start(); sources.push(src);
      // Slow gusting via an LFO on a lowpass cutoff.
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.08;
      const lfoGain = ctx.createGain(); lfoGain.gain.value = 300;
      lfo.connect(lfoGain); lfoGain.connect(bp.frequency); lfo.start(); sources.push(lfo); break;
    }
    case "ocean": {
      const src = noise(); const lp = filter("lowpass", 800);
      src.connect(lp); lp.connect(gain); src.start(); sources.push(src);
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.12;
      const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.5;
      const base = ctx.createConstantSource(); base.offset.value = 0.5;
      lfo.connect(lfoGain); lfoGain.connect(gain.gain); base.connect(gain.gain);
      lfo.start(); base.start(); sources.push(lfo, base); break;
    }
    case "stream": {
      const src = noise(); const hp = filter("highpass", 1500), lp = filter("lowpass", 6000);
      src.connect(hp); hp.connect(lp); lp.connect(gain); src.start(); sources.push(src);
      // Bubbling wobble.
      const lfo = ctx.createOscillator(); lfo.frequency.value = 6;
      const lfoGain = ctx.createGain(); lfoGain.gain.value = 800;
      lfo.connect(lfoGain); lfoGain.connect(hp.frequency); lfo.start(); sources.push(lfo); break;
    }
    case "forest": {
      // Soft wind bed + occasional bird blips.
      const src = noise(); const bp = filter("bandpass", 600, 0.4);
      src.connect(bp); bp.connect(gain); src.start(); sources.push(src);
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.1;
      const lfoGain = ctx.createGain(); lfoGain.gain.value = 200;
      lfo.connect(lfoGain); lfoGain.connect(bp.frequency); lfo.start(); sources.push(lfo);
      const chirp = () => {
        const t = ctx.currentTime;
        const o = ctx.createOscillator(); o.type = "sine";
        const f = 1800 + Math.random() * 1500; o.frequency.setValueAtTime(f, t);
        o.frequency.exponentialRampToValueAtTime(f * 1.3, t + 0.08);
        const g = ctx.createGain(); g.gain.value = 0;
        o.connect(g); g.connect(master);
        o.start();
        g.gain.linearRampToValueAtTime(0.08, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
        window.setTimeout(() => { try { o.stop(); } catch { /* noop */ } }, 250);
      };
      const id3 = window.setInterval(() => { if (Math.random() < 0.4) chirp(); }, 2500);
      timers.push(id3); break;
    }
    case "birds": {
      const chirp = () => {
        const t = ctx.currentTime;
        const o = ctx.createOscillator(); o.type = "sine";
        const f = 2000 + Math.random() * 1800; o.frequency.setValueAtTime(f, t);
        o.frequency.exponentialRampToValueAtTime(f * (1 + Math.random()), t + 0.1);
        const g = ctx.createGain(); g.gain.value = 0;
        o.connect(g); g.connect(gain);
        o.start();
        g.gain.linearRampToValueAtTime(0.12, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
        window.setTimeout(() => { try { o.stop(); } catch { /* noop */ } }, 300);
      };
      const id4 = window.setInterval(() => {
        const burst = 1 + Math.floor(Math.random() * 3);
        for (let i = 0; i < burst; i++) window.setTimeout(chirp, i * 140);
      }, 1800);
      timers.push(id4); break;
    }
    case "crickets": {
      const src = noise(); const bp = filter("bandpass", 4500, 8);
      const trem = ctx.createGain(); trem.gain.value = 0.3;
      src.connect(bp); bp.connect(trem); trem.connect(gain); src.start(); sources.push(src);
      // Fast tremolo gives the chirping pulse.
      const lfo = ctx.createOscillator(); lfo.type = "square"; lfo.frequency.value = 18;
      const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.3;
      lfo.connect(lfoGain); lfoGain.connect(trem.gain); lfo.start(); sources.push(lfo); break;
    }
    case "fire": {
      const src = noise(); const lp = filter("lowpass", 1200);
      const g = ctx.createGain(); g.gain.value = 0.4;
      src.connect(lp); lp.connect(g); g.connect(gain); src.start(); sources.push(src);
      // Random crackle pops.
      const pop = () => {
        const t = ctx.currentTime;
        const n = noise(); const hp = filter("highpass", 2000);
        const pg = ctx.createGain(); pg.gain.value = 0;
        n.connect(hp); hp.connect(pg); pg.connect(master);
        n.start();
        pg.gain.linearRampToValueAtTime(0.15 + Math.random() * 0.15, t + 0.005);
        pg.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
        window.setTimeout(() => { try { n.stop(); } catch { /* noop */ } }, 120);
      };
      const id5 = window.setInterval(() => { if (Math.random() < 0.7) pop(); }, 400);
      timers.push(id5); break;
    }
    case "pad": {
      [196, 261.6, 329.6].forEach((f, i) => {
        const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = f;
        o.detune.value = i * 4 - 4;
        const g = ctx.createGain(); g.gain.value = 0.18;
        o.connect(g); g.connect(gain); o.start(); sources.push(o);
      });
      break;
    }
    case "drone": {
      [55, 82.4, 110].forEach((f) => {
        const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = f;
        const g = ctx.createGain(); g.gain.value = 0.22;
        o.connect(g); g.connect(gain); o.start(); sources.push(o);
      });
      const lp = filter("lowpass", 400); void lp; break;
    }
    case "cafe": {
      const src = noise(); const bp = filter("bandpass", 500, 0.7), lp = filter("lowpass", 2000);
      src.connect(bp); bp.connect(lp); lp.connect(gain); src.start(); sources.push(src); break;
    }
    case "fan": {
      const src = noise(); const lp = filter("lowpass", 900);
      src.connect(lp); lp.connect(gain); src.start(); sources.push(src);
      // Motor whir: amplitude modulation at blade-pass rate.
      const lfo = ctx.createOscillator(); lfo.type = "sine"; lfo.frequency.value = 24;
      const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.12;
      const base = ctx.createConstantSource(); base.offset.value = 0.88;
      lfo.connect(lfoGain); lfoGain.connect(gain.gain); base.connect(gain.gain);
      lfo.start(); base.start(); sources.push(lfo, base); break;
    }
  }

  return { sources, gain, timers };
}

// Sounds that manage their own gain envelope and shouldn't get the default fade-in ramp.
const SELF_GAIN = new Set(["ocean", "fan"]);

export function useSoundscape() {
  const ctxRef = useRef<AudioContext | null>(null);
  const masterRef = useRef<GainNode | null>(null);
  const currentRef = useRef<Nodes | null>(null);
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

  const stopCurrent = () => {
    const cur = currentRef.current;
    const ctx = ctxRef.current;
    if (!cur || !ctx) return;
    cur.gain.gain.cancelScheduledValues(ctx.currentTime);
    cur.gain.gain.setValueAtTime(cur.gain.gain.value, ctx.currentTime);
    cur.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4);
    const toStop = cur.sources; const toClear = cur.timers; const el = cur.el;
    window.setTimeout(() => {
      toStop.forEach((s) => { try { s.stop(); } catch { /* already stopped */ } });
      toClear.forEach((t) => clearInterval(t));
      if (el) { el.pause(); el.src = ""; }
    }, 450);
    currentRef.current = null;
  };

  const play = (id: string) => {
    const ctx = ensureCtx();
    if (ctx.state === "suspended") ctx.resume();
    stopCurrent();
    setActiveId(id);
    if (id === "off") return;

    const sound = SOUNDS.find((s) => s.id === id);
    // Real-file branch: if a track has a src, stream it on loop instead of synthesizing.
    if (sound?.src) {
      const el = new Audio(sound.src);
      el.loop = true; el.crossOrigin = "anonymous";
      const srcNode = ctx.createMediaElementSource(el);
      const gain = ctx.createGain(); gain.gain.value = 0;
      srcNode.connect(gain); gain.connect(masterRef.current!);
      el.play().catch(() => { /* autoplay blocked until user gesture */ });
      gain.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.6);
      currentRef.current = { sources: [], gain, timers: [], el };
      return;
    }

    const nodes = buildSound(ctx, id, masterRef.current!);
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
