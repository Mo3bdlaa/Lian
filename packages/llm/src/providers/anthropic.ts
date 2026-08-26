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
        // Prompt caching: one breakpoint, at the end of the stable prefix.
        // Caching is a PREFIX match, so a second breakpoint after per-turn
        // content would never hit — packages/prompt decides where the
        // boundary is and this only carries it across.
        const system = request.system.map((segment) => ({
          type: 'text' as const,
          text: segment.text,
          ...(segment.cache ? { cache_control: { type: 'ephemeral' as const } } : {}),
        }));

        const stream = client.messages.stream({
          model: request.model,
          max_tokens: request.maxOutputTokens,
          system,
          // Two breakpoints: the end of the system block, and the end of the
          // history.  Both are prefixes of the same request, in the order the
          // provider renders them (system, then messages).
          messages: request.messages.map((message, index) => {
            const isHistoryEnd = request.cacheHistory && index === request.messages.length - 2;
            const isLast = index === request.messages.length - 1;
            // Images ride with the last user message, as content blocks
            // before the text: the model reads the picture and then the
            // question about it.
            const images = isLast ? (request.attachments ?? []) : [];
            if (images.length > 0) {
              return {
                role: message.role,
                content: [
                  ...images.map((attachment) => ({
                    type: 'image' as const,
                    source: { type: 'base64' as const, media_type: attachment.contentType as 'image/jpeg', data: attachment.base64 },
                  })),
                  { type: 'text' as const, text: message.content },
                ],
              };
            }
            return {
              role: message.role,
              content: isHistoryEnd
                ? [{ type: 'text' as const, text: message.content, cache_control: { type: 'ephemeral' as const } }]
                : message.content,
            };
          }),
          // Adaptive thinking is on by default on this model family.  Her
          // replies are short and conversational, so effort is low unless a
          // surface asks for more: the work is recall and tone, not analysis.
          output_config: { effort: request.effort },
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        });

        stream.on('text', (delta: string) => onDelta(delta));
        const final = await stream.finalMessage();

        return {
          usage: {
            inputTokens: final.usage.input_tokens,
            outputTokens: final.usage.output_tokens,
            // Reported, never assumed.  A breakpoint under the provider's
            // minimum prefix silently does not cache, and a zero here is how
            // that becomes visible instead of being believed.
            cacheWriteTokens: final.usage.cache_creation_input_tokens ?? 0,
            cacheReadTokens: final.usage.cache_read_input_tokens ?? 0,
          },
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
