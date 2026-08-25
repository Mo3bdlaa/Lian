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
 * NOTE FOR THE COST DECISION (see HANDOFF): at these prices a chat turn with a
 * ~3k-token prompt and a ~200-token reply costs about 20,000 micros ($0.020)
 * on Opus 5.  The free plan allows 30 messages a day, so a free user who uses
 * their full allowance costs roughly $0.60/day — far above the $0.15/month
 * free ceiling in domain/plan.ts, which means the ceiling will bite on day
 * one unless a cheaper model is chosen for some surfaces.  That is a business
 * decision, not an engineering one, so nothing is downgraded here: the model
 * is per-surface configuration, the ceiling is enforced, and the arithmetic
 * is written down.
 */
export const DEFAULT_MODEL = 'claude-opus-5';

export function modelEntry(id: string): ModelEntry {
  const entry = MODELS[id];
  if (entry === undefined) throw new Error(`unknown model '${id}'. Add it to the catalogue with its capabilities and price.`);
  return entry;
}

export function costMicros(model: string, usage: { inputTokens: number; outputTokens: number }): number {
  const { pricing } = modelEntry(model);
  return Math.ceil(
    (usage.inputTokens * pricing.inputPerMillionMicros) / M + (usage.outputTokens * pricing.outputPerMillionMicros) / M,
  );
}
