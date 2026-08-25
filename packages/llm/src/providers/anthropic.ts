// The default provider.
//
// Q14/Q17: one default ships, the choice is logged.  Anthropic because the
// product needs a model that follows a long, block-structured system prompt
// closely — the whole design rests on the prompt being obeyed — and because
// the streaming API gives usage back on the final message, which the per-user
// cost ceiling needs.  Swapping it means writing another file in this folder;
// nothing above provider.ts knows the name.
import Anthropic from '@anthropic-ai/sdk';
import { modelEntry } from '../catalogue.ts';
import { ProviderError, type CompletionRequest, type CompletionResult, type Provider } from '../provider.ts';
import type { ModelCapabilities } from '../catalogue.ts';

export function anthropicProvider(apiKey: string): Provider {
  const client = new Anthropic({ apiKey });

  return {
    id: 'anthropic',

    capabilities(model: string): ModelCapabilities {
      return modelEntry(model).capabilities;
    },

    async stream(request: CompletionRequest, onDelta: (delta: string) => void): Promise<CompletionResult> {
      try {
        const stream = client.messages.stream({
          model: request.model,
          max_tokens: request.maxOutputTokens,
          system: request.system,
          messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
          // Adaptive thinking is on by default on this model family.  Her
          // replies are short and conversational, so effort is low unless a
          // surface asks for more: the work is recall and tone, not analysis.
          output_config: { effort: request.effort },
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        });

        stream.on('text', (delta: string) => onDelta(delta));
        const final = await stream.finalMessage();

        return {
          usage: { inputTokens: final.usage.input_tokens, outputTokens: final.usage.output_tokens },
          stopReason: final.stop_reason,
        };
      } catch (error) {
        // The status is what the key pool cools down on (LESSONS §12).
        if (error instanceof Anthropic.APIError) {
          throw new ProviderError(error.message, error.status ?? 500, (error.status ?? 500) >= 500 || error.status === 429);
        }
        throw error;
      }
    },
  };
}
