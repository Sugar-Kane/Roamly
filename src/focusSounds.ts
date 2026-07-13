// Built-in focus music — no accounts, no ads. Because the app owns this
// audio (unlike the Spotify/Apple embeds), the timer can control it
// perfectly: start on focus, fade out at the break.
//
// Every option is actual music, and recorded tracks do not repeat for 7 days:
//  - "melody", "beats", "piano", "ambient", and "rain" are generative WebAudio — they synthesize a
//    fresh, non-looping performance each session, so they never repeat.
//  - "lofi" (Café) and "calm" are real free-license recordings (Kevin MacLeod)
//    bundled under /audio/lofi. A local 7-day listening history removes every
//    recently heard track from the shuffle. When that pool is exhausted, the
//    station switches to a fresh generative performance instead of repeating.

export type FocusSoundId =
  | "melody" | "lofi" | "calm" | "beats" | "piano" | "ambient" | "rain";

export const FOCUS_SOUNDS: { id: FocusSoundId; name: string; hint: string }[] = [
  { id: "melody", name: "Melody", hint: "Slow tune over soft chords" },
  { id: "lofi", name: "Café music", hint: "25 real tracks · 7-day no-repeat memory" },
  { id: "calm", name: "Calm music", hint: "18 real tracks · 7-day no-repeat memory" },
  { id: "beats", name: "Lo-fi beats", hint: "Live chillhop groove" },
  { id: "piano", name: "Piano", hint: "Gentle drifting piano" },
  { id: "ambient", name: "Ambient drift", hint: "Endless evolving soundscape" },
  { id: "rain", name: "Rainy piano", hint: "Fresh piano with soft rainfall" },
];

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let teardown: (() => void) | null = null; // stops this sound's sources/timers
let currentVolume = 0.5;
let keeper: HTMLAudioElement | null = null;

// ---- real recorded tracks (Café music) ----
// Free-license instrumentals (Kevin MacLeod, CC0/CC-BY — see the manifest for
// per-track licensing) bundled under /audio/lofi by the fetch-music workflow.
// They play through one persistent <audio> element routed into the WebAudio
// graph, so volume, fades, and the iOS handling all work like the synth sounds.
// category: "lofi" = chill jazz/lounge (Café music), "calm" = ambient/meditation.
export type MusicCategory = "lofi" | "calm";
export type MusicTrack = { file: string; title: string; artist: string; license: string; category?: MusicCategory };
let playlist: MusicTrack[] | null = null; // null = manifest not loaded yet
let musicEl: HTMLAudioElement | null = null;
let musicSrcNode: MediaElementAudioSourceNode | null = null;
let musicToken: object | null = null; // identifies the active music build (see buildMusic)

const playlistReady = fetch("/audio/lofi/manifest.json")
  .then((r) => (r.ok ? r.json() : []))
  .then((rows: MusicTrack[]) => { playlist = Array.isArray(rows) ? rows : []; })
  .catch(() => { playlist = []; });

const TRACK_HISTORY_KEY = "roamly-music-track-history-v1";
const TRACK_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

function recentTrackHistory(now = Date.now()): Record<string, number> {
  try {
    const parsed = JSON.parse(localStorage.getItem(TRACK_HISTORY_KEY) ?? "{}") as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, number] =>
      typeof entry[1] === "number" && now - entry[1] < TRACK_COOLDOWN_MS));
  } catch {
    return {};
  }
}

function rememberTrack(file: string, now = Date.now()) {
  try {
    const history = recentTrackHistory(now);
    history[file] = now;
    localStorage.setItem(TRACK_HISTORY_KEY, JSON.stringify(history));
  } catch {
    // Storage can be unavailable in private browsing. The in-session shuffle
    // still prevents repeats until the page is closed.
  }
}

export function tracksOutsideCooldown(pool: MusicTrack[], now = Date.now()): MusicTrack[] {
  const history = recentTrackHistory(now);
  return pool.filter((track) => history[track.file] === undefined);
}

// Tracks in a category (falls back to the whole playlist if none are tagged
// that way, so an unpopulated category still plays something).
function tracksFor(category: MusicCategory): MusicTrack[] {
  if (!playlist) return [];
  const tagged = playlist.filter((t) => t.category === category);
  return tagged.length > 0 ? tagged : playlist;
}

// Whether real tracks are available for a category. Returns false only once the
// manifest has loaded and the category is genuinely empty (so we fall back to
// synth); while loading (playlist === null) we optimistically say true.
export function hasTracks(category: MusicCategory): boolean {
  if (playlist === null) return true;
  if (playlist.length === 0) return false;
  return tracksFor(category).length > 0;
}

// CC BY 4.0 requires visible attribution — the sounds panel shows this line.
export function musicCredit(): string | null {
  if (!playlist || playlist.length === 0) return null;
  return `Music: ${playlist[0].artist} (incompetech.com) · CC BY 4.0`;
}

function musicElement(): HTMLAudioElement {
  if (!musicEl) {
    musicEl = new Audio();
    musicEl.preload = "auto";
    musicEl.setAttribute("playsinline", "");
  }
  return musicEl;
}

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
  // Bless the music element inside the same gesture: an element that has
  // played once by user activation may later have its src swapped and be
  // replayed programmatically (how the Café playlist advances on iOS).
  const el = musicElement();
  if (!el.src) {
    el.src = silentWavURI();
    el.play().catch(() => { /* same as keeper */ });
  }
}

function audioCtx(): AudioContext | null {
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

// ---- OS media-session signaling + full release ----
// iOS promotes any playing <audio> element to a lock-screen "Now Playing"
// tile. While a session is active we give that tile honest metadata; when
// nothing needs audio anymore we fully release everything, or the looping
// silent keeper pins the tile forever and burns battery.

function mediaSession(): MediaSession | null {
  return typeof navigator !== "undefined" && "mediaSession" in navigator ? navigator.mediaSession : null;
}

function announcePlayback(title: string, artist = "Roamly Focus") {
  const ms = mediaSession();
  if (!ms) return;
  try {
    ms.metadata = new MediaMetadata({ title, artist });
    ms.playbackState = "playing";
  } catch { /* MediaMetadata unsupported — cosmetic only */ }
}

function clearPlayback(state: MediaSessionPlaybackState = "none") {
  const ms = mediaSession();
  if (!ms) return;
  try {
    if (state === "none") ms.metadata = null;
    ms.playbackState = state;
  } catch { /* cosmetic only */ }
}

// Hand the audio session back to the OS: silence and unload the keeper and
// the music element, suspend the AudioContext, dismiss the media tile.
// No-op while something is actively playing. Everything re-acquires on the
// next Start tap (unlockAudio/startFocusSound run inside user gestures).
export function releaseAudioSession() {
  if (masterGain) return; // a sound is playing — the session is legitimately held
  if (keeper) {
    keeper.pause();
    keeper.removeAttribute("src");
    try { keeper.load(); } catch { /* older browsers */ }
    keeper = null; // rebuilt from a data URI on the next unlockAudio
  }
  if (musicEl) {
    musicEl.pause();
    if (musicEl.src) {
      musicEl.removeAttribute("src");
      try { musicEl.load(); } catch { /* older browsers */ }
    }
  }
  if (ctx && ctx.state === "running") void ctx.suspend();
  clearPlayback("none");
}

// The page going away is the one moment we can't rely on React cleanup.
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    teardown?.();
    masterGain = null;
    teardown = null;
    releaseAudioSession();
  });
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

function buildPiano(audio: AudioContext, out: GainNode): () => void {
  const timers: number[] = [];
  // Warm room: soften the top so the piano reads mellow, not bright.
  const warm = audio.createBiquadFilter(); warm.type = "lowpass"; warm.frequency.value = 2600;
  warm.connect(out);

  // One felt-piano note: a triangle fundamental plus a soft octave partial,
  // fast attack and a long exponential tail — the envelope that reads "piano".
  const note = (freq: number, t: number, vel: number) => {
    const decay = rand(2.5, 4.5);
    const g = audio.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    let tail: AudioNode = g;
    if (audio.createStereoPanner) {
      const pan = audio.createStereoPanner(); pan.pan.value = rand(-0.3, 0.3);
      g.connect(pan); tail = pan;
    }
    tail.connect(warm);
    const o1 = audio.createOscillator(); o1.type = "triangle"; o1.frequency.value = freq;
    const o2 = audio.createOscillator(); o2.type = "sine"; o2.frequency.value = freq * 2;
    const o2g = audio.createGain(); o2g.gain.value = 0.35;
    o1.connect(g); o2.connect(o2g); o2g.connect(g);
    o1.start(t); o1.stop(t + decay + 0.2);
    o2.start(t); o2.stop(t + decay + 0.2);
  };

  // Diatonic 4-chord progressions in C (root-position triads, Hz), one chord
  // per bar. A random progression + random transpose gives each session its
  // own key; the per-bar note choices below keep it from ever repeating.
  const PROGRESSIONS: number[][][] = [
    [[261.63, 329.63, 392.0], [220.0, 261.63, 329.63], [174.61, 220.0, 261.63], [196.0, 246.94, 293.66]], // C Am F G
    [[220.0, 261.63, 329.63], [174.61, 220.0, 261.63], [196.0, 246.94, 293.66], [261.63, 329.63, 392.0]], // Am F G C
    [[174.61, 220.0, 261.63], [261.63, 329.63, 392.0], [196.0, 246.94, 293.66], [220.0, 261.63, 329.63]], // F C G Am
    [[261.63, 329.63, 392.0], [196.0, 246.94, 293.66], [220.0, 261.63, 329.63], [174.61, 220.0, 261.63]], // C G Am F
  ];
  const progression = PROGRESSIONS[Math.floor(Math.random() * PROGRESSIONS.length)];
  const transpose = Math.pow(2, Math.round(rand(-2, 2)) / 12);

  let bar = 0;
  const playBar = () => {
    const chord = progression[bar % progression.length].map((f) => f * transpose);
    const t0 = audio.currentTime + 0.05;
    // Left hand: a low root, then the chord tones gently rolled up.
    note(chord[0] / 2, t0, 0.14);
    chord.forEach((f, i) => note(f, t0 + 0.35 + i * rand(0.28, 0.5), rand(0.06, 0.11)));
    // Right hand: a few chord-tone notes an octave up, spread across the bar
    // with rests — random each time, so the melody never repeats.
    const melodyNotes = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < melodyNotes; i++) {
      const f = chord[Math.floor(Math.random() * chord.length)] * 2;
      note(f, t0 + rand(1.0, 5.5), rand(0.05, 0.1));
    }
    bar++;
    timers.push(window.setTimeout(playBar, rand(6500, 8500)));
  };
  playBar();

  return () => { timers.forEach((t) => window.clearTimeout(t)); };
}

function buildAmbient(audio: AudioContext, out: GainNode): () => void {
  const oscs: OscillatorNode[] = [];
  const timers: number[] = [];
  const rootChoices = [110, 123.47, 130.81, 146.83, 164.81];
  const root = rootChoices[Math.floor(Math.random() * rootChoices.length)];
  const intervals = [1, 1.5, 2, 2.5];
  const warm = audio.createBiquadFilter();
  warm.type = "lowpass";
  warm.frequency.value = rand(650, 1100);
  warm.Q.value = 0.4;
  warm.connect(out);

  for (const [index, interval] of intervals.entries()) {
    const gain = audio.createGain();
    gain.gain.value = 0.035 + index * 0.008;
    gain.connect(warm);
    for (const detune of [-rand(2, 7), rand(2, 7)]) {
      const osc = audio.createOscillator();
      osc.type = index % 2 ? "sine" : "triangle";
      osc.frequency.value = root * interval;
      osc.detune.value = detune;
      osc.connect(gain);
      osc.start();
      oscs.push(osc);
    }
  }

  const bell = () => {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    const at = audio.currentTime;
    osc.type = "sine";
    osc.frequency.value = root * [3, 4, 5, 6][Math.floor(Math.random() * 4)];
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(rand(0.035, 0.065), at + 0.4);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + rand(5, 9));
    osc.connect(gain); gain.connect(out);
    osc.start(at); osc.stop(at + 10);
    timers.push(window.setTimeout(bell, rand(7000, 16000)));
  };
  timers.push(window.setTimeout(bell, rand(2500, 7000)));

  return () => {
    timers.forEach((timer) => window.clearTimeout(timer));
    for (const osc of oscs) { try { osc.stop(); } catch { /* stopped */ } osc.disconnect(); }
    warm.disconnect();
  };
}

function buildRainyPiano(audio: AudioContext, out: GainNode): () => void {
  const pianoStop = buildPiano(audio, out);
  const rain = audio.createBufferSource();
  rain.buffer = noiseBuffer(audio, "white");
  rain.loop = true;
  const rainBand = audio.createBiquadFilter();
  rainBand.type = "bandpass";
  rainBand.frequency.value = rand(1800, 2600);
  rainBand.Q.value = 0.35;
  const rainGain = audio.createGain();
  rainGain.gain.value = 0.025;
  rain.connect(rainBand); rainBand.connect(rainGain); rainGain.connect(out);
  rain.start();
  return () => {
    pianoStop();
    try { rain.stop(); } catch { /* stopped */ }
    rain.disconnect(); rainBand.disconnect(); rainGain.disconnect();
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
  // ---- per-session character: every start sounds like a different track ----
  const BPM = rand(68, 82);
  const beatLen = 60 / BPM;
  const stepLen = beatLen / 4; // 16th-note grid
  const swing = stepLen * rand(0.5, 0.62); // pushes off-beat 8ths late
  const transpose = Math.pow(2, Math.round(rand(-3, 3)) / 12); // random key
  // Lofi-friendly 4-chord progressions (root-position 7th voicings), one
  // chord per bar, looping every 4 bars.
  const PROGRESSIONS: number[][][] = [
    [[174.61, 220.0, 261.63, 329.63], [164.81, 196.0, 246.94, 293.66], [146.83, 174.61, 220.0, 261.63], [130.81, 164.81, 196.0, 246.94]], // Fmaj7 Em7 Dm7 Cmaj7
    [[220.0, 261.63, 329.63, 392.0], [174.61, 220.0, 261.63, 329.63], [130.81, 164.81, 196.0, 246.94], [196.0, 246.94, 293.66, 329.63]],  // Am7 Fmaj7 Cmaj7 G6
    [[146.83, 174.61, 220.0, 261.63], [196.0, 246.94, 293.66, 349.23], [130.81, 164.81, 196.0, 246.94], [220.0, 261.63, 329.63, 392.0]],  // Dm7 G7 Cmaj7 Am7
    [[164.81, 196.0, 246.94, 293.66], [220.0, 261.63, 329.63, 392.0], [146.83, 174.61, 220.0, 261.63], [196.0, 246.94, 293.66, 349.23]],  // Em7 Am7 Dm7 G7
    [[174.61, 220.0, 261.63, 329.63], [220.0, 261.63, 329.63, 392.0], [164.81, 196.0, 246.94, 293.66], [146.83, 174.61, 220.0, 261.63]],  // Fmaj7 Am7 Em7 Dm7
  ];
  const progression = PROGRESSIONS[Math.floor(Math.random() * PROGRESSIONS.length)];
  const hatGrid = Math.random() < 0.7 ? 2 : 4; // swung 8ths vs sparser quarters

  const chord = (t: number, barNum: number) => {
    const freqs = progression[barNum % 4];
    const lp = audio.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1200;
    const g = audio.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.085, t + 0.15);
    g.gain.setTargetAtTime(0.0001, t + beatLen * 3, 0.5);
    lp.connect(g); g.connect(bus);
    for (const f of freqs) {
      const o = audio.createOscillator(); o.type = "triangle"; o.frequency.value = f * transpose;
      o.connect(lp);
      o.start(t); o.stop(t + beatLen * 4 + 1.5);
    }
  };

  // Sparse lead: a soft chord-tone note an octave up, same envelope idea as
  // the Melody sound's lead.
  const lead = (t: number, freq: number) => {
    const o = audio.createOscillator(); o.type = "sine"; o.frequency.value = freq;
    const g = audio.createGain();
    const release = rand(1.5, 2.5);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(rand(0.07, 0.11), t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + release);
    let tail: AudioNode = g;
    if (audio.createStereoPanner) {
      const pan = audio.createStereoPanner(); pan.pan.value = rand(-0.4, 0.4);
      g.connect(pan); tail = pan;
    }
    o.connect(g); tail.connect(bus);
    o.start(t); o.stop(t + release + 0.2);
  };

  // ---- per-bar plan: the groove varies bar to bar, with a breather or a
  // small snare fill every 8th bar and occasional lead notes ----
  type BarPlan = { kicks: Set<number>; hats: Set<number>; openHat: number; dropout: boolean; fill: boolean; melody: Map<number, number> };
  const planBar = (barNum: number): BarPlan => {
    const kicks = new Set<number>([0]);
    if (Math.random() < 0.85) kicks.add(8);
    const ghostSlots = [3, 6, 7, 10, 11, 14];
    const ghosts = 1 + (Math.random() < 0.4 ? 1 : 0);
    for (let i = 0; i < ghosts; i++) kicks.add(ghostSlots[Math.floor(Math.random() * ghostSlots.length)]);
    const hats = new Set<number>();
    for (let s = 0; s < 16; s += hatGrid) if (Math.random() < 0.9) hats.add(s);
    const openHat = Math.random() < 0.35 ? [6, 10, 14][Math.floor(Math.random() * 3)] : -1;
    const eighthBar = barNum % 8 === 7;
    const dropout = eighthBar && Math.random() < 0.5;
    const fill = eighthBar && !dropout;
    const melody = new Map<number, number>();
    if (Math.random() < 0.35) {
      const chordNow = progression[barNum % 4];
      const n = Math.random() < 0.5 ? 1 : 2;
      for (let i = 0; i < n; i++) {
        const s = [0, 4, 6, 8, 10, 12][Math.floor(Math.random() * 6)];
        melody.set(s, chordNow[Math.floor(Math.random() * chordNow.length)] * 2 * transpose);
      }
    }
    return { kicks, hats, openHat, dropout, fill, melody };
  };
  let plan = planBar(0);

  // Lookahead scheduler: a coarse interval walks the 16-step (one bar) swung
  // pattern, always booking events ~0.3s ahead on the audio clock so JS timer
  // jitter never reaches the groove.
  let step = 0;
  let bar = 0;
  let nextStepTime = audio.currentTime + 0.1;
  const tick = window.setInterval(() => {
    while (nextStepTime < audio.currentTime + 0.3) {
      const swungTime = step % 4 === 2 ? nextStepTime + swing : nextStepTime;
      if (step === 0) chord(swungTime, bar);
      if (!plan.dropout) {
        if (plan.kicks.has(step)) kick(swungTime);
        if (step === 4 || step === 12) snare(swungTime);
        if (plan.fill && (step === 13 || step === 15)) snare(swungTime); // drag into the next bar
        if (plan.hats.has(step)) hat(swungTime, step === plan.openHat);
      }
      const leadFreq = plan.melody.get(step);
      if (leadFreq) lead(swungTime, leadFreq);
      step = (step + 1) % 16;
      if (step === 0) { bar++; plan = planBar(bar); }
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

// Real-track playlist for one category: shuffled order, advances on track end,
// reshuffles when exhausted. The element routes through `out`, so fades/volume
// are shared.
function buildMusic(audio: AudioContext, out: GainNode, category: MusicCategory): () => void {
  const el = musicElement();
  if (!musicSrcNode) musicSrcNode = audio.createMediaElementSource(el);
  musicSrcNode.connect(out);
  el.loop = false;
  el.volume = 1;
  // All music builds share the one <audio> element and source node. When you
  // switch tracks (e.g. Café → Calm) the previous sound's teardown fires ~250ms
  // later (after its fade); this token makes that stale teardown a no-op so it
  // can't pause/disconnect the track that just took over.
  const token = {};
  musicToken = token;

  let stopped = false;
  let order: MusicTrack[] = [];
  let fallbackStop: (() => void) | null = null;
  const nextTrack = () => {
    if (stopped) return;
    const pool = tracksFor(category);
    if (pool.length === 0) return;
    if (order.length === 0) {
      order = tracksOutsideCooldown(pool);
      if (order.length === 0) {
        fallbackStop = category === "lofi" ? buildLofi(audio, out) : buildPiano(audio, out);
        announcePlayback(category === "lofi" ? "Fresh café session" : "Fresh calm session", "Roamly Focus");
        return;
      }
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
    }
    const track = order.pop()!;
    rememberTrack(track.file);
    el.src = track.file;
    void el.play().catch(() => { /* resumes on the next user gesture */ });
    announcePlayback(track.title, track.artist);
  };
  el.onended = nextTrack;
  void playlistReady.then(() => { if (!stopped) nextTrack(); });

  return () => {
    stopped = true;
    if (musicToken !== token) return; // a newer music build already took over
    el.onended = null;
    fallbackStop?.();
    el.pause();
    el.removeAttribute("src");
    try { el.load(); } catch { /* flush the buffered track */ }
    musicSrcNode?.disconnect();
    musicToken = null;
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
    // The iOS keeper is intentionally NOT paused here — it stays looping while
    // the session may still need a chime (silent-switch audibility). The
    // idle-release effect in App calls releaseAudioSession() once nothing is
    // running anymore, which is what finally frees the keeper and the tile.
    if (!masterGain) clearPlayback("paused");
  }, fadeSeconds * 1000 + 100);
  masterGain = null;
  teardown = null;
}

// End-of-phase chime, played through the SAME unlocked AudioContext + keeper as
// the focus sounds — so it survives the iOS silent switch (a separate context
// with no keeper element gets muted). Two soft rising sine notes.
export function playChime() {
  const audio = audioCtx();
  if (!audio) return;
  keeper?.play().catch(() => { /* not unlocked yet; harmless */ });
  const start = audio.currentTime + 0.02;
  const notes: [number, number][] = [[528, start], [660, start + 0.18]];
  for (const [freq, at] of notes) {
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = "sine";
    o.frequency.value = freq;
    o.connect(g); g.connect(audio.destination);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.2, at + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.9);
    o.start(at); o.stop(at + 0.95);
  }
}

export function setFocusVolume(volume: number) {
  currentVolume = volume;
  if (ctx && masterGain) {
    masterGain.gain.setTargetAtTime(volume, ctx.currentTime, 0.05);
  }
}

// Gently dims whatever is playing (synth or real tracks — both route through
// masterGain) over the last few seconds of a focus block, so the music flows
// into the break instead of cutting off. The phase-boundary stop/start that
// follows resets the gain naturally.
export function duckFocusSound(seconds = 5) {
  if (!ctx || !masterGain) return;
  const g = masterGain;
  const t = ctx.currentTime;
  try {
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(g.gain.value, t);
    g.gain.linearRampToValueAtTime(Math.max(0.0001, currentVolume * 0.08), t + seconds);
  } catch { /* context torn down */ }
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
  if (id === "beats") stop = buildLofi(audio, gain);
  else if (id === "piano") stop = buildPiano(audio, gain);
  else if (id === "ambient") stop = buildAmbient(audio, gain);
  else if (id === "rain") stop = buildRainyPiano(audio, gain);
  // Café / Calm play real bundled tracks; a generative station stands in as the
  // fallback while that category's manifest is missing (e.g. before the workflow ran).
  else if (id === "lofi") stop = hasTracks("lofi") ? buildMusic(audio, gain, "lofi") : buildLofi(audio, gain);
  else if (id === "calm") stop = hasTracks("calm") ? buildMusic(audio, gain, "calm") : buildPiano(audio, gain);
  // "melody" and any unknown/legacy id fall back to the Melody station.
  else stop = buildMelody(audio, gain);

  masterGain = gain;
  teardown = stop;
  // Real-track stations overwrite this with per-track metadata as they play.
  announcePlayback(FOCUS_SOUNDS.find((s) => s.id === id)?.name ?? "Focus sounds");
}

export function focusSoundActive(): boolean {
  return masterGain !== null;
}
