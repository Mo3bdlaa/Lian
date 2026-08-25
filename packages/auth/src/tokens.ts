// Opaque tokens.
//
// The token is given out once and only its SHA-256 lives in the database, so
// a database read does not yield a working session or a working confirmation
// link.  That is the same promise the product makes about memory: what is
// stored is what is needed, and no more.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

export function tokensMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
