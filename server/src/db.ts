// PostgreSQL connection and schema migrations.
//
// Columns are snake_case in the database and camelCase in JS. Only column names are transformed:
// JSON values keep their keys, so `to_jsonb(track)` comes out in Spotify's (and YourSpotify's)
// snake_case shape (`duration_ms`, `release_date`…).
//
// The model follows YourSpotify's: Spotify's tracks, albums and artists are stored once for everyone,
// and each user's history is a list of plays (YourSpotify's "infos"), with the album and artists of the
// track copied onto the play so stats never need to join the catalog to group.

import postgres from "postgres";
import { DATABASE_URL } from "./config.ts";

export const sql = postgres(DATABASE_URL, {
  max: Number(process.env.DATABASE_POOL_MAX ?? 10),
  // Close idle connections: each one is a Postgres process holding several MB.
  idle_timeout: 60,
  onnotice: () => {},
  // Times inside JSON (plays' played_at) come out in UTC, whatever the server's zone.
  connection: { TimeZone: "UTC" },
  transform: { column: { from: postgres.toCamel, to: postgres.fromCamel } },
});

export type Sql = typeof sql;

const MIGRATIONS: string[] = [
  /* 1: initial schema */ `
  CREATE TABLE users (
    -- 24 hex digits, like the MongoDB ids YourSpotify used: imported users keep theirs.
    id text PRIMARY KEY,
    username text NOT NULL,
    email text,
    is_admin boolean NOT NULL DEFAULT false,
    -- The Spotify account: how the user signs in.
    spotify_id text UNIQUE NOT NULL,
    access_token text,
    refresh_token text,
    -- When the access token expires (epoch ms).
    expires_in bigint NOT NULL DEFAULT 0,
    -- The last time recently played tracks were fetched (epoch ms).
    last_timestamp bigint NOT NULL DEFAULT 0,
    poll_error text,
    timezone text,
    week_start smallint NOT NULL DEFAULT 1,
    date_format text NOT NULL DEFAULT 'default',
    metric_used text NOT NULL DEFAULT 'number' CHECK (metric_used IN ('number', 'duration')),
    nb_elements integer NOT NULL DEFAULT 10,
    preferred_stats_period text NOT NULL DEFAULT 'month',
    history_line boolean NOT NULL DEFAULT false,
    dark_mode text NOT NULL DEFAULT 'follow',
    blacklisted_artists text[] NOT NULL DEFAULT '{}',
    public_token text UNIQUE,
    first_listened_at timestamptz,
    language text NOT NULL DEFAULT 'en',
    created_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz
  );

  CREATE TABLE sessions (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    method text NOT NULL,
    user_agent text NOT NULL DEFAULT '',
    ip text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE spotify_states (
    state text PRIMARY KEY,
    expires_at timestamptz NOT NULL
  );

  CREATE TABLE artists (
    id text PRIMARY KEY,
    name text NOT NULL,
    genres text[] NOT NULL DEFAULT '{}',
    images jsonb NOT NULL DEFAULT '[]',
    external_urls jsonb NOT NULL DEFAULT '{}',
    href text NOT NULL DEFAULT '',
    uri text NOT NULL DEFAULT ''
  );

  CREATE TABLE albums (
    id text PRIMARY KEY,
    name text NOT NULL,
    album_type text NOT NULL DEFAULT '',
    artists text[] NOT NULL DEFAULT '{}',
    images jsonb NOT NULL DEFAULT '[]',
    release_date text NOT NULL DEFAULT '',
    release_date_precision text NOT NULL DEFAULT '',
    genres text[] NOT NULL DEFAULT '{}',
    copyrights jsonb NOT NULL DEFAULT '[]',
    external_urls jsonb NOT NULL DEFAULT '{}',
    href text NOT NULL DEFAULT '',
    uri text NOT NULL DEFAULT ''
  );

  CREATE TABLE tracks (
    id text PRIMARY KEY,
    name text NOT NULL,
    album text NOT NULL,
    artists text[] NOT NULL DEFAULT '{}',
    disc_number integer NOT NULL DEFAULT 1,
    duration_ms integer NOT NULL DEFAULT 0,
    explicit boolean NOT NULL DEFAULT false,
    external_urls jsonb NOT NULL DEFAULT '{}',
    href text NOT NULL DEFAULT '',
    is_local boolean NOT NULL DEFAULT false,
    preview_url text,
    track_number integer NOT NULL DEFAULT 1,
    uri text NOT NULL DEFAULT ''
  );
  CREATE INDEX tracks_album ON tracks(album);
  CREATE INDEX tracks_primary_artist ON tracks((artists[1]));

  -- YourSpotify's "infos": one row per play.
  CREATE TABLE plays (
    id bigserial PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    track_id text NOT NULL,
    album_id text NOT NULL,
    primary_artist_id text NOT NULL,
    artist_ids text[] NOT NULL,
    duration_ms integer NOT NULL,
    played_at timestamptz NOT NULL,
    -- Hidden from stats because the user blacklisted the track's artist.
    blacklisted boolean NOT NULL DEFAULT false
  );
  -- Range scans read only this index.
  CREATE UNIQUE INDEX plays_user_time ON plays(user_id, played_at, track_id)
    INCLUDE (album_id, primary_artist_id, duration_ms, blacklisted);
  CREATE INDEX plays_user_track ON plays(user_id, track_id, played_at);
  CREATE INDEX plays_user_artist ON plays(user_id, primary_artist_id, played_at);
  CREATE INDEX plays_user_album ON plays(user_id, album_id, played_at);

  CREATE TABLE imports (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type text NOT NULL,
    current integer NOT NULL DEFAULT 0,
    total integer NOT NULL,
    status text NOT NULL DEFAULT 'progress',
    -- The uploaded files, kept until the import succeeds or is removed (to retry).
    metadata jsonb NOT NULL DEFAULT '[]',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX imports_user ON imports(user_id);

  CREATE TABLE kv (key text PRIMARY KEY, value text NOT NULL);
  `,
];

export async function migrate() {
  await sql.begin(async (tx) => {
    // Several containers starting at once: only one migrates.
    await tx`SELECT pg_advisory_xact_lock(4242002)`;
    await tx`CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
    const [{ v }] = await tx<{ v: number }[]>`SELECT coalesce(max(version), 0)::int AS v FROM schema_migrations`;
    for (let i = v; i < MIGRATIONS.length; i++) {
      await tx.unsafe(MIGRATIONS[i]);
      await tx`INSERT INTO schema_migrations (version) VALUES (${i + 1})`;
      console.log(`Database migrated to version ${i + 1}`);
    }
  });
}

export async function kvGet(key: string): Promise<string | undefined> {
  const [row] = await sql<{ value: string }[]>`SELECT value FROM kv WHERE key = ${key}`;
  return row?.value;
}

export async function kvSet(key: string, value: string) {
  await sql`INSERT INTO kv (key, value) VALUES (${key}, ${value}) ON CONFLICT (key) DO UPDATE SET value = excluded.value`;
}

// --- Instance-wide preferences (YourSpotify's "global preferences") ---

export interface GlobalPreferences {
  /** New users may sign up (the first one always can). */
  allowRegistrations: boolean;
  /** Users may compare their tastes (affinity). */
  allowAffinity: boolean;
}

export async function globalPreferences(): Promise<GlobalPreferences> {
  const rows = await sql<{ key: string; value: string }[]>`SELECT key, value FROM kv WHERE key IN ('allowRegistrations', 'allowAffinity')`;
  const get = (k: string) => rows.find((r) => r.key === k)?.value !== "false";
  return { allowRegistrations: get("allowRegistrations"), allowAffinity: get("allowAffinity") };
}

export async function setGlobalPreferences(patch: Partial<GlobalPreferences>): Promise<GlobalPreferences> {
  for (const [k, v] of Object.entries(patch)) if (typeof v === "boolean") await kvSet(k, String(v));
  return globalPreferences();
}

/** A piece of SQL to embed in another query. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Fragment = postgres.PendingQuery<any>;
