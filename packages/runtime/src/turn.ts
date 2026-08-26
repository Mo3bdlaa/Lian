// ==========================================================================
// The turn.
//
// One function runs a turn, and BOTH surfaces call it: the user typing
// (surface 'chat') and her reaching out with the app closed (surface
// 'proactive').  The only differences are the surface passed to
// assemblePrompt and where the output goes.  That is LESSONS §1's actual
// repair — in Noura the second path was a different function, and it fell
// back to defaults nobody saw until a background message arrived.
//
// The order below is deliberate:
//   1. reserve the budget          — atomically, before spending anything
//   2. persist the user's message  — so a crash mid-stream loses nothing
//   3. assemble the prompt         — the one path
//   4. stream through the TagStream — nothing reaches a client unstripped
//   5. dispatch tags to capabilities — after the write, never before
//   6. persist, charge, record
// ==========================================================================
import { assemblePrompt, type PromptPorts, type Surface } from '@lian/prompt';
import { TagStream, type Provider, type TagSpec, turnCostMicros, modelEntry, budgetFor } from '@lian/llm';
import { ownerOfTag, tagSpecs, type CapabilityPorts } from '@lian/capabilities';
import { limitsFor, localDayKey, SUBSTANTIVE_MESSAGES_PER_QUALIFYING_DAY, type CaptureSummary, type Plan } from '@lian/domain';

export type AbsorbFn = (input: {
  userId: string; assistantId: string; plan: Plan; localDay: string;
  exchange: { userMessage: string | null; assistantMessage: string; userMessageId: string | null; assistantMessageId: string };
}) => Promise<{ kept: number; queued: number; refused: number }>;

export type TurnSink = {
  /** Already-clean text.  A control tag never reaches this (LESSONS §3). */
  text(delta: string): void;
  /** An inline confirmation row, after the capability's write succeeded. */
  capture(summary: CaptureSummary): void;
  /** Q7: she has already said "logged AED 400" by now, so a failed capture
   *  is spoken about rather than silently dropped. */
  captureFailed(reason: string, language: 'en' | 'ar'): void;
  /** Q5: the pending queue is full.  A visible, honest state — never a
   *  silent drop, and never a countdown. */
  memoryQueueFull?(language: 'en' | 'ar'): void;
};

export type TurnPorts = {
  prompt: PromptPorts;
  capabilities: CapabilityPorts;
  /** Only what the turn itself needs from storage. */
  turn: {
    appendMessage(input: { assistantId: string; conversationId: string; role: 'user' | 'assistant'; body: string; tags: unknown[]; surface: string | null; clientId: string | null }): Promise<{ id: string }>;
    history(assistantId: string, conversationId: string, limit: number): Promise<{ role: 'user' | 'assistant'; content: string }[]>;
    claimCapture(input: { userId: string; messageId: string; tagIndex: number; capability: string; entityTable: string; entityId: string }): Promise<boolean>;
    voidCaptures(userId: string, messageId: string): Promise<{ entityTable: string; entityId: string }[]>;
    reserve(userId: string, kind: 'messages' | 'proactive', periodKey: string, ceiling: number, by: number): Promise<boolean>;
    /** Distinct from reserve() on purpose: "is there room left?" and "take
     *  one" are different questions, and an overloaded by=0 argument is how
     *  two implementations of a port quietly disagree. */
    hasHeadroom(userId: string, kind: 'model_cost_micros', periodKey: string, ceiling: number): Promise<boolean>;
    charge(userId: string, kind: 'model_cost_micros', periodKey: string, micros: number): Promise<void>;
    markOutreachAnswered(assistantId: string): Promise<void>;
    creditQualifyingDay(assistantId: string, localDay: string): Promise<void>;
    userMessagesOnDay(assistantId: string, localDay: string): Promise<number>;
    recordEvent(input: { name: 'message_sent' | 'proactive_sent' | 'capture_created'; userId: string; assistantId: string; dayKey: string }): Promise<void>;
  };
  provider: Provider;
  /** Extraction runs on the non-voice path (LESSONS §1, as restated).  It is
   *  a port rather than an import so the turn cannot reach the analysis
   *  prompts, and so a test can run a turn without a second model. */
  absorb: AbsorbFn;
};

export type TurnInput = {
  readonly userId: string;
  readonly assistantId: string;
  readonly conversationId: string;
  readonly surface: Surface;
  readonly plan: Plan;
  readonly timeZone: string;
  readonly language: 'en' | 'ar';
  readonly model: string;
  readonly now: Date;
  /** Present for 'chat' and 'regenerate'; absent when she speaks first. */
  readonly userMessage: string | null;
  /** Idempotency for retries.  Q6: a retry is free and must not double-send. */
  readonly clientId: string | null;
  /** For 'regenerate': the message being replaced, whose captures are voided. */
  readonly replacingMessageId: string | null;
};

export type TurnResult =
  | {
      readonly status: 'done'; readonly messageId: string; readonly text: string;
      readonly captures: CaptureSummary[]; readonly costMicros: number;
      /** What the cache actually did this turn, so the saving is observed
       *  rather than assumed. */
      readonly cache: { readonly written: number; readonly read: number };
    }
  /** PRD §11: she is not gone.  The caller shows her line, not a modal. */
  | { readonly status: 'message_limit_reached' }
  /** LESSONS §12: the per-user ceiling.  Distinct from the message limit
   *  because it is our cost, not their allowance — and it must never be
   *  presented as her having run out of things to say. */
  | { readonly status: 'cost_ceiling_reached' }
  | { readonly status: 'quiet'; readonly reason: string };

/** Reserved for her reply; the rest of the window is prompt plus history. */
const OUTPUT_RESERVE_TOKENS = 1_024;
const HISTORY_MESSAGES = 40;

export async function runTurn(input: TurnInput, ports: TurnPorts, sink: TurnSink): Promise<TurnResult> {
  const limits = limitsFor(input.plan);
  const localDay = localDayKey(input.now, input.timeZone);
  const month = localDay.slice(0, 7);

  // ── 1. budget ───────────────────────────────────────────────────────────
  // Both ceilings are reserved atomically in the database.  In-process
  // counting is not a limit (LESSONS §12), and a refusal must not increment.
  if (input.surface === 'chat') {
    const granted = await ports.turn.reserve(input.userId, 'messages', localDay, limits.messagesPerDay, 1);
    if (!granted) return { status: 'message_limit_reached' };
  }
  if (input.surface === 'proactive') {
    const granted = await ports.turn.reserve(input.userId, 'proactive', localDay, limits.proactivePerDay, 1);
    if (!granted) return { status: 'quiet', reason: 'daily reach-out already sent' };
  }
  const costHeadroom = await ports.turn.hasHeadroom(input.userId, 'model_cost_micros', month, limits.modelCostPerMonth);
  if (!costHeadroom) return { status: 'cost_ceiling_reached' };

  // ── 2. the user's message ───────────────────────────────────────────────
  let userMessageId: string | null = null;
  if (input.userMessage !== null) {
    userMessageId = (await ports.turn.appendMessage({
      assistantId: input.assistantId, conversationId: input.conversationId, role: 'user',
      body: input.userMessage, tags: [], surface: null, clientId: input.clientId,
    })).id;
    // LESSONS §4: a reply answers everything she was waiting on, so backoff
    // resets.  Reminders the user set are untouched — they never counted.
    await ports.turn.markOutreachAnswered(input.assistantId);
  }

  // Q7: a regeneration voids what the previous version captured, so
  // regenerating "Okay, logged AED 400" does not log AED 400 twice.
  if (input.replacingMessageId !== null) {
    await ports.turn.voidCaptures(input.userId, input.replacingMessageId);
  }

  // ── 3. the one prompt path ──────────────────────────────────────────────
  const assembled = await assemblePrompt(
    {
      userId: input.userId, assistantId: input.assistantId, surface: input.surface,
      conversationId: input.conversationId, now: input.now,
      retrievalQuery: input.userMessage, memoryLimit: 12,
    },
    ports.prompt,
  );

  // ── 4. stream ───────────────────────────────────────────────────────────
  const specs: TagSpec[] = tagSpecs();
  const stream = new TagStream(specs);
  const capabilities = modelEntry(input.model).capabilities;
  const budget = budgetFor({
    contextTokens: capabilities.contextTokens,
    maxOutputTokens: capabilities.maxOutputTokens,
    reserveForOutput: OUTPUT_RESERVE_TOKENS,
  });

  const history = await ports.turn.history(input.assistantId, input.conversationId, HISTORY_MESSAGES);

  // The final turn: per-turn context, then what they actually said, then the
  // repeated directive.  Everything before it is byte-stable, which is what
  // makes both the system block and the history cacheable.
  //
  // The context is delimited and labelled because it now travels inside a
  // user message: the system block says anything between these markers is
  // from the system rather than from the person.  Someone typing the markers
  // themselves gets them back as ordinary text, which is the failure mode
  // worth being deliberate about.
  const finalTurn = [
    assembled.turnPrefix === '' ? null : `<<context>>\n${assembled.turnPrefix}\n<</context>>`,
    input.userMessage,
    assembled.turnSuffix === '' ? null : assembled.turnSuffix,
  ].filter((part): part is string => part !== null && part !== '').join('\n\n');

  // When the user just spoke, the last history entry IS that message — it was
  // persisted above.  It is replaced by the composed version rather than
  // appearing twice.  When she speaks first there is nothing to replace.
  const prior = input.userMessage === null ? history : history.slice(0, -1);
  // A conversation has to open on a user turn; a window can begin mid-reply.
  const firstUser = prior.findIndex((message) => message.role === 'user');
  const priorHistory = firstUser === -1 ? [] : prior.slice(firstUser);
  const messages = [...priorHistory, { role: 'user' as const, content: finalTurn }];

  const pendingTags: { name: string; payload: unknown; index: number }[] = [];
  const failedTags: string[] = [];
  let text = '';

  const consume = (events: ReturnType<TagStream['push']>) => {
    for (const event of events) {
      if (event.type === 'text') { text += event.text; sink.text(event.text); }
      else if (event.type === 'tag') pendingTags.push({ name: event.name, payload: event.payload, index: event.index });
      else failedTags.push(event.reason);
    }
  };

  const usage = await ports.provider.stream(
    {
      model: input.model, system: assembled.system, messages,
      maxOutputTokens: budget.maxOutputTokens, effort: 'low',
      // Only worth a breakpoint when there is history to cache.
      cacheHistory: priorHistory.length >= 2,
    },
    (delta) => consume(stream.push(delta)),
  );
  consume(stream.flush());

  // ── 5. persist, then dispatch ───────────────────────────────────────────
  const message = await ports.turn.appendMessage({
    assistantId: input.assistantId, conversationId: input.conversationId, role: 'assistant',
    body: text.trim(), tags: pendingTags, surface: input.surface, clientId: null,
  });

  const captures: CaptureSummary[] = [];
  for (const tag of pendingTags) {
    const capability = ownerOfTag(tag.name);
    // A tag with no owner cannot occur — the parser only accepts what the
    // registry offered — but if it ever does, it is not silently dropped.
    if (capability === undefined) { sink.captureFailed(`unknown tag ${tag.name}`, input.language); continue; }

    const outcome = await capability.handle(
      {
        context: {
          userId: input.userId, assistantId: input.assistantId, surface: input.surface,
          localDay, timeZone: input.timeZone, plan: input.plan, language: input.language,
        },
        tag, messageId: message.id,
      },
      ports.capabilities,
    );

    if (!outcome.ok) { failedTags.push(outcome.reason); sink.captureFailed(outcome.reason, input.language); continue; }

    // Idempotent on (message_id, tag_index): a retried stream cannot log the
    // same transaction twice (Q7).
    const claimed = await ports.turn.claimCapture({
      userId: input.userId, messageId: message.id, tagIndex: tag.index,
      capability: capability.id, entityTable: outcome.entityTable, entityId: outcome.entityId,
    });
    if (!claimed) continue;

    captures.push(outcome.summary);
    sink.capture(outcome.summary);
    await ports.turn.recordEvent({ name: 'capture_created', userId: input.userId, assistantId: input.assistantId, dayKey: localDay });
  }

  // ── 6. charge and record ────────────────────────────────────────────────
  const spent = turnCostMicros(input.model, usage.usage);
  await ports.turn.charge(input.userId, 'model_cost_micros', month, spent);
  await ports.turn.recordEvent({
    name: input.surface === 'proactive' ? 'proactive_sent' : 'message_sent',
    userId: input.userId, assistantId: input.assistantId, dayKey: localDay,
  });

  // ── 7. remember, and count the day ──────────────────────────────────────
  // assembled.writesMemory comes from the SURFACE, not from a caller, so
  // incognito cannot write memory by passing the wrong flag (Q12).
  if (assembled.writesMemory && userMessageId !== null) {
    const absorbed = await ports.absorb({
      userId: input.userId, assistantId: input.assistantId, plan: input.plan, localDay,
      exchange: {
        userMessage: input.userMessage, assistantMessage: text.trim(),
        userMessageId, assistantMessageId: message.id,
      },
    });
    // Q5: at the queue cap she says so.  Bounded and truthful beats unbounded
    // or silent, and this is the only place that state can be noticed.
    if (absorbed.refused > 0) sink.memoryQueueFull?.(input.language);

    // Q3: a qualifying day is a day the user was really in, counted once.
    const messagesToday = await ports.turn.userMessagesOnDay(input.assistantId, localDay);
    if (messagesToday >= SUBSTANTIVE_MESSAGES_PER_QUALIFYING_DAY) {
      await ports.turn.creditQualifyingDay(input.assistantId, localDay);
    }
  }

  return {
    status: 'done', messageId: message.id, text: text.trim(), captures, costMicros: spent,
    cache: { written: usage.usage.cacheWriteTokens, read: usage.usage.cacheReadTokens },
  };
}
