// Block order.
//
// LESSONS §1: "Block order is deliberate and must be protected by tests, not
// by discipline."  And: "Recency wins.  Any instruction that overrides
// another must appear AFTER it, and the most important instruction is
// repeated last."
//
// Order is therefore DATA — one frozen array, asserted by an exact-match test
// so a reorder requires deliberately editing a test — and the recency rule is
// structural: a block declares a zone, and a zone cannot be jumped.  The
// scenario block declares OVERRIDE, so it can never render before the persona
// no matter how it is registered.  That is LESSONS §2's first half made
// impossible to get wrong rather than merely documented.
export const ZONES = ['foundation', 'override', 'trailing'] as const;
export type Zone = (typeof ZONES)[number];

export const BLOCK_IDS = [
  // ── foundation ──────────────────────────────────────────────────────────
  'identity',      // who she is — the authored persona voice
  'canon',         // what she has said about herself (LESSONS §5)
  'relationship',  // how well they know each other, as prose
  'profile',       // what the user says about themselves (UI-UX §12)
  'capabilities',  // what she can do — composed from the registry (§13)
  'conversation',  // which conversation this is, and whether it is kept
  'earlier',       // the rolling summary of what fell out of the window
  'memory',        // what she remembers about them
  'standing',      // where things stand right now — capability state
  'environment',   // time, mood, language, plan
  // ── override ────────────────────────────────────────────────────────────
  'scenario',      // replaces the role above (LESSONS §2)
  // ── trailing ────────────────────────────────────────────────────────────
  'contract',      // the control tags available this turn (LESSONS §3)
  'directive',     // the most important instruction, repeated last
] as const;

export type BlockId = (typeof BLOCK_IDS)[number];

export const BLOCK_ZONE: Readonly<Record<BlockId, Zone>> = {
  identity: 'foundation',
  canon: 'foundation',
  relationship: 'foundation',
  profile: 'foundation',
  memory: 'foundation',
  capabilities: 'foundation',
  standing: 'foundation',
  environment: 'foundation',
  conversation: 'foundation',
  earlier: 'foundation',
  scenario: 'override',
  contract: 'trailing',
  directive: 'trailing',
} as const;

export function zoneRank(zone: Zone): number {
  return ZONES.indexOf(zone);
}

// ── channels ───────────────────────────────────────────────────────────────
//
// WHY THERE ARE TWO.
//
// Prompt caching is a prefix match over the whole request, and providers
// render it in one order: system, then messages.  So ANY per-turn content in
// the system prompt invalidates the cache for the system prompt AND for every
// message after it.  With retrieved memory and the current time living in the
// system block, the conversation history could never be cached — which is
// most of the tokens in a long conversation.
//
// Measured before changing anything: the stable part of the system prompt was
// 587 tokens, 65% of the system block but ~20% of a turn once history is
// counted — and BELOW the ~1024-token minimum a cache breakpoint needs, so it
// would not have cached at all.
//
// The fix is to split by what changes rather than by what it says:
//
//   'system'  identity, canon, relationship, profile, capabilities, the
//             output contract, the directive.  Byte-stable for a whole
//             conversation, so it caches, and so the history after it can.
//   'turn'    memory, standing, environment, conversation, earlier, the
//             scenario.  Rendered into the final user turn, where changing
//             every turn costs nothing because it is the end of the prefix
//             anyway.
//
// LESSONS §1 survives this, and is why the split is safe: "the most important
// instruction is repeated last".  The directive is at the end of the system
// block AND repeated after the user's message, which is now genuinely the
// last thing the model reads.  The scenario override moves LATER relative to
// the persona, not earlier, so §2 gets stronger rather than weaker.
export type Channel = 'system' | 'turn';

export const BLOCK_CHANNEL: Readonly<Record<BlockId, Channel>> = {
  identity: 'system',
  canon: 'system',
  relationship: 'system',
  profile: 'system',
  capabilities: 'system',
  contract: 'system',
  directive: 'system',

  conversation: 'turn',
  earlier: 'turn',
  memory: 'turn',
  standing: 'turn',
  environment: 'turn',
  scenario: 'turn',
};

/** Blocks in BLOCK_IDS order, filtered to one channel. */
export function blocksIn(channel: Channel): BlockId[] {
  return BLOCK_IDS.filter((id) => BLOCK_CHANNEL[id] === channel);
}

// ── caching ────────────────────────────────────────────────────────────────
// Prompt caching is a PREFIX match: any byte change anywhere in the prefix
// invalidates everything after it.  So whether a block changes between turns
// of the same conversation is not a comment, it is data — and it decides
// where the cache breakpoint goes.
//
// The order above is arranged around two constraints at once.  LESSONS §1
// requires the directive last, which means the stable tail cannot be moved
// to the front; so the cacheable prefix is everything up to the first block
// that changes per turn.  `capabilities` (what she CAN do) and `standing`
// (what is due today) were one block until caching made the difference
// matter: splitting them moves several hundred tokens from the volatile side
// to the cached side, every turn, for the life of a conversation.
export type Volatility =
  /** Same bytes for the whole conversation, or near enough that a rare
   *  invalidation is cheaper than never caching. */
  | 'stable'
  /** Changes per turn.  Everything from here on is re-read every time. */
  | 'per-turn';

export const BLOCK_VOLATILITY: Readonly<Record<BlockId, Volatility>> = {
  identity: 'stable',
  // Canon changes only when she says something new about herself, which is
  // rare after the first days.  Paying an occasional cache write is worth
  // keeping the biggest block of text in the cached prefix.
  canon: 'stable',
  relationship: 'stable',
  profile: 'stable',
  capabilities: 'stable',
  standing: 'per-turn',
  memory: 'per-turn',
  environment: 'per-turn',
  conversation: 'stable',
  earlier: 'per-turn',
  scenario: 'stable',
  contract: 'stable',
  directive: 'stable',
};

/** How many leading blocks are cacheable: everything before the first
 *  per-turn one.  A stable block AFTER a volatile one is not cacheable —
 *  that is what "prefix" means, and forgetting it is how a cache silently
 *  never hits. */
export function cacheablePrefix(): BlockId[] {
  const prefix: BlockId[] = [];
  for (const id of BLOCK_IDS) {
    if (BLOCK_VOLATILITY[id] === 'per-turn') break;
    prefix.push(id);
  }
  return prefix;
}
