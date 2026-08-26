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
  'memory',        // what she remembers about them
  'capabilities',  // composed from the registry (LESSONS §13)
  'environment',   // time, mood, language, plan
  'conversation',  // which conversation this is, and whether it is kept
  'earlier',       // the rolling summary of what fell out of the window
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
