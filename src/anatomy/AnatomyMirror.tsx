// Anatomy Mirror: study head & neck anatomy on your own face, live.
// The camera feed is processed on the device (MediaPipe + three.js) and never
// uploaded. Anatomy: BodyParts3D (CC BY-SA 2.1 JP), one adult scaled to you.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Camera, Eye, Hand, Layers, Loader2, Scan, SlidersHorizontal, Sparkles, Tag, Target, X } from "lucide-react";
import type { AnatomyEngine, Fit, LabelSpot, Layer, Look } from "./engine";

type ViewMode = "full" | "split" | "lens";
type QuizSet = "bones" | "muscles" | "brain";
const QUIZ_LAYERS: Record<QuizSet, Layer[]> = { bones: ["skull", "jaw"], muscles: ["muscles"], brain: ["brain"] };
const QUIZ_NAMES: Record<QuizSet, string> = { bones: "Bones", muscles: "Facial muscles", brain: "Brain" };
const LAYER_NAMES: Record<Layer, string> = { skull: "Skull", jaw: "Jaw & teeth", muscles: "Muscles", brain: "Brain", eyes: "Eyes" };
const QUIZ_LENGTH = 8;
const DEFAULT_FIT: Fit = { scale: 1, up: 0, depth: 0 };

type Quiz = { set: QuizSet; queue: string[]; index: number; score: number; feedback: { ok: boolean; text: string } | null; done: boolean };

function shuffle<T>(a: T[]): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
}

export function AnatomyMirror({ onBack, onLogMinutes, taskTitle }: {
  onBack: () => void;
  onLogMinutes: (minutes: number) => void;
  taskTitle?: string | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tintRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<AnatomyEngine | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const [status, setStatus] = useState<"idle" | "starting" | "running" | "error">("idle");
  const [message, setMessage] = useState<string>("");
  const [look, setLook] = useState<Look>("xray");
  const [layers, setLayers] = useState<Layer[]>(["skull", "jaw", "eyes"]);
  const [hands, setHands] = useState(true);
  const [mode, setMode] = useState<ViewMode>("full");
  const [showLabels, setShowLabels] = useState(false);
  const [fit, setFit] = useState<Fit>(DEFAULT_FIT);
  const [opacity, setOpacity] = useState(1);
  const [feather, setFeather] = useState(0.35);
  const [panel, setPanel] = useState<"layers" | "fit" | null>("layers");
  const [labels, setLabels] = useState<LabelSpot[]>([]);
  const [tracking, setTracking] = useState({ face: false, hands: 0 });
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [studySeconds, setStudySeconds] = useState(0);
  const [saved, setSaved] = useState<number | null>(null);
  const modeRef = useRef(mode); modeRef.current = mode;
  const featherRef = useRef(feather); featherRef.current = feather;
  // The stage takes the camera's own shape: cropping the frame would break the fit.
  const [aspect, setAspect] = useState(16 / 9);
  // Tapping a part outside a quiz names it for a few seconds.
  const [picked, setPicked] = useState<string | null>(null);
  // Label positions are needed for the labels toggle and for quiz feedback, and for a tapped part.
  const labelsOnRef = useRef(showLabels); labelsOnRef.current = showLabels || (!!quiz && !quiz.done) || !!picked;
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = stageRef.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setStageSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (!picked) return;
    const id = window.setTimeout(() => setPicked(null), 3500);
    return () => window.clearTimeout(id);
  }, [picked]);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    engineRef.current?.dispose();
    engineRef.current = null;
  }, []);
  useEffect(() => stop, [stop]);

  // Study time: counts while the mirror is running and a face is in view.
  useEffect(() => {
    if (status !== "running") return;
    const id = window.setInterval(() => { if (document.visibilityState === "visible") setStudySeconds((s) => s + 1); }, 1000);
    return () => window.clearInterval(id);
  }, [status]);

  const start = async () => {
    setStatus("starting"); setMessage("Asking for your camera…");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error("no_camera_api"), { name: "NotSupportedError" });
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current!, canvas = canvasRef.current!;
      video.srcObject = stream;
      await video.play();
      if (video.videoWidth && video.videoHeight) setAspect(video.videoWidth / video.videoHeight);
      const { AnatomyEngine } = await import("./engine");
      const engine = new AnatomyEngine(canvas, video);
      engineRef.current = engine;
      await engine.load(setMessage);
      engine.setLook(look); engine.setLayers(layers); engine.setHands(hands); engine.setFit(fit); engine.setOpacity(opacity);
      setStatus("running"); setMessage("");
      let lastUi = 0;
      const loop = () => {
        const f = engine.tick();
        const now = performance.now();
        // Lens follows the fingertip every frame (style only, no React render).
        const c = canvasRef.current, t = tintRef.current;
        if (c && t) {
          const m = maskFor(modeRef.current, featherRef.current, f.fingertip);
          for (const el of [c, t]) { el.style.setProperty("mask-image", m); el.style.setProperty("-webkit-mask-image", m); }
        }
        if (now - lastUi > 120) {
          lastUi = now;
          setTracking((prev) => (prev.face === f.face && prev.hands === f.hands ? prev : { face: f.face, hands: f.hands }));
          setLabels(labelsOnRef.current ? f.labels : []);
        }
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    } catch (e) {
      stop();
      const name = (e as { name?: string })?.name;
      setStatus("error");
      setMessage(
        name === "NotAllowedError" ? "Camera access was blocked. Allow the camera for roamlyflow.com in your browser settings, then try again."
          : name === "NotFoundError" || name === "OverconstrainedError" ? "No camera was found on this device."
            : name === "NotSupportedError" ? "This browser can't open the camera here. Try a recent Chrome, Edge, Safari or Firefox."
              : "The mirror couldn't start. Check your connection and try again.",
      );
    }
  };

  // Push settings to the engine as they change.
  useEffect(() => { engineRef.current?.setLook(look); }, [look]);
  useEffect(() => { engineRef.current?.setLayers(layers); }, [layers]);
  useEffect(() => { engineRef.current?.setHands(hands); }, [hands]);
  useEffect(() => { engineRef.current?.setFit(fit); }, [fit]);
  useEffect(() => { engineRef.current?.setOpacity(opacity); }, [opacity]);
  useEffect(() => { engineRef.current?.setFocusLayers(quiz && !quiz.done ? QUIZ_LAYERS[quiz.set] : null); }, [quiz]);

  const toggleLayer = (l: Layer) => setLayers((cur) => (cur.includes(l) ? cur.filter((x) => x !== l) : [...cur, l]));

  const startQuiz = (set: QuizSet) => {
    const engine = engineRef.current; if (!engine) return;
    const pool = engine.labelsFor(QUIZ_LAYERS[set]);
    setShowLabels(false);
    setQuiz({ set, queue: shuffle(pool).slice(0, QUIZ_LENGTH), index: 0, score: 0, feedback: null, done: false });
  };

  // Quiz taps: the stage is mirrored, so flip x back to video coordinates.
  const onStageTap = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!engineRef.current) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = 1 - (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    if (!quiz || quiz.done) {
      setPicked(engineRef.current.pick(x, y, layers)?.label ?? null);
      return;
    }
    const hit = engineRef.current.pick(x, y, QUIZ_LAYERS[quiz.set]);
    if (!hit) return;
    const target = quiz.queue[quiz.index];
    const ok = hit.label === target;
    const next = quiz.index + 1;
    setQuiz({
      ...quiz, score: quiz.score + (ok ? 1 : 0), index: next, done: next >= quiz.queue.length,
      feedback: { ok, text: ok ? `Yes, that's the ${target.toLowerCase()}.` : `That's the ${hit.label.toLowerCase()}. The ${target.toLowerCase()} is labelled now.` },
    });
  };

  const minutes = Math.floor(studySeconds / 60);
  const logTime = () => {
    if (minutes < 1) return;
    onLogMinutes(minutes);
    setSaved(minutes);
    setStudySeconds((s) => s - minutes * 60);
  };

  const quizTarget = quiz && !quiz.done ? quiz.queue[quiz.index] : null;
  // During a quiz only a missed answer is labelled; otherwise labels follow the toggle.
  const shownLabels = useMemo(() => {
    if (quiz && !quiz.done) {
      if (!quiz.feedback || quiz.feedback.ok) return [];
      const missed = quiz.queue[quiz.index - 1];
      return labels.filter((l) => l.label === missed);
    }
    if (showLabels) return declutter(labels, stageSize, picked);
    return picked ? labels.filter((l) => l.label === picked) : [];
  }, [labels, quiz, showLabels, picked, stageSize]);

  const running = status === "running";
  return (
    <section aria-label="Anatomy Mirror" className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <button onClick={() => { stop(); onBack(); }} className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground transition hover:text-foreground">
            <ArrowLeft size={13} /> Back to focus
          </button>
          <h1 className="font-display text-2xl font-semibold">Anatomy Mirror</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            See the skull, jaw, facial muscles and brain pinned to your own head as you move. Open your mouth and the jaw opens; hold up a hand to see its bones. Tap any part to name it.
          </p>
        </div>
        {running && (
          <div className="flex items-center gap-2">
            {minutes >= 1 && (
              <button onClick={logTime} className="rounded-full gradient-primary px-4 py-2 text-xs font-semibold text-white shadow-glow">
                Save {minutes} min{taskTitle ? ` to ${taskTitle.length > 24 ? `${taskTitle.slice(0, 24)}…` : taskTitle}` : " to Analytics"}
              </button>
            )}
            {saved !== null && minutes < 1 && <span className="text-xs text-muted-foreground">Saved {saved} min ✓</span>}
          </div>
        )}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_17rem]">
        {/* Stage */}
        <div ref={stageRef} className="relative overflow-hidden rounded-3xl border border-border bg-black shadow-sm" style={{ aspectRatio: String(aspect) }}
          onPointerDown={onStageTap}>
          <video ref={videoRef} playsInline muted className="absolute inset-0 h-full w-full object-fill" style={{ transform: "scaleX(-1)" }} />
          <div ref={tintRef} aria-hidden="true" className={`pointer-events-none absolute inset-0 transition-opacity ${running && look === "xray" ? "opacity-100" : "opacity-0"}`}
            style={{ transform: "scaleX(-1)", background: "rgba(2, 8, 20, 0.62)" }} />
          <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" style={{ transform: "scaleX(-1)" }} />
          {/* Labels are not mirrored (text stays readable); positions are flipped instead. */}
          {shownLabels.map((l) => (
            <span key={l.label} className={`pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium text-white shadow ${l.label === picked ? "bg-primary" : "bg-black/60"}`}
              style={{ left: `${(1 - l.x) * 100}%`, top: `${l.y * 100}%` }}>{l.label}</span>
          ))}

          {!running && (
            <div className="absolute inset-0 grid place-items-center bg-gradient-to-b from-black/70 to-black/85 p-6 text-center text-white">
              <div className="max-w-sm">
                <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl gradient-primary shadow-glow"><Scan size={26} /></div>
                <p className="mt-4 font-display text-xl font-semibold">Look inside your own head</p>
                <p className="mt-2 text-sm text-white/75">Your camera feed is processed on this device and never uploaded.</p>
                {status === "error" && <p role="alert" className="mt-3 rounded-xl bg-red-500/20 px-3 py-2 text-xs text-red-100">{message}</p>}
                <button onClick={() => void start()} disabled={status === "starting"}
                  className="mt-5 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black disabled:opacity-60">
                  {status === "starting" ? <><Loader2 size={16} className="animate-spin" /> {message || "Starting…"}</> : <><Camera size={16} /> {status === "error" ? "Try again" : "Turn on camera"}</>}
                </button>
              </div>
            </div>
          )}

          {running && !tracking.face && (
            <p className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs text-white">Face the camera so the mirror can find you</p>
          )}
          {running && mode === "lens" && tracking.hands === 0 && (
            <p className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs text-white">Hold up a hand: the lens follows your index finger</p>
          )}
          {quizTarget && (
            <div className="pointer-events-none absolute inset-x-0 top-3 mx-auto w-fit max-w-[90%] rounded-2xl bg-black/70 px-4 py-2 text-center text-white shadow-lg">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/70">{QUIZ_NAMES[quiz!.set]} · {quiz!.index + 1}/{quiz!.queue.length}</p>
              <p className="text-sm font-semibold">Tap the {quizTarget.toLowerCase()}</p>
              {quiz!.feedback && <p className={`mt-0.5 text-xs ${quiz!.feedback.ok ? "text-emerald-300" : "text-amber-200"}`}>{quiz!.feedback.text}</p>}
            </div>
          )}
        </div>

        {/* Controls */}
        <aside className="space-y-3">
          <div className="grid grid-cols-2 gap-1 rounded-2xl border border-border bg-card/70 p-1">
            {(["xray", "solid"] as Look[]).map((l) => (
              <button key={l} onClick={() => setLook(l)} aria-pressed={look === l}
                className={`rounded-xl py-2 text-xs font-semibold transition ${look === l ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                {l === "xray" ? "X-ray" : "Solid"}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-1 rounded-2xl border border-border bg-card/70 p-1">
            {(["full", "split", "lens"] as ViewMode[]).map((m) => (
              <button key={m} onClick={() => setMode(m)} aria-pressed={mode === m}
                className={`rounded-xl py-2 text-xs font-semibold transition ${mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                {m === "full" ? "Full" : m === "split" ? "Half" : "Lens"}
              </button>
            ))}
          </div>

          <div className="rounded-2xl border border-border bg-card/70">
            <button onClick={() => setPanel(panel === "layers" ? null : "layers")} className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium">
              <Layers size={15} className="text-primary" /> Layers
            </button>
            {panel === "layers" && (
              <div className="space-y-1.5 px-3 pb-3">
                {(["skull", "jaw", "muscles", "brain", "eyes"] as Layer[]).map((l) => (
                  <label key={l} className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-secondary/50">
                    {LAYER_NAMES[l]}
                    <input type="checkbox" checked={layers.includes(l)} onChange={() => toggleLayer(l)} className="h-4 w-4 accent-[hsl(var(--primary))]" />
                  </label>
                ))}
                <label className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-secondary/50">
                  <span className="flex items-center gap-1.5"><Hand size={14} /> Hand bones</span>
                  <input type="checkbox" checked={hands} onChange={() => setHands(!hands)} className="h-4 w-4 accent-[hsl(var(--primary))]" />
                </label>
                <label className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-secondary/50">
                  <span className="flex items-center gap-1.5"><Tag size={14} /> Labels</span>
                  <input type="checkbox" checked={showLabels} onChange={() => setShowLabels(!showLabels)} disabled={!!quiz && !quiz.done} className="h-4 w-4 accent-[hsl(var(--primary))]" />
                </label>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-border bg-card/70">
            <button onClick={() => setPanel(panel === "fit" ? null : "fit")} className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium">
              <SlidersHorizontal size={15} className="text-primary" /> Fit to your head
            </button>
            {panel === "fit" && (
              <div className="space-y-3 px-4 pb-4 text-xs">
                <Slider label="Size" min={0.85} max={1.15} step={0.005} value={fit.scale} onChange={(v) => setFit({ ...fit, scale: v })} />
                <Slider label="Up / down" min={-1.5} max={1.5} step={0.05} value={fit.up} onChange={(v) => setFit({ ...fit, up: v })} />
                <Slider label="Depth" min={-2} max={2} step={0.05} value={fit.depth} onChange={(v) => setFit({ ...fit, depth: v })} />
                <Slider label="Opacity" min={0.2} max={1} step={0.05} value={opacity} onChange={setOpacity} />
                <Slider label="Edge softness" min={0} max={1} step={0.05} value={feather} onChange={setFeather} />
                <button onClick={() => { setFit(DEFAULT_FIT); setOpacity(1); setFeather(0.35); }} className="text-muted-foreground underline-offset-2 hover:underline">Reset</button>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-border bg-card/70 p-4">
            <p className="flex items-center gap-2 text-sm font-medium"><Target size={15} className="text-primary" /> Quiz yourself</p>
            {!quiz || quiz.done ? (
              <>
                {quiz?.done && (
                  <p className="mt-2 text-sm"><Sparkles size={14} className="mr-1 inline text-primary" />{quiz.score}/{quiz.queue.length} on {QUIZ_NAMES[quiz.set].toLowerCase()}.</p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">Tap the structure it names, right on your own face.</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {(Object.keys(QUIZ_NAMES) as QuizSet[]).map((s) => (
                    <button key={s} onClick={() => startQuiz(s)} disabled={!running}
                      className="rounded-full border border-border px-3 py-1.5 text-xs font-medium transition hover:border-primary/40 disabled:opacity-40">{QUIZ_NAMES[s]}</button>
                  ))}
                </div>
              </>
            ) : (
              <div className="mt-2 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Score {quiz.score}/{quiz.index}</span>
                <button onClick={() => setQuiz(null)} className="flex items-center gap-1 text-muted-foreground hover:text-foreground"><X size={12} /> End</button>
              </div>
            )}
          </div>
        </aside>
      </div>

      <p className="mt-4 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
        <Eye size={13} className="mt-0.5 shrink-0" />
        <span>
          Shows where structures typically sit: a real dataset of one adult, scaled to your head. It isn't a scan of you and isn't a medical tool.
          Anatomy models: <a href="https://lifesciencedb.jp/bp3d/" target="_blank" rel="noreferrer" className="underline">BodyParts3D</a>, © The Database Center for Life Science,
          {" "}<a href="https://creativecommons.org/licenses/by-sa/2.1/jp/deed.en" target="_blank" rel="noreferrer" className="underline">CC BY-SA 2.1 JP</a> (simplified and re-aligned).
          Tracking by MediaPipe.
        </span>
      </p>
    </section>
  );
}

/** Keeps labels from piling up: each is nudged up or down until it clears the ones
 *  already placed, and dropped if there is no room (tap a part to name it instead). */
function declutter(labels: LabelSpot[], size: { w: number; h: number }, first: string | null): LabelSpot[] {
  if (!size.w || !size.h) return labels;
  const H = 22, placed: { x0: number; x1: number; y0: number; y1: number }[] = [], out: LabelSpot[] = [];
  const order = [...labels].sort((a, b) => (a.label === first ? -1 : b.label === first ? 1 : a.y - b.y));
  for (const l of order) {
    const w = l.label.length * 6.2 + 18, cx = (1 - l.x) * size.w, cy0 = l.y * size.h;
    for (const dy of [0, -H, H, -2 * H, 2 * H]) {
      const cy = cy0 + dy;
      const box = { x0: cx - w / 2, x1: cx + w / 2, y0: cy - H / 2, y1: cy + H / 2 };
      if (box.y0 < 0 || box.y1 > size.h) continue;
      if (placed.some((p) => box.x0 < p.x1 && box.x1 > p.x0 && box.y0 < p.y1 && box.y1 > p.y0)) continue;
      placed.push(box);
      out.push({ ...l, y: cy / size.h });
      break;
    }
  }
  return out;
}

function Slider({ label, min, max, step, value, onChange }: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="flex justify-between text-muted-foreground"><span>{label}</span><span className="font-mono">{value.toFixed(2)}</span></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-1 w-full accent-[hsl(var(--primary))]" />
    </label>
  );
}

// CSS mask for the mixed-reality views, in unmirrored video coordinates.
function maskFor(mode: ViewMode, feather: number, tip: { x: number; y: number } | null): string {
  if (mode === "full") return "none";
  const f = 2 + feather * 18; // percent of width
  if (mode === "split") return `linear-gradient(to right, black ${50 - f / 2}%, transparent ${50 + f / 2}%)`;
  if (!tip) return "linear-gradient(transparent, transparent)";
  const r = 15;
  return `radial-gradient(circle at ${tip.x * 100}% ${tip.y * 100}%, black ${r}%, transparent ${r + f}%)`;
}
