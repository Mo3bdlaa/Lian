// Measuring the assumption the free tier is priced on.
//
// The blended cost of a turn depends on how many turns a session has: the
// first turn of a session pays a cache WRITE (1.25× fresh input) and every
// turn after it pays a READ (0.1×). @lian/llm assumes one turn in ten pays a
// write — i.e. ten-turn sessions — and that number was chosen, not measured.
//
// This is the measurement. It answers one question with real data: how many
// turns are in a session? Everything else about the economics follows.
import type { Sql } from '../client.ts';
import { db } from '../client.ts';

/**
 * How long a pause ends a session.
 *
 * ASSUMPTION, and the one that decides the answer: 30 minutes. It is longer
 * than the provider's cache TTL (~5 minutes), so this OVER-counts turns per
 * session — the measured write share is a floor, and the real one is higher.
 * Stated because a session-length metric with an undeclared gap is a number
 * that means whatever the reader assumes.
 */
export const SESSION_GAP_MINUTES = 30;

export type SessionDistribution = {
  readonly sessions: number;
  readonly turns: number;
  readonly mean: number;
  readonly median: number;
  readonly p90: number;
  /** turns-in-session → how many sessions had exactly that many. */
  readonly histogram: ReadonlyArray<{ turns: number; sessions: number }>;
  /**
   * The share of turns that begin a session, and therefore pay a cache
   * write. This is the measured counterpart of CACHE_WRITE_TURN_SHARE.
   */
  readonly cacheWriteShare: number;
  readonly gapMinutes: number;
  readonly since: string | null;
};

const EMPTY: Omit<SessionDistribution, 'gapMinutes' | 'since'> = {
  sessions: 0, turns: 0, mean: 0, median: 0, p90: 0, histogram: [], cacheWriteShare: 0,
};

/**
 * The turns-per-session distribution across every account.
 *
 * Returns counts only — no message bodies, no user or assistant identifiers
 * leave this function. That is what makes an aggregate over everybody an
 * acceptable read rather than an inherited access path (LESSONS §11).
 */
export async function turnsPerSession(
  options: { since?: Date | null; gapMinutes?: number; assistantId?: string | null } = {},
  sql: Sql = db(),
): Promise<SessionDistribution> {
  const gapMinutes = options.gapMinutes ?? SESSION_GAP_MINUTES;
  const since = options.since ?? null;
  const assistantId = options.assistantId ?? null;

  // db-scoping:allow-unscoped — an aggregate over every account, by
  // definition: "how long is a session" has no owner. It returns counts and
  // nothing else, so no row of anyone's data crosses this boundary.
  const { rows } = await sql.query<{ turns: number }>(
    `WITH turns AS (
       SELECT assistant_id, created_at,
              lag(created_at) OVER (PARTITION BY assistant_id ORDER BY created_at) AS previous
       FROM messages
       WHERE role = 'user' AND deleted_at IS NULL
         AND ($1::timestamptz IS NULL OR created_at >= $1)
         AND ($3::uuid IS NULL OR assistant_id = $3)
     ),
     marked AS (
       SELECT assistant_id, created_at,
              CASE WHEN previous IS NULL OR created_at - previous > make_interval(mins => $2::int)
                   THEN 1 ELSE 0 END AS starts_session
       FROM turns
     ),
     numbered AS (
       SELECT assistant_id,
              sum(starts_session) OVER (PARTITION BY assistant_id ORDER BY created_at
                                        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS session_number
       FROM marked
     )
     SELECT count(*)::int AS turns
     FROM numbered
     GROUP BY assistant_id, session_number
     ORDER BY turns`,
    [since, gapMinutes, assistantId],
  );

  if (rows.length === 0) return { ...EMPTY, gapMinutes, since: since?.toISOString() ?? null };

  const lengths = rows.map((row) => row.turns);
  const turns = lengths.reduce((total, length) => total + length, 0);
  const sessions = lengths.length;
  const at = (share: number): number => lengths[Math.min(lengths.length - 1, Math.floor(share * lengths.length))]!;

  const counts = new Map<number, number>();
  for (const length of lengths) counts.set(length, (counts.get(length) ?? 0) + 1);

  return {
    sessions,
    turns,
    mean: turns / sessions,
    median: at(0.5),
    p90: at(0.9),
    histogram: [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([turnsInSession, sessionCount]) => ({ turns: turnsInSession, sessions: sessionCount })),
    // One write per session, so the share of turns paying a write is the
    // share of turns that start one.
    cacheWriteShare: sessions / turns,
    gapMinutes,
    since: since?.toISOString() ?? null,
  };
}

// ── the cost dashboard (per-user pressure against the ceilings) ────────────
//
// LESSONS §12: a paid model with no per-user ceiling is how these products
// die. The ceilings exist and are enforced; what did not exist until now is
// any way to LOOK at them, which means the first sign of a bad assumption
// would have been a bill.
//
// Everything below returns DISTRIBUTIONS AND COUNTS. No user id, no email, no
// message body, nothing that identifies a person, ever — which is what keeps
// an aggregate over everybody an acceptable read (LESSONS §11) rather than
// the admin data path this product does not have. `reporting.test.ts` asserts
// the shape carries no identifier, so a future edit cannot quietly add one.

export type CounterPressure = {
  readonly kind: string;
  readonly periodKey: string;
  /** How many accounts have a non-zero value for this counter. */
  readonly accounts: number;
  readonly total: number;
  readonly median: number;
  readonly p90: number;
  readonly max: number;
  /** Accounts at or past the ceiling, and within a tenth of it. The second
   *  number is the one that moves first. */
  readonly atCeiling: number;
  readonly nearCeiling: number;
  readonly ceiling: number;
};

/**
 * One counter's spread across the accounts using it, for one period.
 *
 * `ceiling` is passed in rather than read here: the limits are a product
 * decision in @lian/domain, and a repository that knew them would be a second
 * place they are written down.
 */
export async function counterPressure(
  input: { kind: string; periodKey: string; ceiling: number },
  sql: Sql = db(),
): Promise<CounterPressure> {
  // db-scoping:allow-unscoped — an aggregate over every account's meter, by
  // definition. It returns counts and quantiles; no user_id leaves it.
  const { rows } = await sql.query<{
    accounts: number; total: string | null; median: string | null;
    p90: string | null; max: string | null; at_ceiling: number; near_ceiling: number;
  }>(
    `SELECT count(*)::int                                              AS accounts,
            sum(value)                                                 AS total,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY value)         AS median,
            percentile_cont(0.9) WITHIN GROUP (ORDER BY value)         AS p90,
            max(value)                                                 AS max,
            count(*) FILTER (WHERE value >= $3)::int                   AS at_ceiling,
            count(*) FILTER (WHERE value >= $3 * 0.9 AND value < $3)::int AS near_ceiling
     FROM usage_counters
     WHERE kind = $1 AND period_key = $2 AND value > 0`,
    [input.kind, input.periodKey, input.ceiling],
  );
  const row = rows[0];
  return {
    kind: input.kind, periodKey: input.periodKey, ceiling: input.ceiling,
    accounts: row?.accounts ?? 0,
    total: Number(row?.total ?? 0),
    median: Math.round(Number(row?.median ?? 0)),
    p90: Math.round(Number(row?.p90 ?? 0)),
    max: Number(row?.max ?? 0),
    atCeiling: row?.at_ceiling ?? 0,
    nearCeiling: row?.near_ceiling ?? 0,
  };
}

/** How many accounts are on each plan. The denominator for everything else. */
export async function planCounts(sql: Sql = db()): Promise<{ free: number; paid: number }> {
  // db-scoping:allow-unscoped — a count of every account, by definition.
  const { rows } = await sql.query<{ plan: string; n: number }>(
    `SELECT plan, count(*)::int AS n FROM users WHERE deleted_at IS NULL GROUP BY plan`,
  );
  const counts = { free: 0, paid: 0 };
  for (const row of rows) {
    if (row.plan === 'paid') counts.paid = row.n;
    else counts.free = row.n;
  }
  return counts;
}

/**
 * Total model spend in a month, in micros, across everybody.
 *
 * The number that turns into a bill. Reported beside the per-account
 * distribution because the two fail differently: a high total with a low p90
 * is growth, and a low total with a p90 at the ceiling is one account about
 * to be cut off.
 */
export async function monthlySpendMicros(month: string, sql: Sql = db()): Promise<number> {
  // db-scoping:allow-unscoped — an aggregate over every account's spend.
  const { rows } = await sql.query<{ total: string | null }>(
    `SELECT sum(value) AS total FROM usage_counters WHERE kind = 'model_cost_micros' AND period_key = $1`,
    [month],
  );
  return Number(rows[0]?.total ?? 0);
}

