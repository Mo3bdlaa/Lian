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

export type CompletionRequest = {
  readonly model: string;
  readonly system: string;
  readonly messages: readonly { role: 'user' | 'assistant'; content: string }[];
  readonly maxOutputTokens: number;
  /** Chat is conversational, not analytical: low effort keeps her quick. */
  readonly effort: 'low' | 'medium' | 'high';
  readonly signal?: AbortSignal;
};

export type Usage = { inputTokens: number; outputTokens: number };

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
