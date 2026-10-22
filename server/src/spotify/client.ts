// Talking to Spotify's Web API.
//
// Spotify rate-limits per app, not per user, so every request goes through one queue: one at a
// time, users' clicks (high priority) before the background polling and imports. A 429 waits for
// Retry-After and tries again.
//
// The endpoints are the ones YourSpotify uses today: since Spotify's 2026 changes for apps in
// development mode, tracks, albums and artists are fetched one by one (the batch endpoints are gone)
// and playlists are created with POST /me/playlists.

import { spotify } from "../config.ts";
import { sql } from "../db.ts";
import { HttpError } from "../http.ts";
import type { User } from "../users.ts";

const API = "https://api.spotify.com/v1";
const ACCOUNTS = "https://accounts.spotify.com/api/token";

export class SpotifyError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`Spotify answered ${status}: ${body.slice(0, 300)}`);
    this.status = status;
    this.body = body;
  }
}

// --- The queue ---

type Priority = "high" | "normal";
interface Job {
  run: () => Promise<Response>;
  resolve: (r: Response) => void;
  reject: (e: unknown) => void;
  attempts: number;
}
const queues: Record<Priority, Job[]> = { high: [], normal: [] };
let busy = false;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function retryAfterMs(res: Response) {
  const v = res.headers.get("retry-after");
  const n = Number(v);
  if (v && Number.isFinite(n)) return Math.min(Math.max(0, n * 1000), 10 * 60_000);
  const at = v ? Date.parse(v) : NaN;
  return Number.isNaN(at) ? 1000 : Math.min(Math.max(0, at - Date.now()), 10 * 60_000);
}

async function pump() {
  if (busy) return;
  busy = true;
  try {
    for (;;) {
      const job = queues.high.shift() ?? queues.normal.shift();
      if (!job) break;
      try {
        const res = await job.run();
        if (res.status === 429 && job.attempts < 5) {
          job.attempts++;
          queues.high.unshift(job);
          await sleep(retryAfterMs(res));
          continue;
        }
        job.resolve(res);
      } catch (e) {
        job.reject(e);
      }
    }
  } finally {
    busy = false;
  }
}

function enqueue(run: () => Promise<Response>, priority: Priority): Promise<Response> {
  return new Promise((resolve, reject) => {
    queues[priority].push({ run, resolve, reject, attempts: 0 });
    void pump();
  });
}

async function call<T>(url: string, init: RequestInit, priority: Priority): Promise<T> {
  const res = await enqueue(() => fetch(url, { ...init, signal: AbortSignal.timeout(30_000) }), priority);
  const text = await res.text();
  if (!res.ok) throw new SpotifyError(res.status, text);
  return (text ? JSON.parse(text) : undefined) as T;
}

// --- OAuth ---

function app() {
  if (!spotify) throw new HttpError(503, "Spotify isn't configured on this server (SPOTIFY_PUBLIC, SPOTIFY_SECRET)");
  return spotify;
}

const basic = () => `Basic ${Buffer.from(`${app().clientId}:${app().clientSecret}`).toString("base64")}`;

export interface Tokens {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms. */
  expiresIn: number;
}

export function authorizeUrl(state: string): string {
  const url = new URL("https://accounts.spotify.com/authorize");
  url.search = new URLSearchParams({
    client_id: app().clientId,
    response_type: "code",
    redirect_uri: app().redirectUri,
    state,
    scope: app().scopes,
  }).toString();
  return url.toString();
}

export async function exchangeCode(code: string): Promise<Tokens> {
  const data = await call<{ access_token: string; refresh_token: string; expires_in: number }>(
    ACCOUNTS,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: basic() },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: app().redirectUri }),
    },
    "high",
  );
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: Date.now() + data.expires_in * 1000 };
}

async function refresh(refreshToken: string): Promise<Tokens> {
  const data = await call<{ access_token: string; refresh_token?: string; expires_in: number }>(
    ACCOUNTS,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: basic() },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
    },
    "high",
  );
  // Spotify sometimes rotates the refresh token.
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: Date.now() + data.expires_in * 1000 };
}

/** Calls Spotify with a fresh access token (used right after the code exchange, before a user exists). */
export function withToken(accessToken: string) {
  return <T>(path: string, init: RequestInit = {}, priority: Priority = "high") =>
    call<T>(`${API}${path}`, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${accessToken}` } }, priority);
}

// --- A user's client ---

const refreshing = new Map<string, Promise<string>>();

/** The user's access token, refreshed if it expires within two minutes. */
async function accessToken(userId: string): Promise<string> {
  const [u] = await sql<Pick<User, "accessToken" | "refreshToken" | "expiresIn">[]>`
    SELECT access_token, refresh_token, expires_in FROM users WHERE id = ${userId}`;
  if (!u?.refreshToken) throw new HttpError(409, "Connect your Spotify account first");
  if (u.accessToken && Date.now() < Number(u.expiresIn) - 120_000) return u.accessToken;
  let pending = refreshing.get(userId);
  if (!pending) {
    pending = (async () => {
      try {
        const t = await refresh(u.refreshToken!);
        await sql`
          UPDATE users SET access_token = ${t.accessToken}, expires_in = ${t.expiresIn},
            refresh_token = coalesce(${t.refreshToken ?? null}, refresh_token)
          WHERE id = ${userId}`;
        return t.accessToken;
      } catch (e) {
        // Access revoked at Spotify (or the app's credentials changed): the user has to reconnect.
        if (e instanceof SpotifyError && e.status === 400 && /invalid_grant/.test(e.body)) {
          await sql`
            UPDATE users SET access_token = NULL, refresh_token = NULL,
              poll_error = 'Spotify access was revoked. Connect your account again.'
            WHERE id = ${userId}`;
        }
        throw e;
      } finally {
        refreshing.delete(userId);
      }
    })();
    refreshing.set(userId, pending);
  }
  return pending;
}

export interface SpotifyImage {
  url: string;
  height: number | null;
  width: number | null;
}
export interface SpotifyArtist {
  id: string;
  name: string;
  genres?: string[];
  images?: SpotifyImage[];
  external_urls?: Record<string, string>;
  href?: string;
  uri?: string;
}
export interface SpotifyAlbum {
  id: string;
  name: string;
  album_type?: string;
  artists: SpotifyArtist[];
  images?: SpotifyImage[];
  release_date?: string;
  release_date_precision?: string;
  genres?: string[];
  copyrights?: unknown[];
  external_urls?: Record<string, string>;
  href?: string;
  uri?: string;
}
export interface SpotifyTrack {
  id: string;
  name: string;
  album: SpotifyAlbum;
  artists: SpotifyArtist[];
  disc_number?: number;
  duration_ms: number;
  explicit?: boolean;
  external_urls?: Record<string, string>;
  href?: string;
  is_local?: boolean;
  preview_url?: string | null;
  track_number?: number;
  uri?: string;
}
export interface RecentlyPlayed {
  items: { played_at: string; track: SpotifyTrack }[];
  next: string | null;
}
export interface SpotifyPlaylist {
  id: string;
  name: string;
  owner: { id: string };
  images?: SpotifyImage[];
  tracks?: { total: number };
}

export function spotifyFor(userId: string) {
  const get = async <T>(path: string, priority: Priority = "normal", init: RequestInit = {}) => {
    const token = await accessToken(userId);
    const url = path.startsWith("http") ? path : `${API}${path}`;
    return call<T>(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` } }, priority);
  };
  const send = <T>(method: string, path: string, body?: unknown) =>
    get<T>(path, "high", { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  /** Not found (deleted, or unavailable in the market) is null, not an error. */
  const maybe = async <T>(path: string, priority: Priority): Promise<T | null> => {
    try {
      return await get<T>(path, priority);
    } catch (e) {
      if (e instanceof SpotifyError && (e.status === 404 || e.status === 400)) return null;
      throw e;
    }
  };

  return {
    me: () => get<{ id: string; display_name: string | null; email?: string; images?: SpotifyImage[]; product?: string; country?: string }>("/me", "high"),
    /** Recently played since `after` (epoch ms), following `next` pages. */
    async recentlyPlayed(after: number) {
      const items: RecentlyPlayed["items"] = [];
      let url: string | null = `/me/player/recently-played?limit=50&after=${Math.max(0, Math.floor(after))}`;
      for (let page = 0; url && page < 20; page++) {
        const data: RecentlyPlayed = await get<RecentlyPlayed>(url);
        items.push(...data.items);
        url = data.next;
      }
      return items;
    },
    track: (id: string, priority: Priority = "normal") => maybe<SpotifyTrack>(`/tracks/${encodeURIComponent(id)}`, priority),
    album: (id: string, priority: Priority = "normal") => maybe<SpotifyAlbum>(`/albums/${encodeURIComponent(id)}`, priority),
    artist: (id: string, priority: Priority = "normal") => maybe<SpotifyArtist>(`/artists/${encodeURIComponent(id)}`, priority),
    /** The best match for a track name and artist name (the old "privacy" exports have no ids). */
    async search(track: string, artist: string): Promise<SpotifyTrack | null> {
      const q = `track:${track.slice(0, 100)} artist:${artist.slice(0, 100)}`;
      const data = await maybe<{ tracks: { items: SpotifyTrack[] } }>(`/search?type=track&limit=10&q=${encodeURIComponent(q)}`, "normal");
      return data?.tracks.items[0] ?? null;
    },
    /**
     * Plays on a named device: without one, Spotify can accept the request and play nothing.
     * Takes the active device, else the first one available. Without the playback-state scope
     * (accounts connected before it was added), plays without naming a device, as before.
     */
    async play(uri: string) {
      let deviceId: string | undefined;
      try {
        const { devices } = await get<{ devices: { id: string | null; is_active: boolean; is_restricted: boolean }[] }>("/me/player/devices", "high");
        const usable = devices.filter((d) => d.id && !d.is_restricted);
        deviceId = (usable.find((d) => d.is_active) ?? usable[0])?.id ?? undefined;
      } catch (e) {
        if (!(e instanceof SpotifyError && (e.status === 401 || e.status === 403))) throw e;
      }
      const query = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : "";
      await send<void>("PUT", `/me/player/play${query}`, { uris: [uri] });
    },
    async playlists() {
      const items: SpotifyPlaylist[] = [];
      let url: string | null = "/me/playlists?limit=50";
      for (let page = 0; url && page < 40; page++) {
        const data: { items: SpotifyPlaylist[]; next: string | null } = await get(url, "high");
        items.push(...data.items.filter(Boolean));
        url = data.next;
      }
      return items;
    },
    async addToPlaylist(playlistId: string, trackIds: string[]) {
      for (let i = 0; i < trackIds.length; i += 100) {
        await send("POST", `/playlists/${encodeURIComponent(playlistId)}/tracks`, { uris: trackIds.slice(i, i + 100).map((id) => `spotify:track:${id}`) });
      }
    },
    async createPlaylist(name: string, trackIds: string[]) {
      const created = await send<{ id: string; external_urls?: { spotify?: string } }>("POST", "/me/playlists", {
        name,
        public: true,
        collaborative: false,
        description: "",
      });
      for (let i = 0; i < trackIds.length; i += 100) {
        await send("POST", `/playlists/${encodeURIComponent(created.id)}/tracks`, { uris: trackIds.slice(i, i + 100).map((id) => `spotify:track:${id}`) });
      }
      return created;
    },
  };
}

export type SpotifyClient = ReturnType<typeof spotifyFor>;
