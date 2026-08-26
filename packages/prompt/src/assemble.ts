// ==========================================================================
// THE ONE PATH THAT BUILDS THE SYSTEM PROMPT.
//
// LESSONS §1.  Noura had more than one: scheduled jobs and proactive messages
// went through a different route that fell back to defaults, so she answered
// with a different personality depending on which code path woke her.  The
// bug was invisible in chat and only showed up in background messages.
//
// Four properties keep that from recurring, and none of them is discipline:
//
//   1. CALLERS PASS IDENTIFIERS, NOT CONTEXT.  This function loads what it
//      needs through ports.  There is no persona context for a caller to
//      construct inline, because the parameter does not exist.
//   2. MISSING CONTEXT THROWS.  No `?? defaults` anywhere below.
//   3. SURFACE IS DATA.  Chat, proactive, briefing, dreams and diary select
//      blocks and a trailing directive — never a different assembler.
//   4. ORDER IS DATA, AND ZONES ENFORCE RECENCY.  A block cannot render
//      outside its zone, so the scenario override cannot precede the persona.
//
// If you are adding a caller: pass ids. If you are adding a surface: add it
// to SURFACES and give it a golden snapshot — the test will tell you.
// ==========================================================================
import { MissingContextError } from './errors.ts';
import { BLOCKS } from './blocks.ts';
import { BLOCK_IDS, BLOCK_ZONE, BLOCK_CHANNEL, BLOCK_VOLATILITY, TURN_SECTION, zoneRank, type BlockId } from './zones.ts';
import { SURFACE_CONFIG, type Surface } from './surfaces.ts';
import type { PromptPorts } from './ports.ts';
import type { AssemblyContext } from './context.ts';

export type AssemblyRequest = {
  readonly userId: string;
  readonly assistantId: string;
  readonly surface: Surface;
  /** Required for conversational surfaces; null for the ones with no thread. */
  readonly conversationId: string | null;
  /** The assembler never reads a clock: a prompt must be reproducible. */
  readonly now: Date;
  /** What to retrieve memory against.  null retrieves by salience. */
  readonly retrievalQuery: string | null;
  readonly memoryLimit: number;
};

export type PromptSegment = { readonly text: string; readonly cache: boolean };

export type AssembledPrompt = {
  /** The whole prompt as one string.  Not what is sent — the golden
   *  snapshots read it, and so does anyone debugging which path produced a
   *  message. */
  readonly text: string;
  /**
   * The system block: byte-stable for a whole conversation, and therefore
   * cacheable — along with every message after it.
   */
  readonly system: readonly PromptSegment[];
  /** Per-turn context, rendered into the final user turn ahead of what they
   *  actually said. */
  readonly turnPrefix: string;
  /** LESSONS §1: "the most important instruction is repeated last."  This is
   *  the repetition, and with the split it is now genuinely last. */
  readonly turnSuffix: string;
  /** Reported so a caller can see whether the prefix clears the provider's
   *  minimum, rather than assuming it did. */
  readonly systemChars: number;
  readonly surface: Surface;
  /** Which blocks rendered, in order, with sizes — for debugging one path
   *  rather than guessing which of two produced a message. */
  readonly blocks: readonly { id: BlockId; chars: number }[];
  /** The tags the parser should accept this turn (LESSONS §3). */
  readonly tags: readonly { name: string; usage: string }[];
  readonly writesMemory: boolean;
};

const SEPARATOR = '\n\n';

export async function assemblePrompt(request: AssemblyRequest, ports: PromptPorts): Promise<AssembledPrompt> {
  const context = await loadContext(request, ports);
  return renderPrompt(context);
}

/** Loading is separate only so tests can render a context directly; it is not
 *  a second entry point — nothing outside this package can construct an
 *  AssemblyContext and reach renderPrompt, because index.ts exports neither. */
export async function loadContext(request: AssemblyRequest, ports: PromptPorts): Promise<AssemblyContext> {
  const { surface } = request;
  const require0 = <T>(value: T | null | undefined, what: string): T => {
    if (value === null || value === undefined) throw new MissingContextError(what, surface);
    return value;
  };

  const [assistant, user, relationship, mood] = await Promise.all([
    ports.loadAssistant(request.assistantId, request.userId),
    ports.loadUser(request.userId),
    ports.loadRelationship(request.assistantId),
    ports.loadMood(request.assistantId),
  ]);

  const resolvedAssistant = require0(assistant, 'assistant');
  const resolvedUser = require0(user, 'user');
  const resolvedRelationship = require0(relationship, 'relationship');
  const resolvedMood = require0(mood, 'mood');

  const conversation =
    request.conversationId === null
      ? null
      : require0(await ports.loadConversation(request.assistantId, request.conversationId), 'conversation');

  const localDay = new Intl.DateTimeFormat('en-CA', {
    timeZone: resolvedUser.timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(request.now);
  const localHour = Number(
    new Intl.DateTimeFormat('en-US', { timeZone: resolvedUser.timeZone, hour: 'numeric', hourCycle: 'h23' }).format(request.now),
  );

  const [canon, memories, profile, capabilities, messagesRemaining, onboarding, earlier] = await Promise.all([
    ports.loadCanon(request.assistantId),
    ports.loadMemories(request.assistantId, request.retrievalQuery, request.memoryLimit),
    ports.loadProfile(request.userId),
    ports.contributeCapabilities({ userId: request.userId, assistantId: request.assistantId, surface, localDay }),
    ports.messagesRemaining(request.userId, localDay),
    ports.loadOnboarding(request.assistantId, request.userId),
    request.conversationId === null ? Promise.resolve(null) : ports.loadEarlier(request.assistantId, request.conversationId),
  ]);

  return {
    surface,
    assistant: resolvedAssistant,
    user: resolvedUser,
    relationship: resolvedRelationship,
    conversation,
    earlier,
    canon,
    memories,
    profile,
    capabilities,
    onboarding,
    environment: {
      now: request.now.toISOString(),
      localHour,
      localDay,
      mood: resolvedMood,
      messagesRemaining,
    },
  };
}

export function renderPrompt(context: AssemblyContext): AssembledPrompt {
  const config = SURFACE_CONFIG[context.surface];
  const omitted = new Set<string>(config.omits);
  const rendered: { id: BlockId; chars: number }[] = [];
  const parts: string[] = [];
  const systemParts: string[] = [];
  // The turn's two sections, kept apart so the structure is fixed rather
  // than incidental (see TURN_SECTION).
  const recalled: string[] = [];
  const environment: string[] = [];

  // BLOCK_IDS is already in zone order; asserting it here means a future edit
  // to that array cannot silently break the recency rule, even if someone
  // moves an entry without reading zones.ts.
  assertZoneOrder();

  for (const id of BLOCK_IDS) {
    if (omitted.has(id)) continue;
    const text = BLOCKS[id](context);
    if (text === null || text.trim() === '') continue;
    const trimmed = text.trim();
    parts.push(trimmed);
    rendered.push({ id, chars: trimmed.length });
    // The directive is the one block that appears twice: once ending the
    // system block, once ending the turn.  That is §1's repetition, not a
    // duplicate.
    if (id === 'directive') { systemParts.push(trimmed); continue; }
    if (BLOCK_CHANNEL[id] === 'system') { systemParts.push(trimmed); continue; }
    (TURN_SECTION[id] === 'environment' ? environment : recalled).push(trimmed);
  }

  const systemText = systemParts.join(SEPARATOR);
  const directive = BLOCKS.directive(context) ?? '';

  // Named sections, always in this order, always with these labels — the
  // contract in the system block describes exactly this shape, and "the last
  // thing in the message is what they just said" is only useful to her if it
  // is always true.
  const turnSections: string[] = [];
  if (recalled.length > 0) turnSections.push(`RECALLED\n${recalled.join(SEPARATOR)}`);
  if (environment.length > 0) turnSections.push(`ENVIRONMENT\n${environment.join(SEPARATOR)}`);

  return {
    text: parts.join(SEPARATOR),
    system: systemText === '' ? [] : [{ text: systemText, cache: true }],
    turnPrefix: turnSections.join(SEPARATOR),
    turnSuffix: directive.trim(),
    systemChars: systemText.length,
    surface: context.surface,
    blocks: rendered,
    tags: context.capabilities.flatMap((c) => c.tags),
    writesMemory: config.writesMemory,
  };
}

function assertZoneOrder(): void {
  let highest = 0;
  for (const id of BLOCK_IDS) {
    const rank = zoneRank(BLOCK_ZONE[id]);
    if (rank < highest) {
      throw new Error(
        `block '${id}' is in zone '${BLOCK_ZONE[id]}' but appears after a later zone. ` +
          'Recency wins: an instruction that overrides another must appear after it (LESSONS §1).',
      );
    }
    highest = rank;
    // Every block declares its volatility, because the cache breakpoint is
    // computed from it and a missing entry would silently shrink the prefix.
    if (BLOCK_VOLATILITY[id] === undefined) throw new Error(`block '${id}' does not declare volatility`);
  }
}
