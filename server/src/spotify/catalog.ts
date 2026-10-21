// Storing what Spotify returns: the shared catalog (tracks, albums, artists) and users' plays.
//
// A track from "recently played" comes with its album (images, release date, artists), so only
// artists we've never seen are fetched (for their pictures and genres). YourSpotify fetched the
// track, its album and its artists again for every new track.

import { sql } from "../db.ts";
import type { SpotifyAlbum, SpotifyArtist, SpotifyClient, SpotifyTrack } from "./client.ts";

const uniqBy = <T>(items: T[], key: (t: T) => string) => [...new Map(items.map((i) => [key(i), i])).values()];

/** Tracks with an id, an album and at least one artist (local files have none). */
export const storable = (t: SpotifyTrack | null | undefined): t is SpotifyTrack =>
  !!t?.id && !!t.album?.id && Array.isArray(t.artists) && t.artists.length > 0 && !!t.artists[0]?.id;

function albumRow(a: SpotifyAlbum) {
  return {
    id: a.id,
    name: a.name ?? "",
    album_type: a.album_type ?? "",
    artists: (a.artists ?? []).map((x) => x.id).filter(Boolean),
    images: a.images ?? [],
    release_date: a.release_date ?? "",
    release_date_precision: a.release_date_precision ?? "",
    genres: a.genres ?? [],
    copyrights: a.copyrights ?? [],
    external_urls: a.external_urls ?? {},
    href: a.href ?? "",
    uri: a.uri ?? `spotify:album:${a.id}`,
  };
}

function trackRow(t: SpotifyTrack) {
  return {
    id: t.id,
    name: t.name ?? "",
    album: t.album.id,
    artists: t.artists.map((x) => x.id).filter(Boolean),
    disc_number: t.disc_number ?? 1,
    duration_ms: t.duration_ms ?? 0,
    explicit: !!t.explicit,
    external_urls: t.external_urls ?? {},
    href: t.href ?? "",
    is_local: !!t.is_local,
    preview_url: t.preview_url ?? null,
    track_number: t.track_number ?? 1,
    uri: t.uri ?? `spotify:track:${t.id}`,
  };
}

function artistRow(a: SpotifyArtist) {
  return {
    id: a.id,
    name: a.name ?? "",
    genres: a.genres ?? [],
    images: a.images ?? [],
    external_urls: a.external_urls ?? {},
    href: a.href ?? "",
    uri: a.uri ?? `spotify:artist:${a.id}`,
  };
}

// postgres.js encodes the value itself for a jsonb parameter.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asJson = (rows: unknown[]) => sql.json(rows as any);

/**
 * Stores tracks (and their albums), then fetches and stores the artists we don't have yet.
 * Artists Spotify won't return are kept with just their name, so plays never point at nothing.
 */
export async function storeTracks(client: SpotifyClient | null, tracks: SpotifyTrack[]) {
  const list = uniqBy(tracks.filter(storable), (t) => t.id);
  if (!list.length) return;
  const albums = uniqBy(list.map((t) => t.album), (a) => a.id).map(albumRow);
  await sql`
    INSERT INTO albums SELECT * FROM jsonb_populate_recordset(null::albums, ${asJson(albums)}::jsonb)
    ON CONFLICT (id) DO NOTHING`;
  await sql`
    INSERT INTO tracks SELECT * FROM jsonb_populate_recordset(null::tracks, ${asJson(list.map(trackRow))}::jsonb)
    ON CONFLICT (id) DO NOTHING`;

  const simplified = uniqBy([...list.flatMap((t) => t.artists), ...list.flatMap((t) => t.album.artists ?? [])].filter((a) => a?.id), (a) => a.id);
  const known = await sql<{ id: string }[]>`SELECT id FROM artists WHERE id = ANY(${simplified.map((a) => a.id)})`;
  const have = new Set(known.map((r) => r.id));
  const missing = simplified.filter((a) => !have.has(a.id));
  if (!missing.length) return;
  const full: SpotifyArtist[] = [];
  for (const a of missing) {
    const fetched = client ? await client.artist(a.id).catch(() => null) : null;
    full.push(fetched ?? a);
  }
  await sql`
    INSERT INTO artists SELECT * FROM jsonb_populate_recordset(null::artists, ${asJson(full.map(artistRow))}::jsonb)
    ON CONFLICT (id) DO NOTHING`;
}

export interface PlayInput {
  track: SpotifyTrack;
  playedAt: Date;
}

/**
 * Adds plays to a user's history (their tracks must be stored). A play of the same track within
 * `windowSeconds` of one already there is a duplicate (an import overlapping what was collected).
 * Returns how many were added.
 */
export async function storePlays(userId: string, plays: PlayInput[], windowSeconds = 30): Promise<number> {
  const valid = plays.filter((p) => storable(p.track) && !Number.isNaN(p.playedAt.getTime()));
  if (!valid.length) return 0;
  // Duplicates within the batch itself.
  valid.sort((a, b) => a.playedAt.getTime() - b.playedAt.getTime());
  const last = new Map<string, number>();
  const rows = [];
  for (const p of valid) {
    const t = p.playedAt.getTime();
    const prev = last.get(p.track.id);
    if (prev !== undefined && t - prev < windowSeconds * 1000) continue;
    last.set(p.track.id, t);
    rows.push({
      track_id: p.track.id,
      album_id: p.track.album.id,
      primary_artist_id: p.track.artists[0].id,
      artist_ids: p.track.artists.map((a) => a.id).filter(Boolean),
      duration_ms: p.track.duration_ms ?? 0,
      played_at: p.playedAt.toISOString(),
    });
  }
  const window = `${windowSeconds} seconds`;
  const inserted = await sql<{ playedAt: Date }[]>`
    INSERT INTO plays (user_id, track_id, album_id, primary_artist_id, artist_ids, duration_ms, played_at, blacklisted)
    SELECT ${userId}, x.track_id, x.album_id, x.primary_artist_id, x.artist_ids, x.duration_ms, x.played_at,
           x.primary_artist_id = ANY(u.blacklisted_artists)
    FROM jsonb_to_recordset(${asJson(rows)}::jsonb)
      AS x(track_id text, album_id text, primary_artist_id text, artist_ids text[], duration_ms integer, played_at timestamptz)
    CROSS JOIN users u
    WHERE u.id = ${userId}
      AND NOT EXISTS (
        SELECT 1 FROM plays p
        WHERE p.user_id = ${userId} AND p.track_id = x.track_id
          AND p.played_at BETWEEN x.played_at - ${window}::interval AND x.played_at + ${window}::interval)
    ON CONFLICT DO NOTHING
    RETURNING played_at`;
  if (inserted.length) {
    const first = inserted.reduce((m, r) => (r.playedAt < m ? r.playedAt : m), inserted[0].playedAt);
    await sql`UPDATE users SET first_listened_at = least(coalesce(first_listened_at, ${first}), ${first}) WHERE id = ${userId}`;
  }
  return inserted.length;
}
