// The live contract.
//
// Everything else about voice is tested against fakes, which proves our
// logic and nothing about the provider. This file is the other half: it runs
// ONLY when a real key is present, and asserts the three constraints from Q14
// against the actual service.
//
//   npm test                          → skipped, and says so
//   LIAN_SPEECH_API_KEY=… npm test    → runs for real
//
// It is skipped in CI by default on purpose: a test that costs money and
// needs the network should be a deliberate act, not a surprise in someone's
// pull request. But it exists, it is real, and running it is one variable.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { httpSpeechProvider, DEFAULT_SPEECH } from './providers/speech.ts';

const KEY = process.env['LIAN_SPEECH_API_KEY'] ?? '';
const skip = KEY === '' ? 'LIAN_SPEECH_API_KEY not set — the live contract is skipped, not passing' : false;

describe('the speech provider, against the live API', { skip }, () => {
  const provider = httpSpeechProvider({ ...DEFAULT_SPEECH, apiKey: KEY });

  test('constraint 1: it answers from this host', async () => {
    // LESSONS §12: ElevenLabs' free tier blocks datacenter IPs, which is why
    // "works from where we run" is a constraint and not an assumption.
    const result = await provider.synthesise({ text: 'Good morning.', voiceId: 'alloy' });
    assert.ok(result.audio.byteLength > 1_000, 'a real clip comes back');
    assert.match(result.contentType, /^audio\//);
  });

  test('constraint 2: it returns bytes, so WE decide whether they are kept', async () => {
    const result = await provider.synthesise({ text: 'Nothing here is kept.', voiceId: 'alloy' });
    assert.ok(result.audio instanceof Uint8Array, 'a hosted URL would make persist:false unenforceable');
  });

  test('constraint 3: the unit we meter is the unit we can count first', async () => {
    // Characters out, seconds in — both known before the call, which is what
    // makes a per-user monthly ceiling possible at all.
    const text = 'This is a sentence of a known length.';
    const spoken = await provider.synthesise({ text, voiceId: 'alloy' });
    const heard = await provider.transcribe({ audio: spoken.audio, contentType: spoken.contentType, languageHint: 'en' });
    assert.ok(heard.text.length > 0);
    assert.match(heard.text.toLowerCase(), /sentence/, 'round trip: what she said is what comes back');
  });

  test('Arabic survives the round trip', async () => {
    // Arabic is first-class here, so this is a correctness test rather than a
    // nice-to-have.
    const spoken = await provider.synthesise({ text: 'صباح الخير. النهاردة هادي.', voiceId: 'alloy' });
    const heard = await provider.transcribe({ audio: spoken.audio, contentType: spoken.contentType, languageHint: 'ar' });
    assert.ok(/[؀-ۿ]/.test(heard.text), `expected Arabic back, got: ${heard.text}`);
  });
});
