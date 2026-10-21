// Talking to the Music server (same origin; Vite proxies /api in development).
// Opened through a public link (?token=…), every request carries the token: read-only, as on YourSpotify.

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** The public link's token, if the app was opened through one. */
export const publicToken: string | null = new URLSearchParams(location.search).get("token");

export function withToken(path: string): string {
  if (!publicToken) return path;
  return `${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(publicToken)}`;
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown; form?: FormData }): Promise<T> {
  const res = await fetch(`/api${withToken(path)}`, {
    method: init?.method ?? (init?.body !== undefined || init?.form ? "POST" : "GET"),
    headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init?.form ?? (init?.body !== undefined ? JSON.stringify(init.body) : undefined),
    credentials: "same-origin",
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    if (res.status === 401 && !path.startsWith("/auth/") && !publicToken) window.dispatchEvent(new Event("music:signed-out"));
    throw new ApiError(res.status, data?.error ?? data?.message ?? data?.code ?? `Request failed (${res.status})`, data?.code);
  }
  if (res.status === 204) return undefined as T;
  const type = res.headers.get("content-type") ?? "";
  return (type.includes("json") ? res.json() : res.text()) as Promise<T>;
}

export function query(params: Record<string, string | number | undefined | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
}

// --- Types (YourSpotify's shapes, as the server returns them) ---

export interface Image {
  url: string;
  height: number | null;
  width: number | null;
}

export interface Artist {
  id: string;
  name: string;
  genres: string[];
  images: Image[];
  external_urls: Record<string, string>;
  uri: string;
}

export interface Album {
  id: string;
  name: string;
  album_type: string;
  artists: string[];
  images: Image[];
  release_date: string;
  uri: string;
  external_urls: Record<string, string>;
}

export interface Track {
  id: string;
  name: string;
  album: string;
  artists: string[];
  duration_ms: number;
  explicit: boolean;
  uri: string;
  external_urls: Record<string, string>;
}

export type TrackWithAlbum = Omit<Track, "album"> & { album: Album };

/** A play (YourSpotify's "info"). */
export interface Info {
  _id: string;
  id: string;
  albumId: string;
  primaryArtistId: string;
  artistIds: string[];
  durationMs: number;
  played_at: string;
}

export type HistoryItem = Info & { track: Track & { full_album: Album | null; full_artists: Artist[] } };

export interface Me {
  id: string;
  username: string;
  admin: boolean;
  spotifyId: string;
  settings: {
    historyLine: boolean;
    preferredStatsPeriod: string;
    nbElements: number;
    metricUsed: "number" | "duration";
    darkMode: string;
    timezone?: string;
    dateFormat: string;
    blacklistedArtists: string[];
  };
  publicToken: string | null;
  firstListenedAt: string | null;
  /** The last time recently played tracks were fetched (epoch ms). */
  lastTimestamp: number;
  email: string | null;
  timezone: string;
  weekStart: 0 | 1;
  spotifyLinked: boolean;
  pollError: string | null;
  createdAt: string;
  guest: boolean;
}

export interface ServerInfo {
  spotify: boolean;
  version: string;
  defaultTimezone: string;
  pollIntervalSeconds: number;
}

export interface AuthConfig {
  spotify: boolean;
  dev: boolean;
}

export interface UpdateStatus {
  current: string;
  latest: { version: string; url: string; publishedAt: string | null } | null;
  available: boolean;
  releasesUrl: string;
  checkedAt: string | null;
  disabled?: boolean;
  error?: string;
}

export interface Summary {
  from: string;
  to: string;
  ms: number;
  plays: number;
  tracks: number;
  artists: number;
  albums: number;
  top: { ms: number; plays: number; artist: Artist }[];
  days: { date: string; ms: number; plays: number; artists: Record<string, number> }[];
}

export interface TopItem {
  _id: string;
  duration_ms: number;
  count: number;
  differents: number;
  total_duration_ms: number;
  total_count: number;
  track: Track;
  album: Album;
  artist: Artist;
}

export interface Rank {
  index: number;
  isMax: boolean;
  isMin: boolean;
  results: { id: string; count: number }[];
}

export interface Account {
  id: string;
  username: string;
  admin: boolean;
  firstListenedAt: string | null;
}

export interface GlobalPreferences {
  allowRegistrations: boolean;
  allowAffinity: boolean;
}

export interface Session {
  id: string;
  method: string;
  userAgent: string;
  ip: string;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

export interface ImportState {
  _id: string;
  type: "privacy" | "full-privacy";
  current: number;
  total: number;
  status: "progress" | "success" | "failure" | "failure-removed";
  createdAt: string;
  updatedAt: string;
}

export interface AdminUser {
  id: string;
  username: string;
  email: string | null;
  isAdmin: boolean;
  spotifyId: string;
  collecting: boolean;
  pollError: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  plays: number;
  lastPlayAt: string | null;
}

export interface Playlist {
  id: string;
  name: string;
  images?: Image[];
}

/** Rows of /spotify/top/sessions. */
export interface ListeningSession {
  sessionLength: number;
  distanceToLast: { distance: { subtract: number; info: Info }[] };
  full_tracks: Record<string, Track>;
}

export type CollaborativeRow = Record<string, number> & { _id: string; average_percents: number; minima: number; track?: Track; album?: Album; artist: Artist };

/** The smallest image at least `min` pixels wide (Spotify lists them largest first). */
export function imageOf(images: Image[] | undefined, min = 64): string | null {
  if (!images?.length) return null;
  const sorted = [...images].sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  return (sorted.find((i) => (i.width ?? 0) >= min) ?? sorted[sorted.length - 1]).url;
}
