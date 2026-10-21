// Tokens and ids on node:crypto.

import { createHash, randomBytes, randomUUID } from "node:crypto";

export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * A new user id, shaped like the MongoDB ObjectIds YourSpotify gave its users (24 hex digits):
 * seconds since 1970, then random bytes. Imported users keep their old id.
 */
export function newUserId(): string {
  const time = Math.floor(Date.now() / 1000).toString(16).padStart(8, "0");
  return time + randomBytes(8).toString("hex");
}

/** A public share token, as YourSpotify made them (a UUID). */
export const newPublicToken = () => randomUUID();
