// Built-in ambient focus sounds, synthesized with WebAudio — no audio files,
// no accounts, no licensing, works offline. Because the app owns this audio
// (unlike the Spotify/Apple embeds), the timer can control it perfectly:
// start on focus, fade out at the break.
//
// Two families: noise textures (rain, stream, ocean, deep/white noise) and
// meditation tones (singing bowl, calm drone, wind chimes) built from
// oscillators with slow envelopes instead of static.

export type FocusSoundId =
  | "melody" | "lofi"
  | "bowl" | "om" | "chimes" | "stream"
  | "rain" | "ocean" | "brown" | "white";

export const FOCUS_SOUNDS: { id: FocusSoundId; name: string; hint: string }[] = [
  { id: "melody", name: "Melody", hint: "Slow tune over soft chords" },
  { id: "lofi", name: "Lofi beats", hint: "Mellow beat, jazzy chords" },
  { id: "bowl", name: "Singing bowl", hint: "Soft strikes, long resonance" },
  { id: "om", name: "Calm drone", hint: "Warm meditative hum" },
  { id: "chimes", name: "Wind chimes", hint: "Gentle drifting tones" },
  { id: "stream", name: "Stream", hint: "Babbling water" },
  { id: "rain", name: "Rain", hint: "Steady rainfall" },
  { id: "ocean", name: "Ocean", hint: "Slow wave swells" },
  { id: "brown", name: "Deep noise", hint: "Low, warm rumble" },
  { id: "white", name: "White noise", hint: "Even static wash" },
];

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let teardown: (() => void) | null = null; // stops this sound's sources/timers
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

const rand = (min: number, max: number) => min + Math.random() * (max - min);

// ---- builders: each wires its graph into `out` and returns a teardown ----

function buildNoise(audio: AudioContext, out: GainNode, id: "rain" | "white" | "brown" | "ocean" | "stream"): () => void {
  const src = audio.createBufferSource();
  src.buffer = noiseBuffer(audio, id === "white" || id === "rain" || id === "stream" ? "white" : "brown");
  src.loop = true;
  const extras: (OscillatorNode | AudioBufferSourceNode)[] = [src];

  let head: AudioNode = src;
  if (id === "rain") {
    const hp = audio.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 500;
    const lp = audio.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 8000;
    head.connect(hp); hp.connect(lp); head = lp;
  } else if (id === "white") {
    const lp = audio.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 10000;
    head.connect(lp); head = lp;
  } else if (id === "ocean") {
    const swell = audio.createGain();
    swell.gain.value = 0.65;
    const osc = audio.createOscillator();
    osc.frequency.value = 0.09; // ~11s per wave
    const depth = audio.createGain();
    depth.gain.value = 0.35;
    osc.connect(depth); depth.connect(swell.gain); osc.start();
    extras.push(osc);
    head.connect(swell); head = swell;
  } else if (id === "stream") {
    // Babble: band-limited noise whose center wobbles, plus a faint sparkle.
    const lp = audio.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1100; lp.Q.value = 1.2;
    const wob = audio.createOscillator(); wob.frequency.value = 0.35;
    const wobDepth = audio.createGain(); wobDepth.gain.value = 420;
    wob.connect(wobDepth); wobDepth.connect(lp.frequency); wob.start();
    extras.push(wob);
    head.connect(lp);
    const sparkleHp = audio.createBiquadFilter(); sparkleHp.type = "highpass"; sparkleHp.frequency.value = 3200;
    const sparkleGain = audio.createGain(); sparkleGain.gain.value = 0.12;
    src.connect(sparkleHp); sparkleHp.connect(sparkleGain); sparkleGain.connect(out);
    head = lp;
  }
  head.connect(out);
  src.start();

  return () => {
    for (const n of extras) { try { n.stop(); } catch { /* stopped */ } n.disconnect(); }
  };
}

function buildOm(audio: AudioContext, out: GainNode): () => void {
  // Warm hum: low fundamental with a beating twin, a fifth and an octave,
  // low-passed and swelling slowly.
  const mix = audio.createGain(); mix.gain.value = 0.5;
  const lp = audio.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 520;
  const voices: [number, number][] = [[82.41, 0.5], [82.9, 0.35], [123.6, 0.22], [164.8, 0.12]];
  const nodes: OscillatorNode[] = [];
  for (const [freq, level] of voices) {
    const o = audio.createOscillator(); o.type = "sine"; o.frequency.value = freq;
    const g = audio.createGain(); g.gain.value = level;
    o.connect(g); g.connect(mix); o.start();
    nodes.push(o);
  }
  const swellOsc = audio.createOscillator(); swellOsc.frequency.value = 0.06;
  const swellDepth = audio.createGain(); swellDepth.gain.value = 0.15;
  swellOsc.connect(swellDepth); swellDepth.connect(mix.gain); swellOsc.start();
  nodes.push(swellOsc);
  mix.connect(lp); lp.connect(out);
  return () => { for (const n of nodes) { try { n.stop(); } catch { /* stopped */ } n.disconnect(); } };
}

function buildBowl(audio: AudioContext, out: GainNode): () => void {
  const timers: number[] = [];
  // Constant faint resonance under the strikes.
  const droneStop = (() => {
    const o = audio.createOscillator(); o.type = "sine"; o.frequency.value = 196;
    const g = audio.createGain(); g.gain.value = 0.045;
    o.connect(g); g.connect(out); o.start();
    return () => { try { o.stop(); } catch { /* stopped */ } o.disconnect(); };
  })();

  const strike = () => {
    const detune = rand(0.99, 1.01);
    // A bowl's inharmonic partials with individual decays.
    const partials: [number, number, number][] = [[196, 0.5, 9], [533, 0.16, 6], [1060, 0.05, 4]];
    for (const [freq, level, decay] of partials) {
      const o = audio.createOscillator(); o.type = "sine"; o.frequency.value = freq * detune;
      const g = audio.createGain();
      const t = audio.currentTime;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(level, t + 0.025);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      o.connect(g); g.connect(out);
      o.start(t); o.stop(t + decay + 0.3);
    }
  };
  const scheduleNext = () => {
    const id = window.setTimeout(() => { strike(); scheduleNext(); }, rand(9000, 16000));
    timers.push(id);
  };
  strike();
  scheduleNext();
  return () => { timers.forEach((t) => window.clearTimeout(t)); droneStop(); };
}

function buildChimes(audio: AudioContext, out: GainNode): () => void {
  const timers: number[] = [];
  // Faint low pad so the silence between chimes isn't dead air.
  const padStop = (() => {
    const src = audio.createBufferSource();
    src.buffer = noiseBuffer(audio, "brown");
    src.loop = true;
    const lp = audio.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 600;
    const g = audio.createGain(); g.gain.value = 0.05;
    src.connect(lp); lp.connect(g); g.connect(out); src.start();
    return () => { try { src.stop(); } catch { /* stopped */ } src.disconnect(); };
  })();

  const scale = [523.25, 587.33, 659.25, 783.99, 880.0]; // C major pentatonic
  const ding = () => {
    const freq = scale[Math.floor(Math.random() * scale.length)];
    const o = audio.createOscillator(); o.type = "triangle"; o.frequency.value = freq;
    const g = audio.createGain();
    const t = audio.currentTime;
    const decay = rand(3, 5);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(rand(0.12, 0.2), t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    let tail: AudioNode = g;
    if (audio.createStereoPanner) {
      const pan = audio.createStereoPanner(); pan.pan.value = rand(-0.6, 0.6);
      g.connect(pan); tail = pan;
    }
    o.connect(g); tail.connect(out);
    o.start(t); o.stop(t + decay + 0.2);
  };
  const scheduleNext = () => {
    const id = window.setTimeout(() => {
      ding();
      if (Math.random() < 0.3) { const id2 = window.setTimeout(ding, rand(250, 600)); timers.push(id2); }
      scheduleNext();
    }, rand(2500, 7000));
    timers.push(id);
  };
  ding();
  scheduleNext();
  return () => { timers.forEach((t) => window.clearTimeout(t)); padStop(); };
}

function buildMelody(audio: AudioContext, out: GainNode): () => void {
  const timers: number[] = [];
  const oscs: OscillatorNode[] = [];

  // Chord pad: Am → F → C → G voicings, one gain per chord, crossfaded on a
  // slow loop. All 12 oscillators run continuously; only the ramps move.
  const padLp = audio.createBiquadFilter(); padLp.type = "lowpass"; padLp.frequency.value = 800;
  padLp.connect(out);
  const chords: number[][] = [
    [220.0, 261.63, 329.63], // Am
    [174.61, 220.0, 261.63], // F
    [196.0, 261.63, 329.63], // C (2nd inversion-ish)
    [196.0, 246.94, 293.66], // G
  ];
  const chordGains: GainNode[] = chords.map((freqs, i) => {
    const g = audio.createGain();
    g.gain.value = i === 0 ? 0.11 : 0.0001;
    g.connect(padLp);
    for (const f of freqs) {
      // Detuned pair per voice for warmth.
      for (const det of [0.9985, 1.0015]) {
        const o = audio.createOscillator(); o.type = "triangle"; o.frequency.value = f * det;
        const vg = audio.createGain(); vg.gain.value = 0.33;
        o.connect(vg); vg.connect(g); o.start();
        oscs.push(o);
      }
    }
    return g;
  });
  let chordIdx = 0;
  const CHORD_SECONDS = 12;
  const nextChord = () => {
    const from = chordGains[chordIdx];
    chordIdx = (chordIdx + 1) % chords.length;
    const to = chordGains[chordIdx];
    const t = audio.currentTime;
    from.gain.cancelScheduledValues(t);
    from.gain.setValueAtTime(from.gain.value, t);
    from.gain.linearRampToValueAtTime(0.0001, t + 3);
    to.gain.cancelScheduledValues(t);
    to.gain.setValueAtTime(to.gain.value, t);
    to.gain.linearRampToValueAtTime(0.11, t + 3);
    timers.push(window.setTimeout(nextChord, CHORD_SECONDS * 1000));
  };
  timers.push(window.setTimeout(nextChord, CHORD_SECONDS * 1000));

  // Lead: A-minor pentatonic, mostly stepwise motion so it reads as a tune.
  const scale = [440.0, 523.25, 587.33, 659.25, 783.99, 880.0]; // A C D E G A
  let noteIdx = Math.floor(Math.random() * scale.length);
  const note = () => {
    // Prefer a neighbor step; occasionally leap or repeat.
    const r = Math.random();
    if (r < 0.4) noteIdx = Math.min(scale.length - 1, noteIdx + 1);
    else if (r < 0.8) noteIdx = Math.max(0, noteIdx - 1);
    else noteIdx = Math.floor(Math.random() * scale.length);
    const o = audio.createOscillator(); o.type = "sine"; o.frequency.value = scale[noteIdx];
    const g = audio.createGain();
    const t = audio.currentTime;
    const release = rand(2, 3);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(rand(0.14, 0.2), t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t + release);
    let tail: AudioNode = g;
    if (audio.createStereoPanner) {
      const pan = audio.createStereoPanner(); pan.pan.value = rand(-0.35, 0.35);
      g.connect(pan); tail = pan;
    }
    o.connect(g); tail.connect(out);
    o.start(t); o.stop(t + release + 0.2);
  };
  const scheduleNote = () => {
    // ~15% of slots are rests (schedule the wait, skip the note).
    const id = window.setTimeout(() => {
      if (Math.random() > 0.15) note();
      scheduleNote();
    }, rand(2000, 4500));
    timers.push(id);
  };
  note();
  scheduleNote();

  return () => {
    timers.forEach((t) => window.clearTimeout(t));
    for (const o of oscs) { try { o.stop(); } catch { /* stopped */ } o.disconnect(); }
  };
}

function buildLofi(audio: AudioContext, out: GainNode): () => void {
  // Everything runs through one warm lowpass bus.
  const bus = audio.createGain(); bus.gain.value = 1;
  const warm = audio.createBiquadFilter(); warm.type = "lowpass"; warm.frequency.value = 3500;
  bus.connect(warm); warm.connect(out);

  const noise = noiseBuffer(audio, "white");

  // Vinyl bed: faint hiss plus sparse crackle pops.
  const hiss = audio.createBufferSource(); hiss.buffer = noise; hiss.loop = true;
  const hissBp = audio.createBiquadFilter(); hissBp.type = "bandpass"; hissBp.frequency.value = 4500; hissBp.Q.value = 0.5;
  const hissG = audio.createGain(); hissG.gain.value = 0.012;
  hiss.connect(hissBp); hissBp.connect(hissG); hissG.connect(out); hiss.start();
  const crackleTimers: number[] = [];
  const crackle = () => {
    const s = audio.createBufferSource(); s.buffer = noise;
    const g = audio.createGain();
    const t = audio.currentTime;
    g.gain.setValueAtTime(rand(0.03, 0.09), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.02);
    const hp = audio.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 2000;
    s.connect(hp); hp.connect(g); g.connect(out);
    s.start(t); s.stop(t + 0.03);
    crackleTimers.push(window.setTimeout(crackle, rand(150, 900)));
  };
  crackle();

  // Drum voices, scheduled on the audio clock for tight timing.
  const kick = (t: number) => {
    const o = audio.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const g = audio.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(g); g.connect(bus);
    o.start(t); o.stop(t + 0.3);
  };
  const snare = (t: number) => {
    const s = audio.createBufferSource(); s.buffer = noise;
    const bp = audio.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1800; bp.Q.value = 0.8;
    const g = audio.createGain();
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    s.connect(bp); bp.connect(g); g.connect(bus);
    s.start(t); s.stop(t + 0.2);
  };
  const hat = (t: number, open: boolean) => {
    const s = audio.createBufferSource(); s.buffer = noise;
    const hp = audio.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 7000;
    const g = audio.createGain();
    const decay = open ? 0.12 : 0.04;
    g.gain.setValueAtTime(open ? 0.07 : 0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    s.connect(hp); hp.connect(g); g.connect(bus);
    s.start(t); s.stop(t + decay + 0.02);
  };
  // One jazzy 7th chord per bar, alternating Fmaj7 / Em7.
  const chordFreqs: number[][] = [
    [174.61, 220.0, 261.63, 329.63], // Fmaj7
    [164.81, 196.0, 246.94, 293.66], // Em7
  ];
  const chord = (t: number, bar: number, beatLen: number) => {
    const freqs = chordFreqs[bar % 2];
    const lp = audio.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1200;
    const g = audio.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.085, t + 0.15);
    g.gain.setTargetAtTime(0.0001, t + beatLen * 3, 0.5);
    lp.connect(g); g.connect(bus);
    for (const f of freqs) {
      const o = audio.createOscillator(); o.type = "triangle"; o.frequency.value = f;
      o.connect(lp);
      o.start(t); o.stop(t + beatLen * 4 + 1.5);
    }
  };

  // Lookahead scheduler: a coarse interval walks a 16-step (one bar) swung
  // pattern, always booking events ~0.3s ahead on the audio clock so JS timer
  // jitter never reaches the groove. 74 BPM, swung 8ths.
  const BPM = 74;
  const beatLen = 60 / BPM;
  const stepLen = beatLen / 4; // 16th-note grid
  const SWING = stepLen * 0.55; // pushes off-beat 8ths late
  let step = 0;
  let bar = 0;
  let nextStepTime = audio.currentTime + 0.1;
  const tick = window.setInterval(() => {
    while (nextStepTime < audio.currentTime + 0.3) {
      const swungTime = step % 4 === 2 ? nextStepTime + SWING : nextStepTime;
      if (step === 0) { kick(swungTime); chord(swungTime, bar, beatLen); }
      if (step === 7 && Math.random() < 0.35) kick(swungTime); // syncopated ghost kick
      if (step === 8) kick(swungTime);
      if (step === 4 || step === 12) snare(swungTime);
      if (step % 2 === 0) hat(swungTime, step === 14 && Math.random() < 0.3);
      step = (step + 1) % 16;
      if (step === 0) bar++;
      nextStepTime += stepLen;
    }
  }, 100);

  return () => {
    window.clearInterval(tick);
    crackleTimers.forEach((t) => window.clearTimeout(t));
    try { hiss.stop(); } catch { /* stopped */ }
    hiss.disconnect();
  };
}

// ---- public controls ----

export function stopFocusSound(fadeSeconds = 0.6) {
  if (!ctx || !masterGain) return;
  const g = masterGain;
  const td = teardown;
  const t = ctx.currentTime;
  try {
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(g.gain.value, t);
    g.gain.linearRampToValueAtTime(0.0001, t + fadeSeconds);
  } catch { /* context torn down */ }
  window.setTimeout(() => {
    td?.();
    g.disconnect();
    // Pause the iOS keeper after the fade (kept alive through it so the
    // end-of-phase chime still plays in the unlocked session).
    if (!masterGain) keeper?.pause();
  }, fadeSeconds * 1000 + 100);
  masterGain = null;
  teardown = null;
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

  const gain = audio.createGain();
  gain.gain.setValueAtTime(0.0001, audio.currentTime);
  gain.gain.linearRampToValueAtTime(volume, audio.currentTime + 0.8); // fade in
  gain.connect(audio.destination);

  let stop: () => void;
  if (id === "melody") stop = buildMelody(audio, gain);
  else if (id === "lofi") stop = buildLofi(audio, gain);
  else if (id === "om") stop = buildOm(audio, gain);
  else if (id === "bowl") stop = buildBowl(audio, gain);
  else if (id === "chimes") stop = buildChimes(audio, gain);
  else stop = buildNoise(audio, gain, id);

  masterGain = gain;
  teardown = stop;
}

export function focusSoundActive(): boolean {
  return masterGain !== null;
}
