// Usage counters — LESSONS §12.
//
// "Rate limiting held in process memory resets on every cold start and is
// per-instance. It is not a rate limit."  So the counter is a row, the
// increment is atomic, and the message limit and the model-cost ceiling are
// enforced through the same function at the same point in the turn.
import type { Sql } from '../client.ts';
import { db } from '../client.ts';
import type { UserScope } from '../scope.ts';

export type CounterKind =
  | 'messages' | 'proactive' | 'model_cost_micros' | 'tts_chars' | 'stt_seconds'
  /** The introduction, budgeted once per account rather than per day — see
   *  ONBOARDING_MESSAGE_ALLOWANCE and migration 0018. Its period key is the
   *  constant 'once', so it never resets and cannot be farmed. */
  | 'onboarding'
  /** Bytes HELD, not bytes uploaded — it moves in both directions and has no
   *  period. See migration 0009. */
  | 'storage_bytes';

/** Atomic: read-then-write across two requests is how a limit leaks. */
export async function increment(
  scope: UserScope,
  kind: CounterKind,
  periodKey: string,
  by: number,
  sql: Sql = db(),
): Promise<number> {
  const { rows } = await sql.query<{ value: number }>(
    `INSERT INTO usage_counters (user_id, kind, period_key, value, updated_at)
     -- GREATEST on both branches: a decrement that arrives before anything
     -- was counted must clamp rather than violate the CHECK.
     VALUES ($1, $2, $3, GREATEST(0, $4), now())
     ON CONFLICT (user_id, kind, period_key)
     -- One counter moves in both directions: storage_bytes
     -- goes down when an attachment is deleted, and a double decrement must
     -- clamp rather than violate the CHECK and lose the whole statement.
     DO UPDATE SET value = GREATEST(0, usage_counters.value + $4), updated_at = now()
     RETURNING value`,
    [scope.userId, kind, periodKey, by],
  );
  return rows[0]?.value ?? 0;
}

export async function current(scope: UserScope, kind: CounterKind, periodKey: string, sql: Sql = db()): Promise<number> {
  const { rows } = await sql.query<{ value: number }>(
    `SELECT value FROM usage_counters WHERE user_id = $1 AND kind = $2 AND period_key = $3`,
    [scope.userId, kind, periodKey],
  );
  return rows[0]?.value ?? 0;
}

/**
 * Reserve `by` units against a ceiling, atomically.  Returns whether they
 * were granted; a refusal never increments, so a user at the limit does not
 * keep pushing the number up.
 *
 * THE INSERT NEEDS ITS OWN GUARD, and the first version did not have one.
 *
 * `ON CONFLICT DO UPDATE ... WHERE` bounds the UPDATE branch only.  When no
 * row exists yet — the first reservation of a period — there is no conflict,
 * so the WHERE never runs and the row is inserted whatever `by` is and
 * whatever the ceiling is.
 *
 * That is not theoretical.  The free plan's STT ceiling is zero, because
 * voice is paid-only, and it was enforced ENTIRELY by this function: a free
 * account's first voice note of each calendar month was transcribed and paid
 * for, every month, forever.  A single reservation larger than the whole
 * ceiling went through the same way.  Every test passed, because every test
 * reserved one unit at a time against a ceiling above one, which is the
 * exact case the missing guard does not affect.
 *
 * LESSONS §16 again, in a new place: correctly scoped, atomic, and wrong in
 * a way that looks identical to working.  The `SELECT ... WHERE $4 <= $5`
 * is the insert's half of the check — no row is proposed at all when the
 * amount alone would exceed the ceiling, so neither branch can grant it.
 */
export async function reserve(
  scope: UserScope,
  kind: CounterKind,
  periodKey: string,
  ceiling: number,
  by = 1,
  sql: Sql = db(),
): Promise<{ granted: boolean; value: number }> {
  const { rows } = await sql.query<{ value: number }>(
    `INSERT INTO usage_counters (user_id, kind, period_key, value, updated_at)
     -- Explicitly typed: in a bare SELECT the parameter's type is deduced
     -- from BOTH the column it feeds and the comparison it appears in, and
     -- Postgres refuses the two readings ("text versus bigint").
     SELECT $1::uuid, $2::text, $3::text, $4::bigint, now() WHERE $4::bigint <= $5::bigint
     ON CONFLICT (user_id, kind, period_key)
     DO UPDATE SET value = usage_counters.value + EXCLUDED.value, updated_at = now()
     WHERE usage_counters.value + EXCLUDED.value <= $5
     RETURNING value`,
    [scope.userId, kind, periodKey, by, ceiling],
  );
  if (rows[0] !== undefined) return { granted: true, value: rows[0].value };
  return { granted: false, value: await current(scope, kind, periodKey, sql) };
}

/**
 * Give a reservation back when what it paid for did not happen.
 *
 * A separate name rather than `increment(..., -1)` at the call site, because
 * "spend one" and "the spend was void" are different events and a log that
 * cannot tell them apart cannot answer "did the outage cost anybody a day?".
 *
 * It is `increment` underneath, which already clamps at zero on both branches
 * — so a refund that arrives twice, or for a counter that reset overnight
 * between the reservation and the failure, cannot mint allowance.
 */
export async function release(
  scope: UserScope,
  kind: CounterKind,
  periodKey: string,
  by = 1,
  sql: Sql = db(),
): Promise<number> {
  return increment(scope, kind, periodKey, -Math.abs(by), sql);
}
