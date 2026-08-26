// Ports.
//
// The assembler loads its own context, so it needs a way to read.  It reads
// through these rather than importing @lian/db, for two reasons: the boundary
// gate keeps the dependency graph acyclic, and — more usefully — the whole
// assembly path stays testable from fakes, which is what makes the golden
// snapshots cheap enough to keep.
//
// A port that returns null for something required produces a
// MissingContextError.  It never produces a default.
import type {
  AssistantContext, CanonContext, CapabilityContribution, ConversationContext,
  EarlierContext, MemoryContext, OnboardingContext, ProfileContext, RelationshipContext, UserContext,
} from './context.ts';
import type { Surface } from './surfaces.ts';

export type PromptPorts = {
  loadAssistant(assistantId: string, userId: string): Promise<AssistantContext | null>;
  loadUser(userId: string): Promise<UserContext | null>;
  loadRelationship(assistantId: string): Promise<RelationshipContext | null>;
  loadMood(assistantId: string): Promise<'warm' | 'quiet' | 'neutral' | null>;
  loadConversation(assistantId: string, conversationId: string): Promise<ConversationContext | null>;
  /** null when the conversation still fits in the window. */
  loadEarlier(assistantId: string, conversationId: string): Promise<EarlierContext | null>;
  loadCanon(assistantId: string): Promise<CanonContext[]>;
  loadMemories(assistantId: string, query: string | null, limit: number): Promise<MemoryContext[]>;
  loadProfile(userId: string): Promise<ProfileContext[]>;
  /** The capability registry, contributing to the prompt (LESSONS §13). */
  contributeCapabilities(input: { userId: string; assistantId: string; surface: Surface; localDay: string }): Promise<CapabilityContribution[]>;
  messagesRemaining(userId: string, localDay: string): Promise<number>;
  /** null once the four things PRD §8 has to learn are known. */
  loadOnboarding(assistantId: string, userId: string): Promise<OnboardingContext | null>;
};
