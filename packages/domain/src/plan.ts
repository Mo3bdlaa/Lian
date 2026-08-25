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
  voice: boolean;
};

/**
 * The paid plan is "unlimited in practice", which is a product promise and
 * not an infrastructure one.  These ceilings are set well above any plausible
 * daily use so a runaway loop or a scripted client cannot bill the company,
 * and a user who reaches one is a conversation, not an error message.
 */
export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: {
    messagesPerDay: 30,
    proactivePerDay: 1,
    activeMemoriesPerAssistant: 100,
    modelCostPerMonth: 150_000, // $0.15
    ttsCharsPerMonth: 0,
    voice: false,
  },
  paid: {
    messagesPerDay: 2_000,
    proactivePerDay: 12,
    activeMemoriesPerAssistant: Number.MAX_SAFE_INTEGER,
    modelCostPerMonth: 3_000_000, // $3.00 against a $9 price
    ttsCharsPerMonth: 200_000,
    voice: true,
  },
};

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
