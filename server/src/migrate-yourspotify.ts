// Imports a YourSpotify MongoDB database into Music.
//
//   npm run migrate:yourspotify -- "mongodb://host:27017/your_spotify" [--users name1,name2] [--dry-run]
//
// What comes over: the catalog (tracks, albums, artists), users (with their YourSpotify ids, so
// links and API calls naming them keep working; settings; admin rights; public share tokens; and
// Spotify tokens, so collecting goes on without anyone signing in again), every play (blacklisted
// ones stay hidden), and the instance's preferences (registrations, affinity).
//
// Everyone then signs in with Spotify as before and finds their account. Running it again only adds
// what's missing. If someone already signed in to Music before the import, their YourSpotify history
// is added to that account.

import { MongoClient, type Document } from "mongodb";
import { migrate, setGlobalPreferences, sql } from "./db.ts";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const sourceUrl = args.find((a) => /^mongodb(\+srv)?:\/\//.test(a)) ?? process.env.YOURSPOTIFY_MONGO_URL;
const onlyUsers = opt("users")?.split(",").map((u) => u.trim().toLowerCase());
const dryRun = args.includes("--dry-run");
const BATCH = 5000;

if (!sourceUrl) {
  console.error('Usage: npm run migrate:yourspotify -- "mongodb://host:27017/your_spotify" [--users name1,name2] [--dry-run]');
  process.exit(1);
}

// postgres.js encodes the value itself for a jsonb parameter.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = (rows: unknown[]) => sql.json(rows as any);
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const text = (v: unknown) => (typeof v === "string" ? v : "");

async function copyCatalog(db: ReturnType<MongoClient["db"]>) {
  const tables = {
    artists: (d: Document) => ({
      id: d.id,
      name: text(d.name),
      genres: arr(d.genres),
      images: Array.isArray(d.images) ? d.images : [],
      external_urls: d.external_urls ?? {},
      href: text(d.href),
      uri: text(d.uri) || `spotify:artist:${d.id}`,
    }),
    albums: (d: Document) => ({
      id: d.id,
      name: text(d.name),
      album_type: text(d.album_type),
      artists: arr(d.artists),
      images: Array.isArray(d.images) ? d.images : [],
      release_date: text(d.release_date),
      release_date_precision: text(d.release_date_precision),
      genres: arr(d.genres),
      copyrights: Array.isArray(d.copyrights) ? d.copyrights : [],
      external_urls: d.external_urls ?? {},
      href: text(d.href),
      uri: text(d.uri) || `spotify:album:${d.id}`,
    }),
    tracks: (d: Document) => ({
      id: d.id,
      name: text(d.name),
      album: text(d.album),
      artists: arr(d.artists),
      disc_number: Number(d.disc_number) || 1,
      duration_ms: Number(d.duration_ms) || 0,
      explicit: !!d.explicit,
      external_urls: d.external_urls ?? {},
      href: text(d.href),
      is_local: !!d.is_local,
      preview_url: typeof d.preview_url === "string" ? d.preview_url : null,
      track_number: Number(d.track_number) || 1,
      uri: text(d.uri) || `spotify:track:${d.id}`,
    }),
  } as const;
  for (const [table, row] of Object.entries(tables)) {
    let n = 0;
    let batch: unknown[] = [];
    const flush = async () => {
      if (batch.length && !dryRun) {
        await sql`
          INSERT INTO ${sql(table)} SELECT * FROM jsonb_populate_recordset(null::${sql(table)}, ${json(batch)}::jsonb)
          ON CONFLICT (id) DO NOTHING`;
      }
      n += batch.length;
      batch = [];
    };
    for await (const d of db.collection(table).find({}, { projection: { _id: 0 } })) {
      if (typeof d.id !== "string") continue;
      batch.push(row(d));
      if (batch.length >= BATCH) await flush();
    }
    await flush();
    console.log(`${table}: ${n}`);
  }
}

async function main() {
  await migrate();
  const client = new MongoClient(sourceUrl!, { serverSelectionTimeoutMS: 10_000 });
  await client.connect();
  const db = client.db();
  console.log(`Reading ${db.databaseName}${dryRun ? " (dry run)" : ""}`);

  await copyCatalog(db);

  // Track id → what a play needs, for old plays missing them.
  const trackInfo = new Map<string, { album: string; artists: string[]; ms: number }>();
  for await (const t of db.collection("tracks").find({}, { projection: { _id: 0, id: 1, album: 1, artists: 1, duration_ms: 1 } })) {
    trackInfo.set(t.id, { album: text(t.album), artists: arr(t.artists), ms: Number(t.duration_ms) || 0 });
  }

  let users = await db.collection("users").find({}, { projection: { tracks: 0 } }).toArray();
  if (onlyUsers) users = users.filter((u) => onlyUsers.includes(String(u.username).toLowerCase()) || onlyUsers.includes(u._id.toString()));
  console.log(`${users.length} user(s)`);

  for (const u of users) {
    const ysId = u._id.toString();
    const spotifyId = text(u.spotifyId);
    if (!spotifyId) {
      console.warn(`  ${u.username}: no Spotify id, skipped`);
      continue;
    }
    const s = (u.settings ?? {}) as Record<string, unknown>;
    const [existing] = await sql<{ id: string }[]>`SELECT id FROM users WHERE spotify_id = ${spotifyId} OR id = ${ysId}`;
    const id = existing?.id ?? ysId;
    if (!existing && !dryRun) {
      await sql`
        INSERT INTO users ${sql({
          id,
          username: text(u.username).slice(0, 64) || spotifyId,
          isAdmin: !!u.admin,
          spotifyId,
          accessToken: text(u.accessToken) || null,
          refreshToken: text(u.refreshToken) || null,
          expiresIn: Number(u.expiresIn) || 0,
          lastTimestamp: Number(u.lastTimestamp) || 0,
          timezone: text(s.timezone) || null,
          dateFormat: text(s.dateFormat) || "default",
          metricUsed: s.metricUsed === "duration" ? "duration" : "number",
          nbElements: Math.min(50, Math.max(5, Number(s.nbElements) || 10)),
          preferredStatsPeriod: text(s.preferredStatsPeriod) || "month",
          historyLine: !!s.historyLine,
          darkMode: text(s.darkMode) || "follow",
          blacklistedArtists: arr(s.blacklistedArtists),
          publicToken: text(u.publicToken) || null,
          firstListenedAt: u.firstListenedAt instanceof Date ? u.firstListenedAt : null,
          createdAt: u._id.getTimestamp(),
        })}`;
    }

    let added = 0;
    let read = 0;
    let batch: unknown[] = [];
    const flush = async () => {
      if (batch.length && !dryRun) {
        const rows = await sql`
          INSERT INTO plays (user_id, track_id, album_id, primary_artist_id, artist_ids, duration_ms, played_at, blacklisted)
          SELECT ${id}, x.track_id, x.album_id, x.primary_artist_id, x.artist_ids, x.duration_ms, x.played_at, x.blacklisted
          FROM jsonb_to_recordset(${json(batch)}::jsonb)
            AS x(track_id text, album_id text, primary_artist_id text, artist_ids text[], duration_ms integer, played_at timestamptz, blacklisted boolean)
          ON CONFLICT DO NOTHING RETURNING 1`;
        added += rows.length;
      }
      batch = [];
    };
    for await (const p of db.collection("infos").find({ owner: u._id }, { projection: { _id: 0, owner: 0 } })) {
      read++;
      const trackId = text(p.id);
      const t = trackInfo.get(trackId);
      const artistIds = arr(p.artistIds).length ? arr(p.artistIds) : (t?.artists ?? []);
      const albumId = text(p.albumId) || t?.album;
      const primary = text(p.primaryArtistId) || artistIds[0];
      if (!trackId || !albumId || !primary || !(p.played_at instanceof Date)) continue;
      batch.push({
        track_id: trackId,
        album_id: albumId,
        primary_artist_id: primary,
        artist_ids: artistIds,
        duration_ms: Number(p.durationMs) || t?.ms || 0,
        played_at: p.played_at.toISOString(),
        blacklisted: Array.isArray(p.blacklistedBy) && p.blacklistedBy.length > 0,
      });
      if (batch.length >= BATCH) await flush();
    }
    await flush();
    if (!dryRun) {
      await sql`
        UPDATE users SET first_listened_at = (SELECT min(played_at) FROM plays WHERE user_id = ${id}),
          blacklisted_artists = (SELECT ARRAY(SELECT DISTINCT unnest(blacklisted_artists || ${arr(s.blacklistedArtists)}::text[])))
        WHERE id = ${id}`;
    }
    console.log(`  ${u.username}${existing && existing.id !== ysId ? " (into the account they already had)" : ""}: ${read} plays read, ${added} added`);
  }

  const prefs = await db.collection("globalpreferences").findOne({});
  if (prefs && !dryRun) {
    await setGlobalPreferences({ allowRegistrations: prefs.allowRegistrations !== false, allowAffinity: prefs.allowAffinity !== false });
    console.log(`Preferences: registrations ${prefs.allowRegistrations !== false ? "open" : "closed"}, affinity ${prefs.allowAffinity !== false ? "on" : "off"}`);
  }

  await client.close();
  await sql.end();
  console.log("Done.");
}

main().catch(async (e) => {
  console.error(e);
  await sql.end().catch(() => {});
  process.exit(1);
});
