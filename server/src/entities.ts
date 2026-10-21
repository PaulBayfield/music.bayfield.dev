// Artists, albums and tracks: lookups, search, and one user's stats for one of them
// (YourSpotify's /artist, /album, /track and /search routes, same shapes).
//
// As on YourSpotify, these stats include blacklisted plays: blacklisting hides an artist from the
// overall stats, not from its own page.

import { sql, type Fragment } from "./db.ts";
import { ALBUM, ARTIST, INFO, TRACK, TRACK_WITH_ALBUM } from "./stats.ts";
import { tzOf, type User } from "./users.ts";

const local = (u: User) => sql`(p.played_at AT TIME ZONE ${tzOf(u)})`;

export const getArtists = (ids: string[]) =>
  sql`SELECT ${ARTIST()} AS j FROM artists ar WHERE ar.id = ANY(${ids})`.then((r) => r.map((x) => x.j));
export const getAlbums = (ids: string[]) =>
  sql`SELECT ${ALBUM()} AS j FROM albums a WHERE a.id = ANY(${ids})`.then((r) => r.map((x) => x.j));
export const getTracks = (ids: string[]) =>
  sql`SELECT ${TRACK()} AS j FROM tracks t WHERE t.id = ANY(${ids})`.then((r) => r.map((x) => x.j));

/** Name contains the query, closest matches (starting with it, shortest) first. */
const like = (q: string) => `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
const rank = (col: Fragment, q: string) => sql`(lower(${col}) LIKE lower(${q.replace(/[\\%_]/g, (m) => `\\${m}`) + "%"})) DESC, length(${col})`;

export const searchArtists = (q: string, limit = 20) =>
  sql`SELECT ${ARTIST()} AS j FROM artists ar WHERE ar.name ILIKE ${like(q)} ORDER BY ${rank(sql`ar.name`, q)} LIMIT ${limit}`.then((r) => r.map((x) => x.j));

export const searchAlbums = (q: string, limit = 20) =>
  sql`
    SELECT ${ALBUM()} || jsonb_build_object('full_artists',
      (SELECT coalesce(jsonb_agg(${ARTIST()} ORDER BY x.ord), '[]') FROM unnest(a.artists) WITH ORDINALITY x(id, ord) JOIN artists ar ON ar.id = x.id)) AS j
    FROM albums a WHERE a.name ILIKE ${like(q)} ORDER BY ${rank(sql`a.name`, q)} LIMIT ${limit}`.then((r) => r.map((x) => x.j));

export const searchTracks = (q: string, limit = 20) =>
  sql`
    SELECT ${TRACK()} || jsonb_build_object('full_album', ${ALBUM()}, 'full_artists',
      (SELECT coalesce(jsonb_agg(${ARTIST()} ORDER BY x.ord), '[]') FROM unnest(t.artists) WITH ORDINALITY x(id, ord) JOIN artists ar ON ar.id = x.id)) AS j
    FROM tracks t LEFT JOIN albums a ON a.id = t.album WHERE t.name ILIKE ${like(q)} ORDER BY ${rank(sql`t.name`, q)} LIMIT ${limit}`.then((r) =>
    r.map((x) => x.j),
  );

/** First and last play of the plays matching `where`, each with its track (and the track's album). */
async function firstLast(u: User, where: Fragment, extra?: (p: string) => Fragment) {
  const pick = (dir: Fragment) => sql`
    SELECT ${INFO()} || jsonb_build_object('track', ${TRACK_WITH_ALBUM()}) ${extra ? sql`|| ${extra("p")}` : sql``} AS j
    FROM plays p JOIN tracks t ON t.id = p.track_id JOIN albums a ON a.id = t.album
    WHERE p.user_id = ${u.id} AND ${where} ORDER BY p.played_at ${dir} LIMIT 1`;
  const [[first], [last]] = await Promise.all([pick(sql`ASC`), pick(sql`DESC`)]);
  return first ? { _id: null, first: first.j, last: last.j } : undefined;
}

/** The two months with the most plays, with the total. */
async function bestPeriod(u: User, where: Fragment) {
  const rows = await sql`
    SELECT extract(year FROM ${local(u)})::int AS year, extract(month FROM ${local(u)})::int AS month, count(*)::int AS count,
      (sum(count(*)) OVER ())::int AS total
    FROM plays p WHERE p.user_id = ${u.id} AND ${where}
    GROUP BY 1, 2 ORDER BY count DESC, year DESC, month DESC LIMIT 2`;
  return rows.map((r) => ({ _id: { year: r.year, month: r.month }, count: r.count, total: r.total }));
}

// --- Artist ---

export async function artistStats(u: User, artistId: string) {
  const where = sql`p.primary_artist_id = ${artistId}`;
  const [[artist], fl, mostListened, albumMostListened, period, [total], dayRepartition] = await Promise.all([
    getArtists([artistId]),
    firstLast(u, where, (p) => sql`jsonb_build_object('artistInfos', jsonb_build_object('_id', ${sql(p)}.track_id, 'trackId', ${sql(p)}.track_id, 'artistId', ${sql(p)}.primary_artist_id))`),
    sql`
      SELECT g.id, g.count, ${TRACK_WITH_ALBUM()} AS track
      FROM (SELECT p.track_id AS id, count(*)::int AS count FROM plays p WHERE p.user_id = ${u.id} AND ${where}
            GROUP BY p.track_id ORDER BY count DESC, p.track_id LIMIT 10) g
      JOIN tracks t ON t.id = g.id JOIN albums a ON a.id = t.album ORDER BY g.count DESC, g.id`,
    sql`
      SELECT g.id, g.count, ${ALBUM()} AS album
      FROM (SELECT p.album_id AS id, count(*)::int AS count FROM plays p WHERE p.user_id = ${u.id} AND ${where}
            GROUP BY p.album_id ORDER BY count DESC, p.album_id LIMIT 10) g
      JOIN albums a ON a.id = g.id ORDER BY g.count DESC, g.id`,
    bestPeriod(u, where),
    sql`
      SELECT count(*)::int AS count, count(DISTINCT p.track_id)::int AS differents, coalesce(sum(p.duration_ms), 0)::float8 AS duration_ms
      FROM plays p WHERE p.user_id = ${u.id} AND ${where}`,
    sql`
      SELECT extract(hour FROM ${local(u)})::int AS hour, count(*)::int AS count, sum(p.duration_ms)::float8 AS duration
      FROM plays p WHERE p.user_id = ${u.id} AND ${where} GROUP BY 1 ORDER BY 1`,
  ]);
  if (!artist) return null;
  if (!total.count) return { code: "NEVER_LISTENED" as const };
  return {
    artist,
    firstLast: fl,
    mostListened: mostListened.map((r) => ({ _id: r.id, count: r.count, track: r.track })),
    albumMostListened: albumMostListened.map((r) => ({ _id: r.id, count: r.count, album: r.album })),
    bestPeriod: period,
    total: { _id: 1, count: total.count, differents: total.differents, duration_ms: total.durationMs },
    dayRepartition: dayRepartition.map((r) => ({ _id: r.hour, count: r.count, duration: r.duration })),
  };
}

/** The user's most played tracks of an artist (for "top of artist" playlists). */
export async function mostListenedOfArtist(u: User, artistId: string, nb: number) {
  return sql<{ id: string; count: number }[]>`
    SELECT track_id AS id, count(*)::int AS count FROM plays
    WHERE user_id = ${u.id} AND primary_artist_id = ${artistId} GROUP BY track_id ORDER BY count DESC, track_id LIMIT ${nb}`;
}

// --- Album ---

export async function albumStats(u: User, albumId: string) {
  const where = sql`p.album_id = ${albumId}`;
  const [[album], fl, tracks, period, [total]] = await Promise.all([
    getAlbums([albumId]),
    firstLast(u, where),
    sql`
      SELECT g.id, g.count, ${TRACK()} AS track
      FROM (SELECT p.track_id AS id, count(*)::int AS count FROM plays p WHERE p.user_id = ${u.id} AND ${where} GROUP BY p.track_id) g
      JOIN tracks t ON t.id = g.id ORDER BY g.count DESC, g.id`,
    bestPeriod(u, where),
    sql`
      SELECT count(*)::int AS count, count(DISTINCT p.track_id)::int AS differents, coalesce(sum(p.duration_ms), 0)::float8 AS duration_ms
      FROM plays p WHERE p.user_id = ${u.id} AND ${where}`,
  ]);
  if (!album) return null;
  const artists = await getArtists(album.artists);
  artists.sort((a, b) => album.artists.indexOf(a.id) - album.artists.indexOf(b.id));
  return {
    album,
    artists,
    firstLast: fl,
    tracks: tracks.map((r) => ({ _id: r.id, count: r.count, track: r.track })),
    // Added by this app.
    bestPeriod: period,
    total: { count: total.count, differents: total.differents, duration_ms: total.durationMs },
  };
}

// --- Track ---

export async function trackStats(u: User, trackId: string) {
  const where = sql`p.track_id = ${trackId}`;
  const [[track], [count], period, [first], [last], recent] = await Promise.all([
    getTracks([trackId]),
    sql`SELECT count(*)::int AS n FROM plays p WHERE p.user_id = ${u.id} AND ${where}`,
    bestPeriod(u, where),
    sql`SELECT ${INFO()} AS j FROM plays p WHERE p.user_id = ${u.id} AND ${where} ORDER BY p.played_at ASC LIMIT 1`,
    sql`SELECT ${INFO()} AS j FROM plays p WHERE p.user_id = ${u.id} AND ${where} ORDER BY p.played_at DESC LIMIT 1`,
    sql`SELECT ${INFO()} AS j FROM plays p WHERE p.user_id = ${u.id} AND ${where} ORDER BY p.played_at DESC LIMIT 10`,
  ]);
  if (!track || !track.artists[0]) return null;
  if (!count.n) return { code: "NEVER_LISTENED" as const };
  const [[album], [artist]] = await Promise.all([getAlbums([track.album]), getArtists([track.artists[0]])]);
  return {
    track,
    artist,
    album,
    bestPeriod: period,
    firstLast: { _id: null, first: first?.j, last: last?.j },
    recentHistory: recent.map((r) => r.j),
    total: { count: count.n },
  };
}

// --- Over time, for one item (this app's entity pages) ---

/** Plays and listening time per month (or day) of one artist, album or track. */
export async function itemTimeline(u: User, type: "track" | "album" | "artist", id: string, unit: "day" | "month") {
  const col = sql(type === "track" ? "track_id" : type === "album" ? "album_id" : "primary_artist_id");
  return sql<{ date: string; count: number; ms: number }[]>`
    SELECT to_char(date_trunc(${unit}, ${local(u)}), 'YYYY-MM-DD') AS date, count(*)::int AS count, sum(p.duration_ms)::float8 AS ms
    FROM plays p WHERE p.user_id = ${u.id} AND p.${col} = ${id} GROUP BY 1 ORDER BY 1`;
}
