// Admin BI dashboard — Music library.
//
// The focus channels the app offers are defined by FOCUS_SOUNDS in
// focusSounds.ts; the tracks behind them live in public.music_tracks. This page
// is the one place to see both together: every channel as a collapsible row
// showing its track count and total runtime, expanding into the full track list
// with per-track preview, rename, enable/disable, and delete — plus an upload
// form that pushes a file straight to the `focus-music` Storage bucket.
//
// Two of the seven channels (Café, Calm) play these recordings today. The other
// five synthesise audio live in the browser and ignore the catalog until the
// player is wired to prefer real tracks — the header badge says so per channel
// rather than letting an admin upload into what looks like a void.

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Music, Play, Pause, Trash2, Upload, Eye, EyeOff, Loader2 } from "lucide-react";
import {
  adminListMusicTracks, adminUploadMusicTrack, adminUpdateMusicTrack, adminDeleteMusicTrack,
  MUSIC_MAX_BYTES, type MusicTrackRow,
} from "./db";
import { FOCUS_SOUNDS, type FocusSoundId } from "./focusSounds";
import { Modal } from "./Modal";

// Channels whose audio is generated live by WebAudio. They have no playlist
// today, so uploads sit in the catalog unused until the player prefers tracks.
const GENERATIVE: ReadonlySet<string> = new Set<FocusSoundId>(["melody", "beats", "piano", "ambient", "rain"]);

function fmtDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// "1 h 24 min" / "48 min" — channel-level runtime, the number that actually
// tells you whether a station repeats inside a session.
function fmtTotal(seconds: number): string {
  if (seconds <= 0) return "0 min";
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)} h ${mins % 60} min`;
}

export function MusicPage() {
  const [tracks, setTracks] = useState<MusicTrackRow[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [open, setOpen] = useState<string | null>(null);
  const [uploadFor, setUploadFor] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<MusicTrackRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // One shared preview element: starting a second track stops the first.
  const previewRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);

  const load = () => {
    setStatus("loading");
    adminListMusicTracks()
      .then((rows) => { setTracks(rows); setStatus("ready"); })
      .catch(() => setStatus("error"));
  };
  useEffect(load, []);

  // Stop and release the preview when leaving the page.
  useEffect(() => () => { previewRef.current?.pause(); previewRef.current = null; }, []);

  const preview = (t: MusicTrackRow) => {
    if (playing === t.id) { previewRef.current?.pause(); setPlaying(null); return; }
    previewRef.current?.pause();
    const el = new Audio(t.url);
    el.onended = () => setPlaying(null);
    el.onerror = () => { setPlaying(null); setNotice(`Couldn't play "${t.title}" — the file may be missing.`); };
    previewRef.current = el;
    void el.play().then(() => setPlaying(t.id)).catch(() => {
      setPlaying(null);
      setNotice("The browser blocked playback. Click again.");
    });
  };

  const byChannel = useMemo(() => {
    const map = new Map<string, MusicTrackRow[]>();
    for (const s of FOCUS_SOUNDS) map.set(s.id, []);
    for (const t of tracks) {
      // A row whose channel is no longer in FOCUS_SOUNDS still needs a home,
      // or it would silently vanish from the admin view.
      if (!map.has(t.channel)) map.set(t.channel, []);
      map.get(t.channel)!.push(t);
    }
    return map;
  }, [tracks]);

  const toggleActive = async (t: MusicTrackRow) => {
    setBusyId(t.id);
    // Optimistic: the row flips immediately, and a failure reloads the truth.
    setTracks((prev) => prev.map((x) => (x.id === t.id ? { ...x, active: !x.active } : x)));
    const { error } = await adminUpdateMusicTrack(t.id, { active: !t.active });
    setBusyId(null);
    if (error) { setNotice(error); load(); }
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    const t = confirmDelete;
    setBusyId(t.id);
    const { error } = await adminDeleteMusicTrack(t.id);
    setBusyId(null);
    setConfirmDelete(null);
    if (error) { setNotice(error); return; }
    if (playing === t.id) { previewRef.current?.pause(); setPlaying(null); }
    setTracks((prev) => prev.filter((x) => x.id !== t.id));
  };

  const totalTracks = tracks.filter((t) => t.active).length;
  const totalSeconds = tracks.filter((t) => t.active).reduce((a, t) => a + (t.duration_seconds ?? 0), 0);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="rounded-2xl border border-border bg-card/70 px-4 py-2.5">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Active tracks</p>
          <p className="font-display text-xl font-semibold">{totalTracks}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card/70 px-4 py-2.5">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Total runtime</p>
          <p className="font-display text-xl font-semibold">{fmtTotal(totalSeconds)}</p>
        </div>
        <button onClick={load} className="ml-auto rounded-full border border-border bg-card px-4 py-2 text-sm text-muted-foreground transition hover:border-primary/40">
          Refresh
        </button>
      </div>

      {notice && (
        <div role="status" className="mb-3 flex items-start gap-2 rounded-2xl border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-400">
          <span className="flex-1">{notice}</span>
          <button onClick={() => setNotice(null)} className="shrink-0 text-xs underline-offset-2 hover:underline">Dismiss</button>
        </div>
      )}

      {status === "error" && <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">Couldn't load the music library.</div>}
      {status === "loading" && <div className="space-y-2">{Array.from({ length: 7 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-2xl bg-border/40" />)}</div>}

      {status === "ready" && (
        <div className="space-y-2">
          {[...byChannel.entries()].map(([channel, rows]) => {
            const meta = FOCUS_SOUNDS.find((s) => s.id === channel);
            const active = rows.filter((r) => r.active);
            const seconds = active.reduce((a, r) => a + (r.duration_seconds ?? 0), 0);
            const expanded = open === channel;
            const generative = GENERATIVE.has(channel);

            return (
              <section key={channel} className="overflow-hidden rounded-2xl border border-border bg-card/70">
                <button onClick={() => setOpen(expanded ? null : channel)} aria-expanded={expanded}
                  className="flex w-full items-center gap-3 p-4 text-left transition hover:bg-primary/5">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Music size={18} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{meta?.name ?? channel}</span>
                      {generative && (
                        <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                          title="This channel synthesises audio live in the browser and does not play catalog tracks yet.">
                          Generative
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                      {active.length} track{active.length === 1 ? "" : "s"} · {fmtTotal(seconds)}
                      {rows.length > active.length ? ` · ${rows.length - active.length} hidden` : ""}
                      {meta?.hint ? ` · ${meta.hint}` : ""}
                    </span>
                  </span>
                  <ChevronDown size={18} className={`shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
                </button>

                {expanded && (
                  <div className="border-t border-border px-4 pb-4 pt-3">
                    {generative && (
                      <p className="mb-3 rounded-xl border border-dashed border-border bg-background/40 p-2.5 text-[11px] text-muted-foreground">
                        This channel currently generates its audio live and ignores the catalog. Tracks added here are stored and ready, but won't play until the player is wired to prefer real tracks on this channel.
                      </p>
                    )}

                    <button onClick={() => setUploadFor(channel)}
                      className="mb-3 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition active:scale-95">
                      <Upload size={15} /> Add music to {meta?.name ?? channel}
                    </button>

                    {rows.length === 0 ? (
                      <p className="rounded-xl border border-dashed border-border bg-card/50 p-3 text-xs text-muted-foreground">No tracks on this channel yet.</p>
                    ) : (
                      <ul className="divide-y divide-border rounded-xl border border-border">
                        {rows.map((t) => (
                          <li key={t.id} className={`flex items-center gap-2 p-2.5 ${t.active ? "" : "opacity-50"}`}>
                            <button onClick={() => preview(t)} aria-label={playing === t.id ? `Pause ${t.title}` : `Preview ${t.title}`}
                              className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border text-muted-foreground transition hover:border-primary/50 hover:text-primary">
                              {playing === t.id ? <Pause size={14} /> : <Play size={14} />}
                            </button>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium">{t.title}</span>
                              <span className="block truncate text-[11px] text-muted-foreground">
                                {t.artist} · {fmtDuration(t.duration_seconds)} · {t.license}
                                {t.source === "bundled" ? " · bundled" : ""}
                              </span>
                            </span>
                            <button onClick={() => void toggleActive(t)} disabled={busyId === t.id}
                              aria-label={t.active ? `Hide ${t.title}` : `Show ${t.title}`} title={t.active ? "Hide from players" : "Show to players"}
                              className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border text-muted-foreground transition hover:border-primary/50 hover:text-primary disabled:opacity-40">
                              {t.active ? <Eye size={14} /> : <EyeOff size={14} />}
                            </button>
                            <button onClick={() => setConfirmDelete(t)} disabled={busyId === t.id}
                              aria-label={`Delete ${t.title}`}
                              className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border text-muted-foreground transition hover:border-destructive/50 hover:text-destructive disabled:opacity-40">
                              <Trash2 size={14} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      {uploadFor && (
        <UploadDialog channel={uploadFor} onClose={() => setUploadFor(null)}
          onDone={() => { setUploadFor(null); load(); }} />
      )}

      {confirmDelete && (
        <Modal label="Delete track" onClose={() => { if (!busyId) setConfirmDelete(null); }}
          cardClassName="w-full max-w-sm rounded-3xl border border-border bg-card p-6 shadow-xl">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-destructive/10 text-destructive"><Trash2 size={20} /></div>
          <h3 className="mt-4 font-display text-xl font-semibold">Delete "{confirmDelete.title}"?</h3>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {confirmDelete.source === "upload"
              ? "The audio file is removed from storage too. This can't be undone — use hide instead if you only want it out of rotation."
              : "This is a bundled track shipped with the app. Removing it here takes it out of rotation; the file stays in the repo."}
          </p>
          <div className="mt-5 flex gap-2">
            <button onClick={() => setConfirmDelete(null)} disabled={!!busyId}
              className="flex-1 rounded-full border border-border bg-card py-2.5 text-sm text-muted-foreground transition hover:border-primary/40 disabled:opacity-50">Cancel</button>
            <button onClick={() => void doDelete()} disabled={!!busyId}
              className="flex-1 rounded-full bg-destructive py-2.5 text-sm font-semibold text-destructive-foreground transition active:scale-95 disabled:opacity-50">
              {busyId ? "Deleting…" : "Delete"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// Upload one or more audio files to a channel. Multiple files upload
// sequentially so a large batch can't open dozens of parallel connections;
// per-file failures are collected and reported rather than aborting the rest.
function UploadDialog({ channel, onClose, onDone }: { channel: string; onClose: () => void; onDone: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [license, setLicense] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const name = FOCUS_SOUNDS.find((s) => s.id === channel)?.name ?? channel;
  const tooBig = files.filter((f) => f.size > MUSIC_MAX_BYTES);

  const submit = async () => {
    if (files.length === 0) return;
    setBusy(true); setError(null); setProgress(0);
    const failures: string[] = [];
    for (const [i, file] of files.entries()) {
      // A typed title only makes sense for a single file; batches take their
      // titles from the filenames.
      const { error: err } = await adminUploadMusicTrack(channel, file, {
        title: files.length === 1 ? title : undefined,
        artist, license,
      });
      if (err) failures.push(`${file.name}: ${err}`);
      setProgress(i + 1);
    }
    setBusy(false);
    if (failures.length > 0) { setError(failures.join("\n")); return; }
    onDone();
  };

  return (
    <Modal label={`Add music to ${name}`} onClose={() => { if (!busy) onClose(); }}
      cardClassName="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-xl">
      <h3 className="font-display text-xl font-semibold">Add music to {name}</h3>
      <p className="mt-1 text-sm text-muted-foreground">MP3, OGG, WAV, M4A or WebM. Up to 60 MB per file.</p>

      <label className="mt-4 block cursor-pointer rounded-2xl border border-dashed border-border bg-background/40 p-4 text-center transition hover:border-primary/50">
        <Upload size={18} className="mx-auto text-muted-foreground" />
        <span className="mt-2 block text-sm">
          {files.length === 0 ? "Choose audio files" : `${files.length} file${files.length === 1 ? "" : "s"} selected`}
        </span>
        <input type="file" accept="audio/*" multiple className="hidden" disabled={busy}
          onChange={(e) => { setFiles([...(e.target.files ?? [])]); setError(null); }} />
      </label>

      {files.length > 0 && (
        <ul className="mt-2 max-h-28 space-y-0.5 overflow-auto text-[11px] text-muted-foreground">
          {files.map((f) => (
            <li key={f.name} className={f.size > MUSIC_MAX_BYTES ? "text-destructive" : ""}>
              {f.name} — {(f.size / 1048576).toFixed(1)} MB
            </li>
          ))}
        </ul>
      )}

      {files.length === 1 && (
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (defaults to the filename)" disabled={busy}
          className="mt-3 w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20" />
      )}
      <input value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="Artist" disabled={busy}
        className="mt-2 w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20" />
      <input value={license} onChange={(e) => setLicense(e.target.value)} placeholder="License (e.g. CC BY 4.0)" disabled={busy}
        className="mt-2 w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20" />

      <p className="mt-2 text-[11px] text-muted-foreground">
        Only upload audio you own or that is licensed for this use — these files are served publicly to every listener.
      </p>

      {tooBig.length > 0 && <p className="mt-2 text-xs text-destructive">{tooBig.length} file{tooBig.length === 1 ? " is" : "s are"} over the 60 MB limit and will be rejected.</p>}
      {error && <p className="mt-2 whitespace-pre-line text-xs text-destructive">{error}</p>}

      <div className="mt-5 flex gap-2">
        <button onClick={onClose} disabled={busy}
          className="flex-1 rounded-full border border-border bg-card py-2.5 text-sm text-muted-foreground transition hover:border-primary/40 disabled:opacity-50">Cancel</button>
        <button onClick={() => void submit()} disabled={busy || files.length === 0}
          className="flex-1 rounded-full bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition active:scale-95 disabled:opacity-50">
          {busy ? <span className="inline-flex items-center gap-1.5"><Loader2 size={14} className="animate-spin" />{progress}/{files.length}</span> : "Upload"}
        </button>
      </div>
    </Modal>
  );
}
