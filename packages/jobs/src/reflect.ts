// Dreams and diary.
//
// These ARE her voice — she is writing, not classifying — so they go through
// assemblePrompt like everything else she says.  That is why `dream` and
// `diary` were surfaces from the first night: LESSONS §1 is about who is
// speaking, and here it is her.
//
// Nothing produced here is sent.  A diary entry is what she made of a day; a
// dream is a loose association she may bring up later, once.  The product
// value is small and specific: "I was thinking about what you said on
// Tuesday" is only honest if she actually did.
export type ReflectionKind = 'dream' | 'diary';

export type ReflectPorts = {
  /**
   * Assistants with enough of a day behind them to reflect on, one page at a
   * time. `after` is a keyset cursor over assistant id; a page shorter than
   * `limit` is the end.
   *
   * It PAGES rather than returning one batch because the caller filters the
   * result — to the time zones that have reached the hour — and a filter
   * applied after a LIMIT is how a job silently serves the same first N
   * accounts forever. Whoever falls past the batch never gets a diary, and
   * nothing in the report says anyone was missed.
   */
  dueForReflection(kind: ReflectionKind, localDay: string, limit: number, after: string | null): Promise<ReflectPage>;
  alreadyReflected(assistantId: string, kind: ReflectionKind, localDay: string): Promise<boolean>;
  /** Runs the SAME turn function as chat, on the dream/diary surface, with no
   *  sink attached — nothing is delivered. */
  reflect(input: { assistantId: string; userId: string; conversationId: string; kind: ReflectionKind; localDay: string }): Promise<string | null>;
  store(assistantId: string, input: { kind: ReflectionKind; body: string; aboutDay: string }): Promise<boolean>;
};

export type ReflectCandidate = { assistantId: string; userId: string; timeZone: string; conversationId: string };

/**
 * One page.
 *
 * `next` is separate from the rows on purpose: a wrapper that FILTERS the
 * rows (the scheduler restricts them to the time zones that reached the hour)
 * must not also decide where the next page starts, or the cursor jumps over
 * everything it filtered out. The source owns the cursor; a filter owns only
 * the rows.
 */
export type ReflectPage = { rows: ReflectCandidate[]; next: string | null };

export type ReflectReport = { considered: number; written: number; skipped: number };

export const REFLECT_BATCH = 50;

export async function runReflections(
  input: { kind: ReflectionKind; localDay: string },
  ports: ReflectPorts,
): Promise<ReflectReport> {
  const due: ReflectCandidate[] = [];
  let after: string | null = null;
  for (;;) {
    const page = await ports.dueForReflection(input.kind, input.localDay, REFLECT_BATCH, after);
    due.push(...page.rows);
    if (page.next === null) break;
    after = page.next;
  }
  const report: ReflectReport = { considered: due.length, written: 0, skipped: 0 };

  for (const assistant of due) {
    // One per day.  A re-run of the job is not a second thought, and the
    // unique index says so too — this is the cheap check before the model
    // call, not the guarantee.
    if (await ports.alreadyReflected(assistant.assistantId, input.kind, input.localDay)) {
      report.skipped += 1;
      continue;
    }
    const body = await ports.reflect({
      assistantId: assistant.assistantId, userId: assistant.userId,
      conversationId: assistant.conversationId, kind: input.kind, localDay: input.localDay,
    });
    if (body === null || body.trim() === '') { report.skipped += 1; continue; }
    const stored = await ports.store(assistant.assistantId, { kind: input.kind, body: body.trim(), aboutDay: input.localDay });
    if (stored) report.written += 1;
    else report.skipped += 1;
  }
  return report;
}
