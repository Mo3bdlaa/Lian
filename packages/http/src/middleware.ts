// Session, rate limit, idempotency.
//
// The three things every route needs and none should implement. Applied by
// the server, declared per route, so "did this route check auth?" is
// answerable by reading the route table rather than the handler.
import { createHash } from 'node:crypto';
import { HttpError, type RequestContext } from './router.ts';

export type Session = { readonly userId: string; readonly sessionId: string; readonly deviceId: string | null };

export type MiddlewarePorts = {
  sessionByToken(tokenHash: string, now: Date): Promise<Session | null>;
  takeToken(bucketKey: string, windowSeconds: number, limit: number, now: Date): Promise<{ allowed: boolean; resetAt: Date }>;
  claimIdempotency(input: { key: string; userId: string | null; route: string; requestHash: string }): Promise<{ state: 'fresh' | 'in_flight' | 'conflict' } | { state: 'replay'; status: number; body: unknown }>;
  completeIdempotency(key: string, status: number, body: unknown): Promise<void>;
};

export type RateRule = { readonly limit: number; readonly windowSeconds: number };

/**
 * Rate limits, per route class.
 *
 * ASSUMPTIONS, stated because they are guesses: these are sized for a person
 * using a phone, not measured against traffic that does not exist yet. The
 * auth numbers are the only ones chosen against a threat rather than a user —
 * they are what makes password guessing expensive.
 */
export const RATE_RULES = {
  /** Sign-in and sign-up, per IP. Ten a minute is generous for a person and
   *  slow for a script. */
  auth: { limit: 10, windowSeconds: 60 },
  /** Per account, so a stolen password cannot be brute-forced from many IPs. */
  authPerAccount: { limit: 5, windowSeconds: 300 },
  /** Sending a message. The plan's daily limit is the real one; this is the
   *  runaway guard, and it is per second rather than per day. */
  chat: { limit: 20, windowSeconds: 60 },
  /** Corrections, settings, everything else a signed-in person does. */
  write: { limit: 60, windowSeconds: 60 },
  /** Reads. High, because a client that lists memories on every screen is
   *  normal and should not be throttled into feeling broken. */
  read: { limit: 300, windowSeconds: 60 },
  /** Export and deletion: expensive, and nobody needs to do either twice a
   *  minute. */
  heavy: { limit: 3, windowSeconds: 3_600 },
  /**
   * Asking for a password reset. Deliberately tighter than `auth`, and
   * applied per ADDRESS ASKED FOR as well as per IP: the endpoint sends mail
   * to an address the requester names, so an unlimited one is both an
   * enumeration oracle with a delay and a way to have somebody else's inbox
   * filled from a hundred IPs.
   */
  resetRequest: { limit: 3, windowSeconds: 900 },
} as const satisfies Record<string, RateRule>;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

export function bearerFrom(context: RequestContext): string | null {
  const header = context.headers['authorization'] ?? '';
  if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  // The PWA holds its session in a cookie so a stolen token cannot be read by
  // script; the bearer form is for the tick and for tests.
  const cookie = context.headers['cookie'] ?? '';
  const match = /(?:^|;\s*)lian_session=([^;]+)/.exec(cookie);
  return match === null ? null : decodeURIComponent(match[1]!);
}

export async function requireSession(context: RequestContext, ports: MiddlewarePorts, now: Date): Promise<Session> {
  const token = bearerFrom(context);
  if (token === null) throw new HttpError(401, 'no_session', 'not signed in');
  const session = await ports.sessionByToken(hashToken(token), now);
  if (session === null) throw new HttpError(401, 'no_session', 'that session has expired');
  return session;
}

export async function enforceRate(
  input: { bucket: string; rule: RateRule; now: Date },
  ports: MiddlewarePorts,
): Promise<void> {
  const verdict = await ports.takeToken(input.bucket, input.rule.windowSeconds, input.rule.limit, input.now);
  if (verdict.allowed) return;
  const seconds = Math.max(1, Math.ceil((verdict.resetAt.getTime() - input.now.getTime()) / 1000));
  throw new HttpError(429, 'rate_limited', `too many requests — try again in ${seconds}s`);
}

export function requestHash(context: RequestContext): string {
  return createHash('sha256').update(`${context.method} ${context.path}\n${context.rawBody}`).digest('base64url');
}

/**
 * Idempotency for a write.
 *
 * Every write route, not just capture: a phone on a flaky connection retries
 * POSTs, and "it went through twice" is indistinguishable from a bug to the
 * person it happens to. The key comes from the client; a write without one is
 * refused rather than quietly accepted, because a route that only sometimes
 * has this protection is a route nobody can reason about.
 */
export const IDEMPOTENCY_HEADER = 'idempotency-key';

export async function withIdempotency(
  input: { context: RequestContext; userId: string | null; route: string },
  ports: MiddlewarePorts,
  run: () => Promise<{ status: number; json: unknown }>,
): Promise<{ status: number; json: unknown; replayed: boolean }> {
  const key = input.context.headers[IDEMPOTENCY_HEADER];
  if (key === undefined || key.trim() === '') {
    throw new HttpError(400, 'idempotency_key_required', `every write needs an ${IDEMPOTENCY_HEADER} header`);
  }
  if (key.length > 200) throw new HttpError(400, 'idempotency_key_too_long', 'that key is too long');

  const scoped = `${input.userId ?? 'anon'}:${key}`;
  const hash = requestHash(input.context);
  const claim = await ports.claimIdempotency({ key: scoped, userId: input.userId, route: input.route, requestHash: hash });

  if (claim.state === 'replay') return { status: claim.status, json: claim.body, replayed: true };
  if (claim.state === 'in_flight') {
    // The first request has not answered yet. 409 rather than a wait: the
    // client should retry, and holding the connection open doubles the load
    // that caused this.
    throw new HttpError(409, 'in_flight', 'that request is still being processed');
  }
  if (claim.state === 'conflict') {
    throw new HttpError(422, 'idempotency_conflict', 'that key was already used with a different request');
  }

  const result = await run();
  await ports.completeIdempotency(scoped, result.status, result.json);
  return { ...result, replayed: false };
}
