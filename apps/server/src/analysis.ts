// The analysis model, from the same provider port the turn uses.
//
// @lian/analysis declares a two-line interface — text in, text out — so it
// cannot construct a persona (LESSONS §1, as restated). This is the adapter
// that satisfies it, and it deliberately does not accept a system prompt from
// anywhere but @lian/analysis's own catalogue.
import type { AnalysisModel } from '@lian/analysis';
import type { Provider } from '@lian/llm';

/**
 * ASSUMPTION, stated because it is a cost decision rather than a measured
 * one: extraction, canon and summary rolling are structured, short-output
 * jobs, so they run on the cheapest catalogue model (Haiku 4.5, $1/$5 per
 * million in/out, priced 2026-06-24) rather than the chat model. Roughly
 * half the input price of Sonnet 5 and a fifth of Opus 5. If extraction
 * quality turns out to depend on the larger model, this is the one line
 * that changes.
 */
export const ANALYSIS_MODEL = 'claude-haiku-4-5';

/**
 * ASSUMPTION: the vision model is the chat-tier model rather than the
 * analysis-tier one, because reading a crumpled receipt photograph is the
 * hard task in this product and a misread total is money in the wrong place.
 * Priced in the catalogue at $2/$10 per million in/out for Sonnet 5 (read
 * 2026-06-24); one receipt is a small image plus ~200 output tokens, so the
 * cost is dominated by the image. Not verified against a live bill in this
 * environment.
 */
export const VISION_MODEL = 'claude-sonnet-5';

export function analysisModelFrom(provider: Provider, model: string = ANALYSIS_MODEL, visionModel: string = VISION_MODEL): AnalysisModel {
  const run = async (
    input: { system: string; user: string; maxOutputTokens: number },
    options: { model: string; attachments?: readonly { contentType: string; base64: string }[] },
  ) => {
    let text = '';
    const result = await provider.stream(
      {
        model: options.model,
        system: [{ text: input.system, cache: false }],
        messages: [{ role: 'user', content: input.user }],
        // One shot, no history: there is no prefix to match against.
        cacheHistory: false,
        maxOutputTokens: input.maxOutputTokens,
        // Analysis is the one place the higher setting would be defensible;
        // it is not taken, because the output is JSON against a schema and a
        // longer deliberation buys nothing.
        effort: 'low',
        ...(options.attachments === undefined ? {} : { attachments: options.attachments }),
      },
      (delta) => { text += delta; },
    );
    return { text, usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens } };
  };

  // Capability negotiation rather than assumption (Q17): the port is
  // OPTIONAL, so a deployment pointed at a model that cannot see reports
  // 'no_vision' and says so, instead of sending an image nothing will look at.
  const canSee = provider.capabilities(visionModel).vision;

  return {
    ...(canSee
      ? {
          async completeWithImage(input: { system: string; user: string; maxOutputTokens: number; image: { contentType: string; base64: string } }) {
            return run(input, { model: visionModel, attachments: [input.image] });
          },
        }
      : {}),
    async complete(input) {
      return run(input, { model });
    },
  };
}
