import { useEffect, useRef, useState } from "react";

// Each soundscape is generated live with the Web Audio API — no files, works offline.
// To swap in a real lo-fi/nature audio file later, give a track a `src` URL and the
// hook will stream that instead of synthesizing (see the `src` branch in start()).
export type Sound = {
  id: string;
  name: string;
  hint: string;
  premium?: boolean;
  src?: string; // optional: real audio file URL (mp3/ogg). If set, it's streamed on loop.
};

export const SOUNDS: Sound[] = [
  { id: "off", name: "Off", hint: "Silence" },
  { id: "rain", name: "Rain", hint: "Steady rainfall" },
  { id: "brown", name: "Brown noise", hint: "Deep, even hush" },
  { id: "ocean", name: "Ocean", hint: "Slow rolling waves" },
  { id: "pad", name: "Warm pad", hint: "Soft ambient chord", premium: true },
  { id: "cafe", name: "Café hum", hint: "Gentle room tone", premium: true },
];

type Nodes = { sources: AudioScheduledSourceNode[]; gain: GainNode; timers: number[]; el?: HTMLAudioElement };

// A reusable buffer of white noise we shape into the different textures.
function makeNoiseBuffer(ctx: AudioContext, seconds = 2) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function buildSound(ctx: AudioContext, id: string, master: GainNode): Nodes {
  const sources: AudioScheduledSourceNode[] = [];
  const timers: number[] = [];
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(master);

  const noise = () => {
    const src = ctx.createBufferSource();
    src.buffer = makeNoiseBuffer(ctx);
    src.loop = true;
    return src;
  };

  if (id === "rain") {
    const src = noise();
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 1000;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 7000;
    src.connect(hp); hp.connect(lp); lp.connect(gain);
    src.start(); sources.push(src);
  } else if (id === "brown") {
    // Integrate white noise to approximate brown noise (more low-end energy).
    const src = noise();
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 500;
    const lp2 = ctx.createBiquadFilter(); lp2.type = "lowpass"; lp2.frequency.value = 200;
    src.connect(lp); lp.connect(lp2); lp2.connect(gain);
    src.start(); sources.push(src);
  } else if (id === "ocean") {
    const src = noise();
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 800;
    src.connect(lp); lp.connect(gain);
    src.start(); sources.push(src);
    // Slow swell: modulate gain like waves coming in and out.
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.12;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.5;
    const base = ctx.createConstantSource(); base.offset.value = 0.5;
    lfo.connect(lfoGain); lfoGain.connect(gain.gain); base.connect(gain.gain);
    lfo.start(); base.start(); sources.push(lfo, base);
  } else if (id === "pad") {
    // Warm major-ish chord from a few detuned sine oscillators.
    [196, 261.6, 329.6].forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = f;
      o.detune.value = i * 4 - 4;
      const g = ctx.createGain(); g.gain.value = 0.18;
      o.connect(g); g.connect(gain);
      o.start(); sources.push(o);
    });
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1200;
    // (pad already routed straight to gain; filter kept subtle by not inserting—keeps it warm)
    void lp;
  } else if (id === "cafe") {
    const src = noise();
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 500; bp.Q.value = 0.7;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 2000;
    src.connect(bp); bp.connect(lp); lp.connect(gain);
    src.start(); sources.push(src);
  }

  return { sources, gain, timers };
}

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
    // Fade out, then stop, to avoid clicks.
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
    // Fade in (ocean manages its own gain envelope, so skip the ramp for it).
    if (id !== "ocean") {
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

  // Clean up the audio context when the app unmounts.
  useEffect(() => () => { try { ctxRef.current?.close(); } catch { /* noop */ } }, []);

  return { activeId, volume, play, changeVolume };
}
