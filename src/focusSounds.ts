// Built-in ambient focus sounds, synthesized with WebAudio — no audio files,
// no accounts, no licensing, works offline. Because the app owns this audio
// (unlike the Spotify/Apple embeds), the timer can control it perfectly:
// start on focus, fade out at the break.

export type FocusSoundId = "rain" | "brown" | "white" | "ocean";

export const FOCUS_SOUNDS: { id: FocusSoundId; name: string; hint: string }[] = [
  { id: "rain", name: "Rain", hint: "Steady rainfall" },
  { id: "brown", name: "Deep noise", hint: "Low, warm rumble" },
  { id: "white", name: "White noise", hint: "Even static wash" },
  { id: "ocean", name: "Ocean", hint: "Slow wave swells" },
];

let ctx: AudioContext | null = null;
let source: AudioBufferSourceNode | null = null;
let masterGain: GainNode | null = null;
let lfo: OscillatorNode | null = null;
let currentVolume = 0.5;
let keeper: HTMLAudioElement | null = null;

// ~50ms of silence as a WAV data URI, built deterministically at runtime.
function silentWavURI(): string {
  const n = 400;
  const bytes = new Uint8Array(44 + n);
  const dv = new DataView(bytes.buffer);
  const w = (o: number, str: string) => { for (let i = 0; i < str.length; i++) bytes[o + i] = str.charCodeAt(i); };
  w(0, "RIFF"); dv.setUint32(4, 36 + n, true); w(8, "WAVE");
  w(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, 8000, true); dv.setUint32(28, 8000, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true);
  w(36, "data"); dv.setUint32(40, n, true);
  bytes.fill(128, 44); // 8-bit silence midpoint
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return "data:audio/wav;base64," + btoa(bin);
}

// Must be called synchronously inside a real tap/click. Two iOS Safari rules
// make this necessary: (1) an AudioContext only starts inside a user gesture;
// (2) WebAudio is muted by the hardware silent switch unless an HTML <audio>
// element is playing, which promotes the session to "playback". The looping
// silent keeper element satisfies both — on other browsers it's a no-op.
export function unlockAudio() {
  audioCtx();
  if (!keeper) {
    keeper = new Audio(silentWavURI());
    keeper.loop = true;
    keeper.volume = 0.01;
    keeper.setAttribute("playsinline", "");
  }
  keeper.play().catch(() => { /* browsers that don't need the trick may refuse; fine */ });
}

function audioCtx(): AudioContext | null {
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

// 4 seconds of looped noise; brown noise is a leaky integration of white.
function noiseBuffer(audio: AudioContext, kind: "white" | "brown"): AudioBuffer {
  const length = audio.sampleRate * 4;
  const buffer = audio.createBuffer(1, length, audio.sampleRate);
  const data = buffer.getChannelData(0);
  if (kind === "white") {
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  } else {
    let last = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
  }
  return buffer;
}

export function stopFocusSound(fadeSeconds = 0.6) {
  if (!ctx || !masterGain) return;
  const g = masterGain;
  const s = source;
  const l = lfo;
  const t = ctx.currentTime;
  try {
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(g.gain.value, t);
    g.gain.linearRampToValueAtTime(0.0001, t + fadeSeconds);
  } catch { /* context torn down */ }
  window.setTimeout(() => {
    try { s?.stop(); } catch { /* already stopped */ }
    try { l?.stop(); } catch { /* already stopped */ }
    s?.disconnect(); l?.disconnect(); g.disconnect();
    // Pause the iOS keeper after the fade (kept alive through it so the
    // end-of-phase chime still plays in the unlocked session).
    if (!source) keeper?.pause();
  }, fadeSeconds * 1000 + 100);
  source = null;
  masterGain = null;
  lfo = null;
}

export function setFocusVolume(volume: number) {
  currentVolume = volume;
  if (ctx && masterGain) {
    masterGain.gain.setTargetAtTime(volume, ctx.currentTime, 0.05);
  }
}

export function startFocusSound(id: FocusSoundId, volume = currentVolume) {
  const audio = audioCtx();
  if (!audio) return;
  keeper?.play().catch(() => { /* not unlocked yet; harmless */ });
  stopFocusSound(0.15); // replace whatever is playing
  currentVolume = volume;

  const src = audio.createBufferSource();
  src.buffer = noiseBuffer(audio, id === "white" || id === "rain" ? "white" : "brown");
  src.loop = true;

  const gain = audio.createGain();
  gain.gain.setValueAtTime(0.0001, audio.currentTime);
  gain.gain.linearRampToValueAtTime(volume, audio.currentTime + 0.8); // fade in

  let head: AudioNode = src;
  if (id === "rain") {
    // Rain ≈ white noise band-limited to a hiss with the low rumble removed.
    const hp = audio.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 500;
    const lp = audio.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 8000;
    head.connect(hp); hp.connect(lp); head = lp;
  } else if (id === "white") {
    const lp = audio.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 10000;
    head.connect(lp); head = lp;
  } else if (id === "ocean") {
    // Ocean ≈ brown noise with a slow swell (LFO wobbling the gain).
    const swell = audio.createGain();
    swell.gain.value = 0.65;
    const osc = audio.createOscillator();
    osc.frequency.value = 0.09; // ~11s per wave
    const oscDepth = audio.createGain();
    oscDepth.gain.value = 0.35;
    osc.connect(oscDepth);
    oscDepth.connect(swell.gain);
    osc.start();
    head.connect(swell); head = swell;
    lfo = osc;
  }
  // brown: raw buffer straight through — already a warm rumble.

  head.connect(gain);
  gain.connect(audio.destination);
  src.start();

  source = src;
  masterGain = gain;
}

export function focusSoundActive(): boolean {
  return source !== null;
}
