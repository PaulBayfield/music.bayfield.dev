// The user record and the shapes the app sees.

import { DEFAULT_TIMEZONE } from "./config.ts";
import { sql } from "./db.ts";

export interface User {
  id: string;
  username: string;
  email: string | null;
  isAdmin: boolean;
  spotifyId: string;
  accessToken: string | null;
  refreshToken: string | null;
  expiresIn: string; // bigint
  lastTimestamp: string; // bigint
  pollError: string | null;
  timezone: string | null;
  weekStart: number;
  dateFormat: string;
  metricUsed: "number" | "duration";
  nbElements: number;
  preferredStatsPeriod: string;
  historyLine: boolean;
  darkMode: string;
  blacklistedArtists: string[];
  publicToken: string | null;
  firstListenedAt: Date | null;
  language: "en" | "fr";
  createdAt: Date;
  lastSeenAt: Date | null;
}

export async function getUser(id: string): Promise<User | undefined> {
  const [u] = await sql<User[]>`SELECT * FROM users WHERE id = ${id}`;
  return u;
}

/** The user's time zone, or the server's default (TIMEZONE) when they haven't picked one. */
export const tzOf = (u: Pick<User, "timezone">) => u.timezone || DEFAULT_TIMEZONE;

/**
 * GET /me's `user`: YourSpotify's shape (so its clients keep working), plus what this app adds.
 * Never the Spotify tokens. A guest (public link) doesn't see the email.
 */
export function meView(u: User, guest = false) {
  return {
    _id: u.id,
    id: u.id,
    username: u.username,
    admin: u.isAdmin,
    spotifyId: u.spotifyId,
    expiresIn: Number(u.expiresIn),
    lastTimestamp: Number(u.lastTimestamp),
    settings: {
      historyLine: u.historyLine,
      preferredStatsPeriod: u.preferredStatsPeriod,
      nbElements: u.nbElements,
      metricUsed: u.metricUsed,
      darkMode: u.darkMode,
      timezone: u.timezone ?? undefined,
      dateFormat: u.dateFormat,
      blacklistedArtists: u.blacklistedArtists,
    },
    lastImport: null,
    publicToken: u.publicToken,
    firstListenedAt: u.firstListenedAt,
    // Added by this app.
    email: guest ? null : u.email,
    /** The time zone in effect. */
    timezone: tzOf(u),
    weekStart: u.weekStart,
    /** Spotify still lets us read the history (false once access is revoked: sign in again). */
    spotifyLinked: !!u.refreshToken,
    pollError: guest ? null : u.pollError,
    createdAt: u.createdAt,
    guest,
  };
}

export type MeView = ReturnType<typeof meView>;
