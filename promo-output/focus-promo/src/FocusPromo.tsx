import { AbsoluteFill, Audio, Easing, Img, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from "remotion";
import "./fonts";
import { DISPLAY, MONO, UI } from "./fonts";
import { Backdrop, BrowserWindow, C, Callout, Cursor, Headline, LogoMark, Screen, WIN, camAt, prog, t2f, window01, type Cam } from "./components";
import { DURATION, FPS, SFX, VO, s } from "./timeline";

const END = DURATION / FPS;

// Scene boundaries (seconds).
const T = {
  intro: 2.2, exams: 6.0, timers: 12.0, focus: 17.0, pets: 23.0, customize: 25.8, music: 29.4, pip: 35.0, desk: 36.3,
  themes: 40.45, cta: 44.4,
};

// Screenshot (CSS px) → video px, for a given camera.
function toVideo(cam: Cam, x: number, y: number) {
  const W = 1440, H = 900, z = cam.z;
  const tx = Math.min(0, Math.max(W - W * z, W / 2 - cam.x * z));
  const ty = Math.min(0, Math.max(H - H * z, H / 2 - cam.y * z));
  return { x: WIN.x + tx + x * z, y: WIN.y + WIN.chrome + ty + y * z };
}
const still = (x: number, y: number, z: number, t = 0): Cam => ({ t, x, y, z });

// Shots shown in the browser window, with camera keys in absolute seconds.
type Shot = { from: number; to: number; src: string; cam: Cam[]; fade?: number };
const SHOTS: Shot[] = [
  // Exams
  { from: 6.0, to: 7.65, src: "shots/b2-exam-list.png", cam: [{ t: 6.0, x: 620, y: 470, z: 1.15 }, { t: 7.2, x: 620, y: 470, z: 1.4 }], fade: 0 },
  { from: 7.6, to: 8.95, src: "shots/b5-filled.png", cam: [{ t: 7.6, x: 700, y: 420, z: 1.4 }, { t: 8.95, x: 700, y: 420, z: 1.48 }] },
  { from: 8.9, to: 10.15, src: "shots/c2-custom-typed.png", cam: [{ t: 8.9, x: 700, y: 420, z: 1.48 }, { t: 10.15, x: 700, y: 420, z: 1.52 }] },
  { from: 10.1, to: 12.05, src: "shots/c4-two-exams.png", cam: [{ t: 10.1, x: 720, y: 450, z: 1 }, { t: 10.9, x: 460, y: 300, z: 1.55 }] },
  // Timers
  { from: 12.0, to: 13.6, src: "shots/d1-timer-menu.png", cam: [{ t: 12.0, x: 720, y: 330, z: 1.15 }, { t: 13.3, x: 720, y: 300, z: 1.38 }] },
  { from: 13.55, to: 14.8, src: "shots/d2-timer-menu-scrolled.png", cam: [{ t: 13.55, x: 720, y: 640, z: 1.38 }, { t: 14.5, x: 720, y: 700, z: 1.45 }] },
  { from: 14.75, to: 15.65, src: "shots/d3b-countup-ready.png", cam: [still(560, 170, 1.45)] },
  { from: 15.6, to: 17.05, src: "shots/d5-countup-0.png", cam: [{ t: 15.6, x: 560, y: 170, z: 1.45 }, { t: 16.6, x: 380, y: 160, z: 1.75 }] },
  // Start
  { from: 17.0, to: 18.6, src: "shots/e0-classic-card.png", cam: [{ t: 17.0, x: 720, y: 330, z: 1.0 }, { t: 18.1, x: 800, y: 330, z: 1.1 }, { t: 18.6, x: 837, y: 336, z: 1.6 }] },
  // Customize Session: pets and garden off
  { from: 25.8, to: 26.95, src: "shots/f1-customize-on.png", cam: [{ t: 25.8, x: 720, y: 450, z: 1 }, { t: 26.4, x: 1230, y: 240, z: 1.55 }] },
  { from: 26.9, to: 27.85, src: "shots/f2-customize-pets-off.png", cam: [still(1230, 240, 1.55)] },
  { from: 27.8, to: 28.65, src: "shots/f3-customize-both-off.png", cam: [still(1230, 240, 1.55)] },
  { from: 28.6, to: 29.45, src: "shots/f4-focus-clean.png", cam: [{ t: 28.6, x: 720, y: 450, z: 1.25 }, { t: 29.45, x: 720, y: 450, z: 1.05 }] },
  // Music
  { from: 29.4, to: 33.55, src: "shots/m1-focus-sounds.png", cam: [{ t: 29.4, x: 720, y: 220, z: 1.15 }, { t: 30.8, x: 720, y: 220, z: 1.32 }, { t: 31.4, x: 720, y: 220, z: 1.32 }, { t: 32.2, x: 720, y: 560, z: 1.32 }] },
  { from: 33.5, to: 35.05, src: "shots/m3-apple.png", cam: [{ t: 33.5, x: 720, y: 230, z: 1.32 }, { t: 35.05, x: 720, y: 230, z: 1.42 }] },
  // Pop out (click)
  { from: 35.0, to: 36.5, src: "shots/e0-classic-card.png", cam: [{ t: 35.0, x: 720, y: 330, z: 1.0 }, { t: 35.8, x: 780, y: 380, z: 1.15 }] },
];

// The 8 themes, each held for 0.3 s, then a grid.
const THEMES: [string, string][] = [
  ["coffee", "Coffee Shop"], ["whitecoat", "White Coat"], ["library", "Library Night"], ["nightshift", "Night Shift"],
  ["deepsea", "Deep Sea"], ["sage", "Sage Calm"], ["sunset", "Sunset Study"], ["ocean", "Ocean Desk"],
];
const THEME_T0 = 40.65, THEME_STEP = 0.3, GRID_AT = THEME_T0 + THEMES.length * THEME_STEP; // 43.05

// The focus-mode clip (10 s of the real overlay, pets and garden animating) starts here.
const CLIP_AT = 18.4;

export const FocusPromo = () => {
  const f = useCurrentFrame();
  const sec = f / FPS;

  // Browser window: enters after the intro, steps aside for the desktop scene and the theme grid.
  const enter = prog(f, T.exams - 0.05, T.exams + 0.5, Easing.out(Easing.cubic));
  const toDesk = prog(f, T.desk - 0.05, T.desk + 0.3);
  const back = prog(f, T.themes - 0.1, T.themes + 0.2, Easing.out(Easing.cubic));
  const toGrid = prog(f, GRID_AT - 0.05, GRID_AT + 0.35);
  const away = sec < T.themes - 1 ? toDesk : 1 - back;
  const winOpacity = Math.min(enter, 1 - away, 1 - toGrid) * (sec < T.cta ? 1 : 0);
  const winScale = (0.92 + 0.08 * enter) * (1 - 0.12 * away) * (1 - 0.25 * toGrid);
  const winY = (1 - enter) * 260 + away * 60;

  // Focus mode video camera: full view, then onto companions + garden.
  const videoCam = camAt(f, [{ t: CLIP_AT, x: 720, y: 450, z: 1.25 }, { t: CLIP_AT + 0.5, x: 720, y: 450, z: 1 }, { t: T.pets, x: 720, y: 450, z: 1 },
    { t: T.pets + 0.8, x: 345, y: 190, z: 1.6 }, { t: T.customize, x: 345, y: 190, z: 1.68 }]);

  const shotLayer = SHOTS.filter((sh) => sec >= sh.from - 0.01 && sec < sh.to).map((sh) => {
    const fade = sh.fade ?? 0.1;
    const o = fade ? prog(f, sh.from, sh.from + fade, Easing.linear) : 1;
    return <Screen key={sh.src + sh.from} src={sh.src} cam={camAt(f, sh.cam)} opacity={o} />;
  });
  const themeIdx = Math.min(THEMES.length - 1, Math.max(0, Math.floor((sec - THEME_T0) / THEME_STEP)));
  const showThemes = sec >= T.themes - 0.15 && sec < T.cta;

  // Cursor targets use each shot's camera at click time.
  const cB2 = camAt(t2f(7.5), SHOTS[0].cam), cB5 = camAt(t2f(8.8), SHOTS[1].cam), cC2 = camAt(t2f(10.0), SHOTS[2].cam);
  const cD1 = camAt(t2f(13.45), SHOTS[4].cam), cD2 = camAt(t2f(14.65), SHOTS[5].cam);
  const cE0 = camAt(t2f(18.1), SHOTS[8].cam), cF = still(1230, 240, 1.55), cM1 = camAt(t2f(33.4), SHOTS[13].cam), cPop = camAt(t2f(35.95), SHOTS[15].cam);
  const P = (cam: Cam, x: number, y: number, t: number) => ({ t, ...toVideo(cam, x, y) });

  return (
    <AbsoluteFill style={{ fontFamily: UI }}>
      <Backdrop />
      <Hook />
      <Intro />

      {/* Browser window with the real app */}
      {winOpacity > 0 && (
        <div style={{ position: "absolute", inset: 0, opacity: winOpacity, transform: `translateY(${winY}px) scale(${winScale})`, transformOrigin: "960px 560px" }}>
          <BrowserWindow>
            {shotLayer}
            {sec >= CLIP_AT - 0.2 && sec < T.customize + 0.05 && (
              <Sequence from={s(CLIP_AT)} durationInFrames={s(T.customize + 0.05 - CLIP_AT)} layout="none">
                <Screen cam={videoCam} opacity={prog(f, CLIP_AT - 0.2, CLIP_AT + 0.1, Easing.linear)}
                  video={<OffthreadVideo src={staticFile("clips/focus-mode.mp4")} style={{ width: 1440, height: 900 }} muted />} />
              </Sequence>
            )}
            {showThemes && <Screen src={`shots/t-${THEMES[themeIdx][0]}.png`} cam={still(720, 450, 1)} />}
          </BrowserWindow>
        </div>
      )}

      {/* Headlines */}
      <Headline from={T.exams + 0.4} to={T.timers} kicker="Exam schedule">Board exams or your own, counted down.</Headline>
      <Headline from={T.timers} to={T.focus} kicker="Timers">Classic Pomodoro, or count up.</Headline>
      <Headline from={T.focus} to={T.pets} kicker="Focus mode">Just you and the task.</Headline>
      <Headline from={T.pets} to={T.customize} kicker="Companions">Your pets and garden, right on the timer.</Headline>
      <Headline from={T.customize} to={T.music} kicker="Customize session">Prefer it quiet? Switch them off.</Headline>
      <Headline from={T.music} to={T.pip} kicker="Music">Study channels, Spotify or Apple Music.</Headline>
      <Headline from={T.pip} to={T.themes} kicker="Pop-out timer · PC">Float the timer over your notes.</Headline>
      <Headline from={T.themes} to={T.cta} kicker="Themes">Make it yours.</Headline>

      {/* Callouts */}
      <Callout from={7.8} to={8.9} x={1270} y={830}>Pick from the list…</Callout>
      <Callout from={9.1} to={10.1} x={1270} y={830}>…or name your own</Callout>
      <Callout from={10.95} to={12.0} x={980} y={760} tone="amber">Live countdown for every exam</Callout>
      <Callout from={12.4} to={13.6} x={1330} y={840}>Classic 25/5</Callout>
      <Callout from={15.75} to={17.0} x={1180} y={480} tone="amber">Stopwatch mode</Callout>
      <Callout from={19.2} to={22.9} x={1250} y={930}>Everything else falls away</Callout>
      <Callout from={23.9} to={25.75} x={1425} y={286} tone="amber">← Pets keep you company</Callout>
      <Callout from={24.3} to={25.75} x={1425} y={500} tone="amber">← Your garden grows</Callout>
      <Callout from={29.9} to={31.3} x={1290} y={930}>7 built-in channels</Callout>
      <Callout from={32.2} to={33.45} x={1290} y={930}>Spotify</Callout>
      <Callout from={33.7} to={35.0} x={1290} y={930}>Apple Music</Callout>

      {/* Cursor */}
      <Cursor from={6.8} to={10.4} path={[
        { t: 6.8, x: 1300, y: 980 }, P(cB2, 499, 544, 7.5), P(cB5, 846, 540, 8.8), P(cC2, 846, 540, 10.0), { t: 10.4, x: 1150, y: 980 },
      ]} clicks={[7.6, 8.9, 10.1]} />
      <Cursor from={12.6} to={15.0} path={[{ t: 12.6, x: 1250, y: 980 }, P(cD1, 720, 176, 13.45), P(cD2, 720, 782, 14.65), { t: 15.0, x: 1250, y: 980 }]} clicks={[13.55, 14.75]} />
      <Cursor from={17.3} to={18.4} path={[{ t: 17.3, x: 1400, y: 900 }, P(cE0, 837, 336, 18.0)]} clicks={[18.1]} />
      <Cursor from={26.3} to={28.4} path={[{ t: 26.3, x: 1500, y: 800 }, P(cF, 1393, 145, 26.8), P(cF, 1393, 215, 27.7)]} clicks={[26.9, 27.8]} />
      <Cursor from={32.7} to={33.8} path={[{ t: 32.7, x: 1300, y: 950 }, P(cM1, 980, 512, 33.4)]} clicks={[33.5]} />
      <Cursor from={35.2} to={36.3} path={[{ t: 35.2, x: 1350, y: 950 }, P(cPop, 788, 399, 35.9)]} clicks={[36.0]} />

      {/* Desktop with the pop-out timer */}
      {sec >= T.desk - 0.05 && sec < T.themes + 0.2 && <Desktop />}

      {/* Theme grid */}
      {sec >= GRID_AT - 0.1 && sec < T.cta + 0.3 && <ThemeGrid />}

      {/* End card */}
      {sec >= T.cta - 0.1 && <EndCard />}

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
  const fadeOut = interpolate(sec, [END - 1.8, END], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return base * fadeIn * fadeOut;
}

const Hook = () => {
  const f = useCurrentFrame();
  const o = window01(f, 0.05, T.intro + 0.05, 0.3, 0.35);
  if (o <= 0) return null;
  const words = ["Your", "exam", "has", "a", "date."];
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: o }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 26, transform: `translateY(${-prog(f, T.intro - 0.35, T.intro + 0.05) * 80}px)` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontFamily: DISPLAY, fontSize: 124, fontWeight: 600, color: C.ink, letterSpacing: "-0.02em" }}>
          {words.map((w, i) => {
            const p = prog(f, 0.42 + i * 0.17, 0.75 + i * 0.17, Easing.out(Easing.cubic));
            return <span key={w} style={{ marginRight: 16, opacity: p, transform: `translateY(${(1 - p) * 40}px)`, color: w === "date." ? C.brown : C.ink, fontStyle: w === "date." ? "italic" : "normal" }}>{w}</span>;
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// Introduces the product: the logo draws, the wordmark and the site's own tagline land.
const Intro = () => {
  const f = useCurrentFrame();
  const o = window01(f, T.intro, T.exams + 0.15, 0.25, 0.4);
  if (o <= 0) return null;
  const draw = prog(f, T.intro + 0.1, T.intro + 1.0, Easing.inOut(Easing.cubic));
  const word = prog(f, T.intro + 0.5, T.intro + 1.0, Easing.out(Easing.cubic));
  const tag = prog(f, T.intro + 1.4, T.intro + 1.85, Easing.out(Easing.cubic));
  const chips = ["Focus timer", "Exam countdowns", "Study planner"];
  const lift = prog(f, T.exams - 0.35, T.exams + 0.15) * -120;
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: o, transform: `translateY(${lift}px)` }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ fontFamily: MONO, fontSize: 24, letterSpacing: "0.32em", textTransform: "uppercase", color: C.brown, opacity: word, marginBottom: 30 }}>Meet</div>
        <div style={{ display: "flex", alignItems: "center", gap: 36 }}>
          <div style={{ transform: `scale(${0.8 + 0.2 * draw}) rotate(${(1 - draw) * -40}deg)`, filter: "drop-shadow(0 18px 30px rgba(22,24,29,0.25))" }}><LogoMark size={150} draw={draw} /></div>
          <div style={{ fontFamily: DISPLAY, fontSize: 140, fontWeight: 600, color: C.brown, letterSpacing: "-0.02em", opacity: word, transform: `translateX(${(1 - word) * -30}px)` }}>Roamly Flow</div>
        </div>
        <div style={{ marginTop: 36, fontFamily: DISPLAY, fontSize: 54, color: C.ink, opacity: tag, transform: `translateY(${(1 - tag) * 20}px)` }}>The Pomodoro method built for PA school.</div>
        <div style={{ marginTop: 34, display: "flex", gap: 16 }}>
          {chips.map((c, i) => {
            const p = prog(f, T.intro + 2.0 + i * 0.18, T.intro + 2.4 + i * 0.18, Easing.out(Easing.back(1.8)));
            return <span key={c} style={{ opacity: p, transform: `scale(${0.8 + 0.2 * p})`, padding: "12px 24px", borderRadius: 999, fontFamily: UI, fontSize: 26, fontWeight: 600,
              background: "rgba(251,247,241,0.85)", border: "1.5px solid rgba(138,95,68,0.3)", color: C.brown }}>{c}</span>;
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
  const o = window01(f, T.desk, T.themes + 0.1, 0.3, 0.3);
  const notesIn = prog(f, T.desk, T.desk + 0.45, Easing.out(Easing.cubic));
  const pipIn = prog(f, T.desk + 0.5, T.desk + 1.0, Easing.out(Easing.back(1.6)));
  const tick = Math.floor((f - t2f(T.desk + 0.5)) / FPS);
  return (
    <AbsoluteFill style={{ opacity: o }}>
      {/* notes window (a prop) */}
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
      <Callout from={T.desk + 1.1} to={T.themes - 0.1} x={1390} y={640} tone="amber">Stays on top while you work</Callout>
    </AbsoluteFill>
  );
};

const ThemeGrid = () => {
  const f = useCurrentFrame();
  const o = window01(f, GRID_AT - 0.1, T.cta + 0.3, 0.2, 0.35);
  return (
    <AbsoluteFill style={{ opacity: o }}>
      {THEMES.map(([id, name], i) => {
        const col = i % 4, row = Math.floor(i / 4);
        const p = prog(f, GRID_AT + i * 0.05, GRID_AT + 0.4 + i * 0.05, Easing.out(Easing.back(1.5)));
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
  const c = T.cta;
  const o = prog(f, c - 0.05, c + 0.3, Easing.linear);
  const draw = prog(f, c + 0.1, c + 1.0, Easing.inOut(Easing.cubic));
  const word = prog(f, c + 0.55, c + 1.05, Easing.out(Easing.cubic));
  const tag = prog(f, c + 1.6, c + 2.05, Easing.out(Easing.cubic));
  const url = prog(f, 47.4, 47.85, Easing.out(Easing.back(1.6)));
  const sub = prog(f, 47.9, 48.3);
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
