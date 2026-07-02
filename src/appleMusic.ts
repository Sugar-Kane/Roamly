// Apple Music embed helpers: parsing pasted links into an embeddable target,
// plus a small curated preset list for one-click playback.
//
// Apple's iframe embed player lives at `embed.music.apple.com` and mirrors the
// path of a regular `music.apple.com` share link exactly (same
// `/<storefront>/<type>/<slug>/<id>` shape, only the host changes) — unlike
// Spotify, there's no separate ID extraction needed, just a host swap.

export type AppleMusicEmbedType = "album" | "playlist" | "song" | "artist" | "station";

export type AppleMusicTarget = { type: AppleMusicEmbedType; path: string };

export type AppleMusicPreset = {
  id: string;
  name: string;
  hint: string;
  type: AppleMusicEmbedType;
  path: string;
};

// Official Apple Music editorial playlists. Unlike the Spotify preset list,
// each of these was opened live via embed.music.apple.com during development
// (2026-07-02) and confirmed to render — if Apple ever retires or renames one,
// replace just its `path` below; nothing else in the app needs to change.
export const APPLE_MUSIC_PRESETS: AppleMusicPreset[] = [
  { id: "pure-focus", name: "Pure Focus", hint: "Ambient electronic concentration", type: "playlist", path: "/us/playlist/pure-focus/pl.dbd712beded846dca273d5d3259d28aa" },
  { id: "beatstrumentals", name: "BEATstrumentals", hint: "Chill instrumental beats", type: "playlist", path: "/us/playlist/beatstrumentals/pl.f54198ad42404535be13eabf3835fb22" },
  { id: "piano-essentials", name: "Piano Essentials", hint: "Classical piano, low tempo", type: "playlist", path: "/us/playlist/piano-essentials/pl.5e6ff35247334d9699646afd21e589bd" },
  { id: "coffee-shop-essentials", name: "Coffee Shop Essentials", hint: "Acoustic coffee-shop vibe", type: "playlist", path: "/us/playlist/coffee-shop-essentials/pl.bfee2d8a4ba844acbbc289f35995881e" },
];

const APPLE_MUSIC_RE = /(?:https?:\/\/)?(?:embed\.)?music\.apple\.com(\/[a-z]{2}\/(album|playlist|song|artist|station)\/[^\s]+)/i;

// Parses a `music.apple.com/<storefront>/...` share link (or an already-embed
// `embed.music.apple.com/...` link) into a target. Preserves any trailing
// query string (e.g. `?i=<songId>`, used for a specific track within an
// album). Returns null for anything that doesn't match Apple Music's URL shape.
export function parseAppleMusicUrl(input: string): AppleMusicTarget | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const match = trimmed.match(APPLE_MUSIC_RE);
  if (!match) return null;

  return { type: match[2].toLowerCase() as AppleMusicEmbedType, path: match[1] };
}

export function toEmbedSrc({ path }: AppleMusicTarget): string {
  return `https://embed.music.apple.com${path}`;
}

// A single song's compact embed is short; anything with a tracklist
// (album/playlist/artist/station) needs more room for art + track rows.
export function embedHeight(type: AppleMusicEmbedType): number {
  return type === "song" ? 175 : 450;
}
