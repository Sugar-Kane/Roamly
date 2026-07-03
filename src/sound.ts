// Shared end-of-phase chime, used by both the personal timer (useTimer) and
// the shared room timer (RoomsLive). One consistent sound for every boundary —
// a study session ending and a break ending alike.
//
// A single AudioContext is reused across plays. Browsers require a prior user
// gesture before audio can start; by the time a phase ends the user has
// interacted (started a timer / joined a room), so resume() succeeds.

let ctx: AudioContext | null = null;

export function playChime() {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    if (!ctx) ctx = new AC();
    if (ctx.state === "suspended") void ctx.resume();
    const audio = ctx;
    const start = audio.currentTime;
    // Two gentle rising sine notes — a soft "ding-dong" that reads as a chime.
    const notes: [number, number][] = [[528, start], [660, start + 0.18]];
    for (const [freq, at] of notes) {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = "sine";
      o.frequency.value = freq;
      o.connect(g);
      g.connect(audio.destination);
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.18, at + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.9);
      o.start(at);
      o.stop(at + 0.95);
    }
  } catch {
    /* audio not available in this context */
  }
}
