import { createHash, randomBytes } from "node:crypto";

/** A random URL-safe token that cannot be guessed. */
export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Tokens are stored only as hashes, so a database leak does not leak working links. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
