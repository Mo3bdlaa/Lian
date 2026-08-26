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
  /**
   * Bytes of object storage held — photographs, receipts, voice notes.
   *
   * Held rather than uploaded: the counter goes down when something is
   * deleted, which is why it has no period key. Storage is the one cost that
   * accumulates rather than resetting, so a ceiling without a decrement is a
   * ceiling everybody eventually hits.
   */
  storageBytes: number;
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

/**
 * The currency assumed when none is stated.
 *
 * ASSUMPTION: AED, because the product's first market is the UAE. It is a
 * DEFAULT, not a restriction — a receipt that prints its own code is captured
 * in that code, and so is a spend where they say one. It lives here rather
 * than as a literal in three files so changing the market is one edit.
 */
export const DEFAULT_CURRENCY = 'AED';

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: {
    // 20 messages a day is the named limit, so the ceiling must fund it.
    //
    // The arithmetic, with every assumption named (all of them live in
    // @lian/llm/catalogue.ts with their source and date):
    //
    //   20 messages/day × 30 days          = 600 turns/month
    //   a typical turn, uncached           = 8,000 micros
    //   the same turn reading the cache    = 4,220
    //   the same turn WRITING the cache    = 9,050  (first turn of a session)
    //   blended at 1-in-10 writes          ≈ 4,700
    //   600 × 4,700                        ≈ 2,820,000 micros = $2.82
    //
    // So the ceiling is $3.00, which funds the named limit with ~6% of head
    // room.  runtime/turn.test.ts recomputes all of this from the model
    // catalogue and fails if the two stop agreeing.
    //
    // What that means, stated plainly because it is a business fact and not
    // an engineering one: a free user costs up to $3.00/month of model spend
    // against $9.00 from a subscriber, so roughly three free users consume
    // one paying customer — before voice, before hosting.  Caching already
    // halved it; the levers left are the message limit, the model, and how
    // much history a turn carries.
    messagesPerDay: 20,
    proactivePerDay: 1,
    activeMemoriesPerAssistant: 100,
    modelCostPerMonth: 3_000_000, // $3.00 — see the arithmetic above
    ttsCharsPerMonth: 0,
    sttSecondsPerMonth: 0,
    // 200 MB. ASSUMPTION about what that buys: a photographed receipt is
    // 2–5 MB, so it is roughly 40–100 receipts — enough that a free user
    // capturing money from photographs does not meet a wall in the first
    // months, and small enough to be a rounding error.
    //
    // ASSUMPTION about what it costs: S3-compatible storage runs about
    // $0.015/GB/month, which is $0.003 for a full 200 MB against a $3.00
    // model ceiling. That price is from general knowledge and was NOT
    // verified from a provider's page in this environment — if it is wrong
    // by 3x it is still a rounding error, which is why it is stated and
    // then left alone.
    storageBytes: 200 * 1024 * 1024,
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
    // 5 GB. Voice notes in both directions live here as well as photographs:
    // at ~1.2 MB for a five-minute note, that is thousands of them. Same
    // price assumption as above: ~$0.075/month against a $9 price.
    storageBytes: 5 * 1024 * 1024 * 1024,
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
