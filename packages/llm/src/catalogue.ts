// The model catalogue.
//
// Q17: provider-agnostic from day one — capability negotiation, no assumption
// of tool-calling, and a per-model token budgeter.  One default provider
// ships; BYO-key is not built tonight, but nothing here precludes it, because
// retrofitting that into a coupled LLM package is the expensive version.
//
// Prices are per million tokens, recorded with the date they were read so a
// stale number is visibly stale rather than quietly wrong.
export type ModelCapabilities = {
  /** Every model in this product must stream: the turn is a stream. */
  readonly streaming: boolean;
  /** NOT assumed.  Capture works through control tags precisely so that a
   *  local or self-hosted model without tool-calling is still a first-class
   *  citizen — which the audience for this product cares about. */
  readonly toolCalling: boolean;
  readonly vision: boolean;
  readonly contextTokens: number;
  readonly maxOutputTokens: number;
};

export type ModelPricing = {
  readonly inputPerMillionMicros: number;
  readonly outputPerMillionMicros: number;
  /** When these prices were last checked, in the source they came from. */
  readonly pricedOn: string;
};

export type ModelEntry = {
  readonly id: string;
  readonly provider: 'anthropic';
  readonly capabilities: ModelCapabilities;
  readonly pricing: ModelPricing;
};

const M = 1_000_000;

/**
 * Prices re-read from the Anthropic model table on 2026-08-27. All three were
 * unchanged from 2026-06-24.
 *
 * WORTH KNOWING RATHER THAN JUST CHECKING: Sonnet 5's $2/$10 was announced as
 * introductory pricing with an increase to $3/$15 scheduled for 2026-09-01 —
 * four days from this reading. That increase has been CANCELLED and $2/$10 is
 * now the standard price. Had it gone ahead, the free tier's ceiling in
 * domain/plan.ts would have been 50% short overnight, and nothing in this
 * repository would have said so.
 */
export const MODELS: Readonly<Record<string, ModelEntry>> = {
  'claude-opus-5': {
    id: 'claude-opus-5', provider: 'anthropic',
    capabilities: { streaming: true, toolCalling: true, vision: true, contextTokens: 1_000_000, maxOutputTokens: 128_000 },
    pricing: { inputPerMillionMicros: 5 * M, outputPerMillionMicros: 25 * M, pricedOn: '2026-08-27' },
  },
  'claude-sonnet-5': {
    id: 'claude-sonnet-5', provider: 'anthropic',
    capabilities: { streaming: true, toolCalling: true, vision: true, contextTokens: 1_000_000, maxOutputTokens: 128_000 },
    pricing: { inputPerMillionMicros: 2 * M, outputPerMillionMicros: 10 * M, pricedOn: '2026-08-27' },
  },
  'claude-haiku-4-5': {
    id: 'claude-haiku-4-5', provider: 'anthropic',
    capabilities: { streaming: true, toolCalling: true, vision: true, contextTokens: 200_000, maxOutputTokens: 64_000 },
    pricing: { inputPerMillionMicros: 1 * M, outputPerMillionMicros: 5 * M, pricedOn: '2026-08-27' },
  },
};

/**
 * The default model for every surface.
 *
 * The ruling (see HANDOFF §3): do NOT downgrade the first session to make the
 * numbers work.  The first session is where the product is won or lost.  The
 * free MESSAGE limit moved to 20 instead, so the two limits agree and a free
 * user only ever meets the one the copy names.
 *
 * The arithmetic, kept current because plan.ts depends on it: a chat turn with
 * a ~3k-token prompt and a ~200-token reply costs about 7,500 micros ($0.0075)
 * on Sonnet 5 and about 20,000 ($0.020) on Opus 5.  Against the free plan's
 * $0.15/month model-spend ceiling that is 20 turns and 7 turns respectively.
 */
export const DEFAULT_MODEL = 'claude-sonnet-5';

export function modelEntry(id: string): ModelEntry {
  const entry = MODELS[id];
  if (entry === undefined) throw new Error(`unknown model '${id}'. Add it to the catalogue with its capabilities and price.`);
  return entry;
}

/**
 * What one chat turn actually looks like, used by the plan arithmetic and by
 * the test that keeps the two limits honest.  The system prompt is the bulk
 * of it: persona, canon, relationship, memory, capabilities and the contract,
 * plus a bounded history window.
 */
export const TYPICAL_TURN = { inputTokens: 3_000, outputTokens: 200 } as const;

/**
 * Prompt-cache price multipliers, relative to fresh input.
 *
 * VERIFIED, not assumed, and every number below depends on it: a 5-minute
 * cache write costs 1.25× fresh input and a read costs 0.1×. Read from the
 * provider's pricing table on 2026-08-27, same source and date as the
 * per-model prices above, where it is stated as a multiplier rather than
 * inferred from two prices.
 *
 * There is also a 1-HOUR write at 2×, which this product does not use: turns
 * are minutes apart at best and the 5-minute cache is the one that matches.
 * If that ever changes, this constant is not enough — it becomes two.
 *
 * If those multipliers move, the free-tier ceiling in domain/plan.ts moves
 * with them, and the test in runtime/turn.test.ts is what says so.
 */
export const CACHE_WRITE_MULTIPLIER = 1.25;
export const CACHE_READ_MULTIPLIER = 0.1;

/**
 * Below this many tokens a cache breakpoint silently does nothing.
 * ASSUMPTION: ~1024 tokens, from the same documentation.  "Silently" is the
 * important word — a prefix under the minimum is not an error, it is simply
 * never cached, so the turn reports what it actually got rather than
 * assuming a hit.
 */
export const MIN_CACHEABLE_TOKENS = 1024;

/**
 * What share of a typical turn's input is cacheable.
 *
 * MEASURED, not assumed — and the first version of this number was assumed
 * and wrong by three times, which is why it now says how it was arrived at.
 *
 * From the golden chat prompt (packages/prompt/src/__golden__/chat.txt) plus
 * TYPICAL_TURN's 3,000 input tokens:
 *
 *   system block          ~790 tokens   stable for the conversation
 *   per-turn context      ~135 tokens   memory, standing, time, directive
 *   history               ~2,075 tokens  append-only, so all but the last
 *                                        message is stable too
 *
 * Cacheable = the system block plus the history prefix = ~0.85 of the input.
 * The number below is deliberately more conservative than that: history is
 * short early in a conversation, and a cache entry expires between sessions.
 *
 * ASSUMPTION inside the measurement: ~4 characters per token, the usual rough
 * ratio for English; Arabic runs denser, so the Arabic side caches slightly
 * better than this and never worse.
 */
export const TYPICAL_CACHED_SHARE = 0.7;

export type TurnUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens?: number;
  cacheReadTokens?: number;
};

/** Cost of one turn from real usage, cache-aware. */
export function turnCostMicros(model: string, usage: TurnUsage): number {
  const { pricing } = modelEntry(model);
  const input = usage.inputTokens * pricing.inputPerMillionMicros;
  const write = (usage.cacheWriteTokens ?? 0) * pricing.inputPerMillionMicros * CACHE_WRITE_MULTIPLIER;
  const read = (usage.cacheReadTokens ?? 0) * pricing.inputPerMillionMicros * CACHE_READ_MULTIPLIER;
  const output = usage.outputTokens * pricing.outputPerMillionMicros;
  return Math.ceil((input + write + read + output) / M);
}

/**
 * Cost of one typical turn, in three states, so the difference caching makes
 * is a number rather than a claim:
 *
 *   'uncached'    no caching at all — what we billed before this ran
 *   'cache-write' the first turn of a conversation, which pays 1.25×
 *   'cache-read'  every turn after it
 */
/**
 * The share of turns that pay a cache WRITE rather than a read.
 *
 * ASSUMPTION: 1 in 10.  A cache entry lives ~5 minutes by default, so the
 * first turn of every session pays the write, as does any turn after a pause
 * longer than that.  One in ten implies sessions of about ten turns, which
 * matches nothing measured yet — there is no usage data.  It is here rather
 * than buried in a spreadsheet so that the first week of real sessions can
 * correct it, and so the plan ceiling below is not quietly optimistic.
 */
export const CACHE_WRITE_TURN_SHARE = 0.1;

/**
 * What a turn costs on average once caching is on — the number the plan
 * ceiling should actually be sized against, because a month contains both
 * kinds of turn.
 */
export function blendedTurnMicros(model: string): number {
  const write = typicalTurnMicros(model, 'cache-write');
  const read = typicalTurnMicros(model, 'cache-read');
  return Math.ceil(write * CACHE_WRITE_TURN_SHARE + read * (1 - CACHE_WRITE_TURN_SHARE));
}

export function typicalTurnMicros(model: string, state: 'uncached' | 'cache-write' | 'cache-read' = 'uncached'): number {
  const prefix = Math.round(TYPICAL_TURN.inputTokens * TYPICAL_CACHED_SHARE);
  const rest = TYPICAL_TURN.inputTokens - prefix;
  if (state === 'uncached') return turnCostMicros(model, TYPICAL_TURN);
  return turnCostMicros(model, {
    inputTokens: rest,
    outputTokens: TYPICAL_TURN.outputTokens,
    ...(state === 'cache-write' ? { cacheWriteTokens: prefix } : { cacheReadTokens: prefix }),
  });
}

/** Kept for callers that have no cache usage to report. */
export function costMicros(model: string, usage: { inputTokens: number; outputTokens: number }): number {
  return turnCostMicros(model, usage);
}
