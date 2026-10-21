// What this app adds to YourSpotify's API (under /api/app): the dashboard's day-by-day summary,
// the activity calendar and weekly rhythm, devices, statistics, export and user admin.
//
// Ranges here are local days ("from" and "to", both included) in the user's time zone.

import { Hono, type Context } from "hono";
import { stream } from "hono/streaming";
import { sql } from "./db.ts";
import { APP_VERSION, DEFAULT_TIMEZONE, POLL_INTERVAL_SECONDS, UPDATE_CHECK, spotify } from "./config.ts";
import { requireAdmin, requireUser, requireUserOrGuest, signOutEverywhere, type AppEnv } from "./auth.ts";
import { sha256 } from "./crypto.ts";
import { bad, body, isDate, rateLimit, str } from "./http.ts";
import { RELEASES_URL, updateStatus } from "./updates.ts";
import { itemTimeline } from "./entities.ts";
import { ARTIST, TIMESPLITS, varietyPer, type Timesplit } from "./stats.ts";
import { deleteUser } from "./routes.ts";
import { pollStats, pollUser } from "./spotify/poller.ts";
import { tzOf, type User } from "./users.ts";

export const appRoutes = new Hono<AppEnv>();

/** Today in the user's time zone. */
function today(tz: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** The local days asked for; without `from`, since the first play. */
async function days(c: Context<AppEnv>, user: User) {
  const tz = tzOf(user);
  const { from, to } = c.req.query();
  const end = isDate(to) ? to : today(tz);
  let start = isDate(from) ? from : null;
  if (!start) {
    const [r] = await sql<{ d: string | null }[]>`
      SELECT to_char(min(played_at) AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS d FROM plays WHERE user_id = ${user.id}`;
    start = r.d ?? end;
  }
  if (start > end) throw bad("The range ends before it starts");
  return { tz, from: start, to: end };
}

/** Plays from local day `from` to local day `to` (included). */
const inDays = (user: User, tz: string, from: string, to: string) => sql`
  p.user_id = ${user.id} AND NOT p.blacklisted
  AND p.played_at >= (${from}::date::timestamp AT TIME ZONE ${tz})
  AND p.played_at < ((${to}::date + 1)::timestamp AT TIME ZONE ${tz})`;

const SERIES = 8;

/**
 * The dashboard: totals, every day of the range (listening time, plays, and the time of the
 * range's top artists, for the stacked chart).
 */
appRoutes.get("/summary", requireUserOrGuest, async (c) => {
  const user = c.get("user");
  const { tz, from, to } = await days(c, user);
  const where = inDays(user, tz, from, to);
  const [[totals], top, perDay] = await Promise.all([
    sql<{ ms: number; plays: number; tracks: number; artists: number; albums: number }[]>`
      SELECT coalesce(sum(duration_ms), 0)::float8 AS ms, count(*)::int AS plays, count(DISTINCT track_id)::int AS tracks,
        count(DISTINCT primary_artist_id)::int AS artists, count(DISTINCT album_id)::int AS albums
      FROM plays p WHERE ${where}`,
    sql<{ id: string; ms: number; plays: number; artist: unknown }[]>`
      SELECT g.id, g.ms, g.plays, ${ARTIST()} AS artist FROM (
        SELECT primary_artist_id AS id, sum(duration_ms)::float8 AS ms, count(*)::int AS plays
        FROM plays p WHERE ${where} GROUP BY 1 ORDER BY ms DESC LIMIT ${SERIES}
      ) g JOIN artists ar ON ar.id = g.id ORDER BY g.ms DESC`,
    sql<{ date: string; artist: string; ms: number; plays: number }[]>`
      SELECT to_char(p.played_at AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS date, p.primary_artist_id AS artist,
        sum(p.duration_ms)::float8 AS ms, count(*)::int AS plays
      FROM plays p WHERE ${where} GROUP BY 1, 2`,
  ]);
  const series = new Set(top.map((t) => t.id));
  const byDay = new Map<string, { date: string; ms: number; plays: number; artists: Record<string, number> }>();
  for (let d = from; d <= to; d = addDay(d)) byDay.set(d, { date: d, ms: 0, plays: 0, artists: {} });
  for (const r of perDay) {
    const day = byDay.get(r.date);
    if (!day) continue;
    day.ms += r.ms;
    day.plays += r.plays;
    if (series.has(r.artist)) day.artists[r.artist] = (day.artists[r.artist] ?? 0) + r.ms;
  }
  return c.json({ from, to, ...totals, top: top.map((t) => ({ ms: t.ms, plays: t.plays, artist: t.artist })), days: [...byDay.values()] });
});

const addDay = (d: string) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10);
};

/** Listening time per day over the last year (or `days`), for the activity calendar. */
appRoutes.get("/activity", requireUserOrGuest, async (c) => {
  const user = c.get("user");
  const tz = tzOf(user);
  const n = Math.min(Math.max(Number(c.req.query("days")) || 371, 7), 3660);
  const to = today(tz);
  const start = new Date(`${to}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - n + 1);
  const from = start.toISOString().slice(0, 10);
  const rows = await sql<{ date: string; ms: number; plays: number }[]>`
    SELECT to_char(p.played_at AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS date, sum(duration_ms)::float8 AS ms, count(*)::int AS plays
    FROM plays p WHERE ${inDays(user, tz, from, to)} GROUP BY 1`;
  const map = new Map(rows.map((r) => [r.date, r]));
  const out = [];
  for (let d = from; d <= to; d = addDay(d)) out.push({ date: d, ms: map.get(d)?.ms ?? 0, plays: map.get(d)?.plays ?? 0 });
  return c.json(out);
});

/** Listening time by weekday (0 = Sunday) and hour: a 7 × 24 grid of milliseconds. */
appRoutes.get("/rhythm", requireUserOrGuest, async (c) => {
  const user = c.get("user");
  const { tz, from, to } = await days(c, user);
  const rows = await sql<{ dow: number; hour: number; ms: number }[]>`
    SELECT extract(dow FROM p.played_at AT TIME ZONE ${tz})::int AS dow, extract(hour FROM p.played_at AT TIME ZONE ${tz})::int AS hour,
      sum(duration_ms)::float8 AS ms
    FROM plays p WHERE ${inDays(user, tz, from, to)} GROUP BY 1, 2`;
  const grid = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const r of rows) grid[r.dow][r.hour] = r.ms;
  return c.json(grid);
});

/** Plays and time per month (or day) of one artist, album or track. */
appRoutes.get("/timeline/:type/:id", requireUserOrGuest, async (c) => {
  const type = c.req.param("type");
  if (type !== "track" && type !== "album" && type !== "artist") throw bad("Unknown type");
  return c.json(await itemTimeline(c.get("user"), type, c.req.param("id"), c.req.query("unit") === "day" ? "day" : "month"));
});

/** Different artists, songs and albums per period (start, end, timeSplit as on the /spotify routes). */
appRoutes.get("/variety", requireUserOrGuest, async (c) => {
  const start = new Date(c.req.query("start") ?? "");
  const end = c.req.query("end") ? new Date(c.req.query("end")!) : new Date();
  const s = (c.req.query("timeSplit") ?? "day") as Timesplit;
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || !TIMESPLITS.includes(s)) throw bad("Invalid range");
  return c.json(await varietyPer(c.get("user"), start, end, s));
});

/**
 * Listening streaks: runs of consecutive local days with at least one play. The current one still
 * counts if it ended yesterday (today isn't over); the longest is all time.
 */
appRoutes.get("/streaks", requireUserOrGuest, async (c) => {
  const user = c.get("user");
  const tz = tzOf(user);
  const runs = await sql<{ start: string; end: string; days: number }[]>`
    WITH d AS (SELECT DISTINCT (played_at AT TIME ZONE ${tz})::date AS day FROM plays WHERE user_id = ${user.id} AND NOT blacklisted),
    g AS (SELECT day, day - (row_number() OVER (ORDER BY day))::int AS grp FROM d),
    r AS (SELECT min(day) AS first_day, max(day) AS last_day, count(*)::int AS days FROM g GROUP BY grp)
    SELECT to_char(first_day, 'YYYY-MM-DD') AS start, to_char(last_day, 'YYYY-MM-DD') AS end, days FROM r
    WHERE last_day >= ${today(tz)}::date - 1 OR days = (SELECT max(days) FROM r)`;
  const yesterday = new Date(`${today(tz)}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const current = runs.find((r) => r.end >= yesterday.toISOString().slice(0, 10)) ?? null;
  const longest = runs.reduce<(typeof runs)[number] | null>((best, r) => (!best || r.days > best.days || (r.days === best.days && r.end > best.end) ? r : best), null);
  return c.json({ current, longest, today: today(tz) });
});

// --- Server ---

appRoutes.get("/server", (c) =>
  c.json({ spotify: !!spotify, version: APP_VERSION, defaultTimezone: DEFAULT_TIMEZONE, pollIntervalSeconds: POLL_INTERVAL_SECONDS }),
);

/** Whether a newer release is out. `?refresh=1` skips the cache (the "Check for updates" button). */
appRoutes.get("/updates", requireUser, async (c) => {
  if (!UPDATE_CHECK) {
    return c.json({ current: APP_VERSION, latest: null, available: false, releasesUrl: RELEASES_URL, checkedAt: null, disabled: true });
  }
  const refresh = c.req.query("refresh") === "1";
  if (refresh) rateLimit(c, "update-check", 10, 60 * 60_000);
  return c.json(await updateStatus(refresh));
});

/** Fetch recently played now instead of waiting for the next round. */
appRoutes.post("/poll", requireUser, async (c) => {
  rateLimit(c, "poll", 6, 60_000);
  const added = await pollUser(c.get("user").id).catch((e: Error) => {
    throw bad(e.message);
  });
  return c.json({ added });
});

// --- Devices (sessions) ---

appRoutes.get("/sessions", requireUser, async (c) => {
  const current = c.get("session")!.id;
  const rows = await sql<{ id: string; method: string; userAgent: string; ip: string; createdAt: Date; lastSeenAt: Date }[]>`
    SELECT id, method, user_agent, ip, created_at, last_seen_at FROM sessions
    WHERE user_id = ${c.get("user").id} AND expires_at > now() ORDER BY last_seen_at DESC`;
  // The id is the token's hash; hash it again so the page never sees anything a cookie could be checked against.
  return c.json(rows.map((r) => ({ ...r, id: sha256(r.id).slice(0, 24), current: r.id === current })));
});

appRoutes.delete("/sessions/:id", requireUser, async (c) => {
  const rows = await sql<{ id: string }[]>`SELECT id FROM sessions WHERE user_id = ${c.get("user").id}`;
  const target = rows.find((r) => sha256(r.id).slice(0, 24) === c.req.param("id"));
  if (target) await sql`DELETE FROM sessions WHERE id = ${target.id}`;
  return c.json({ ok: true });
});

appRoutes.post("/sessions/revoke-others", requireUser, async (c) => {
  await signOutEverywhere(c.get("user").id, c.get("session")!.id);
  return c.json({ ok: true });
});

// --- Your data ---

appRoutes.get("/export", requireUser, async (c) => {
  const user = c.get("user");
  const csv = c.req.query("format") === "csv";
  c.header("Content-Type", csv ? "text/csv; charset=utf-8" : "application/x-ndjson; charset=utf-8");
  c.header("Content-Disposition", `attachment; filename="music-${today(tzOf(user))}.${csv ? "csv" : "ndjson"}"`);
  const cols = ["played_at", "track", "artist", "album", "duration_ms", "track_id", "artist_id", "album_id"];
  const quote = (v: unknown) => {
    const s = v instanceof Date ? v.toISOString() : String(v ?? "");
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return stream(c, async (out) => {
    if (csv) await out.write(cols.join(",") + "\n");
    const cursor = sql`
      SELECT p.played_at, t.name AS track, ar.name AS artist, a.name AS album, p.duration_ms,
        p.track_id, p.primary_artist_id AS artist_id, p.album_id
      FROM plays p LEFT JOIN tracks t ON t.id = p.track_id LEFT JOIN artists ar ON ar.id = p.primary_artist_id
        LEFT JOIN albums a ON a.id = p.album_id
      WHERE p.user_id = ${user.id} ORDER BY p.played_at`.cursor(2000);
    for await (const rows of cursor) {
      let chunk = "";
      for (const r of rows as Record<string, unknown>[]) {
        const values = [r.playedAt, r.track, r.artist, r.album, r.durationMs, r.trackId, r.artistId, r.albumId];
        chunk += csv ? values.map(quote).join(",") + "\n" : JSON.stringify(Object.fromEntries(cols.map((k, i) => [k, values[i]]))) + "\n";
      }
      await out.write(chunk);
    }
  });
});

appRoutes.post("/profile/delete-account", requireUser, async (c) => {
  const user = c.get("user");
  if (str((await body(c)).confirm, 100) !== user.username) throw bad("Type your name to confirm");
  if (user.isAdmin) {
    const [{ count }] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM users WHERE is_admin AND id <> ${user.id}`;
    const [{ others }] = await sql<{ others: number }[]>`SELECT count(*)::int AS others FROM users WHERE id <> ${user.id}`;
    if (count === 0 && others > 0) throw bad("You're the only admin. Make someone else an admin first.");
  }
  await deleteUser(user.id);
  return c.json({ ok: true });
});

// --- Statistics ---

const startedAt = Date.now();

appRoutes.get("/statistics", requireUser, async (c) => {
  const user = c.get("user");
  const [you] = await sql`
    SELECT count(*)::int AS plays, coalesce(sum(duration_ms), 0)::float8 AS ms, count(DISTINCT track_id)::int AS tracks,
      count(DISTINCT primary_artist_id)::int AS artists, count(DISTINCT album_id)::int AS albums,
      min(played_at) AS first, max(played_at) AS last,
      count(*) FILTER (WHERE played_at > now() - interval '24 hours')::int AS last24h,
      (SELECT count(*) FROM sessions WHERE user_id = ${user.id} AND expires_at > now())::int AS sessions
    FROM plays WHERE user_id = ${user.id}`;

  let server = null;
  if (user.isAdmin) {
    const [s] = await sql`
      SELECT (SELECT count(*) FROM users)::int AS users,
        (SELECT count(*) FROM users WHERE refresh_token IS NOT NULL)::int AS collecting,
        (SELECT count(*) FROM plays)::int AS plays,
        (SELECT count(*) FROM plays WHERE played_at > now() - interval '24 hours')::int AS last24h,
        (SELECT count(*) FROM tracks)::int AS tracks, (SELECT count(*) FROM albums)::int AS albums,
        (SELECT count(*) FROM artists)::int AS artists,
        pg_database_size(current_database())::text AS db_size, pg_total_relation_size('plays')::text AS plays_size,
        current_setting('server_version') AS postgres`;
    server = {
      ...s,
      poller: { ...pollStats, intervalSeconds: POLL_INTERVAL_SECONDS },
      node: process.version,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      version: APP_VERSION,
    };
  }
  return c.json({ you, server });
});

// --- Admin ---

const admin = new Hono<AppEnv>();
admin.use("*", requireUser, requireAdmin);

admin.get("/users", async (c) =>
  c.json(
    await sql`
      SELECT u.id, u.username, u.email, u.is_admin, u.spotify_id, (u.refresh_token IS NOT NULL) AS collecting, u.poll_error,
        u.created_at, u.last_seen_at, u.first_listened_at,
        (SELECT count(*) FROM plays p WHERE p.user_id = u.id)::int AS plays,
        (SELECT max(played_at) FROM plays p WHERE p.user_id = u.id) AS last_play_at
      FROM users u ORDER BY u.created_at`,
  ),
);

admin.post("/users/:id/sign-out", async (c) => {
  await signOutEverywhere(c.req.param("id"));
  return c.json({ ok: true });
});

appRoutes.route("/admin", admin);
