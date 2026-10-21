// Sessions. You sign in with Spotify, like on YourSpotify (see spotify/oauth.ts): your Spotify
// account is both your identity and where your history comes from.
//
// The session cookie holds a random token; the database only stores its SHA-256.
// Public links (YourSpotify's "public token", ?token=…) give read-only access to one user's stats.

import { Hono, type Context, type MiddlewareHandler, type Next } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { sql } from "./db.ts";
import { DEV_LOGIN_USER, PUBLIC_URL, SECURE_COOKIES, SESSION_IDLE_DAYS, spotify } from "./config.ts";
import { newUserId, randomToken, sha256 } from "./crypto.ts";
import { HttpError, clientIp, str } from "./http.ts";
import { getUser, meView, type User } from "./users.ts";

export interface Session {
  id: string;
  userId: string;
  method: string;
}

export type AppEnv = { Variables: { user: User; session: Session | null; guest: boolean } };

const COOKIE = SECURE_COOKIES ? "__Host-music" : "music";
const DAY = 24 * 60 * 60_000;

// --- Sessions ---

export async function startSession(c: Context, user: User, method: string) {
  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_IDLE_DAYS * DAY);
  await sql`
    INSERT INTO sessions (id, user_id, method, user_agent, ip, expires_at)
    VALUES (${sha256(token)}, ${user.id}, ${method}, ${str(c.req.header("User-Agent"), 300)}, ${clientIp(c)}, ${expires})`;
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure: SECURE_COOKIES,
    sameSite: "Lax",
    path: "/",
    // The cookie outlives idle expiry; the database decides when it's dead.
    maxAge: 400 * 24 * 60 * 60,
  });
  await sql`UPDATE users SET last_seen_at = now() WHERE id = ${user.id}`;
}

async function currentSession(c: Context): Promise<(Session & { user: User }) | null> {
  const token = getCookie(c, COOKIE);
  if (!token) return null;
  const [s] = await sql<(Session & { expiresAt: Date; lastSeenAt: Date })[]>`
    SELECT id, user_id, method, expires_at, last_seen_at FROM sessions WHERE id = ${sha256(token)}`;
  if (!s || s.expiresAt < new Date()) return null;
  const user = await getUser(s.userId);
  if (!user) return null;
  // Slide the idle expiry, at most once a minute per session.
  if (Date.now() - s.lastSeenAt.getTime() > 60_000) {
    const expires = new Date(Date.now() + SESSION_IDLE_DAYS * DAY);
    await sql`UPDATE sessions SET last_seen_at = now(), expires_at = ${expires}, ip = ${clientIp(c)} WHERE id = ${s.id}`;
    await sql`UPDATE users SET last_seen_at = now() WHERE id = ${user.id}`;
  }
  return { ...s, user };
}

/** The user a public link (?token=…) opens, if any. */
async function guestUser(c: Context): Promise<User | null> {
  const token = c.req.query("token");
  if (!token || token.length > 100) return null;
  const [u] = await sql<User[]>`SELECT * FROM users WHERE public_token = ${token}`;
  return u ?? null;
}

/** Signed in (YourSpotify's `logged`). */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const s = await currentSession(c);
  if (!s) throw new HttpError(401, "Not signed in");
  c.set("user", s.user);
  c.set("session", s);
  c.set("guest", false);
  await next();
};

/** Signed in, or opened through a public link: read-only stats (YourSpotify's `isLoggedOrGuest`). */
export const requireUserOrGuest: MiddlewareHandler<AppEnv> = async (c, next) => {
  const guest = await guestUser(c);
  if (guest) {
    c.set("user", guest);
    c.set("session", null);
    c.set("guest", true);
    return next();
  }
  return requireUser(c, next);
};

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get("user").isAdmin || c.get("guest")) throw new HttpError(403, "Admins only");
  await next();
};

/** For GET /me: whoever is there, or nobody. */
export async function whoIs(c: Context): Promise<{ user: User; guest: boolean } | null> {
  const guest = await guestUser(c);
  if (guest) return { user: guest, guest: true };
  const s = await currentSession(c);
  return s ? { user: s.user, guest: false } : null;
}

/**
 * Cookie-authenticated writes must come from the app itself. Browsers send Origin on every
 * cross-site POST, so a mismatch means another site is trying to act as the user.
 */
export async function sameOrigin(c: Context, next: Next) {
  if (c.req.method !== "GET" && c.req.method !== "HEAD" && getCookie(c, COOKIE)) {
    const origin = c.req.header("Origin");
    const site = c.req.header("Sec-Fetch-Site");
    const allowed = new URL(PUBLIC_URL).origin;
    if ((origin && origin !== allowed && !isDevOrigin(origin)) || (!origin && site && site !== "same-origin" && site !== "none")) {
      throw new HttpError(403, "Cross-site request blocked");
    }
  }
  await next();
}

const isDevOrigin = (o: string) => process.env.NODE_ENV !== "production" && /^http:\/\/localhost:\d+$/.test(o);

export async function signOut(c: Context) {
  const token = getCookie(c, COOKIE);
  if (token) await sql`DELETE FROM sessions WHERE id = ${sha256(token)}`;
  deleteCookie(c, COOKIE, { path: "/", secure: SECURE_COOKIES });
}

export async function signOutEverywhere(userId: string, except?: string) {
  await sql`DELETE FROM sessions WHERE user_id = ${userId} AND id <> ${except ?? ""}`;
}

// --- Routes ---

export const authRoutes = new Hono<AppEnv>();

authRoutes.get("/config", (c) => c.json({ spotify: !!spotify, dev: !!DEV_LOGIN_USER }));

authRoutes.post("/logout", async (c) => {
  await signOut(c);
  return c.json({ ok: true });
});

/** Local development only (see DEV_LOGIN_USER): signs in without the identity provider. */
authRoutes.post("/dev-login", async (c) => {
  if (!DEV_LOGIN_USER) throw new HttpError(404, "Not found");
  let [user] = await sql<User[]>`SELECT * FROM users WHERE spotify_id = ${`dev:${DEV_LOGIN_USER}`}`;
  if (!user) {
    const [{ count }] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM users`;
    const id = newUserId();
    await sql`INSERT INTO users (id, username, spotify_id, is_admin) VALUES (${id}, ${DEV_LOGIN_USER}, ${`dev:${DEV_LOGIN_USER}`}, ${count === 0})`;
    user = (await getUser(id))!;
  }
  await startSession(c, user, "dev");
  return c.json({ ok: true });
});

authRoutes.get("/me", requireUser, (c) => c.json(meView(c.get("user"))));
