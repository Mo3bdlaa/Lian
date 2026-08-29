// The measuring instruments' own safety rails.
//
// SIX OF THE LAST SEVEN ALARMING RESULTS FROM `npm run session` WERE THE
// TOOL, NOT THE PRODUCT. That ratio is the reason this file exists. An
// instrument that cries wolf directs real work at nothing and buries the one
// finding that matters underneath the six that do not — and every decision
// made from here reads its output.
//
// So the tools get the same treatment the product got: three rules, each a
// function rather than a habit, each with a test that fails when it is broken.
//
//   1. AN ALARMING CLAIM NAMES THE ROWS IT READ. Not "outreach rows: 499" but
//      499 rows, from this query, scoped to this assistant. Every one of the
//      six would have been caught on sight by its own evidence line.
//   2. A TOOL ASSERTS ITS OWN ISOLATION. It read rows; do they belong to the
//      account it created? A developer's database holds tens of thousands of
//      other people's, and "SELECT … FROM outreach" is a lie there.
//   3. A MEASUREMENT SAYS WHAT IT COMPARED. A recall figure of 100% against
//      an empty ground truth is not a pass, it is an absence of evidence, and
//      it must not be able to render as a tick.
//
// Nothing here touches a database. These are the decisions, separated from
// the queries, so they can be tested without one.

// ── 1. an alarming claim names the rows it read ───────────────────────────

/** Where a number came from. Every field is required on purpose. */
export type Evidence = {
  /** The query, or a description precise enough to re-run by hand. */
  readonly query: string;
  /** What it was scoped to — an id, or the literal 'EVERY ACCOUNT'. */
  readonly scope: string;
  /** How many rows came back. */
  readonly rows: number;
};

export class UnevidencedClaim extends Error {
  constructor(claim: string, why: string) {
    super(`refusing to report "${claim}" — ${why}`);
    this.name = 'UnevidencedClaim';
  }
}

/**
 * Format an alarming observation, or refuse to.
 *
 * THE REFUSAL IS THE FEATURE. "outreach rows: 499" was printed by a tool that
 * had every means to say those rows belonged to nobody in particular; it did
 * not, and the number went into a document as a product finding about an
 * account one day old. A claim that cannot say what it read is not a finding,
 * it is a rumour, and this throws rather than printing one.
 */
export function alarming(claim: string, evidence: Evidence): string {
  if (claim.trim() === '') throw new UnevidencedClaim(claim, 'the claim is empty');
  if (evidence.query.trim() === '') throw new UnevidencedClaim(claim, 'no query was named');
  if (evidence.scope.trim() === '') {
    throw new UnevidencedClaim(claim, "no scope was named — say 'EVERY ACCOUNT' if that is what it was");
  }
  if (!Number.isInteger(evidence.rows) || evidence.rows < 0) {
    throw new UnevidencedClaim(claim, `row count ${evidence.rows} is not a count`);
  }
  return `${claim}\n      ↳ ${evidence.rows} row(s) from ${evidence.query}, scoped to ${evidence.scope}`;
}

// ── 2. a tool asserts its own isolation ───────────────────────────────────

/** Anything with an owner. Deliberately loose — outreach, memories, messages. */
export type Owned = { readonly assistantId?: string | null; readonly userId?: string | null };

/**
 * The rows in this set that do NOT belong to the scope that claimed them.
 *
 * A tool calls this on what it is about to report. Empty means it is talking
 * about its own account; anything else means it has picked up a neighbour's
 * rows, which is what turned a one-day-old account into one that had been
 * ignored four hundred and ninety-nine times.
 *
 * A row with neither id is counted as foreign rather than ignored: a read that
 * did not select an owner column cannot be shown to be isolated, and "cannot
 * be shown" is the answer, not "probably fine".
 */
export function foreignRows<T extends Owned>(
  rows: readonly T[],
  scope: { userId?: string; assistantId?: string },
): T[] {
  return rows.filter((row) => {
    const byAssistant = scope.assistantId !== undefined && row.assistantId != null
      ? row.assistantId === scope.assistantId
      : null;
    const byUser = scope.userId !== undefined && row.userId != null
      ? row.userId === scope.userId
      : null;
    if (byAssistant === null && byUser === null) return true;
    return byAssistant === false || byUser === false;
  });
}

/** Throw unless every row belongs to the scope. For a tool's own end-of-run check. */
export function assertOwnRows<T extends Owned>(
  what: string,
  rows: readonly T[],
  scope: { userId?: string; assistantId?: string },
): void {
  const foreign = foreignRows(rows, scope);
  if (foreign.length === 0) return;
  throw new Error(
    `${what}: ${foreign.length} of ${rows.length} row(s) do not belong to this run's account. ` +
    'The read is not scoped, and anything reported from it is about somebody else.',
  );
}

// ── 3. a measurement says what it compared ────────────────────────────────

export type Recall =
  | { readonly kind: 'measured'; readonly recall: number; readonly overlap: number; readonly of: number }
  /** Nothing to compare against. NOT a pass — see below. */
  | { readonly kind: 'no-ground-truth'; readonly why: string };

/**
 * Recall of an approximate answer against an exact one.
 *
 * AN EMPTY GROUND TRUTH IS NOT A HUNDRED PER CENT. `overlap / exact.length`
 * is 0/0 there, and every naive spelling of that renders as a tick: `NaN`
 * compares false against a threshold, and guarding it with `Math.max(1, …)`
 * makes it 0, which fails for the wrong reason and sends somebody to rebuild
 * an index that was fine. The absence of evidence gets its own case so that
 * neither can happen.
 */
export function recallOf(approximate: readonly string[], exact: readonly string[]): Recall {
  if (exact.length === 0) {
    return { kind: 'no-ground-truth', why: 'the exact query returned nothing to compare against' };
  }
  const truth = new Set(exact);
  const overlap = new Set(approximate.filter((id) => truth.has(id))).size;
  return { kind: 'measured', recall: overlap / exact.length, overlap, of: exact.length };
}

/**
 * ASSUMPTION: 0.8. The index measured in this project returned 60/60 when
 * built on real data and 2/60 as it was found; any threshold between those
 * works, and 0.8 leaves room for ivfflat's ordinary approximation without
 * tolerating a broken build.
 */
export const RECALL_FLOOR = 0.8;

export function recallVerdict(recall: Recall, floor = RECALL_FLOOR): 'pass' | 'fail' | 'unmeasurable' {
  if (recall.kind === 'no-ground-truth') return 'unmeasurable';
  return recall.recall >= floor ? 'pass' : 'fail';
}
