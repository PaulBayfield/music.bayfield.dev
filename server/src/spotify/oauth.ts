// Signing in with Spotify (YourSpotify's /oauth/spotify routes, same paths under /api).
//
// The Spotify account is the identity, as on YourSpotify: accounts imported from it are found by
// their Spotify id, so everyone signs in and finds their history. Signing in again also renews the
// tokens used to collect plays (what YourSpotify's "relog to Spotify" did).

import { Hono } from "hono";
import { globalPreferences, sql } from "../db.ts";
import { HttpError, str } from "../http.ts";
import { newUserId, randomToken } from "../crypto.ts";
import { requireUser, startSession, type AppEnv } from "../auth.ts";
import { getUser, type User } from "../users.ts";
import { authorizeUrl, exchangeCode, spotifyFor, withToken } from "./client.ts";
import { pollUser } from "./poller.ts";

export const oauthRoutes = new Hono<AppEnv>();

oauthRoutes.get("/spotify", async (c) => {
  const state = randomToken(24);
  await sql`DELETE FROM spotify_states WHERE expires_at < now()`;
  await sql`INSERT INTO spotify_states (state, expires_at) VALUES (${state}, ${new Date(Date.now() + 10 * 60_000)})`;
  return c.redirect(authorizeUrl(state));
});

oauthRoutes.get("/spotify/callback", async (c) => {
  const fail = (message: string) => c.redirect(`/?signin_error=${encodeURIComponent(message)}`);
  const { code, state, error } = c.req.query();
  if (error) return fail(error === "access_denied" ? "Spotify access wasn't granted." : error);
  if (!code || !state) return fail("The Spotify response was incomplete.");
  const [saved] = await sql`DELETE FROM spotify_states WHERE state = ${state} AND expires_at > now() RETURNING state`;
  if (!saved) return fail("This sign-in link has expired. Try again.");

  try {
    const tokens = await exchangeCode(code);
    const me = await withToken(tokens.accessToken)<{ id: string; display_name: string | null; email?: string }>("/me");
    const tokenColumns = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken ?? null,
      expiresIn: tokens.expiresIn,
      pollError: null,
    };

    let [user] = await sql<User[]>`SELECT * FROM users WHERE spotify_id = ${me.id}`;
    if (user) {
      await sql`UPDATE users SET ${sql(tokenColumns)}, email = coalesce(${me.email?.toLowerCase() ?? null}, email) WHERE id = ${user.id}`;
    } else {
      const [{ count }] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM users`;
      if (count > 0 && !(await globalPreferences()).allowRegistrations) {
        return fail("Registrations are closed on this server. Ask an admin to open them.");
      }
      const id = newUserId();
      await sql`
        INSERT INTO users ${sql({
          id,
          username: str(me.display_name || me.id, 64),
          email: me.email?.toLowerCase() ?? null,
          spotifyId: me.id,
          isAdmin: count === 0,
          // Collect the last day straight away (what Spotify still remembers).
          lastTimestamp: Date.now() - 24 * 60 * 60_000,
          ...tokenColumns,
        })}`;
      user = (await getUser(id))!;
      console.log(`[spotify] new user ${user.username} (${id})`);
    }
    await startSession(c, user, "spotify");
    void pollUser(user.id).catch(() => {});
    return c.redirect("/");
  } catch (e) {
    console.warn("Spotify sign-in failed:", e);
    return fail(e instanceof Error ? e.message : "Couldn't sign in with Spotify");
  }
});

/** The signed-in user's Spotify profile. */
oauthRoutes.get("/spotify/me", requireUser, async (c) => {
  if (!c.get("user").refreshToken) throw new HttpError(409, "Sign in with Spotify again");
  try {
    return c.json(await spotifyFor(c.get("user").id).me());
  } catch {
    return c.json({ code: "SPOTIFY_ERROR" }, 500);
  }
});
