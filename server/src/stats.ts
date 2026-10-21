// YourSpotify's statistics, as PostgreSQL queries. Each function returns exactly what the matching
// YourSpotify route returned (field names included), so clients built for it keep working.
//
// Periods are grouped in the user's time zone. YourSpotify's `_id` for a period is
// { year, month?, week?, day?, hour? } (weeks numbered like MongoDB's $week: Sunday-based, 0–53).

import { sql, type Fragment } from "./db.ts";
import { tzOf, type User } from "./users.ts";

export type Timesplit = "all" | "hour" | "day" | "week" | "month" | "year";
export const TIMESPLITS: Timesplit[] = ["all", "hour", "day", "week", "month", "year"];

const SPLIT_COLS: Record<Timesplit, string[]> = {
  all: [],
  year: ["year"],
  month: ["year", "month"],
  week: ["year", "week"],
  day: ["year", "month", "day"],
  hour: ["year", "month", "day", "hour"],
};

export type ItemType = "track" | "album" | "artist";
const KEY: Record<ItemType, string> = { track: "track_id", album: "album_id", artist: "primary_artist_id" };

// --- JSON of catalog rows, in Spotify's (and YourSpotify's) shape ---

export const TRACK = (t = "t") => sql`(to_jsonb(${sql(t)}) || jsonb_build_object('_id', ${sql(t)}.id, 'type', 'track'))`;
export const ALBUM = (a = "a") => sql`(to_jsonb(${sql(a)}) || jsonb_build_object('_id', ${sql(a)}.id, 'type', 'album'))`;
export const ARTIST = (ar = "ar") => sql`(to_jsonb(${sql(ar)}) || jsonb_build_object('_id', ${sql(ar)}.id, 'type', 'artist'))`;
/** A track with its album object in place of the album id. */
export const TRACK_WITH_ALBUM = (t = "t", a = "a") => sql`(${TRACK(t)} || jsonb_build_object('album', ${ALBUM(a)}))`;
/** A play, as YourSpotify's "infos" documents. */
export const INFO = (p = "p") => sql`jsonb_build_object(
  '_id', ${sql(p)}.id::text, 'owner', ${sql(p)}.user_id, 'id', ${sql(p)}.track_id, 'albumId', ${sql(p)}.album_id,
  'primaryArtistId', ${sql(p)}.primary_artist_id, 'artistIds', ${sql(p)}.artist_ids, 'durationMs', ${sql(p)}.duration_ms,
  'played_at', ${sql(p)}.played_at)`;

const TABLE: Record<ItemType, { table: string; json: () => Fragment }> = {
  track: { table: "tracks", json: () => TRACK("e") },
  album: { table: "albums", json: () => ALBUM("e") },
  artist: { table: "artists", json: () => ARTIST("e") },
};

// --- Building blocks ---

/** The user's plays in [start, end] (exclusive), with their local date parts. Blacklisted artists left out. */
function base(u: User, start: Date, end: Date) {
  return sql`
    SELECT p.*, extract(year FROM z.l)::int AS year, extract(month FROM z.l)::int AS month,
      extract(day FROM z.l)::int AS day, extract(hour FROM z.l)::int AS hour,
      ((extract(doy FROM z.l)::int + 6 - extract(dow FROM z.l)::int) / 7) AS week
    FROM plays p CROSS JOIN LATERAL (SELECT p.played_at AT TIME ZONE ${tzOf(u)} AS l) z
    WHERE p.user_id = ${u.id} AND NOT p.blacklisted AND p.played_at > ${start} AND p.played_at < ${end}`;
}

function split(s: Timesplit) {
  const cols = SPLIT_COLS[s];
  const has = cols.length > 0;
  return {
    cols,
    /** "year, month," (or nothing) at the start of a select list. */
    select: has ? sql`${sql(cols)},` : sql``,
    groupBy: has ? sql`GROUP BY ${sql(cols)}` : sql``,
    /** "year, month," at the start of a GROUP BY that has more columns. */
    groupPrefix: has ? sql`${sql(cols)},` : sql``,
    partition: has ? sql`PARTITION BY ${sql(cols)}` : sql``,
    orderBy: has ? sql`ORDER BY ${sql(cols)}` : sql``,
  };
}

/** YourSpotify's period `_id`: the date parts, or null for "all". */
function idOf(row: Record<string, unknown>, s: Timesplit) {
  const cols = SPLIT_COLS[s];
  return cols.length ? Object.fromEntries(cols.map((c) => [c, row[c]])) : null;
}

const metric = (u: User) => (u.metricUsed === "duration" ? sql`sum(duration_ms)::float8` : sql`count(*)::float8`);

// --- Over time ---

export async function songsPer(u: User, start: Date, end: Date, s: Timesplit) {
  const g = split(s);
  const rows = await sql`
    WITH b AS (${base(u, start, end)})
    SELECT ${g.select} count(*)::int AS count, count(DISTINCT track_id)::int AS differents FROM b ${g.groupBy} ${g.orderBy}`;
  return rows.filter((r) => r.count > 0).map((r) => ({ _id: idOf(r, s), count: r.count, differents: r.differents }));
}

export async function timePer(u: User, start: Date, end: Date, s: Timesplit) {
  const g = split(s);
  const rows = await sql`
    WITH b AS (${base(u, start, end)})
    SELECT ${g.select} sum(duration_ms)::float8 AS count, count(*)::int AS n FROM b ${g.groupBy} ${g.orderBy}`;
  return rows.filter((r) => r.n > 0).map((r) => ({ _id: idOf(r, s), count: r.count }));
}

/** Most played tracks of each period (the user's "number of elements"). */
export async function mostListenedSongs(u: User, start: Date, end: Date, s: Timesplit) {
  const g = split(s);
  const rows = await sql`
    WITH b AS (${base(u, start, end)}),
    c AS (SELECT ${g.select} track_id, count(*)::int AS cnt FROM b GROUP BY ${g.groupPrefix} track_id),
    r AS (SELECT c.*, row_number() OVER (${g.partition} ORDER BY cnt DESC, track_id) AS rn FROM c)
    SELECT ${g.select} jsonb_agg(${TRACK_WITH_ALBUM()} ORDER BY rn) AS tracks, array_agg(r.cnt ORDER BY rn) AS counts
    FROM r JOIN tracks t ON t.id = r.track_id JOIN albums a ON a.id = t.album
    WHERE rn <= ${u.nbElements} ${g.groupBy} ${g.orderBy}`;
  return rows.map((r) => ({ _id: idOf(r, s), tracks: r.tracks, counts: r.counts }));
}

/** Most listened artists of each period, by plays or time (the user's metric). */
export async function bestArtistsPer(u: User, start: Date, end: Date, s: Timesplit) {
  const g = split(s);
  const rows = await sql`
    WITH b AS (${base(u, start, end)}),
    c AS (SELECT ${g.select} primary_artist_id, ${metric(u)} AS cnt FROM b GROUP BY ${g.groupPrefix} primary_artist_id),
    r AS (SELECT c.*, row_number() OVER (${g.partition} ORDER BY cnt DESC, primary_artist_id) AS rn FROM c)
    SELECT ${g.select} jsonb_agg(${ARTIST()} ORDER BY rn) AS artists, array_agg(r.cnt ORDER BY rn) AS counts
    FROM r JOIN artists ar ON ar.id = r.primary_artist_id
    WHERE rn <= ${u.nbElements} ${g.groupBy} ${g.orderBy}`;
  return rows.map((r) => ({ _id: idOf(r, s), artists: r.artists, counts: r.counts }));
}

/** Average release year of what was played. */
export async function albumDateRatio(u: User, start: Date, end: Date, s: Timesplit) {
  const g = split(s);
  const rows = await sql`
    WITH b AS (${base(u, start, end)})
    SELECT ${g.select} avg(nullif(substring(a.release_date FROM '^\\d{4}'), '')::int)::float8 AS total_year, count(*)::int AS count
    FROM b JOIN albums a ON a.id = b.album_id ${g.groupBy} ${g.orderBy}`;
  return rows.filter((r) => r.count > 0).map((r) => ({ _id: idOf(r, s), totalYear: r.totalYear ?? 0, count: r.count }));
}

/** How many artists are on the tracks played (features). */
export async function featRatio(u: User, start: Date, end: Date, s: Timesplit) {
  const g = split(s);
  const rows = await sql`
    WITH b AS (${base(u, start, end)})
    SELECT ${g.select}
      count(*) FILTER (WHERE cardinality(artist_ids) = 1)::int AS n1, count(*) FILTER (WHERE cardinality(artist_ids) = 2)::int AS n2,
      count(*) FILTER (WHERE cardinality(artist_ids) = 3)::int AS n3, count(*) FILTER (WHERE cardinality(artist_ids) = 4)::int AS n4,
      count(*) FILTER (WHERE cardinality(artist_ids) = 5)::int AS n5,
      sum(cardinality(artist_ids))::int AS total_people, count(*)::int AS count
    FROM b ${g.groupBy} ${g.orderBy}`;
  return rows
    .filter((r) => r.count > 0)
    .map((r) => ({
      _id: idOf(r, s),
      1: r.n1,
      2: r.n2,
      3: r.n3,
      4: r.n4,
      5: r.n5,
      count: r.count,
      totalPeople: r.totalPeople,
      average: r.totalPeople / r.count,
    }));
}

/** Every artist of each period, most played first. */
export async function differentArtistsPer(u: User, start: Date, end: Date, s: Timesplit) {
  const g = split(s);
  const rows = await sql`
    WITH b AS (${base(u, start, end)}),
    c AS (SELECT ${g.select} primary_artist_id, count(*)::int AS cnt FROM b GROUP BY ${g.groupPrefix} primary_artist_id)
    SELECT ${g.select} jsonb_agg(${ARTIST()} ORDER BY c.cnt DESC, c.primary_artist_id) AS artists,
      array_agg(c.cnt ORDER BY c.cnt DESC, c.primary_artist_id) AS counts, count(*)::int AS differents
    FROM c JOIN artists ar ON ar.id = c.primary_artist_id ${g.groupBy} ${g.orderBy}`;
  return rows.map((r) => ({ _id: idOf(r, s), artists: r.artists, differents: r.differents, counts: r.counts }));
}

/** Listening per hour of the day (plays or time). */
export async function hourRepartition(u: User, start: Date, end: Date) {
  const rows = await sql`WITH b AS (${base(u, start, end)}) SELECT hour, ${metric(u)} AS count FROM b GROUP BY hour ORDER BY hour`;
  return rows.map((r) => ({ _id: r.hour, count: r.count }));
}

// --- Tops ---

/** Top tracks, albums or artists, with the totals of the range (YourSpotify's /spotify/top/*). */
export async function best(type: ItemType, u: User, start: Date, end: Date, nb: number, offset: number) {
  const key = sql(KEY[type]);
  const rows = await sql`
    WITH b AS (${base(u, start, end)}),
    g AS (
      SELECT ${key} AS key, sum(duration_ms)::float8 AS duration_ms, count(*)::int AS count,
        mode() WITHIN GROUP (ORDER BY track_id) AS track_id, mode() WITHIN GROUP (ORDER BY album_id) AS album_id,
        mode() WITHIN GROUP (ORDER BY primary_artist_id) AS primary_artist_id, count(DISTINCT track_id)::int AS differents
      FROM b GROUP BY ${key}
    ),
    tot AS (SELECT sum(duration_ms)::float8 AS total_duration_ms, sum(count)::int AS total_count FROM g)
    SELECT g.*, tot.*, ${TRACK()} AS track, ${ALBUM()} AS album, ${ARTIST()} AS artist
    FROM g CROSS JOIN tot
      JOIN tracks t ON t.id = g.track_id JOIN albums a ON a.id = g.album_id JOIN artists ar ON ar.id = g.primary_artist_id
    ORDER BY ${u.metricUsed === "duration" ? sql`g.duration_ms` : sql`g.count`} DESC, g.key
    LIMIT ${nb} OFFSET ${offset}`;
  return rows.map((r) => ({
    _id: r.key,
    duration_ms: r.durationMs,
    count: r.count,
    trackId: r.trackId,
    albumId: r.albumId,
    primaryArtistId: r.primaryArtistId,
    differents: r.differents,
    total_duration_ms: r.totalDurationMs,
    total_count: r.totalCount,
    track: r.track,
    album: r.album,
    artist: r.artist,
  }));
}

/** For each hour of the day, its 20 most played items. */
export async function bestOfHour(type: ItemType, u: User, start: Date, end: Date) {
  const key = sql(KEY[type]);
  const { table, json } = TABLE[type];
  const rows = await sql`
    WITH b AS (${base(u, start, end)}),
    g AS (SELECT hour, ${key} AS item_id, count(*)::int AS total FROM b GROUP BY hour, ${key}),
    r AS (
      SELECT g.*, row_number() OVER (PARTITION BY hour ORDER BY total DESC, item_id) AS rn,
        (sum(total) OVER (PARTITION BY hour))::int AS hour_total
      FROM g
    )
    SELECT hour, max(hour_total) AS total, jsonb_agg(jsonb_build_object('itemId', item_id, 'total', r.total) ORDER BY rn) AS items,
      jsonb_object_agg(e.id, ${json()}) AS full_items
    FROM r JOIN ${sql(table)} e ON e.id = r.item_id
    WHERE rn <= 20 GROUP BY hour ORDER BY hour`;
  return rows.map((r) => ({ _id: r.hour, hour: r.hour, total: r.total, items: r.items, full_items: r.fullItems }));
}

/**
 * The five longest listening sessions: plays less than 10 minutes apart (from the end of one
 * track to the start of the next) belong to the same session.
 */
export async function longestSessions(u: User, start: Date, end: Date) {
  const rows = await sql`
    WITH b AS (
      SELECT p.* FROM plays p
      WHERE p.user_id = ${u.id} AND NOT p.blacklisted AND p.played_at > ${start} AND p.played_at < ${end}
    ),
    d AS (
      SELECT b.*, CASE WHEN lag(played_at) OVER w IS NULL THEN 600001
        ELSE extract(epoch FROM played_at - lag(played_at) OVER w) * 1000 - lag(duration_ms) OVER w END AS subtract
      FROM b WINDOW w AS (ORDER BY played_at)
    ),
    s AS (SELECT d.*, sum(CASE WHEN subtract > 600000 THEN 1 ELSE 0 END) OVER (ORDER BY played_at ROWS UNBOUNDED PRECEDING) AS sid FROM d),
    agg AS (
      SELECT sid, (extract(epoch FROM max(played_at) - min(played_at)) * 1000)::float8 AS session_length,
        jsonb_agg(jsonb_build_object('subtract', subtract, 'info', ${INFO("s")}) ORDER BY played_at) AS distance,
        array_agg(DISTINCT track_id) AS track_ids
      FROM s GROUP BY sid ORDER BY session_length DESC LIMIT 5
    )
    SELECT agg.session_length, agg.distance,
      (SELECT jsonb_object_agg(t.id, ${TRACK()}) FROM tracks t WHERE t.id = ANY(agg.track_ids)) AS full_tracks
    FROM agg ORDER BY agg.session_length DESC`;
  return rows.map((r) => ({ _id: u.id, sessionLength: r.sessionLength, distanceToLast: { distance: r.distance }, full_tracks: r.fullTracks ?? {} }));
}

/** Where an item ranks among everything the user ever played, with its neighbours. */
export async function rankOf(type: ItemType, u: User, itemId: string) {
  const key = sql(KEY[type]);
  const rows = await sql<{ id: string; count: number; idx: number; n: number }[]>`
    WITH g AS (SELECT ${key} AS id, count(*)::int AS count FROM plays WHERE user_id = ${u.id} GROUP BY ${key}),
    r AS (SELECT id, count, (row_number() OVER (ORDER BY count DESC, id) - 1)::int AS idx, (count(*) OVER ())::int AS n FROM g),
    me AS (SELECT idx FROM r WHERE id = ${itemId})
    SELECT r.*, coalesce((SELECT idx FROM me), -1) AS me FROM r
    WHERE r.idx BETWEEN greatest(coalesce((SELECT idx FROM me), 0) - 1, 0) AND greatest(coalesce((SELECT idx FROM me), 0) - 1, 0) + 2
    ORDER BY r.idx`;
  const index = rows.length ? (rows[0] as unknown as { me: number }).me : -1;
  const n = rows[0]?.n ?? 0;
  return { _id: 1, index, isMax: index === 0, isMin: index >= 0 && index === n - 1, results: rows.map((r) => ({ id: r.id, count: r.count })) };
}

// --- History ---

/** Recently played, newest first, with each track's album and artists (YourSpotify's /spotify/gethistory). */
export async function history(u: User, offset: number, number: number, range?: { start: Date; end: Date }) {
  const rows = await sql`
    SELECT ${INFO()} || jsonb_build_object('track', ${TRACK()} || jsonb_build_object(
      'full_album', ${ALBUM()},
      'full_artists', (SELECT coalesce(jsonb_agg(${ARTIST()} ORDER BY x.ord), '[]') FROM unnest(t.artists) WITH ORDINALITY x(id, ord) JOIN artists ar ON ar.id = x.id)
    )) AS info
    FROM plays p JOIN tracks t ON t.id = p.track_id LEFT JOIN albums a ON a.id = t.album
    WHERE p.user_id = ${u.id} AND NOT p.blacklisted
      ${range ? sql`AND p.played_at > ${range.start} AND p.played_at < ${range.end}` : sql``}
    ORDER BY p.played_at DESC LIMIT ${number} OFFSET ${offset}`;
  return rows.map((r) => r.info);
}

// --- Several users (affinity) ---

export type CollaborativeMode = "average" | "minima";

/**
 * What a group of users all like: each item's share of each user's plays, ranked by the average
 * share ("average") or by the smallest one ("minima": only what everyone listens to).
 */
export async function collaborative(type: ItemType, userIds: string[], start: Date, end: Date, mode: CollaborativeMode, limit: number) {
  const ids = [...new Set(userIds)];
  const key = sql(KEY[type]);
  const rows = await sql`
    WITH b AS (
      SELECT user_id, track_id, album_id, primary_artist_id FROM plays
      WHERE user_id = ANY(${ids}) AND NOT blacklisted AND played_at > ${start} AND played_at < ${end}
    ),
    tot AS (SELECT user_id, count(*)::float8 AS total FROM b GROUP BY user_id),
    g AS (
      SELECT ${key} AS key, user_id, count(*)::int AS c, mode() WITHIN GROUP (ORDER BY track_id) AS track_id,
        mode() WITHIN GROUP (ORDER BY album_id) AS album_id
      FROM b GROUP BY ${key}, user_id
    ),
    items AS (
      SELECT g.key, jsonb_object_agg(g.user_id, g.c) AS counts, jsonb_object_agg(g.user_id, g.c / tot.total) AS percents,
        sum(g.c / tot.total) / ${ids.length} AS average_percents,
        CASE WHEN count(*) = ${ids.length} THEN min(g.c / tot.total) ELSE 0 END AS minima,
        mode() WITHIN GROUP (ORDER BY g.track_id) AS track_id, mode() WITHIN GROUP (ORDER BY g.album_id) AS album_id
      FROM g JOIN tot USING (user_id) GROUP BY g.key
    )
    SELECT items.*,
      ${type === "track" ? sql`${TRACK()} AS track, ${ALBUM()} AS album, ${ARTIST()} AS artist` : type === "album" ? sql`${ALBUM()} AS album, ${ARTIST()} AS artist` : sql`${ARTIST()} AS artist`}
    FROM items
      ${
        type === "track"
          ? sql`JOIN tracks t ON t.id = items.key JOIN albums a ON a.id = t.album JOIN artists ar ON ar.id = t.artists[1]`
          : type === "album"
            ? sql`JOIN albums a ON a.id = items.key JOIN artists ar ON ar.id = a.artists[1]`
            : sql`JOIN artists ar ON ar.id = items.key`
      }
    ORDER BY ${mode === "minima" ? sql`items.minima` : sql`items.average_percents`} DESC, items.key
    LIMIT ${limit}`;
  const totals = await sql<{ userId: string; total: number }[]>`
    SELECT user_id, count(*)::int AS total FROM plays
    WHERE user_id = ANY(${ids}) AND NOT blacklisted AND played_at > ${start} AND played_at < ${end} GROUP BY user_id`;
  const totalOf = new Map(totals.map((t) => [t.userId, t.total]));
  return rows.map((r) => {
    const out: Record<string, unknown> = { _id: r.key };
    for (const id of ids) {
      out[id] = r.counts[id] ?? 0;
      out[`total_${id}`] = totalOf.get(id) ?? 0;
      out[`percent_${id}`] = r.percents[id] ?? 0;
    }
    out.average_percents = r.averagePercents;
    out.minima = r.minima;
    if (r.track) out.track = r.track;
    if (r.album) out.album = r.album;
    out.artist = r.artist;
    return out;
  });
}

/** How many different artists, songs and albums each period has (this app's lighter take on different_artists_per). */
export async function varietyPer(u: User, start: Date, end: Date, s: Timesplit) {
  const g = split(s);
  const rows = await sql`
    WITH b AS (${base(u, start, end)})
    SELECT ${g.select} count(DISTINCT primary_artist_id)::int AS artists, count(DISTINCT track_id)::int AS tracks,
      count(DISTINCT album_id)::int AS albums, count(*)::int AS plays
    FROM b ${g.groupBy} ${g.orderBy}`;
  return rows.filter((r) => r.plays > 0).map((r) => ({ _id: idOf(r, s), artists: r.artists, tracks: r.tracks, albums: r.albums }));
}
