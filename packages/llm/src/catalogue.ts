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

/** Prices read 2026-06-24 from the Anthropic model table. */
export const MODELS: Readonly<Record<string, ModelEntry>> = {
  'claude-opus-5': {
    id: 'claude-opus-5', provider: 'anthropic',
    capabilities: { streaming: true, toolCalling: true, vision: true, contextTokens: 1_000_000, maxOutputTokens: 128_000 },
    pricing: { inputPerMillionMicros: 5 * M, outputPerMillionMicros: 25 * M, pricedOn: '2026-06-24' },
  },
  'claude-sonnet-5': {
    id: 'claude-sonnet-5', provider: 'anthropic',
    capabilities: { streaming: true, toolCalling: true, vision: true, contextTokens: 1_000_000, maxOutputTokens: 128_000 },
    pricing: { inputPerMillionMicros: 2 * M, outputPerMillionMicros: 10 * M, pricedOn: '2026-06-24' },
  },
  'claude-haiku-4-5': {
    id: 'claude-haiku-4-5', provider: 'anthropic',
    capabilities: { streaming: true, toolCalling: true, vision: true, contextTokens: 200_000, maxOutputTokens: 64_000 },
    pricing: { inputPerMillionMicros: 1 * M, outputPerMillionMicros: 5 * M, pricedOn: '2026-06-24' },
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
 * The lever that has not been pulled yet.  Our system prompt is stable within
 * a conversation, which is exactly the shape prompt caching wants: cached
 * input reads cost about a tenth of fresh input.  With the prompt cached, a
 * typical turn's input drops to roughly a quarter of its billed cost.
 *
 * NOT IMPLEMENTED.  It is written down here because the plan arithmetic
 * below assumes it, and someone should be able to see that assumption rather
 * than inherit it.
 */
export const PROMPT_CACHE_INPUT_FACTOR = 0.25;

/** Cost of one typical turn on a model, with and without caching. */
export function typicalTurnMicros(model: string, cached = false): number {
  const { pricing } = modelEntry(model);
  const input = TYPICAL_TURN.inputTokens * (cached ? PROMPT_CACHE_INPUT_FACTOR : 1);
  return Math.ceil((input * pricing.inputPerMillionMicros) / M + (TYPICAL_TURN.outputTokens * pricing.outputPerMillionMicros) / M);
}

export function costMicros(model: string, usage: { inputTokens: number; outputTokens: number }): number {
  const { pricing } = modelEntry(model);
  return Math.ceil(
    (usage.inputTokens * pricing.inputPerMillionMicros) / M + (usage.outputTokens * pricing.outputPerMillionMicros) / M,
  );
}
