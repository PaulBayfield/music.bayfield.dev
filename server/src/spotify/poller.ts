// Collects every connected user's recently played tracks, every POLL_INTERVAL_SECONDS.
// Spotify only remembers the last 50 plays, so as long as you listen to fewer than 50 tracks
// between two polls, nothing is missed.

import { POLL_INTERVAL_SECONDS, spotify } from "../config.ts";
import { sql } from "../db.ts";
import { SpotifyError, spotifyFor } from "./client.ts";
import { storePlays, storeTracks } from "./catalog.ts";

/** Look a little before the last poll: plays show up in "recently played" with a delay. */
const OVERLAP_MS = 2 * 60 * 60_000;

export const pollStats = { runs: 0, plays: 0, errors: 0, lastRunAt: null as Date | null };

export async function pollUser(userId: string): Promise<number> {
  const [u] = await sql<{ username: string; lastTimestamp: string }[]>`SELECT username, last_timestamp FROM users WHERE id = ${userId}`;
  if (!u) return 0;
  const client = spotifyFor(userId);
  const startedAt = Date.now();
  try {
    const items = await client.recentlyPlayed(Number(u.lastTimestamp) - OVERLAP_MS);
    await storeTracks(
      client,
      items.map((i) => i.track),
    );
    const added = await storePlays(
      userId,
      items.map((i) => ({ track: i.track, playedAt: new Date(i.played_at) })),
    );
    await sql`UPDATE users SET last_timestamp = ${startedAt}, poll_error = NULL WHERE id = ${userId}`;
    if (added) console.log(`[poll] ${u.username}: ${added} new play(s)`);
    pollStats.plays += added;
    return added;
  } catch (e) {
    pollStats.errors++;
    const message = e instanceof SpotifyError ? `Spotify answered ${e.status}` : e instanceof Error ? e.message : String(e);
    console.warn(`[poll] ${u.username}: ${message}`);
    // A revoked connection already says so (and has no refresh token left): keep that message.
    await sql`UPDATE users SET poll_error = ${message} WHERE id = ${userId} AND refresh_token IS NOT NULL`.catch(() => {});
    throw e;
  }
}

async function pollEveryone() {
  const users = await sql<{ id: string }[]>`SELECT id FROM users WHERE refresh_token IS NOT NULL ORDER BY id`;
  for (const u of users) {
    try {
      await pollUser(u.id);
    } catch {
      // Logged; the next user's turn.
    }
  }
  pollStats.runs++;
  pollStats.lastRunAt = new Date();
}

export function startPoller() {
  if (!spotify) return;
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    pollEveryone()
      .catch((e) => console.error("[poll] failed:", e))
      .finally(() => {
        running = false;
      });
  };
  setTimeout(tick, 5_000);
  setInterval(tick, POLL_INTERVAL_SECONDS * 1000);
}
