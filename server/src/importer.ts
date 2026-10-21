// Importing a Spotify data export (YourSpotify's /import routes, same paths and answers):
// - "privacy": Account data (StreamingHistory*.json: endTime, artistName, trackName, msPlayed),
//   matched to tracks by name.
// - "full-privacy": Extended streaming history (Streaming_History_Audio_*.json, with track URIs).
//
// Plays shorter than 30 seconds are skipped, and plays already there (within a minute) aren't added
// twice. Tracks already in the catalog are read from the database instead of asking Spotify again.
// A failed import keeps its files so it can be retried from where it stopped.

import { mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { IMPORT_DIR } from "./config.ts";
import { sql } from "./db.ts";
import { HttpError, body, str } from "./http.ts";
import { newUserId } from "./crypto.ts";
import { requireUser, type AppEnv } from "./auth.ts";
import { spotifyFor, type SpotifyClient, type SpotifyTrack } from "./spotify/client.ts";
import { storePlays, storeTracks, type PlayInput } from "./spotify/catalog.ts";

type ImportType = "privacy" | "full-privacy";
const MIN_MS = 30_000;
const BATCH = 200;

interface PrivacyItem {
  endTime: string;
  artistName: string;
  trackName: string;
  msPlayed: number;
}
interface FullPrivacyItem {
  ts: string;
  ms_played: number;
  spotify_track_uri: string | null;
  master_metadata_track_name?: string | null;
  master_metadata_album_artist_name?: string | null;
}

const running = new Set<string>();

function validItems(type: ImportType, data: unknown): unknown[] | null {
  if (!Array.isArray(data)) return null;
  const ok =
    type === "privacy"
      ? (i: any) => typeof i?.endTime === "string" && typeof i.artistName === "string" && typeof i.trackName === "string" && typeof i.msPlayed === "number"
      : (i: any) => typeof i?.ts === "string" && typeof i.ms_played === "number" && (i.spotify_track_uri === null || typeof i.spotify_track_uri === "string" || i.spotify_track_uri === undefined);
  return data.every(ok) ? data : null;
}

async function readItems(type: ImportType, files: string[]): Promise<unknown[]> {
  const all: unknown[] = [];
  for (const f of files) {
    const items = validItems(type, JSON.parse(await readFile(f, "utf8")));
    if (!items) throw new HttpError(400, "These files don't look like a Spotify export of this kind");
    all.push(...items);
  }
  return all;
}

/** "2021-03-01 12:34" (UTC, from the account data export) → Date. */
function privacyDate(s: string) {
  const iso = s.trim().replace(" ", "T");
  return new Date(/T\d\d:\d\d$/.test(iso) ? `${iso}:00Z` : /Z$|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
}

/** Catalog tracks by id, shaped enough for storePlays. */
async function knownTracks(ids: string[]): Promise<Map<string, SpotifyTrack>> {
  if (!ids.length) return new Map();
  const rows = await sql<{ id: string; album: string; artists: string[]; durationMs: number; name: string }[]>`
    SELECT id, album, artists, duration_ms, name FROM tracks WHERE id = ANY(${ids})`;
  return new Map(
    rows.map((r) => [r.id, { id: r.id, name: r.name, album: { id: r.album, name: "", artists: [] }, artists: r.artists.map((id) => ({ id, name: "" })), duration_ms: r.durationMs }]),
  );
}

/** Resolves track ids (catalog first, then Spotify, storing what it fetched). */
async function resolveIds(client: SpotifyClient, ids: string[], cache: Map<string, SpotifyTrack | null>) {
  const wanted = [...new Set(ids)].filter((id) => !cache.has(id));
  const known = await knownTracks(wanted);
  for (const [id, t] of known) cache.set(id, t);
  const fetched: SpotifyTrack[] = [];
  for (const id of wanted.filter((id) => !known.has(id))) {
    const t = await client.track(id);
    cache.set(id, t);
    if (t) fetched.push(t);
  }
  await storeTracks(client, fetched);
}

/** Resolves a track from its name and artist name (catalog first, then Spotify search). */
async function resolveName(client: SpotifyClient, track: string, artist: string, cache: Map<string, SpotifyTrack | null>) {
  const key = `${track}\u0000${artist}`;
  if (cache.has(key)) return cache.get(key)!;
  const [row] = await sql<{ id: string }[]>`
    SELECT t.id FROM tracks t JOIN artists ar ON ar.id = t.artists[1]
    WHERE lower(t.name) = lower(${track}) AND lower(ar.name) = lower(${artist}) LIMIT 1`;
  let found: SpotifyTrack | null = row ? ((await knownTracks([row.id])).get(row.id) ?? null) : null;
  if (!found) {
    const plain = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
    const beforeParen = (s: string) => s.split(/[([]/)[0].replace(/'/g, " ").trim() || s;
    found = (await client.search(plain(track), plain(artist))) ?? (await client.search(plain(beforeParen(track)), plain(beforeParen(artist))));
    if (found) await storeTracks(client, [found]);
  }
  cache.set(key, found);
  return found;
}

async function run(importId: string) {
  const [state] = await sql<{ userId: string; type: ImportType; current: number; metadata: string[] }[]>`
    SELECT user_id, type, current, metadata FROM imports WHERE id = ${importId}`;
  if (!state || running.has(state.userId)) return;
  running.add(state.userId);
  const client = spotifyFor(state.userId);
  const cache = new Map<string, SpotifyTrack | null>();
  try {
    const items = await readItems(state.type, state.metadata);
    for (let i = state.current; i < items.length; i += BATCH) {
      const chunk = items.slice(i, i + BATCH);
      const plays: PlayInput[] = [];
      if (state.type === "full-privacy") {
        const usable = (chunk as FullPrivacyItem[]).filter((x) => x.ms_played >= MIN_MS && x.spotify_track_uri?.startsWith("spotify:track:"));
        const idOf = (x: FullPrivacyItem) => x.spotify_track_uri!.split(":")[2];
        await resolveIds(client, usable.map(idOf), cache);
        for (const x of usable) {
          const track = cache.get(idOf(x));
          if (track) plays.push({ track, playedAt: new Date(x.ts) });
        }
      } else {
        for (const x of (chunk as PrivacyItem[]).filter((x) => x.msPlayed >= MIN_MS)) {
          const track = await resolveName(client, x.trackName, x.artistName, cache);
          if (track) plays.push({ track, playedAt: privacyDate(x.endTime) });
        }
      }
      await storePlays(state.userId, plays, 60);
      await sql`UPDATE imports SET current = ${Math.min(items.length, i + BATCH)}, updated_at = now() WHERE id = ${importId}`;
    }
    await sql`UPDATE imports SET status = 'success', updated_at = now() WHERE id = ${importId}`;
    await rm(join(IMPORT_DIR, importId), { recursive: true, force: true });
    console.log(`[import] ${importId} done`);
  } catch (e) {
    console.warn(`[import] ${importId} failed:`, e);
    await sql`UPDATE imports SET status = 'failure', updated_at = now() WHERE id = ${importId}`;
  } finally {
    running.delete(state.userId);
  }
}

/** Imports cut short by a restart can be retried. */
export async function failInterruptedImports() {
  await sql`UPDATE imports SET status = 'failure' WHERE status = 'progress'`;
}

const view = (r: Record<string, unknown>) => ({
  _id: r.id,
  id: r.id,
  user: r.userId,
  type: r.type,
  current: r.current,
  total: r.total,
  status: r.status,
  metadata: r.metadata,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

// --- Routes ---

export const importRoutes = new Hono<AppEnv>();

async function notImporting(userId: string) {
  const [busy] = await sql`SELECT 1 FROM imports WHERE user_id = ${userId} AND status = 'progress'`;
  if (busy || running.has(userId)) throw new HttpError(409, "ALREADY_IMPORTING");
}

for (const type of ["privacy", "full-privacy"] as const) {
  importRoutes.post(
    `/import/${type}`,
    requireUser,
    bodyLimit({ maxSize: 512 * 1024 * 1024, onError: (c) => c.json({ error: "Those files are too large" }, 413) }),
    async (c) => {
      const user = c.get("user");
      await notImporting(user.id);
      const form = await c.req.parseBody({ all: true });
      const files = ([] as unknown[]).concat(form.imports ?? []).filter((f): f is File => f instanceof File);
      if (!files.length) return c.json({ code: "IMPORT_INIT_FAILED", error: "No files" }, 400);
      if (files.length > 50 || files.some((f) => f.size > 50 * 1024 * 1024)) return c.json({ code: "IMPORT_INIT_FAILED", error: "Up to 50 files of 50 MB" }, 400);

      const id = newUserId();
      const dir = join(IMPORT_DIR, id);
      await mkdir(dir, { recursive: true });
      const paths: string[] = [];
      for (const [i, f] of files.entries()) {
        const path = join(dir, `${i}.json`);
        await writeFile(path, Buffer.from(await f.arrayBuffer()));
        paths.push(path);
      }
      let total: number;
      try {
        total = (await readItems(type, paths)).length;
      } catch (e) {
        await rm(dir, { recursive: true, force: true });
        return c.json({ code: "IMPORT_INIT_FAILED", error: e instanceof HttpError ? e.message : "Those files aren't valid JSON" }, 400);
      }
      await sql`INSERT INTO imports (id, user_id, type, total, metadata) VALUES (${id}, ${user.id}, ${type}, ${total}, ${sql.json(paths)})`;
      void run(id);
      return c.json({ code: "IMPORT_STARTED" });
    },
  );
}

importRoutes.post("/import/retry", requireUser, async (c) => {
  const user = c.get("user");
  const id = str((await body(c)).existingStateId, 64);
  await notImporting(user.id);
  const [state] = await sql<{ status: string }[]>`SELECT status FROM imports WHERE id = ${id} AND user_id = ${user.id}`;
  if (!state) throw new HttpError(404, "Not found");
  if (state.status !== "failure") throw new HttpError(400, "Only a failed import can be retried");
  await sql`UPDATE imports SET status = 'progress', updated_at = now() WHERE id = ${id}`;
  void run(id);
  return c.json({ code: "IMPORT_STARTED" });
});

importRoutes.delete("/import/clean/:id", requireUser, async (c) => {
  const id = c.req.param("id");
  const [state] = await sql<{ status: string }[]>`SELECT status FROM imports WHERE id = ${id} AND user_id = ${c.get("user").id}`;
  if (!state) throw new HttpError(404, "Not found");
  if (state.status === "failure") {
    await sql`UPDATE imports SET status = 'failure-removed', updated_at = now() WHERE id = ${id}`;
    await rm(join(IMPORT_DIR, id), { recursive: true, force: true });
  }
  return c.body(null, 204);
});

importRoutes.get("/imports", requireUser, async (c) =>
  c.json((await sql`SELECT * FROM imports WHERE user_id = ${c.get("user").id} ORDER BY created_at DESC`).map(view)),
);
