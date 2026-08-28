// Rate limiting and idempotency — both in the database, both for the same
// reason (LESSONS §12): "Rate limiting held in process memory resets on every
// cold start and is per-instance. It is not a rate limit."
import type { Sql } from '../client.ts';
import { db } from '../client.ts';

// ── rate limiting ─────────────────────────────────────────────────────────

export type RateVerdict = { readonly allowed: boolean; readonly count: number; readonly resetAt: Date };

/**
 * Take one unit from a fixed window.
 *
 * Atomic: the count is incremented and checked in one statement, because
 * read-then-write across two round trips is how a limit leaks under exactly
 * the load it exists for. A refusal does not increment — otherwise a client
 * hammering a closed door keeps pushing its own reset further away.
 *
 * The `WHERE $3 > 0` on the insert is the same fix as usage.reserve's, and
 * unlike that one it was NOT reachable: `ON CONFLICT DO UPDATE ... WHERE`
 * bounds the update branch only, so the first request of a window was
 * allowed whatever the limit — and every rule in RATE_RULES is at least
 * three, so the first request was always allowed anyway. It is here because
 * the way somebody closes a route in a hurry is to set its limit to zero,
 * and without this that would let one request per window through, quietly,
 * which is the worst possible answer to "is this route off".
 */
export async function takeToken(
  bucketKey: string,
  windowSeconds: number,
  limit: number,
  now: Date,
  sql: Sql = db(),
): Promise<RateVerdict> {
  const windowStart = new Date(Math.floor(now.getTime() / (windowSeconds * 1000)) * windowSeconds * 1000);
  const resetAt = new Date(windowStart.getTime() + windowSeconds * 1000);

  const { rows } = await sql.query<{ count: number }>(
    `INSERT INTO rate_limits (bucket_key, window_start, count)
     SELECT $1::text, $2::timestamptz, 1 WHERE $3::int > 0
     ON CONFLICT (bucket_key, window_start)
     DO UPDATE SET count = rate_limits.count + 1
     WHERE rate_limits.count < $3
     RETURNING count`,
    [bucketKey, windowStart, limit],
  );

  if (rows[0] !== undefined) return { allowed: true, count: rows[0].count, resetAt };

  const { rows: current } = await sql.query<{ count: number }>(
    `SELECT count FROM rate_limits WHERE bucket_key = $1 AND window_start = $2`,
    [bucketKey, windowStart],
  );
  return { allowed: false, count: current[0]?.count ?? limit, resetAt };
}

/**
 * Every bucket belonging to one person.
 *
 * rate_limits has no foreign key to hang a cascade on — a bucket key is an
 * opaque string, and most of them are addresses rather than people. But the
 * per-user buckets end in the user's id, and LESSONS §11 says deletion is
 * real: a row reading `chat:<their uuid>` is still their identifier sitting
 * in a table after they asked to be forgotten.
 */
export async function purgeBucketsFor(userId: string, sql: Sql = db()): Promise<number> {
  const { rowCount } = await sql.query(`DELETE FROM rate_limits WHERE bucket_key LIKE '%:' || $1`, [userId]);
  return rowCount ?? 0;
}

/** Windows older than this are dead weight. Called by the tick. */
export async function sweepRateLimits(before: Date, sql: Sql = db()): Promise<number> {
  const { rowCount } = await sql.query(`DELETE FROM rate_limits WHERE window_start < $1`, [before]);
  return rowCount ?? 0;
}

// ── idempotency ───────────────────────────────────────────────────────────

export type IdempotencyState =
  /** First time: proceed, then call `complete`. */
  | { readonly state: 'fresh' }
  /** Same key, same body, already answered: replay it. */
  | { readonly state: 'replay'; readonly status: number; readonly body: unknown }
  /** Same key, still running — the client retried before the first finished. */
  | { readonly state: 'in_flight' }
  /** Same key, DIFFERENT body. Never silently answer this. */
  | { readonly state: 'conflict' };

export async function claimIdempotency(
  input: { key: string; userId: string | null; route: string; requestHash: string },
  sql: Sql = db(),
): Promise<IdempotencyState> {
  const { rows } = await sql.query<{ inserted: boolean; request_hash: string; status: number | null; response_body: unknown; completed_at: Date | null }>(
    `INSERT INTO idempotency_keys (key, user_id, route, request_hash)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (key) DO UPDATE SET key = idempotency_keys.key
     RETURNING (xmax = 0) AS inserted, request_hash, status, response_body, completed_at`,
    [input.key, input.userId, input.route, input.requestHash],
  );
  const row = rows[0]!;
  if (row.inserted) return { state: 'fresh' };
  // A key reused with different content is a client bug, and answering it
  // with the first response would be answering a question nobody asked.
  if (row.request_hash !== input.requestHash) return { state: 'conflict' };
  if (row.completed_at === null) return { state: 'in_flight' };
  return { state: 'replay', status: row.status ?? 200, body: row.response_body };
}

export async function completeIdempotency(key: string, status: number, body: unknown, sql: Sql = db()): Promise<void> {
  await sql.query(
    `UPDATE idempotency_keys SET status = $2, response_body = $3, completed_at = now() WHERE key = $1`,
    [key, status, JSON.stringify(body ?? null)],
  );
}

/**
 * Release a claim for work that did NOT happen.
 *
 * Distinct from `complete`: completing records an answer and replays it
 * forever, which is right for "she said this" and wrong for "the provider was
 * down". A degraded turn writes nothing, charges nothing and refunds its
 * reservation, so the same key must be free to mean a real attempt next time
 * rather than replaying an outage that is over.
 *
 * Deleting rather than marking: the key was never used to produce an answer,
 * so there is nothing about it worth keeping, and a row that exists is a row
 * a conflict check has to reason about.
 */
export async function releaseIdempotency(key: string, sql: Sql = db()): Promise<void> {
  await sql.query(`DELETE FROM idempotency_keys WHERE key = $1 AND completed_at IS NULL`, [key]);
}

/** A request that died mid-flight leaves a claimed key. Released by age, so a
 *  crash does not lock a client out of retrying forever. */
export async function releaseStaleIdempotency(before: Date, sql: Sql = db()): Promise<number> {
  const { rowCount } = await sql.query(
    `DELETE FROM idempotency_keys WHERE completed_at IS NULL AND created_at < $1`,
    [before],
  );
  return rowCount ?? 0;
}

export async function sweepIdempotency(before: Date, sql: Sql = db()): Promise<number> {
  const { rowCount } = await sql.query(`DELETE FROM idempotency_keys WHERE created_at < $1`, [before]);
  return rowCount ?? 0;
}
