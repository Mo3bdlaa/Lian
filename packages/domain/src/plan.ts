// Plan limits.
//
// LESSONS §12: "Free tier plus a paid model with no per-user ceiling is the
// standard way products in this category die. The cap is a launch
// requirement, not an optimisation."  So the model-cost ceiling sits here
// beside the message count, is stored in the same table, and is checked at
// the same point in the turn — not bolted on after the first invoice.
export type Plan = 'free' | 'paid';

/** Micro-dollars: 1_000_000 = $1.00.  Integers, because money. */
export type Micros = number;

export type PlanLimits = {
  /** Q6: user messages only, reset at user-local midnight. */
  messagesPerDay: number;
  /** Her own reach-outs.  A separate budget from messages: PRD §11 says she
   *  is not gone at the message limit, and a shared budget would contradict it. */
  proactivePerDay: number;
  /** PRD §35: active memories per assistant.  Canon is excluded (Q4). */
  activeMemoriesPerAssistant: number;
  /** Model spend per user per calendar month, in micro-dollars. */
  modelCostPerMonth: Micros;
  /** Characters of synthesised speech per month.  Voice is paid-only. */
  ttsCharsPerMonth: number;
  /** Seconds of voice note transcribed per month.  Metered separately from
   *  synthesis because they are billed separately and fail separately. */
  sttSecondsPerMonth: number;
  voice: boolean;
};

/**
 * The paid plan is "unlimited in practice", which is a product promise and
 * not an infrastructure one.  These ceilings are set well above any plausible
 * daily use so a runaway loop or a scripted client cannot bill the company,
 * and a user who reaches one is a conversation, not an error message.
 */
/** Billing months are ragged; the ceiling is sized against a full one. */
export const DAYS_PER_MONTH = 30;

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: {
    // 20 messages a day is the named limit, so the ceiling must fund it.
    // 20 × 30 days × ~4,000 micros a cached turn ≈ 2.4M micros, so the
    // ceiling is 2.5M ($2.50) and the limit a free user meets is the one the
    // copy names.  runtime/turn.test.ts fails if these two stop agreeing.
    //
    // Two things to know about that number.  It assumes prompt caching, which
    // is NOT implemented yet — uncached, a free user costs about $4.80/month
    // and will hit the ceiling around day 15.  And $2.50 of model spend per
    // free user is an acquisition cost, not a rounding error: it is a
    // business decision, recorded here so it is visible rather than inferred
    // from an invoice.
    messagesPerDay: 20,
    proactivePerDay: 1,
    activeMemoriesPerAssistant: 100,
    modelCostPerMonth: 2_500_000, // $2.50
    ttsCharsPerMonth: 0,
    sttSecondsPerMonth: 0,
    voice: false,
  },
  paid: {
    // "Unlimited in practice" (PRD §10): the daily number is a runaway guard,
    // not the binding constraint.  For paid the COST ceiling is what binds,
    // and it is sized so a heavy-but-human user — around 40 turns a day —
    // fits inside a $9 price with room for voice.
    messagesPerDay: 400,
    proactivePerDay: 12,
    activeMemoriesPerAssistant: Number.MAX_SAFE_INTEGER,
    modelCostPerMonth: 5_000_000, // $5.00 against a $9 price
    ttsCharsPerMonth: 200_000,
    // ~30 minutes a month of voice notes: generous for the described use
    // (a note here and there), and bounded against a $9 price.
    sttSecondsPerMonth: 1_800,
    voice: true,
  },
};

/** Turns a plan's daily message allowance into the monthly one the ceiling
 *  has to fund.  Used by the test that keeps the two numbers in agreement. */
export function monthlyMessageAllowance(plan: Plan): number {
  return PLAN_LIMITS[plan].messagesPerDay * DAYS_PER_MONTH;
}

export function limitsFor(plan: Plan): PlanLimits {
  return PLAN_LIMITS[plan];
}

/** How the product talks about the message budget, without a countdown. */
export type MessageBudget = { used: number; limit: number; remaining: number; state: 'ok' | 'approaching' | 'reached' };

/** PRD §11: a quiet indicator near the end, never a countdown timer. */
export const APPROACHING_THRESHOLD = 5;

export function messageBudget(plan: Plan, used: number): MessageBudget {
  const limit = limitsFor(plan).messagesPerDay;
  const remaining = Math.max(0, limit - used);
  const state = remaining === 0 ? 'reached' : remaining <= APPROACHING_THRESHOLD ? 'approaching' : 'ok';
  return { used, limit, remaining, state };
}
