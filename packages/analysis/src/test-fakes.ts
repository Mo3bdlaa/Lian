import type { AnalysisModel } from './extract.ts';

/** A model that returns whatever it was scripted to, and records the calls. */
export function scriptedModel(...responses: string[]): AnalysisModel & { calls: { system: string; user: string }[] } {
  const calls: { system: string; user: string }[] = [];
  let index = 0;
  return {
    calls,
    async complete(input) {
      calls.push({ system: input.system, user: input.user });
      const text = responses[Math.min(index, responses.length - 1)] ?? '[]';
      index += 1;
      return { text, usage: { inputTokens: 200, outputTokens: 40 } };
    },
  };
}
