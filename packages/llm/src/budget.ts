// The token budgeter.
//
// A prompt that overflows the context window fails at the provider, which in
// this product means she goes silent — so the budget is decided before the
// call, not discovered during it.  Trimming is deterministic and ordered by
// what the product can least afford to lose.
//
// The estimate is characters/4, which is approximate by design: an exact count
// costs a round-trip per turn, and the budgeter only needs to be right about
// which blocks fit.  Providers that expose a token counter can override it.
export type TokenEstimator = (text: string) => number;

export const estimateTokens: TokenEstimator = (text) => Math.ceil(text.length / 4);

export type BudgetInput = {
  readonly contextTokens: number;
  readonly maxOutputTokens: number;
  /** Room kept for the model's own reply plus a safety margin. */
  readonly reserveForOutput: number;
};

export type Budget = {
  /** What the system prompt and history may occupy in total. */
  readonly inputBudget: number;
  readonly maxOutputTokens: number;
};

export function budgetFor(input: BudgetInput): Budget {
  const reserve = Math.min(input.reserveForOutput, input.maxOutputTokens);
  const inputBudget = input.contextTokens - reserve;
  if (inputBudget <= 0) throw new Error('model context is smaller than the reserved output');
  return { inputBudget, maxOutputTokens: reserve };
}

/**
 * Fit conversation history into what is left after the system prompt.
 *
 * Trims from the OLDEST end, because a conversation reads from the present
 * backwards — and returns how many were dropped so the turn can say so rather
 * than silently forgetting the middle of a conversation.
 */
export function fitHistory<T>(
  messages: readonly T[],
  systemPromptTokens: number,
  budget: Budget,
  sizeOf: (message: T) => number,
): { kept: T[]; dropped: number } {
  const available = budget.inputBudget - systemPromptTokens;
  if (available <= 0) return { kept: [], dropped: messages.length };
  const kept: T[] = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const size = sizeOf(messages[i]!);
    if (used + size > available) break;
    used += size;
    kept.unshift(messages[i]!);
  }
  return { kept, dropped: messages.length - kept.length };
}
