// Rolling the conversation summary forward.
//
// Not every turn.  Summarising on each message would pay for a second model
// call to restate something that changed by one sentence, so the roll waits
// until enough has fallen out of the window to be worth a call.  The cost of
// a long conversation is then flat rather than linear in its length.
import { rollSummary, type AnalysisModel } from '@lian/analysis';

/** How many messages must fall out of the window before a roll is worth it. */
export const ROLL_THRESHOLD = 20;

export type SummaryPorts = {
  get(assistantId: string, conversationId: string): Promise<{ summary: string; coversThroughAt: Date } | null>;
  unsummarised(assistantId: string, conversationId: string, windowSize: number): Promise<{ id: string; role: 'user' | 'assistant'; body: string; createdAt: Date }[]>;
  put(assistantId: string, conversationId: string, input: { summary: string; coversThroughId: string; coversThroughAt: Date; addedMessages: number }): Promise<void>;
};

export type RollResult =
  | { readonly status: 'rolled'; readonly covered: number }
  | { readonly status: 'not_yet'; readonly waiting: number }
  | { readonly status: 'nothing_to_do' };

export async function maybeRollSummary(
  input: { assistantId: string; conversationId: string; windowSize: number },
  deps: { model: AnalysisModel; ports: SummaryPorts },
): Promise<RollResult> {
  const pending = await deps.ports.unsummarised(input.assistantId, input.conversationId, input.windowSize);
  if (pending.length === 0) return { status: 'nothing_to_do' };
  if (pending.length < ROLL_THRESHOLD) return { status: 'not_yet', waiting: pending.length };

  const existing = await deps.ports.get(input.assistantId, input.conversationId);
  const summary = await rollSummary(
    { summarySoFar: existing?.summary ?? null, messages: pending.map((m) => ({ role: m.role, body: m.body })) },
    deps.model,
  );
  // A model that returned nothing must not advance the cursor: the messages
  // would then be neither in the window nor in the summary, which is the one
  // way this can silently lose a conversation.
  if (summary === null) return { status: 'nothing_to_do' };

  const last = pending[pending.length - 1]!;
  await deps.ports.put(input.assistantId, input.conversationId, {
    summary, coversThroughId: last.id, coversThroughAt: last.createdAt, addedMessages: pending.length,
  });
  return { status: 'rolled', covered: pending.length };
}
