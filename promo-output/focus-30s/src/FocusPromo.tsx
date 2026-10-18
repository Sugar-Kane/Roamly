import { AbsoluteFill, Audio, Easing, Img, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from "remotion";
import "./fonts";
import { DISPLAY, MONO, UI } from "./fonts";
import { Backdrop, BrowserWindow, C, Callout, Cursor, Headline, LogoMark, Screen, WIN, camAt, prog, t2f, window01, type Cam } from "./components";
import { FPS, SFX, VO, s } from "./timeline";

// Screenshot (CSS px) → video px, for a given camera.
function toVideo(cam: Cam, x: number, y: number) {
  const W = 1440, H = 900, z = cam.z;
  const tx = Math.min(0, Math.max(W - W * z, W / 2 - cam.x * z));
  const ty = Math.min(0, Math.max(H - H * z, H / 2 - cam.y * z));
  return { x: WIN.x + tx + x * z, y: WIN.y + WIN.chrome + ty + y * z };
}
const still = (x: number, y: number, z: number, t = 0): Cam => ({ t, x, y, z });

// Shots shown in the browser window: [from, to, file, camera keys (absolute seconds)].
type Shot = { from: number; to: number; src: string; cam: Cam[]; fade?: number };
const SHOTS: Shot[] = [
  // Exams
  { from: 1.35, to: 2.4, src: "shots/b2-exam-list.png", cam: [{ t: 1.35, x: 620, y: 470, z: 1.25 }, { t: 2.4, x: 620, y: 470, z: 1.4 }], fade: 0 },
  { from: 2.35, to: 3.2, src: "shots/b5-filled.png", cam: [{ t: 2.35, x: 700, y: 420, z: 1.4 }, { t: 3.2, x: 700, y: 420, z: 1.48 }] },
  { from: 3.15, to: 3.9, src: "shots/c2-custom-typed.png", cam: [{ t: 3.15, x: 700, y: 420, z: 1.48 }, { t: 3.9, x: 700, y: 420, z: 1.52 }] },
  { from: 3.85, to: 5.05, src: "shots/c4-two-exams.png", cam: [{ t: 3.85, x: 720, y: 450, z: 1 }, { t: 4.35, x: 460, y: 300, z: 1.55 }] },
  // Timers
  { from: 5.0, to: 6.05, src: "shots/d1-timer-menu.png", cam: [{ t: 5.0, x: 720, y: 330, z: 1.2 }, { t: 6.05, x: 720, y: 300, z: 1.38 }] },
  { from: 6.0, to: 6.8, src: "shots/d2-timer-menu-scrolled.png", cam: [{ t: 6.0, x: 720, y: 640, z: 1.38 }, { t: 6.8, x: 720, y: 700, z: 1.45 }] },
  { from: 6.75, to: 7.3, src: "shots/d3b-countup-ready.png", cam: [still(560, 170, 1.45)] },
  { from: 7.25, to: 8.05, src: "shots/d5-countup-0.png", cam: [{ t: 7.25, x: 560, y: 170, z: 1.45 }, { t: 8.05, x: 380, y: 160, z: 1.75 }] },
  // Start
  { from: 8.0, to: 9.1, src: "shots/e0-classic-card.png", cam: [{ t: 8.0, x: 720, y: 330, z: 1.0 }, { t: 8.85, x: 800, y: 330, z: 1.1 }, { t: 9.1, x: 837, y: 336, z: 1.6 }] },
  // Customize Session: pets and garden off
  { from: 14.0, to: 14.8, src: "shots/f1-customize-on.png", cam: [{ t: 14.0, x: 720, y: 450, z: 1 }, { t: 14.45, x: 1230, y: 240, z: 1.55 }] },
  { from: 14.75, to: 15.4, src: "shots/f2-customize-pets-off.png", cam: [still(1230, 240, 1.55)] },
  { from: 15.35, to: 15.9, src: "shots/f3-customize-both-off.png", cam: [still(1230, 240, 1.55)] },
  { from: 15.85, to: 16.25, src: "shots/f4-focus-clean.png", cam: [{ t: 15.85, x: 720, y: 450, z: 1.25 }, { t: 16.25, x: 720, y: 450, z: 1.1 }] },
  // Music
  { from: 16.2, to: 18.7, src: "shots/m1-focus-sounds.png", cam: [{ t: 16.2, x: 720, y: 220, z: 1.2 }, { t: 17.45, x: 720, y: 220, z: 1.32 }, { t: 18.05, x: 720, y: 560, z: 1.32 }] },
  { from: 18.65, to: 19.75, src: "shots/m3-apple.png", cam: [{ t: 18.65, x: 720, y: 230, z: 1.32 }, { t: 19.75, x: 720, y: 230, z: 1.4 }] },
  // Pop out (click)
  { from: 19.7, to: 20.6, src: "shots/e0-classic-card.png", cam: [{ t: 19.7, x: 720, y: 330, z: 1.0 }, { t: 20.3, x: 780, y: 380, z: 1.15 }] },
];

// The 8 themes, each held for 0.19 s, then a grid.
const THEMES: [string, string][] = [
  ["coffee", "Coffee Shop"], ["whitecoat", "White Coat"], ["library", "Library Night"], ["nightshift", "Night Shift"],
  ["deepsea", "Deep Sea"], ["sage", "Sage Calm"], ["sunset", "Sunset Study"], ["ocean", "Ocean Desk"],
];
const THEME_T0 = 22.95, THEME_STEP = 0.19, GRID_AT = THEME_T0 + THEMES.length * THEME_STEP; // ≈ 24.47

export const FocusPromo = () => {
  const f = useCurrentFrame();
  const sec = f / FPS;

  // Browser window presence: enters at 1.35, leaves for the desktop at 20.45–22.9, leaves for the grid at GRID_AT.
  const enter = prog(f, 1.3, 1.85, Easing.out(Easing.cubic));
  const toDesk = prog(f, 20.4, 20.75);
  const back = prog(f, 22.75, 23.05, Easing.out(Easing.cubic));
  const toGrid = prog(f, GRID_AT - 0.05, GRID_AT + 0.35);
  const away = sec < 22 ? toDesk : 1 - back;
  const winOpacity = Math.min(enter, 1 - away, 1 - toGrid) * (sec < 25.3 ? 1 : 0);
  const winScale = (0.92 + 0.08 * enter) * (1 - 0.12 * away) * (1 - 0.25 * toGrid);
  const winY = (1 - enter) * 260 + away * 60;

  // Focus mode video camera (absolute seconds): full view, then zoom onto companions + garden.
  const videoCam = camAt(f, [{ t: 9.0, x: 720, y: 450, z: 1.25 }, { t: 9.4, x: 720, y: 450, z: 1 }, { t: 11.75, x: 720, y: 450, z: 1 }, { t: 12.4, x: 345, y: 190, z: 1.6 }, { t: 14.0, x: 345, y: 190, z: 1.66 }]);

  const shotLayer = SHOTS.filter((sh) => sec >= sh.from - 0.01 && sec < sh.to).map((sh) => {
    const fade = sh.fade ?? 0.08;
    const o = fade ? prog(f, sh.from, sh.from + fade, Easing.linear) : 1;
    return <Screen key={sh.src + sh.from} src={sh.src} cam={camAt(f, sh.cam)} opacity={o} />;
  });
  const themeIdx = Math.min(THEMES.length - 1, Math.max(0, Math.floor((sec - THEME_T0) / THEME_STEP)));
  const showThemes = sec >= 22.75 && sec < 25.3;

  // Cursor positions use each shot's camera at click time.
  const cB2 = camAt(t2f(2.3), SHOTS[0].cam), cB5 = camAt(t2f(3.1), SHOTS[1].cam), cC2 = camAt(t2f(3.8), SHOTS[2].cam);
  const cD1 = camAt(t2f(5.9), SHOTS[4].cam), cD2 = camAt(t2f(6.65), SHOTS[5].cam);
  const cE0 = camAt(t2f(8.6), SHOTS[8].cam), cF = still(1230, 240, 1.55), cM1 = camAt(t2f(18.6), SHOTS[13].cam), cPop = camAt(t2f(20.15), SHOTS[15].cam);
  const P = (cam: Cam, x: number, y: number, t: number) => ({ t, ...toVideo(cam, x, y) });

  return (
    <AbsoluteFill style={{ fontFamily: UI }}>
      <Backdrop />

      {/* Hook */}
      <Hook />

      {/* Browser window with the real app */}
      {winOpacity > 0 && (
        <div style={{ position: "absolute", inset: 0, opacity: winOpacity, transform: `translateY(${winY}px) scale(${winScale})`, transformOrigin: "960px 560px" }}>
          <BrowserWindow>
            {shotLayer}
            {sec >= 8.85 && sec < 14.05 && (
              <Sequence from={s(9.0)} durationInFrames={s(5.05)} layout="none">
                <Screen cam={videoCam} opacity={prog(f, 8.85, 9.1, Easing.linear)}
                  video={<OffthreadVideo src={staticFile("clips/focus-mode.mp4")} style={{ width: 1440, height: 900 }} muted />} />
              </Sequence>
            )}
            {showThemes && <Screen src={`shots/t-${THEMES[themeIdx][0]}.png`} cam={still(720, 450, 1)} />}
          </BrowserWindow>
        </div>
      )}

      {/* Headlines */}
      <Headline from={1.6} to={5.0} kicker="Exam schedule">Board exams or your own, counted down.</Headline>
      <Headline from={5.0} to={8.0} kicker="Timers">Classic Pomodoro, or count up.</Headline>
      <Headline from={8.0} to={11.7} kicker="Focus mode">Just you and the task.</Headline>
      <Headline from={11.7} to={14.0} kicker="Companions">Your pets and garden, right on the timer.</Headline>
      <Headline from={14.0} to={16.2} kicker="Customize session">Prefer it quiet? Switch them off.</Headline>
      <Headline from={16.2} to={19.7} kicker="Music">Study channels, Spotify or Apple Music.</Headline>
      <Headline from={19.7} to={22.85} kicker="Pop-out timer · PC">Float the timer over your notes.</Headline>
      <Headline from={22.85} to={25.3} kicker="Themes">Make it yours.</Headline>

      {/* Callouts */}
      <Callout from={4.4} to={5.0} x={980} y={760} tone="amber">Live countdown for every exam</Callout>
      <Callout from={2.45} to={3.15} x={1270} y={830}>Pick from the list…</Callout>
      <Callout from={3.25} to={3.85} x={1270} y={830}>…or name your own</Callout>
      <Callout from={5.3} to={6.0} x={1330} y={840}>Classic 25/5</Callout>
      <Callout from={7.3} to={8.0} x={1180} y={480} tone="amber">Stopwatch mode</Callout>
      <Callout from={9.5} to={11.6} x={1250} y={930}>Everything else falls away</Callout>
      <Callout from={12.5} to={13.95} x={1425} y={286} tone="amber">← Pets keep you company</Callout>
      <Callout from={12.8} to={13.95} x={1425} y={500} tone="amber">← Your garden grows</Callout>
      <Callout from={16.5} to={17.5} x={1290} y={930}>7 built-in channels</Callout>
      <Callout from={17.9} to={18.65} x={1290} y={930}>Spotify</Callout>
      <Callout from={18.8} to={19.65} x={1290} y={930}>Apple Music</Callout>

      {/* Cursor */}
      <Cursor from={1.9} to={4.05} path={[
        { t: 1.9, x: 1300, y: 980 }, P(cB2, 499, 544, 2.3), P(cB5, 846, 540, 3.1), P(cC2, 846, 540, 3.8), { t: 4.05, x: 1150, y: 980 },
      ]} clicks={[2.35, 3.15, 3.85]} />
      <Cursor from={5.3} to={6.95} path={[{ t: 5.3, x: 1250, y: 980 }, P(cD1, 720, 176, 5.9), P(cD2, 720, 782, 6.65), { t: 6.95, x: 1250, y: 980 }]} clicks={[5.95, 6.7]} />
      <Cursor from={8.05} to={8.85} path={[{ t: 8.05, x: 1400, y: 900 }, P(cE0, 837, 336, 8.55)]} clicks={[8.6]} />
      <Cursor from={14.3} to={15.75} path={[{ t: 14.3, x: 1500, y: 800 }, P(cF, 1393, 145, 14.7), P(cF, 1393, 215, 15.3)]} clicks={[14.75, 15.35]} />
      <Cursor from={18.1} to={18.95} path={[{ t: 18.1, x: 1300, y: 950 }, P(cM1, 980, 512, 18.6)]} clicks={[18.65]} />
      <Cursor from={19.75} to={20.45} path={[{ t: 19.75, x: 1350, y: 950 }, P(cPop, 788, 399, 20.1)]} clicks={[20.15]} />

      {/* Desktop with the pop-out timer */}
      {sec >= 20.35 && sec < 23.1 && <Desktop />}

      {/* Theme grid */}
      {sec >= GRID_AT - 0.1 && sec < 25.6 && <ThemeGrid />}

      {/* End card */}
      {sec >= 25.2 && <EndCard />}

      {/* Audio */}
      <Audio src={staticFile("music.mp3")} volume={(fr) => musicVolume(fr)} />
      {VO.map((v) => (
        <Sequence key={v.id} from={s(v.at)} layout="none"><Audio src={staticFile(`vo/${v.id}.wav`)} volume={1} /></Sequence>
      ))}
      {SFX.map((x, i) => (
        <Sequence key={i} from={s(x.at)} layout="none"><Audio src={staticFile(`sfx/${x.id}.wav`)} volume={x.vol ?? 0.55} /></Sequence>
      ))}
    </AbsoluteFill>
  );
};

// Music bed: ducked under every VO line, gentle fade at the very end.
function musicVolume(fr: number) {
  const sec = fr / FPS;
  let duck = 0;
  for (const v of VO) {
    const a = interpolate(sec, [v.at - 0.15, v.at + 0.05, v.at + v.dur, v.at + v.dur + 0.3], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    duck = Math.max(duck, a);
  }
  const base = 0.5 - 0.3 * duck; // music ≈ −20 LUFS alone, ≈ −28 LUFS under the voice (voice at −16)
  const fadeIn = interpolate(sec, [0, 0.25], [0, 1], { extrapolateRight: "clamp" });
  const fadeOut = interpolate(sec, [28.4, 30], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return base * fadeIn * fadeOut;
}

const Hook = () => {
  const f = useCurrentFrame();
  const o = window01(f, 0.05, 1.55, 0.3, 0.3);
  if (o <= 0) return null;
  const words = ["Your", "exam", "has", "a", "date."];
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: o }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 26, transform: `translateY(${-prog(f, 1.2, 1.55) * 80}px)` }}>
        <div style={{ fontFamily: MONO, fontSize: 22, letterSpacing: "0.3em", color: C.brown, textTransform: "uppercase" }}>Roamly Flow · Focus</div>
        <div style={{ fontFamily: DISPLAY, fontSize: 124, fontWeight: 600, color: C.ink, display: "flex", gap: 30, letterSpacing: "-0.02em" }}>
          {words.map((w, i) => {
            const p = prog(f, 0.32 + i * 0.16, 0.62 + i * 0.16, Easing.out(Easing.cubic));
            return <span key={w} style={{ opacity: p, transform: `translateY(${(1 - p) * 40}px)`, color: w === "date." ? C.brown : C.ink, fontStyle: w === "date." ? "italic" : "normal" }}>{w}</span>;
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const NOTES = [
  "Heart failure: HFrEF vs HFpEF",
  "• HFrEF: EF ≤ 40% — systolic dysfunction",
  "• HFpEF: EF ≥ 50% — impaired relaxation",
  "• ↓CO → RAAS + sympathetic activation",
  "• Signs: JVD, S3, crackles, ↑BNP",
  "• GDMT: ACEi/ARNI, β-blocker, MRA, SGLT2i",
  "Review before Cardiology EOR",
];

const Desktop = () => {
  const f = useCurrentFrame();
  const o = window01(f, 20.4, 23.0, 0.3, 0.3);
  const notesIn = prog(f, 20.4, 20.8, Easing.out(Easing.cubic));
  const pipIn = prog(f, 20.85, 21.35, Easing.out(Easing.back(1.6)));
  const tick = Math.floor((f - t2f(20.6)) / FPS);
  return (
    <AbsoluteFill style={{ opacity: o }}>
      {/* notes window */}
      <div style={{ position: "absolute", left: 200, top: 140, width: 1180, height: 700, borderRadius: 16, background: "#FFFDF9", overflow: "hidden",
        boxShadow: "0 40px 90px rgba(62,44,33,0.25), 0 0 0 1px rgba(62,44,33,0.08)", transform: `translateY(${(1 - notesIn) * 40}px)`, opacity: notesIn }}>
        <div style={{ height: 44, background: "#EFE8DE", display: "flex", alignItems: "center", gap: 8, padding: "0 18px", borderBottom: "1px solid rgba(62,44,33,0.1)" }}>
          {["#E7836F", "#E9B65A", "#8CB77E"].map((c) => <span key={c} style={{ width: 13, height: 13, borderRadius: 7, background: c }} />)}
          <span style={{ marginLeft: 16, fontFamily: UI, fontSize: 15, color: C.muted }}>Lecture 12 — Heart Failure.pdf</span>
        </div>
        <div style={{ padding: "54px 80px", fontFamily: UI, color: "#2D2620" }}>
          <div style={{ fontFamily: DISPLAY, fontSize: 52, fontWeight: 600, marginBottom: 34 }}>{NOTES[0]}</div>
          {NOTES.slice(1, -1).map((n) => <div key={n} style={{ fontSize: 31, lineHeight: 1.9 }}>{n}</div>)}
          <div style={{ marginTop: 36, display: "inline-block", fontSize: 26, padding: "8px 16px", background: "rgba(232,163,61,0.25)", borderRadius: 8 }}>{NOTES[NOTES.length - 1]}</div>
        </div>
      </div>
      {/* the real pop-out window (Document Picture-in-Picture), 180×203 CSS px shown at 2× */}
      <div style={{ position: "absolute", left: 1390, top: 160, width: 360, borderRadius: 14, overflow: "hidden", background: "#F3EADF",
        boxShadow: "0 30px 70px rgba(22,24,29,0.35), 0 0 0 1px rgba(22,24,29,0.12)", transformOrigin: "0% 0%",
        transform: `translate(${(1 - pipIn) * -220}px, ${(1 - pipIn) * 260}px) scale(${0.6 + 0.4 * pipIn})`, opacity: Math.min(1, pipIn * 1.5) }}>
        <div style={{ height: 34, display: "flex", alignItems: "center", gap: 8, padding: "0 12px", fontFamily: UI, fontSize: 14, color: C.muted, borderBottom: "1px solid rgba(62,44,33,0.1)" }}>
          <LogoMark size={16} /> Roamly Flow timer
        </div>
        <div style={{ position: "relative", width: 360, height: 406 }}>
          {/* four real captures of the pop-out, one second apart (24:55 → 24:52) */}
          <Img src={staticFile(`shots/h1-pip-${Math.min(3, Math.max(0, tick))}.png`)} style={{ width: 360, height: 406, display: "block" }} />
        </div>
      </div>
      <Callout from={21.4} to={22.85} x={1390} y={640} tone="amber">Stays on top while you work</Callout>
    </AbsoluteFill>
  );
};

const ThemeGrid = () => {
  const f = useCurrentFrame();
  const o = window01(f, GRID_AT - 0.1, 25.6, 0.2, 0.35);
  return (
    <AbsoluteFill style={{ opacity: o }}>
      {THEMES.map(([id, name], i) => {
        const col = i % 4, row = Math.floor(i / 4);
        const p = prog(f, GRID_AT + i * 0.04, GRID_AT + 0.35 + i * 0.04, Easing.out(Easing.back(1.5)));
        return (
          <div key={id} style={{ position: "absolute", left: 150 + col * 410, top: 170 + row * 410, width: 380, opacity: Math.min(1, p * 1.4), transform: `scale(${0.8 + 0.2 * p})` }}>
            <div style={{ width: 380, height: 238, borderRadius: 14, overflow: "hidden", boxShadow: "0 18px 40px rgba(62,44,33,0.22), 0 0 0 1px rgba(62,44,33,0.1)" }}>
              <Img src={staticFile(`shots/t-${id}.png`)} style={{ width: 380, height: 238, display: "block" }} />
            </div>
            <div style={{ marginTop: 16, fontFamily: UI, fontSize: 26, fontWeight: 600, color: C.ink, textAlign: "center" }}>{name}</div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

const EndCard = () => {
  const f = useCurrentFrame();
  const o = prog(f, 25.25, 25.6, Easing.linear);
  const draw = prog(f, 25.4, 26.3, Easing.inOut(Easing.cubic));
  const word = prog(f, 25.85, 26.35, Easing.out(Easing.cubic));
  const tag = prog(f, 26.5, 26.95, Easing.out(Easing.cubic));
  const url = prog(f, 27.1, 27.55, Easing.out(Easing.back(1.6)));
  const sub = prog(f, 27.6, 28.0);
  return (
    <AbsoluteFill style={{ opacity: o, alignItems: "center", justifyContent: "center" }}>
      <Backdrop />
      <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 36 }}>
          <div style={{ transform: `scale(${0.85 + 0.15 * draw}) rotate(${(1 - draw) * -40}deg)`, filter: "drop-shadow(0 18px 30px rgba(22,24,29,0.25))" }}><LogoMark size={150} draw={draw} /></div>
          <div style={{ fontFamily: DISPLAY, fontSize: 130, fontWeight: 600, color: C.brown, letterSpacing: "-0.02em", opacity: word, transform: `translateX(${(1 - word) * -30}px)` }}>Roamly Flow</div>
        </div>
        <div style={{ marginTop: 34, fontFamily: DISPLAY, fontStyle: "italic", fontSize: 64, color: C.ink, opacity: tag, transform: `translateY(${(1 - tag) * 20}px)` }}>Study with flow.</div>
        <div style={{ marginTop: 46, padding: "18px 40px", borderRadius: 999, background: C.tile, color: "#F7F0E6", fontFamily: UI, fontSize: 42, fontWeight: 650,
          letterSpacing: "0.01em", opacity: url, transform: `scale(${0.8 + 0.2 * url})`, boxShadow: "0 20px 44px rgba(22,24,29,0.3)" }}>
          roamlyflow.com
        </div>
        <div style={{ marginTop: 28, fontFamily: MONO, fontSize: 22, letterSpacing: "0.22em", textTransform: "uppercase", color: C.brown, opacity: sub }}>
          Free to start · Focus timer for students
        </div>
      </div>
    </AbsoluteFill>
  );
};
