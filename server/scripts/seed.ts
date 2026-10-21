// Demo data for local development: a made-up catalog and two years of plays for the
// DEV_LOGIN_USER account (and a second user, to try affinity). No Spotify needed.
//   npm run seed

import { migrate, sql } from "../src/db.ts";
import { newUserId } from "../src/crypto.ts";

const DEV = process.env.DEV_LOGIN_USER ?? "demo";
await migrate();

let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = <T>(a: T[]) => a[Math.floor(rand() * a.length)];
const syl = ["la", "mo", "ri", "ka", "zen", "tor", "vel", "nu", "sha", "dor", "fi", "lu", "mar", "quo", "pel", "sto", "ne", "wa"];
const word = () => {
  const w = Array.from({ length: 2 + Math.floor(rand() * 2) }, () => pick(syl)).join("");
  return w[0].toUpperCase() + w.slice(1);
};
const genres = ["indie pop", "french rap", "electro", "jazz", "rock", "lo-fi", "house", "soul"];

const artists = Array.from({ length: 60 }, (_, i) => ({
  id: `demoartist${String(i).padStart(4, "0")}`,
  name: rand() < 0.5 ? word() : `${word()} ${word()}`,
  genres: [pick(genres)],
}));
const albums = artists.flatMap((a) =>
  Array.from({ length: 1 + Math.floor(rand() * 3) }, (_, j) => ({
    id: `${a.id}alb${j}`,
    name: rand() < 0.3 ? word() : `${word()} ${word()}`,
    artist: a.id,
    year: 1975 + Math.floor(rand() * 50),
  })),
);
const tracks = albums.flatMap((al) =>
  Array.from({ length: 6 + Math.floor(rand() * 8) }, (_, k) => {
    const feat = rand() < 0.2 ? [pick(artists).id] : [];
    return { id: `${al.id}trk${k}`, name: rand() < 0.5 ? word() : `${word()} ${word()}`, album: al.id, artists: [al.artist, ...feat.filter((f) => f !== al.artist)], ms: 120_000 + Math.floor(rand() * 180_000), n: k + 1 };
  }),
);

await sql`DELETE FROM plays WHERE track_id LIKE 'demo%'`;
await sql`DELETE FROM tracks WHERE id LIKE 'demo%'`;
await sql`DELETE FROM albums WHERE id LIKE 'demo%'`;
await sql`DELETE FROM artists WHERE id LIKE 'demo%'`;
await sql`INSERT INTO artists ${sql(artists.map((a) => ({ id: a.id, name: a.name, genres: a.genres, uri: `spotify:artist:${a.id}` })))}`;
await sql`INSERT INTO albums ${sql(albums.map((a) => ({ id: a.id, name: a.name, albumType: "album", artists: [a.artist], releaseDate: `${a.year}-01-01`, releaseDatePrecision: "day", uri: `spotify:album:${a.id}` })))}`;
for (let i = 0; i < tracks.length; i += 1000) {
  await sql`INSERT INTO tracks ${sql(tracks.slice(i, i + 1000).map((t) => ({ id: t.id, name: t.name, album: t.album, artists: t.artists, durationMs: t.ms, trackNumber: t.n, uri: `spotify:track:${t.id}` })))}`;
}

async function user(username: string, spotifyId: string, admin: boolean) {
  const [u] = await sql<{ id: string }[]>`SELECT id FROM users WHERE spotify_id = ${spotifyId}`;
  if (u) return u.id;
  const id = newUserId();
  await sql`INSERT INTO users (id, username, spotify_id, is_admin) VALUES (${id}, ${username}, ${spotifyId}, ${admin})`;
  return id;
}

const [{ count }] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM users`;
const me = await user(DEV, `dev:${DEV}`, count === 0);
const friend = await user("Alex", "dev:alex", false);

/** Two years of plays: favourite artists (Zipf), evenings and weekends, listening sessions. */
async function plays(userId: string, perDay: number, shift: number) {
  const fav = [...artists].sort(() => rand() - 0.5);
  const weight = fav.map((_, i) => 1 / (i + 1 + shift));
  const sum = weight.reduce((a, b) => a + b, 0);
  const pickArtist = () => {
    let r = rand() * sum;
    for (let i = 0; i < fav.length; i++) if ((r -= weight[i]) <= 0) return fav[i];
    return fav[0];
  };
  const byArtist = new Map<string, typeof tracks>();
  for (const t of tracks) byArtist.set(t.artists[0], [...(byArtist.get(t.artists[0]) ?? []), t]);
  const rows: Record<string, unknown>[] = [];
  const now = Date.now();
  for (let d = 730; d >= 0; d--) {
    const day = new Date(now - d * 86400_000);
    const weekend = day.getUTCDay() === 0 || day.getUTCDay() === 6;
    const sessions = rand() < 0.12 ? 0 : 1 + Math.floor(rand() * (weekend ? 4 : 3));
    for (let s = 0; s < sessions; s++) {
      const hour = pick([8, 9, 12, 13, 17, 18, 19, 20, 21, 22, 23, weekend ? 15 : 8]);
      let t = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour - 1, Math.floor(rand() * 60));
      const n = Math.max(1, Math.round((perDay / 2) * (0.3 + rand())));
      for (let k = 0; k < n && t < now; k++) {
        const tr = pick(byArtist.get(pickArtist().id) ?? tracks);
        rows.push({ userId, trackId: tr.id, albumId: tr.album, primaryArtistId: tr.artists[0], artistIds: tr.artists, durationMs: tr.ms, playedAt: new Date(t) });
        t += tr.ms + Math.floor(rand() * 20_000);
      }
    }
  }
  for (let i = 0; i < rows.length; i += 5000) await sql`INSERT INTO plays ${sql(rows.slice(i, i + 5000))} ON CONFLICT DO NOTHING`;
  await sql`UPDATE users SET first_listened_at = (SELECT min(played_at) FROM plays WHERE user_id = ${userId}) WHERE id = ${userId}`;
  return rows.length;
}

console.log(`${artists.length} artists, ${albums.length} albums, ${tracks.length} tracks`);
console.log(`${DEV}: ${await plays(me, 40, 0)} plays`);
console.log(`Alex: ${await plays(friend, 25, 3)} plays`);
await sql.end();
