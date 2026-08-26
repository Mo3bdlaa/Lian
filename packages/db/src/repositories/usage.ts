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
 * Reserve one unit against a ceiling, atomically.  Returns whether the unit
 * was granted; a refusal never increments, so a user at the limit does not
 * keep pushing the number up.
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
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (user_id, kind, period_key)
     DO UPDATE SET value = usage_counters.value + EXCLUDED.value, updated_at = now()
     WHERE usage_counters.value + EXCLUDED.value <= $5
     RETURNING value`,
    [scope.userId, kind, periodKey, by, ceiling],
  );
  if (rows[0] !== undefined) return { granted: true, value: rows[0].value };
  return { granted: false, value: await current(scope, kind, periodKey, sql) };
}
