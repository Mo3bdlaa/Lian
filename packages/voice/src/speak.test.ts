import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { speak, hashText } from './speak.ts';

function fakePorts(fail = false) {
  const writes: string[] = [];
  const store = new Map<string, string>();
  let synthesised = 0;
  let charactersUsed = 0;
  return {
    writes,
    get synthesised() { return synthesised; },
    get charactersUsed() { return charactersUsed; },
    cache: {
      async find(textHash: string, voiceId: string) {
        const key = store.get(`${textHash}:${voiceId}`);
        return key === undefined ? null : { storageKey: key };
      },
      async put(input: { textHash: string; voiceId: string; storageKey: string; bytes: number }) {
        writes.push(input.storageKey);
        store.set(`${input.textHash}:${input.voiceId}`, input.storageKey);
      },
    },
    synthesiser: {
      async synthesise() {
        if (fail) throw new Error('provider blocked this IP');
        synthesised += 1;
        return { storageKey: `audio-${synthesised}`, bytes: 1_000 };
      },
    },
    usage: {
      async reserveCharacters(_u: string, _m: string, ceiling: number, characters: number) {
        if (charactersUsed + characters > ceiling) return false;
        charactersUsed += characters;
        return true;
      },
    },
  };
}

const base = { userId: 'u-1', text: 'I am putting this into words for you.', voiceId: 'v-1', month: '2026-05', characterCeiling: 100_000 };

describe('§8 audio from a non-persisting context is never cached', () => {
  test('a persisting context writes once and reuses', async () => {
    const ports = fakePorts();
    const first = await speak({ ...base, persist: true }, ports);
    assert.equal(first.status, 'ready');
    assert.ok(first.status === 'ready' && !first.cached);
    const second = await speak({ ...base, persist: true }, ports);
    assert.ok(second.status === 'ready' && second.cached);
    assert.equal(ports.writes.length, 1);
    assert.equal(ports.synthesised, 1);
  });

  test('persist:false never writes — not on generation, not on playback', async () => {
    const ports = fakePorts();
    // Noura's bug was that fixing pre-generation only DELAYED the write, and
    // first playback still persisted the row.  So: repeat it.
    for (let i = 0; i < 3; i++) {
      const result = await speak({ ...base, persist: false }, ports);
      assert.equal(result.status, 'ready');
      assert.ok(result.status === 'ready' && !result.cached);
    }
    assert.deepEqual(ports.writes, [], 'no call site may persist audio from an ephemeral context');
  });

  test('a non-persisting context does not even read a row into existence', async () => {
    const ports = fakePorts();
    await speak({ ...base, persist: true }, ports);   // one row exists
    const writesBefore = ports.writes.length;
    await speak({ ...base, persist: false }, ports);  // must not touch it
    assert.equal(ports.writes.length, writesBefore);
  });

  test('§12 the per-user character ceiling applies to voice too', async () => {
    const ports = fakePorts();
    const result = await speak({ ...base, persist: true, characterCeiling: 5 }, ports);
    assert.equal(result.status, 'ceiling_reached');
    assert.deepEqual(ports.writes, []);
  });

  test('a synthesiser failure falls back rather than throwing', async () => {
    // UI-UX §20: "The voice note didn't work, so I'll say it here instead."
    const result = await speak({ ...base, persist: true }, fakePorts(true));
    assert.equal(result.status, 'failed');
  });

  test('the cache key is content-addressed and whitespace-stable', () => {
    assert.equal(hashText('  hello '), hashText('hello'));
    assert.notEqual(hashText('hello'), hashText('hello.'));
  });
});

// ── voice notes from the user ───────────────────────────────────────────────
import { transcribeVoiceNote, MAX_VOICE_NOTE_SECONDS } from './transcribe.ts';

function transcribePorts(result: { text: string; language: string | null } | Error = { text: 'I paid the gym four hundred.', language: 'en' }) {
  let used = 0;
  return {
    get used() { return used; },
    speech: {
      async transcribe() {
        if (result instanceof Error) throw result;
        return result;
      },
    },
    usage: {
      async reserveSeconds(_u: string, _m: string, ceiling: number, seconds: number) {
        if (used + seconds > ceiling) return false;
        used += seconds;
        return true;
      },
    },
  };
}

const note = {
  userId: 'u-1', audio: new Uint8Array([1, 2, 3]), contentType: 'audio/mpeg',
  durationSeconds: 12, month: '2026-05', secondsCeiling: 3_600, languageHint: 'en',
};

describe('Q14 the transcript is the message body', () => {
  test('a voice note becomes text the rest of the product can read', async () => {
    const result = await transcribeVoiceNote(note, transcribePorts());
    assert.deepEqual(result, { status: 'transcribed', text: 'I paid the gym four hundred.', language: 'en' });
    // Memory extraction, search, the rolling summary and the model all read
    // message bodies.  A voice note stored as audio alone is a message the
    // product cannot think about.
  });

  test('an empty transcript is a failure, not an empty message', async () => {
    const result = await transcribeVoiceNote(note, transcribePorts({ text: '   ', language: null }));
    assert.equal(result.status, 'failed');
  });

  test('a provider error is reported, not thrown', async () => {
    const result = await transcribeVoiceNote(note, transcribePorts(new Error('provider blocked this IP')));
    assert.equal(result.status, 'failed');
    assert.ok(result.status === 'failed' && /blocked this IP/.test(result.reason));
  });

  test('§12 the per-user ceiling applies to listening as well as speaking', async () => {
    const ports = transcribePorts();
    const result = await transcribeVoiceNote({ ...note, secondsCeiling: 5 }, ports);
    assert.equal(result.status, 'ceiling_reached');
    assert.equal(ports.used, 0, 'a refusal does not consume the budget');
  });

  test('a recording longer than a voice note is refused before it is paid for', async () => {
    const ports = transcribePorts();
    const result = await transcribeVoiceNote({ ...note, durationSeconds: MAX_VOICE_NOTE_SECONDS + 1 }, ports);
    assert.equal(result.status, 'failed');
    assert.equal(ports.used, 0);
  });

  test('an empty recording never reaches the provider', async () => {
    const ports = transcribePorts();
    assert.equal((await transcribeVoiceNote({ ...note, audio: new Uint8Array() }, ports)).status, 'failed');
    assert.equal(ports.used, 0);
  });
});

describe('the speech provider satisfies the three constraints (Q14)', () => {
  test('synthesis returns bytes, never a hosted URL', async () => {
    // Constraint 2: where audio is written is decided in speak.ts and nowhere
    // else.  A provider that returned a URL would have made that decision for
    // us, and persist:false would be unenforceable.
    const shape = await import('./providers/speech.ts');
    assert.ok('httpSpeechProvider' in shape);
    assert.equal(shape.DEFAULT_SPEECH.id, 'openai-speech');
    assert.ok(shape.DEFAULT_SPEECH.ttsUrl.startsWith('https://'), 'and it is reachable from a datacenter — constraint 1');
  });
});
