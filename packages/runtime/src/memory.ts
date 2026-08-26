// Absorbing a turn into memory.
//
// The extractor (@lian/analysis) proposes; this decides.  The split matters:
// an extractor that could write would be a second thing deciding what she
// keeps, and the plan's capacity rules would end up enforced in two places.
//
// Everything the specs promise about memory is enforced here or below it:
//   PRD §35  100 active memories per assistant on free, nothing evicted
//   Q5       the pending queue is capped at 20, with a visible refusal
//   Q11      direct single-source provenance
//   Q12      incognito writes nothing — the caller does not call this at all
//   §5       canon is separate, uncapped, and never dropped
import { extractMemories, extractCanon, toVectorLiteral, type Embedder, type AnalysisModel, type Exchange } from '@lian/analysis';
import { limitsFor, type Plan } from '@lian/domain';

/** How alike two memories must be before the new one is a duplicate. */
export const DUPLICATE_SIMILARITY = 0.94;

export type MemoryPorts = {
  countActive(assistantId: string): Promise<number>;
  countPending(assistantId: string): Promise<number>;
  findSimilar(assistantId: string, embedding: string, threshold: number): Promise<{ id: string; statement: string } | null>;
  remember(assistantId: string, input: {
    type: string; statement: string; salience: number; sourceMessageId: string;
    embedding: string | null; embeddingModel: string | null;
  }, capacity: number): Promise<{ outcome: 'kept' | 'queued' | 'queue_full'; id?: string }>;
  existingCanon(assistantId: string): Promise<{ statement: string }[]>;
  stateCanon(assistantId: string, input: { statement: string; category: string; firstMessageId: string }): Promise<void>;
  recordEvent(input: { name: 'memory_saved' | 'memory_queued'; userId: string; assistantId: string; dayKey: string }): Promise<void>;
};

export type AbsorbInput = {
  readonly userId: string;
  readonly assistantId: string;
  readonly plan: Plan;
  readonly localDay: string;
  readonly exchange: Exchange;
};

export type AbsorbReport = {
  readonly kept: number;
  readonly queued: number;
  /** Q5: the queue is full.  She says so — nothing is dropped quietly. */
  readonly refused: number;
  readonly duplicates: number;
  readonly canonAdded: number;
  readonly rejected: number;
};

const EMPTY: AbsorbReport = { kept: 0, queued: 0, refused: 0, duplicates: 0, canonAdded: 0, rejected: 0 };

/** Loose match for canon, which has no embedding: it is short and repeats
 *  almost verbatim when it repeats at all. */
function canonKey(statement: string): string {
  return statement.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim();
}

export async function absorbExchange(
  input: AbsorbInput,
  deps: { model: AnalysisModel; embedder: Embedder | null; ports: MemoryPorts },
): Promise<AbsorbReport> {
  const capacity = limitsFor(input.plan).activeMemoriesPerAssistant;
  const report = { ...EMPTY };

  // ── memory about the user ───────────────────────────────────────────────
  const extracted = await extractMemories(input.exchange, deps.model);
  report.rejected += extracted.rejected.length;

  for (const candidate of extracted.candidates) {
    let embedding: string | null = null;
    if (deps.embedder !== null) {
      try {
        const [vector] = await deps.embedder.embed([candidate.statement]);
        if (vector !== undefined) embedding = toVectorLiteral(vector);
      } catch {
        // A failed embedding must not lose the memory.  It is stored
        // unsearchable and picked up by the backfill; needingEmbedding()
        // makes that state queryable rather than invisible.
        embedding = null;
      }
    }

    if (embedding !== null) {
      const duplicate = await deps.ports.findSimilar(input.assistantId, embedding, DUPLICATE_SIMILARITY);
      if (duplicate !== null) { report.duplicates += 1; continue; }
    }

    const result = await deps.ports.remember(
      input.assistantId,
      {
        type: candidate.type, statement: candidate.statement, salience: candidate.salience,
        sourceMessageId: candidate.sourceMessageId,
        embedding, embeddingModel: embedding === null ? null : deps.embedder!.id,
      },
      capacity,
    );

    if (result.outcome === 'kept') {
      report.kept += 1;
      await deps.ports.recordEvent({ name: 'memory_saved', userId: input.userId, assistantId: input.assistantId, dayKey: input.localDay });
    } else if (result.outcome === 'queued') {
      report.queued += 1;
      await deps.ports.recordEvent({ name: 'memory_queued', userId: input.userId, assistantId: input.assistantId, dayKey: input.localDay });
    } else {
      report.refused += 1;
    }
  }

  // ── canon: what SHE said about herself (LESSONS §5) ─────────────────────
  // Uncapped and outside the plan's memory limit — it is her identity, not
  // memory about the user (Q4).
  const canon = await extractCanon(input.exchange, deps.model);
  report.rejected += canon.rejected.length;
  if (canon.candidates.length > 0) {
    const existing = new Set((await deps.ports.existingCanon(input.assistantId)).map((row) => canonKey(row.statement)));
    for (const candidate of canon.candidates) {
      if (existing.has(canonKey(candidate.statement))) continue;
      existing.add(canonKey(candidate.statement));
      await deps.ports.stateCanon(input.assistantId, {
        statement: candidate.statement, category: candidate.category, firstMessageId: candidate.sourceMessageId,
      });
      report.canonAdded += 1;
    }
  }

  return report;
}
