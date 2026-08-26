// A running app, with a model that does not cost anything.
//
//   node tools/preview.ts [port]
//
// Test tooling, not a product mode: it starts the real application with a
// scripted provider and a deterministic embedder so the screens can be
// driven and photographed. Nothing here is reachable from the shipped
// binary — main.ts does not import it, and the fake provider is constructed
// in this file rather than selected by an environment variable.
import { loadConfig } from '../apps/server/src/config.ts';
import { createApplication } from '../apps/server/src/app.ts';
import { deterministicEmbedder, EMBEDDING_DIMENSIONS, type AnalysisModel } from '@lian/analysis';
import { DEFAULT_MODEL, type Provider } from '@lian/llm';
import { generateVapidKeys } from '@lian/push';
import { migrate } from '@lian/db';

const port = Number(process.argv[2] ?? '8790');

/** Her replies, keyed by what was said to her — so a preview session behaves
 *  the same however many sessions came before it. */
const KEYED: [RegExp, string][] = [
  [/adam|call me/i, 'Noted. <call_me>{"name":"Adam"}</call_me> Which language suits you better?'],
  [/english|arabic|language/i, 'English it is. <language>{"style":"en"}</language> Tell me what your week looks like.'],
  [/run|morning/i, "I'll remember that you run every morning before work. That's the sort of thing I keep."],
  [/gym|paid|400/i, 'Okay, logged AED 400 for the gym today. <spend>{"amount":400,"currency":"AED","category":"gym"}</spend>'],
  [/task|remind|call the bank/i, "I'll remind you. <todo>{\"title\":\"call the bank\"}</todo>"],
  [/name you|noor|your name/i, 'Then I am Lian. <my_name>{"name":"Lian","chosenByThem":true}</my_name>'],
];

const REPLIES = [
  "Good to meet you. I'm a secretary, more or less — I keep track of what you tell me. What should I call you?",
  'Noted. <call_me>{"name":"Adam"}</call_me> Which language suits you better?',
  'English it is. <language>{"style":"en"}</language> Tell me what your week looks like.',
  "I'll remember that you run every morning before work. That's the sort of thing I keep.",
  'I can reach you when the app is closed — to follow up, or remind you. Up to you.',
  'Then I am Lian. <my_name>{"name":"Lian","chosenByThem":true}</my_name>',
  'Okay, logged AED 400 for the gym today. <spend>{"amount":400,"currency":"AED","category":"gym"}</spend>',
  "You said the commute was the part you dreaded. Start there: if the new place fixes that, the rest is negotiable.",
];

/**
 * The person's own words, out of the final turn.
 *
 * The turn the model receives is `<<context>>…<</context>>` then the message
 * then the repeated directive (LESSONS §1). A fake that matches against the
 * whole thing matches the environment block — which is how "Hello" came back
 * as the reply to a question about language.
 */
function saidByUser(content: string): string {
  const afterContext = content.includes('<</context>>') ? content.split('<</context>>')[1]! : content;
  return afterContext.split('\n\n').filter((part) => part.trim() !== '')[0] ?? '';
}

let turn = 0;
const provider: Provider = {
  id: 'preview',
  capabilities: () => ({ streaming: true, toolCalling: false, vision: false, contextTokens: 200_000, maxOutputTokens: 4_000 }),
  async stream(request, onDelta) {
    if (request.model === DEFAULT_MODEL) {
      const said = saidByUser(request.messages.at(-1)?.content ?? '');
      const reply = KEYED.find(([pattern]) => pattern.test(said))?.[1] ?? REPLIES[turn++ % REPLIES.length]!;
      // In chunks, so streaming looks like streaming.
      for (let index = 0; index < reply.length; index += 12) {
        onDelta(reply.slice(index, index + 12));
        await new Promise((resolve) => setTimeout(resolve, 12));
      }
    } else {
      onDelta('[]');
    }
    return { usage: { inputTokens: 900, outputTokens: 60, cacheWriteTokens: 0, cacheReadTokens: 0 }, stopReason: 'end_turn' };
  },
};

const analysisModel: AnalysisModel = {
  async complete(input) {
    const remembers = input.user.includes('run every morning');
    return {
      text: remembers ? JSON.stringify([{ type: 'fact', statement: 'They run every morning before work.', salience: 0.7 }]) : '[]',
      usage: { inputTokens: 100, outputTokens: 10 },
    };
  },
};

const keys = generateVapidKeys();
const { config } = loadConfig({
  ...process.env,
  NODE_ENV: 'development',
  PORT: String(port),
  LIAN_TICK_SECRET: 'preview',
  LIAN_VAPID_PUBLIC_KEY: keys.publicKey,
  LIAN_VAPID_PRIVATE_KEY: keys.privateKey,
});

await migrate(() => {});
const { server } = createApplication(config, {
  provider, analysisModel,
  embedder: deterministicEmbedder(EMBEDDING_DIMENSIONS),
  log: (line) => console.log(line),
});
server.listen(port, () => console.log(`preview on http://127.0.0.1:${port}`));
