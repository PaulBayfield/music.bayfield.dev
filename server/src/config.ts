// Server configuration, read once from the environment (see server/.env.example).

import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable ${name} (see server/.env.example)`);
  return value;
}

/** Tolerates what .env files tend to add: spaces, a CR from Windows line endings, quotes. */
const clean = (v: string | undefined) => v?.trim().replace(/^["']|["']$/g, "") || undefined;

const flag = (name: string, fallback: boolean) => {
  const v = process.env[name]?.trim().toLowerCase();
  return v ? v === "true" || v === "1" || v === "yes" : fallback;
};

const list = (name: string) =>
  (process.env[name] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export const PUBLIC_URL = required("PUBLIC_URL").replace(/\/+$/, "");
export const PORT = Number(process.env.PORT ?? 8791);
export const DATABASE_URL = required("DATABASE_URL");
export const DIST_DIR = resolve(process.env.DIST_DIR ?? resolve(import.meta.dirname, "../../dist"));
export const SECURE_COOKIES = PUBLIC_URL.startsWith("https://");

/** Set by the Docker build; when running from a checkout, the root package.json's version. */
export const APP_VERSION = (() => {
  const env = process.env.APP_VERSION?.trim();
  if (env && env !== "dev") return env;
  try {
    return (JSON.parse(readFileSync(resolve(import.meta.dirname, "../../package.json"), "utf8")) as { version?: string }).version ?? "dev";
  } catch {
    return "dev";
  }
})();

/** Look on GitHub for a newer release (shown in Settings → About). */
export const UPDATE_CHECK = flag("UPDATE_CHECK", true);

/**
 * Local development only: signs straight in as this user, without the identity provider.
 * Ignored unless PUBLIC_URL is localhost, so it can't be switched on in production by mistake.
 */
export const DEV_LOGIN_USER = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(PUBLIC_URL) ? process.env.DEV_LOGIN_USER?.trim() || null : null;

/**
 * The Spotify app (developer.spotify.com/dashboard), with the same variable names as YourSpotify so
 * the same app keeps working. It is also how you sign in (like YourSpotify): the Spotify account is the identity.
 */
export const spotify =
  clean(process.env.SPOTIFY_PUBLIC) && clean(process.env.SPOTIFY_SECRET)
    ? {
        clientId: clean(process.env.SPOTIFY_PUBLIC)!,
        clientSecret: clean(process.env.SPOTIFY_SECRET)!,
        redirectUri: clean(process.env.SPOTIFY_REDIRECT_URI) ?? `${PUBLIC_URL}/api/oauth/spotify/callback`,
        scopes: [
          "user-read-private",
          "user-read-email",
          "user-read-recently-played",
          "user-modify-playback-state",
          "user-read-playback-state",
          "playlist-modify-private",
          "playlist-modify-public",
        ].join(" "),
      }
    : null;

/** How often each user's recently played tracks are fetched. Spotify only keeps the last 50. */
export const POLL_INTERVAL_SECONDS = Math.max(30, Number(process.env.POLL_INTERVAL_SECONDS ?? 120));

/** The time zone for users who haven't picked one (YourSpotify's TIMEZONE, same default). */
export const DEFAULT_TIMEZONE = clean(process.env.TIMEZONE) ?? "Europe/Paris";

/**
 * Hosts that answer the API at the root, like YourSpotify's separate API server did
 * (e.g. the old API_ENDPOINT's host), so links and tools built for it keep working.
 */
export const COMPAT_HOSTS = new Set(list("COMPAT_HOSTS").map((h) => h.toLowerCase()));

/** Where uploaded Spotify data exports wait while they're imported. */
export const IMPORT_DIR = resolve(process.env.IMPORT_DIR ?? resolve(tmpdir(), "music-imports"));

/** Prometheus metrics at /api/metrics, with basic auth (YourSpotify's variables). Off when unset. */
export const metricsAuth =
  process.env.PROMETHEUS_USERNAME && process.env.PROMETHEUS_PASSWORD
    ? { username: process.env.PROMETHEUS_USERNAME, password: process.env.PROMETHEUS_PASSWORD }
    : null;

/** Header your reverse proxy puts the visitor IP in (e.g. cf-connecting-ip). Unset: the TCP peer. */
export const CLIENT_IP_HEADER = process.env.CLIENT_IP_HEADER?.toLowerCase();

/** How long a session lasts without being used. */
export const SESSION_IDLE_DAYS = Number(process.env.SESSION_IDLE_DAYS ?? 30);

if (!spotify && !DEV_LOGIN_USER) {
  throw new Error("Set SPOTIFY_PUBLIC and SPOTIFY_SECRET: Music signs in with Spotify (see server/.env.example)");
}
