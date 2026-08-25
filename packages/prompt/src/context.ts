// The fully resolved assembly context.
//
// LESSONS §1: "No caller may construct persona context inline or fall back to
// defaults."  The strongest form of that rule is the one taken here — CALLERS
// PASS IDENTIFIERS, NOT CONTEXT.  assemblePrompt() takes ids and loads this
// itself through ports, so there is no inline persona context for a caller to
// build and no half-filled object for a background job to hand it.
//
// Every field is required.  With exactOptionalPropertyTypes on, a `null` is a
// deliberate value (there is no profile) and an absent field is a type error.
import type { Mood } from '@lian/domain';
import type { Surface } from './surfaces.ts';

export type AssistantContext = {
  id: string;
  name: string;
  gender: 'female' | 'male';
  languageStyle: string;
  personality: Record<string, string>;
};

export type UserContext = {
  id: string;
  timeZone: string;
  languageStyle: string;
  plan: 'free' | 'paid';
};

export type MemoryContext = { type: string; statement: string; when: string };
export type CanonContext = { statement: string };
export type ProfileContext = { section: string; body: string };

export type ConversationContext = {
  id: string;
  kind: 'main' | 'side' | 'incognito';
  /** 'ephemeral' means nothing here is kept — she is told so explicitly. */
  retention: 'persist' | 'ephemeral';
  /** PRD §27.  Rendered by the scenario block only, in the override zone. */
  scenarioText: string | null;
};

export type EnvironmentContext = {
  /** ISO instant.  The assembler never reads a clock itself. */
  now: string;
  localHour: number;
  localDay: string;
  mood: Mood;
  /** Remaining messages today, so she can mention the limit in her own voice
   *  rather than a system banner interrupting (PRD §11). */
  messagesRemaining: number;
};

export type RelationshipContext = {
  stage: 1 | 2 | 3 | 4 | 5;
  /** Prose only.  The day count is deliberately not here: LESSONS §6 says
   *  never a score, and a field is how a progress bar gets built. */
  stageProse: string;
};

/** What a capability contributes.  Built by the registry, never by a caller
 *  reaching into the persona (LESSONS §13). */
export type CapabilityContribution = {
  id: string;
  /** What she can do — rendered into the capabilities block. */
  ability: string;
  /** Current state she should know: "3 tasks due today". */
  state: string | null;
  /** The control tags this capability owns this turn. */
  tags: { name: string; usage: string }[];
};

export type AssemblyContext = {
  surface: Surface;
  assistant: AssistantContext;
  user: UserContext;
  relationship: RelationshipContext;
  environment: EnvironmentContext;
  conversation: ConversationContext | null;
  canon: CanonContext[];
  memories: MemoryContext[];
  profile: ProfileContext[];
  capabilities: CapabilityContribution[];
};
