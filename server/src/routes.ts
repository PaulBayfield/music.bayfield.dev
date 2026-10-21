// YourSpotify's API: the same routes, parameters and answers (under /api, or at the root on a
// COMPAT_HOSTS host), so anything built against it keeps working. The web app uses them too.

import { Hono, type Context } from "hono";
import { globalPreferences, setGlobalPreferences, sql } from "./db.ts";
import { APP_VERSION, UPDATE_CHECK } from "./config.ts";
import { requireAdmin, requireUser, requireUserOrGuest, signOut, whoIs, type AppEnv } from "./auth.ts";
import { newPublicToken } from "./crypto.ts";
import { bad, body, isTimeZone, str } from "./http.ts";
import { updateStatus } from "./updates.ts";
import { meView, type User } from "./users.ts";
import {
  TIMESPLITS,
  albumDateRatio,
  best,
  bestArtistsPer,
  bestOfHour,
  collaborative,
  differentArtistsPer,
  featRatio,
  history,
  hourRepartition,
  longestSessions,
  mostListenedSongs,
  rankOf,
  songsPer,
  timePer,
  type CollaborativeMode,
  type ItemType,
  type Timesplit,
} from "./stats.ts";
import {
  albumStats,
  artistStats,
  getAlbums,
  getArtists,
  getTracks,
  mostListenedOfArtist,
  searchAlbums,
  searchArtists,
  searchTracks,
  trackStats,
} from "./entities.ts";
import { spotifyFor } from "./spotify/client.ts";

export const ysRoutes = new Hono<AppEnv>();

// --- Parameters ---

function date(v: string | undefined, fallback?: Date): Date {
  if (v === undefined || v === "") {
    if (fallback) return fallback;
    throw bad("Missing date");
  }
  const d = new Date(/^\d+$/.test(v) ? Number(v) : v);
  if (Number.isNaN(d.getTime())) throw bad("Invalid date");
  return d;
}

function int(v: string | undefined, { min = 0, max = Infinity, fallback }: { min?: number; max?: number; fallback?: number } = {}) {
  if (v === undefined || v === "") {
    if (fallback !== undefined) return fallback;
    throw bad("Missing number");
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw bad("Invalid number");
  return Math.floor(n);
}

/** start (required) and end (default: now). */
const interval = (c: Context) => ({ start: date(c.req.query("start")), end: date(c.req.query("end"), new Date()) });

function timesplit(c: Context): Timesplit {
  const s = c.req.query("timeSplit") ?? "day";
  if (!TIMESPLITS.includes(s as Timesplit)) throw bad("Invalid timeSplit");
  return s as Timesplit;
}

const ids = (v: string) => v.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 200);

/** `otherIds` or `otherIds[]`, one or many. */
function otherIds(c: Context): string[] {
  const all = [...c.req.queries("otherIds[]") ?? [], ...c.req.queries("otherIds") ?? []].filter((s) => s.length > 0 && s.length <= 64);
  if (!all.length) throw bad("Pick at least one other user");
  return all.slice(0, 20);
}

function mode(v: unknown): CollaborativeMode {
  if (v !== "average" && v !== "minima") throw bad("Invalid mode");
  return v;
}

// --- Account ---

ysRoutes.get("/", (c) => c.text("Hello !"));

ysRoutes.post("/logout", async (c) => {
  await signOut(c);
  return c.body(null, 200);
});

ysRoutes.get("/me", async (c) => {
  const who = await whoIs(c);
  return c.json(who ? { status: true, user: meView(who.user, who.guest) } : { status: false });
});

ysRoutes.post("/settings", requireUser, async (c) => {
  const b = await body(c);
  const patch: Record<string, unknown> = {};
  if (b.historyLine !== undefined) patch.historyLine = b.historyLine === true || b.historyLine === "true";
  if (b.preferredStatsPeriod !== undefined) {
    if (!["day", "week", "month", "year"].includes(b.preferredStatsPeriod as string)) throw bad("Invalid period");
    patch.preferredStatsPeriod = b.preferredStatsPeriod;
  }
  if (b.nbElements !== undefined) {
    const n = Number(b.nbElements);
    if (!(n >= 5 && n <= 50)) throw bad("Between 5 and 50");
    patch.nbElements = Math.floor(n);
  }
  if (b.metricUsed !== undefined) {
    if (b.metricUsed !== "number" && b.metricUsed !== "duration") throw bad("Invalid metric");
    patch.metricUsed = b.metricUsed;
  }
  if (b.darkMode !== undefined) {
    if (!["follow", "dark", "light"].includes(b.darkMode as string)) throw bad("Invalid dark mode");
    patch.darkMode = b.darkMode;
  }
  if (b.timezone !== undefined) {
    if (b.timezone !== null && !isTimeZone(b.timezone)) throw bad("Unknown time zone");
    patch.timezone = b.timezone;
  }
  if (b.dateFormat !== undefined) patch.dateFormat = b.dateFormat === null ? "default" : str(b.dateFormat, 20) || "default";
  // Added by this app.
  if (b.weekStart !== undefined) patch.weekStart = b.weekStart === 0 ? 0 : 1;
  if (b.language === "en" || b.language === "fr") patch.language = b.language;
  if (Object.keys(patch).length) await sql`UPDATE users SET ${sql(patch)} WHERE id = ${c.get("user").id}`;
  return c.body(null, 200);
});

ysRoutes.post("/generate-public-token", requireUser, async (c) => {
  const token = newPublicToken();
  await sql`UPDATE users SET public_token = ${token} WHERE id = ${c.get("user").id}`;
  return c.text(token);
});

ysRoutes.post("/delete-public-token", requireUser, async (c) => {
  await sql`UPDATE users SET public_token = NULL WHERE id = ${c.get("user").id}`;
  return c.body(null, 200);
});

ysRoutes.get("/accounts", requireUserOrGuest, async (c) => {
  const rows = await sql<{ id: string; username: string; isAdmin: boolean; firstListenedAt: Date | null }[]>`
    SELECT id, username, is_admin, first_listened_at FROM users ORDER BY created_at`;
  return c.json(rows.map((u) => ({ id: u.id, username: u.username, admin: u.isAdmin, firstListenedAt: u.firstListenedAt })));
});

ysRoutes.put("/admin/:id", requireUser, requireAdmin, async (c) => {
  const status = (await body(c)).status;
  const on = status === true || status === "true";
  if (!on) {
    const [{ count }] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM users WHERE is_admin AND id <> ${c.req.param("id")}`;
    if (count === 0) return c.json({ code: "CANNOT_HAVE_ZERO_ADMIN" }, 400);
  }
  await sql`UPDATE users SET is_admin = ${on} WHERE id = ${c.req.param("id")}`;
  return c.body(null, 204);
});

ysRoutes.delete("/account/:id", requireUser, requireAdmin, async (c) => {
  const id = c.req.param("id");
  const [u] = await sql`SELECT is_admin FROM users WHERE id = ${id}`;
  if (!u) return c.body(null, 404);
  await deleteUser(id);
  return c.body(null, 204);
});

/** Deletes a user and their history, then the catalog entries nobody played. */
export async function deleteUser(id: string) {
  await sql`DELETE FROM users WHERE id = ${id}`;
  await sql`DELETE FROM tracks t WHERE NOT EXISTS (SELECT 1 FROM plays p WHERE p.track_id = t.id)`;
  await sql`DELETE FROM albums a WHERE NOT EXISTS (SELECT 1 FROM tracks t WHERE t.album = a.id)`;
  await sql`
    DELETE FROM artists ar WHERE NOT EXISTS (SELECT 1 FROM tracks t WHERE ar.id = ANY(t.artists))
      AND NOT EXISTS (SELECT 1 FROM albums a WHERE ar.id = ANY(a.artists))`;
}

ysRoutes.put("/rename", requireUser, async (c) => {
  const name = str((await body(c)).newName, 100);
  if (name.length < 2 || name.length > 64) throw bad("Between 2 and 64 characters");
  await sql`UPDATE users SET username = ${name} WHERE id = ${c.get("user").id}`;
  return c.body(null, 204);
});

ysRoutes.get("/version", async (c) => {
  if (!UPDATE_CHECK) return c.json({ update: false, version: APP_VERSION });
  const s = await updateStatus();
  return c.json({ update: s.available, version: APP_VERSION });
});

ysRoutes.get("/global/preferences", async (c) => c.json(await globalPreferences()));

ysRoutes.post("/global/preferences", requireUser, requireAdmin, async (c) => {
  const b = await body(c);
  return c.json(
    await setGlobalPreferences({
      allowRegistrations: typeof b.allowRegistrations === "boolean" ? b.allowRegistrations : undefined,
      allowAffinity: typeof b.allowAffinity === "boolean" ? b.allowAffinity : undefined,
    }),
  );
});

// --- Stats (/spotify) ---

const sp = new Hono<AppEnv>();

sp.post("/play", requireUser, async (c) => {
  const id = str((await body(c)).id, 64);
  const [track] = await getTracks([id]);
  if (!track) return c.body(null, 400);
  try {
    await spotifyFor(c.get("user").id).play(track.uri);
    return c.body(null, 200);
  } catch (e) {
    const err = e as { body?: string };
    return c.json(JSON.parse(err.body || "{}").error ?? { message: "Spotify refused" }, 400);
  }
});

sp.get("/gethistory", requireUserOrGuest, async (c) => {
  const number = int(c.req.query("number"), { min: 1, max: 50 });
  const offset = int(c.req.query("offset"), { fallback: 0 });
  const s = c.req.query("start");
  const e = c.req.query("end");
  return c.json(await history(c.get("user"), offset, number, s && e ? { start: date(s), end: date(e) } : undefined));
});

sp.get("/listened_to", requireUserOrGuest, async (c) => {
  const { start, end } = interval(c);
  const [r] = await songsPer(c.get("user"), start, end, "all");
  return c.json({ count: r?.count ?? 0 });
});

const perRoute = (path: string, fn: (u: User, start: Date, end: Date, s: Timesplit) => Promise<unknown>) =>
  sp.get(path, requireUserOrGuest, async (c) => {
    const { start, end } = interval(c);
    return c.json(await fn(c.get("user"), start, end, timesplit(c)));
  });

perRoute("/most_listened", mostListenedSongs);
perRoute("/most_listened_artist", bestArtistsPer);
perRoute("/songs_per", songsPer);
perRoute("/time_per", timePer);
perRoute("/album_date_ratio", albumDateRatio);
perRoute("/feat_ratio", featRatio);
perRoute("/different_artists_per", differentArtistsPer);
perRoute("/best_artists_per", bestArtistsPer);

sp.get("/time_per_hour_of_day", requireUserOrGuest, async (c) => {
  const { start, end } = interval(c);
  return c.json(await hourRepartition(c.get("user"), start, end));
});

for (const [path, type] of [["songs", "track"], ["artists", "artist"], ["albums", "album"]] as const) {
  sp.get(`/top/${path}`, requireUserOrGuest, async (c) => {
    const { start, end } = interval(c);
    const nb = int(c.req.query("nb"), { min: 1, max: 30 });
    const offset = int(c.req.query("offset"), { fallback: 0 });
    return c.json(await best(type, c.get("user"), start, end, nb, offset));
  });
  sp.get(`/top/hour-repartition/${path}`, requireUserOrGuest, async (c) => {
    const { start, end } = interval(c);
    return c.json(await bestOfHour(type, c.get("user"), start, end));
  });
  sp.get(`/collaborative/top/${path}`, requireUser, async (c) => {
    if (!(await globalPreferences()).allowAffinity) return c.json({ code: "AFFINITY_NOT_ALLOWED" }, 401);
    const { start, end } = interval(c);
    const users = [c.get("user").id, ...otherIds(c)];
    return c.json(await collaborative(type as ItemType, users, start, end, mode(c.req.query("mode")), 50));
  });
}

sp.get("/top/sessions", requireUserOrGuest, async (c) => {
  const { start, end } = interval(c);
  return c.json(await longestSessions(c.get("user"), start, end));
});

sp.get("/playlists", requireUser, async (c) => {
  const user = c.get("user");
  const all = await spotifyFor(user.id).playlists();
  return c.json(all.filter((p) => p.owner?.id === user.spotifyId));
});

/** Creates a playlist (or adds to one) from a top, an affinity, an artist's top or given tracks. */
sp.post("/playlist/create", requireUser, async (c) => {
  const user = c.get("user");
  const b = await body(c);
  const playlistId = str(b.playlistId, 100) || null;
  let name = str(b.name, 100) || null;
  if (!playlistId && !name && b.type === undefined) throw bad("Give a playlist or a name");
  const nb = int(String(b.nb ?? 50), { min: 1, max: 500 });
  const range = (v: unknown) => {
    const r = (v ?? {}) as Record<string, string>;
    return { start: date(r.start), end: date(r.end, new Date()) };
  };
  let trackIds: string[];
  if (b.type === "top") {
    const { start, end } = range(b.interval);
    trackIds = (await best("track", user, start, end, nb, 0)).map((r) => r._id);
    name ??= `Top songs • ${start.toISOString().slice(0, 10)} – ${end.toISOString().slice(0, 10)}`;
  } else if (b.type === "affinity") {
    const { start, end } = range(b.interval);
    const users = (Array.isArray(b.userIds) ? b.userIds : []).filter((x): x is string => typeof x === "string");
    trackIds = (await collaborative("track", users.length ? users : [user.id], start, end, mode(b.mode), nb)).map((r) => r._id as string);
    name ??= `Affinity • ${new Date().toISOString().slice(0, 10)}`;
  } else if (b.type === "top-artist") {
    const [artist] = await getArtists([str(b.artistId, 64)]);
    if (!artist) return c.body(null, 404);
    trackIds = (await mostListenedOfArtist(user, artist.id, nb)).map((r) => r.id);
    name ??= `My top of ${artist.name}`;
  } else if (b.type === "specific") {
    trackIds = [...new Set((Array.isArray(b.songIds) ? b.songIds : []).filter((x): x is string => typeof x === "string"))];
    name ??= `Music • ${new Date().toISOString().slice(0, 10)}`;
  } else throw bad("Unknown playlist type");
  if (!trackIds.length) throw bad("Nothing to add");
  const client = spotifyFor(user.id);
  if (playlistId) await client.addToPlaylist(playlistId, trackIds);
  else await client.createPlaylist(name, trackIds);
  return c.body(null, 204);
});

ysRoutes.route("/spotify", sp);

// --- Artists, albums, tracks ---

const entity = (
  path: "artist" | "album" | "track",
  get: (ids: string[]) => Promise<unknown[]>,
  stats: (u: User, id: string) => Promise<unknown>,
  type: ItemType,
) => {
  const r = new Hono<AppEnv>();
  r.get("/:ids", requireUserOrGuest, async (c) => {
    const found = await get(ids(c.req.param("ids")));
    return found.length ? c.json(found) : c.body(null, 404);
  });
  r.get("/:id/stats", requireUserOrGuest, async (c) => {
    const result = await stats(c.get("user"), c.req.param("id"));
    return result ? c.json(result) : c.body(null, 404);
  });
  r.get("/:id/rank", requireUserOrGuest, async (c) => {
    const [found] = await get([c.req.param("id")]);
    if (!found) return c.body(null, 404);
    return c.json(await rankOf(type, c.get("user"), c.req.param("id")));
  });
  ysRoutes.route(`/${path}`, r);
  return r;
};

const artists = entity("artist", getArtists, artistStats, "artist");
entity("album", getAlbums, albumStats, "album");
entity("track", getTracks, trackStats, "track");

const query = (c: Context) => {
  const q = c.req.param("query") ?? "";
  if (q.length < 3 || q.length > 64) throw bad("Search between 3 and 64 characters");
  return q;
};

artists.get("/search/:query", requireUserOrGuest, async (c) => c.json(await searchArtists(query(c))));

/** Hides an artist from the stats (their plays stay, flagged). */
artists.post("/blacklist/:id", requireUser, async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  await sql`UPDATE users SET blacklisted_artists = array_append(array_remove(blacklisted_artists, ${id}), ${id}) WHERE id = ${user.id}`;
  await sql`UPDATE plays SET blacklisted = true WHERE user_id = ${user.id} AND primary_artist_id = ${id}`;
  return c.body(null, 204);
});

artists.post("/unblacklist/:id", requireUser, async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  await sql`UPDATE users SET blacklisted_artists = array_remove(blacklisted_artists, ${id}) WHERE id = ${user.id}`;
  await sql`UPDATE plays SET blacklisted = false WHERE user_id = ${user.id} AND primary_artist_id = ${id}`;
  return c.body(null, 204);
});

ysRoutes.get("/search/:query", requireUserOrGuest, async (c) => {
  const q = query(c);
  const [found, tracks, albums] = await Promise.all([searchArtists(q), searchTracks(q), searchAlbums(q)]);
  return c.json({ artists: found, tracks, albums });
});

