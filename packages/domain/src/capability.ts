// ==========================================================================
// The capability contract — LESSONS §13.
//
// "Every new ability — money, health, reminders, and whatever comes next — is
// built as a separate capability that COMPOSES INTO THE PROMPT, the same way
// the secretarial tools do.  Not as scattered functions wired into the chat
// handler.  The moment a capability reaches into the persona directly, adding
// the next one means rewriting the persona."
//
// So a capability is a value with six responsibilities, and FIVE CONSUMERS
// iterate the same registry:
//
//   1. prompt assembly   — promptFragment() and contextFragment() build the
//                          capabilities block; tags build the tag contract
//   2. the turn handler  — dispatches a parsed tag to handle()
//   3. the jobs runner   — collects proposeOutreach() candidates
//   4. data export       — exportFor()   (LESSONS §11)
//   5. deletion          — purgeFor()    (LESSONS §11)
//
// Adding "meals" is a directory and one registry line.  It touches no route
// handler, no persona file, no export code and no deletion code — and
// tools/gates/boundaries.ts refuses to let a capability import @lian/prompt,
// so it cannot reach the persona even if someone tries.
// ==========================================================================
import type { Plan } from './plan.ts';

export type CapabilityId = string;

/** What a capability is told.  Note what is NOT here: the persona, the mood
 *  phrase, canon, memory.  A capability contributes to her; it does not read
 *  her. */
export type CapabilityContext = {
  readonly userId: string;
  readonly assistantId: string;
  readonly surface: string;
  /** The user's local day — every "today" in the product means this one. */
  readonly localDay: string;
  readonly timeZone: string;
  readonly plan: Plan;
  readonly language: 'en' | 'ar';
};

/** A control tag this capability owns (LESSONS §3). */
export type CapabilityTag = {
  readonly name: string;
  readonly payload: boolean;
  /** Rendered into the prompt's contract block, so the offer and the parser
   *  are the same list. */
  readonly usage: string;
};

/** What handle() did, or why it could not.  Q7: a capture that fails must be
 *  reportable, because she has already said "logged AED 400" by then. */
export type CaptureOutcome =
  | { readonly ok: true; readonly entityTable: string; readonly entityId: string; readonly summary: CaptureSummary }
  | { readonly ok: false; readonly reason: string };

/** The inline confirmation row (UI-UX §4).  Conversation metadata, not a form. */
export type CaptureSummary = {
  readonly capability: CapabilityId;
  readonly icon: string;
  /** Already localised by the capability; the chat handler does not format. */
  readonly line: string;
  /** Where tapping the row goes to correct it. */
  readonly correctionRoute: string;
};

export type OutreachCandidate = {
  readonly kind: 'follow_up' | 'reminder' | 'habit' | 'unfinished' | 'briefing' | 'pattern';
  /** LESSONS §4: who wanted this.  A reminder the user asked for is
   *  'user_requested' and is invisible to backoff.  A capability declares
   *  this; the jobs runner never infers it. */
  readonly source: 'assistant_initiated' | 'user_requested';
  readonly scheduledFor: Date;
  readonly dedupeKey: string;
  readonly reason: string;
};

export type ExportSlice = { readonly name: string; readonly rows: readonly unknown[] };

export type Capability<Ports = unknown> = {
  readonly id: CapabilityId;
  readonly tags: readonly CapabilityTag[];

  /** What she can do.  One or two lines, in her prompt. */
  promptFragment(context: CapabilityContext): string | null;

  /** Where things stand right now: "2 things are due today." */
  contextFragment(context: CapabilityContext, ports: Ports): Promise<string | null>;

  /** Handle one parsed tag.  Writes to the capability's OWN tables. */
  handle(input: {
    context: CapabilityContext;
    tag: { name: string; payload: unknown; index: number };
    messageId: string;
  }, ports: Ports): Promise<CaptureOutcome>;

  /** What she might reach out about.  Optional. */
  proposeOutreach?(context: CapabilityContext, ports: Ports): Promise<OutreachCandidate[]>;

  /** LESSONS §11: export and deletion are user-facing features, and every
   *  capability answers for its own rows.  Neither is optional. */
  exportFor(userId: string, ports: Ports): Promise<ExportSlice[]>;
  purgeFor(userId: string, ports: Ports): Promise<void>;
};
