// Memory and canon extraction.
//
// Both run on the non-voice path (see prompts.ts).  Both return candidates —
// neither writes anything.  Persisting is the caller's job, because that is
// where the plan's capacity rules and the pending queue live, and because an
// extractor that could write would be a second thing deciding what she keeps.
import { MEMORY_TYPES, MEMORY_EXTRACTION_SYSTEM, CANON_EXTRACTION_SYSTEM, CONVERSATION_TITLE_SYSTEM } from './prompts.ts';
import { parseArray, extractJson } from './json.ts';

export type MemoryType = (typeof MEMORY_TYPES)[number];

export type MemoryCandidate = {
  readonly type: MemoryType;
  readonly statement: string;
  readonly salience: number;
  /** Q11: DIRECT single-source provenance.  Exactly one message, always. */
  readonly sourceMessageId: string;
};

export type CanonCandidate = {
  readonly category: 'self' | 'preference' | 'history' | 'boundary';
  readonly statement: string;
  readonly sourceMessageId: string;
};

/** The model call.  Provider-agnostic: text in, text out, no tool-calling. */
export type AnalysisModel = {
  complete(input: { system: string; user: string; maxOutputTokens: number }): Promise<{ text: string; usage: { inputTokens: number; outputTokens: number } }>;
};

export type Exchange = {
  readonly userMessage: string | null;
  readonly assistantMessage: string;
  /** The message a memory would be attributed to — the user's, when there is
   *  one.  Nothing is extracted without a source (Q11). */
  readonly userMessageId: string | null;
  readonly assistantMessageId: string;
};

const MAX_STATEMENT_LENGTH = 240;
/** More than this from one exchange is a model that has started narrating. */
export const MAX_CANDIDATES_PER_EXCHANGE = 4;

function validMemory(sourceMessageId: string) {
  return (value: unknown): MemoryCandidate | string => {
    if (typeof value !== 'object' || value === null) return 'not an object';
    const record = value as Record<string, unknown>;
    const type = record['type'];
    if (typeof type !== 'string' || !(MEMORY_TYPES as readonly string[]).includes(type)) return `unknown type ${String(type)}`;
    const statement = record['statement'];
    if (typeof statement !== 'string' || statement.trim().length < 8) return 'statement too short';
    if (statement.length > MAX_STATEMENT_LENGTH) return 'statement too long';
    const rawSalience = record['salience'];
    const salience = typeof rawSalience === 'number' && Number.isFinite(rawSalience) ? Math.min(1, Math.max(0, rawSalience)) : 0.5;
    return { type: type as MemoryType, statement: statement.trim(), salience, sourceMessageId };
  };
}

function validCanon(sourceMessageId: string) {
  return (value: unknown): CanonCandidate | string => {
    if (typeof value !== 'object' || value === null) return 'not an object';
    const record = value as Record<string, unknown>;
    const category = record['category'];
    if (category !== 'self' && category !== 'preference' && category !== 'history' && category !== 'boundary') {
      return `unknown category ${String(category)}`;
    }
    const statement = record['statement'];
    if (typeof statement !== 'string' || statement.trim().length < 8) return 'statement too short';
    if (statement.length > MAX_STATEMENT_LENGTH) return 'statement too long';
    return { category, statement: statement.trim(), sourceMessageId };
  };
}

export type ExtractionResult<T> = {
  readonly candidates: T[];
  readonly rejected: { raw: unknown; reason: string }[];
  readonly usage: { inputTokens: number; outputTokens: number };
};

/**
 * Memory about the USER, from one exchange.
 *
 * Returns nothing when there is no user message: a memory with no source is a
 * memory whose provenance cannot be shown, and UI-UX §39 promises provenance.
 */
export async function extractMemories(exchange: Exchange, model: AnalysisModel): Promise<ExtractionResult<MemoryCandidate>> {
  if (exchange.userMessage === null || exchange.userMessageId === null) {
    return { candidates: [], rejected: [], usage: { inputTokens: 0, outputTokens: 0 } };
  }

  const { text, usage } = await model.complete({
    system: MEMORY_EXTRACTION_SYSTEM,
    user: `USER: ${exchange.userMessage}\nASSISTANT: ${exchange.assistantMessage}`,
    maxOutputTokens: 512,
  });

  const parsed = parseArray(text, validMemory(exchange.userMessageId));
  const seen = new Set<string>();
  const candidates: MemoryCandidate[] = [];
  for (const candidate of parsed.values) {
    // Cheap near-duplicate guard within one exchange; the caller does the
    // same against what is already stored.
    const key = `${candidate.type}:${candidate.statement.toLowerCase().replace(/[^a-z0-9؀-ۿ ]/g, '')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(candidate);
    if (candidates.length === MAX_CANDIDATES_PER_EXCHANGE) break;
  }
  return { candidates, rejected: parsed.rejected, usage };
}

/**
 * Canon — what SHE said about herself (LESSONS §5).  Always attributed to her
 * own message, never to the user's.
 */
export async function extractCanon(exchange: Exchange, model: AnalysisModel): Promise<ExtractionResult<CanonCandidate>> {
  const { text, usage } = await model.complete({
    system: CANON_EXTRACTION_SYSTEM,
    user: exchange.assistantMessage,
    maxOutputTokens: 400,
  });
  const parsed = parseArray(text, validCanon(exchange.assistantMessageId));
  return { candidates: parsed.values.slice(0, MAX_CANDIDATES_PER_EXCHANGE), rejected: parsed.rejected, usage };
}

export async function titleConversation(messages: readonly string[], model: AnalysisModel): Promise<string | null> {
  if (messages.length === 0) return null;
  const { text } = await model.complete({
    system: CONVERSATION_TITLE_SYSTEM,
    user: messages.slice(0, 6).join('\n'),
    maxOutputTokens: 32,
  });
  const title = text.trim().replace(/^["'`]|["'`]$/g, '').replace(/[.!?]$/, '').trim();
  return title.length === 0 || title.length > 60 ? null : title;
}

export { extractJson };
