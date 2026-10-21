// Music server: the web app, the YourSpotify-compatible API, and the Spotify poller.

import { createHash, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { COMPAT_HOSTS, DEV_LOGIN_USER, DIST_DIR, PORT, PUBLIC_URL, metricsAuth, spotify } from "./config.ts";
import { migrate, sql } from "./db.ts";
import { authRoutes, sameOrigin } from "./auth.ts";
import { HttpError } from "./http.ts";
import { ysRoutes } from "./routes.ts";
import { appRoutes } from "./app.ts";
import { importRoutes, failInterruptedImports } from "./importer.ts";
import { oauthRoutes } from "./spotify/oauth.ts";
import { pollStats, startPoller } from "./spotify/poller.ts";

await migrate();
await failInterruptedImports();

const indexPath = resolve(DIST_DIR, "index.html");
const indexHtml = existsSync(indexPath) ? readFileSync(indexPath, "utf8") : null;
// index.html applies the theme in a tiny inline script before the bundle loads (no flash of the
// wrong theme). The policy allows exactly that script, by hash.
const inlineScripts = [...(indexHtml ?? "").matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
  (m) => `'sha256-${createHash("sha256").update(m[1]).digest("base64")}'`,
);

const app = new Hono();

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message, code: err.message }, err.status);
  console.error(err);
  return c.json({ error: "Internal error" }, 500);
});

// On a COMPAT_HOSTS host (YourSpotify's old API address), the API answers at the root.
app.use("*", async (c, next) => {
  const host = (c.req.header("host") ?? "").toLowerCase().replace(/:\d+$/, "");
  const url = new URL(c.req.url);
  if (COMPAT_HOSTS.has(host) && !url.pathname.startsWith("/api/") && url.pathname !== "/api") {
    url.pathname = `/api${url.pathname === "/" ? "" : url.pathname}`;
    return app.fetch(new Request(url, c.req.raw), c.env);
  }
  await next();
});

app.use(
  "*",
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", ...inlineScripts],
      styleSrc: ["'self'", "'unsafe-inline'"],
      // Covers and artist pictures come from Spotify's CDN.
      imgSrc: ["'self'", "data:", "https://*.scdn.co", "https://*.spotifycdn.com"],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      baseUri: ["'self'"],
    },
    referrerPolicy: "strict-origin-when-cross-origin",
  }),
);
app.use("/api/*", async (c, next) => {
  // Imports carry their own (larger) limit.
  if (c.req.path.startsWith("/api/import/")) return next();
  return bodyLimit({ maxSize: 1024 * 1024, onError: (c) => c.json({ error: "Request too large" }, 413) })(c, next);
});
app.use("/api/*", sameOrigin);

app.get("/api/health", async (c) => {
  await sql`SELECT 1`;
  return c.json({ ok: true });
});

/** Prometheus metrics (YourSpotify's /metrics), behind basic auth. */
app.get("/api/metrics", async (c) => {
  const header = c.req.header("authorization") ?? "";
  const [user, pass] = Buffer.from(header.replace(/^Basic /, ""), "base64").toString().split(":");
  const same = (a = "", b = "") => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
  if (!metricsAuth || !same(user, metricsAuth.username) || !same(pass, metricsAuth.password)) {
    c.header("WWW-Authenticate", 'Basic realm="metrics"');
    return c.text("Unauthorized", 401);
  }
  const [s] = await sql<{ users: number; plays: number; tracks: number; albums: number; artists: number }[]>`
    SELECT (SELECT count(*) FROM users)::int AS users, (SELECT count(*) FROM plays)::int AS plays, (SELECT count(*) FROM tracks)::int AS tracks,
      (SELECT count(*) FROM albums)::int AS albums, (SELECT count(*) FROM artists)::int AS artists`;
  const lines = [
    ["music_users", "Users", s.users],
    ["music_plays", "Plays stored", s.plays],
    ["music_tracks", "Tracks in the catalog", s.tracks],
    ["music_albums", "Albums in the catalog", s.albums],
    ["music_artists", "Artists in the catalog", s.artists],
    ["music_poll_runs_total", "Polling rounds", pollStats.runs],
    ["music_poll_plays_total", "Plays collected by polling", pollStats.plays],
    ["music_poll_errors_total", "Failed polls", pollStats.errors],
  ];
  return c.text(lines.map(([name, help, v]) => `# HELP ${name} ${help}\n# TYPE ${name} ${String(name).endsWith("_total") ? "counter" : "gauge"}\n${name} ${v}`).join("\n") + "\n", 200, {
    "Content-Type": "text/plain; version=0.0.4",
  });
});

app.route("/api/auth", authRoutes);
app.route("/api/app", appRoutes);
app.route("/api/oauth", oauthRoutes);
app.route("/api", importRoutes);
app.route("/api", ysRoutes);
app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

if (indexHtml) {
  const index = indexHtml;
  app.use("/assets/*", async (c, next) => {
    await next();
    c.header("Cache-Control", "public, max-age=31536000, immutable");
  });
  app.use("/*", serveStatic({ root: relative(process.cwd(), DIST_DIR) }));
  app.get("*", (c) => {
    c.header("Cache-Control", "no-cache");
    return c.html(index);
  });
} else {
  console.warn(`No web build at ${DIST_DIR}; only the API is served. Run \`npm run build\` in the project root.`);
}

startPoller();

// Expired sessions and sign-in attempts, once an hour.
setInterval(
  () => {
    void sql`DELETE FROM sessions WHERE expires_at < now()`.catch(() => {});
    void sql`DELETE FROM spotify_states WHERE expires_at < now()`.catch(() => {});
  },
  60 * 60_000,
);

serve({ fetch: app.fetch, port: PORT }, ({ port }) => {
  console.log(`Music on http://localhost:${port} (public URL ${PUBLIC_URL})`);
  console.log(`  sign-in: ${[spotify && "Spotify", DEV_LOGIN_USER && `development sign-in as ${DEV_LOGIN_USER}`].filter(Boolean).join(", ")}`);
  if (spotify) console.log(`  Spotify redirect URI: ${spotify.redirectUri}`);
  if (COMPAT_HOSTS.size) console.log(`  API at the root on: ${[...COMPAT_HOSTS].join(", ")}`);
});
