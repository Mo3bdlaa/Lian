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
