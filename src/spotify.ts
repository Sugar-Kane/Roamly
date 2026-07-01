// Spotify embed helpers: parsing pasted links/URIs into an embeddable target,
// plus a small curated preset list for one-click playback.

export type SpotifyEmbedType = "track" | "playlist" | "album" | "artist" | "episode" | "show";

export type SpotifyTarget = { type: SpotifyEmbedType; id: string };

export type SpotifyPreset = {
  id: string;
  name: string;
  hint: string;
  type: SpotifyEmbedType;
  spotifyId: string;
};

// Official Spotify editorial playlist IDs. These are stable in practice but were
// not (and cannot be) verified in a live browser during planning — spot-check
// each one after deploying by opening https://open.spotify.com/playlist/<spotifyId>.
// If any 404s or redirects to a different playlist, replace just its `spotifyId`
// below; nothing else in the app needs to change.
export const SPOTIFY_PRESETS: SpotifyPreset[] = [
  { id: "deep-focus", name: "Deep Focus", hint: "Ambient concentration", type: "playlist", spotifyId: "37i9dQZF1DWZeKCadgRdKQ" },
  { id: "lofi-beats", name: "Lo-Fi Beats", hint: "Chill beats to study to", type: "playlist", spotifyId: "37i9dQZF1DWWQRwui0ExPn" },
  { id: "peaceful-piano", name: "Peaceful Piano", hint: "Solo piano, low tempo", type: "playlist", spotifyId: "37i9dQZF1DX4sWSpwq3LiO" },
  { id: "instrumental-study", name: "Instrumental Study", hint: "Focus without lyrics", type: "playlist", spotifyId: "37i9dQZF1DX9SIqqvKsjG8" },
];

const URI_RE = /^spotify:(track|playlist|album|artist|episode|show):([A-Za-z0-9]+)$/i;
const URL_RE = /open\.spotify\.com\/(?:intl-[a-z]{2,5}\/)?(track|playlist|album|artist|episode|show)\/([A-Za-z0-9]+)/i;

// Parses an `open.spotify.com/...` link (with optional `intl-xx/` locale prefix
// and any trailing `?si=...` query string) or a `spotify:type:id` URI. Returns
// null for anything that doesn't match either shape.
export function parseSpotifyUrl(input: string): SpotifyTarget | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const uriMatch = trimmed.match(URI_RE);
  if (uriMatch) return { type: uriMatch[1].toLowerCase() as SpotifyEmbedType, id: uriMatch[2] };

  const urlMatch = trimmed.match(URL_RE);
  if (urlMatch) return { type: urlMatch[1].toLowerCase() as SpotifyEmbedType, id: urlMatch[2] };

  return null;
}

// `?utm_source=generator` is cosmetic/optional — Spotify's own embeds add it,
// but the player works identically without it.
export function toEmbedSrc({ type, id }: SpotifyTarget): string {
  return `https://open.spotify.com/embed/${type}/${id}`;
}

// Spotify's embed guidance: a single track/episode looks right short (152px);
// anything with a tracklist (playlist/album/show/artist) needs more room (352px).
export function embedHeight(type: SpotifyEmbedType): number {
  return type === "track" || type === "episode" ? 152 : 352;
}
