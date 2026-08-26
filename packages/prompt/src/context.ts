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

/** UI-UX §38: the window holds ~60 messages.  This is what she is shown
 *  instead of everything older — rewritten forward, never regenerated. */
export type EarlierContext = { summary: string; messageCount: number };

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

/**
 * What they attached to the message they just sent.
 *
 * This is NOT the file. It is what a separate, non-voice path read off the
 * file and validated into fields — @lian/analysis for a receipt, the
 * transcriber for a voice note. The picture and the audio never reach the
 * channel she speaks in, because both are text somebody else controls
 * (LESSONS §1a). She is told one thing was attached and one line of what it
 * said, and that is the entire surface.
 */
export type AttachmentContext = {
  kind: 'photo' | 'receipt' | 'voice';
  /** Composed by us out of validated fields. null when nothing could be
   *  read, which she is told rather than left to infer. */
  reading: string | null;
};

/** PRD §8, when it is still running.  null once onboarding is done. */
export type OnboardingContext = { step: string; instruction: string; userName: string | null };

export type AssemblyContext = {
  surface: Surface;
  assistant: AssistantContext;
  user: UserContext;
  relationship: RelationshipContext;
  environment: EnvironmentContext;
  conversation: ConversationContext | null;
  earlier: EarlierContext | null;
  canon: CanonContext[];
  memories: MemoryContext[];
  profile: ProfileContext[];
  capabilities: CapabilityContribution[];
  onboarding: OnboardingContext | null;
  attachment: AttachmentContext | null;
};
