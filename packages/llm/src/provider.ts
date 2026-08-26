// The provider port.
//
// Q17: provider-agnostic from day one.  Three things follow from that and are
// visible in this interface:
//
//   1. No tool-calling is assumed.  Capture happens through control tags in
//      the text stream (see tagstream.ts), so a local or self-hosted model is
//      a first-class citizen.  `capabilities.toolCalling` exists for features
//      that may use it later; nothing in the turn depends on it.
//   2. Streaming is the shape of a turn, not an option on it.
//   3. Usage comes back from the call so the per-user cost ceiling can be
//      charged against the real number rather than an estimate.
import type { ModelCapabilities } from './catalogue.ts';

export type SystemSegment = { readonly text: string; readonly cache: boolean };

export type CompletionRequest = {
  readonly model: string;
  /** Segments, so the adapter can put a cache breakpoint at the end of the
   *  stable prefix.  A provider without caching joins them. */
  readonly system: readonly SystemSegment[];
  readonly messages: readonly { role: 'user' | 'assistant'; content: string }[];
  /**
   * Put a cache breakpoint at the end of the conversation history — every
   * message except the last.  History is append-only within a conversation,
   * so that prefix is byte-identical turn to turn, and in a long conversation
   * it is most of the tokens.  Only worth anything if `system` is stable too,
   * because caching matches a prefix across the whole request.
   */
  readonly cacheHistory: boolean;
  readonly maxOutputTokens: number;
  /** Chat is conversational, not analytical: low effort keeps her quick. */
  readonly effort: 'low' | 'medium' | 'high';
  readonly signal?: AbortSignal;
};

export type Usage = {
  inputTokens: number;
  outputTokens: number;
  /** Tokens written to the cache this turn (billed above fresh input), and
   *  read from it (billed far below).  Reported rather than assumed: a
   *  breakpoint under the provider's minimum silently does nothing, and the
   *  only way to know is to look at what came back. */
  cacheWriteTokens: number;
  cacheReadTokens: number;
};

export type CompletionResult = { readonly usage: Usage; readonly stopReason: string | null };

export type Provider = {
  readonly id: string;
  capabilities(model: string): ModelCapabilities;
  /** Yields text deltas.  The caller feeds them to a TagStream — nothing that
   *  reaches a client has passed through anything else. */
  stream(request: CompletionRequest, onDelta: (delta: string) => void): Promise<CompletionResult>;
};

/** Thrown with the HTTP status so the key pool can cool the right key down. */
export class ProviderError extends Error {
  readonly statusCode: number;
  readonly retryable: boolean;
  constructor(message: string, statusCode: number, retryable: boolean) {
    super(message);
    this.name = 'ProviderError';
    this.statusCode = statusCode;
    this.retryable = retryable;
  }
}
