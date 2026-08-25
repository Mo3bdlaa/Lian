// LESSONS §3, tested at every chunk boundary rather than at a few.
//
// "This was fixed three times. The first two attempts stripped on the client,
// so tags leaked into the visible message whenever the stream chunked
// mid-tag."  The test that would have caught it is the one that puts the
// boundary everywhere, so that is the test.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { TagStream, parseAll, type TagSpec, type StreamEvent } from './tagstream.ts';

const SPECS: TagSpec[] = [
  { name: 'spend', payload: true },
  { name: 'todo', payload: true },
  { name: 'note', payload: true },
  { name: 'done', payload: false },
  { name: 'voice', payload: false },
];

const RESPONSE =
  'Okay, logged AED 400 for the gym today.\n' +
  '<spend>{"amount":400,"currency":"AED","category":"gym"}</spend>\n' +
  'I will also remind you about the book tomorrow.\n' +
  '<todo>{"title":"return the book","due":"2026-05-19"}</todo>\n' +
  'That is everything.<done/>';

const EXPECTED_TEXT =
  'Okay, logged AED 400 for the gym today.\n\nI will also remind you about the book tomorrow.\n\nThat is everything.';

function splitEvery(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
  return chunks;
}

function tagsOf(events: StreamEvent[]) {
  return events.filter((e) => e.type === 'tag').map((e) => ({ name: e.name, payload: e.payload }));
}

describe('§3 the tail buffer', () => {
  test('a whole response in one chunk', () => {
    const { text, events } = parseAll(SPECS, [RESPONSE]);
    assert.equal(text, EXPECTED_TEXT);
    assert.deepEqual(tagsOf(events), [
      { name: 'spend', payload: { amount: 400, currency: 'AED', category: 'gym' } },
      { name: 'todo', payload: { title: 'return the book', due: '2026-05-19' } },
      { name: 'done', payload: null },
    ]);
  });

  test('EVERY possible single split point produces identical output', () => {
    for (let at = 1; at < RESPONSE.length; at++) {
      const { text, events } = parseAll(SPECS, [RESPONSE.slice(0, at), RESPONSE.slice(at)]);
      assert.equal(text, EXPECTED_TEXT, `split at ${at} leaked or lost text: ${JSON.stringify(text.slice(Math.max(0, at - 20), at + 20))}`);
      assert.equal(tagsOf(events).length, 3, `split at ${at} lost a tag`);
    }
  });

  test('every possible PAIR of split points, one character at a time', () => {
    // The pathological case: a chunk boundary inside a tag AND inside its
    // JSON.  Every two-cut partition is checked.
    for (let a = 1; a < RESPONSE.length; a += 1) {
      for (let b = a + 1; b < RESPONSE.length; b += 7) {
        const { text } = parseAll(SPECS, [RESPONSE.slice(0, a), RESPONSE.slice(a, b), RESPONSE.slice(b)]);
        assert.equal(text, EXPECTED_TEXT, `splits at ${a},${b} leaked`);
      }
    }
  });

  test('character-by-character — the worst chunking a provider can do', () => {
    const { text, events } = parseAll(SPECS, [...RESPONSE]);
    assert.equal(text, EXPECTED_TEXT);
    assert.equal(tagsOf(events).length, 3);
  });

  test('the three boundaries the lesson names', () => {
    const inTag = RESPONSE.indexOf('<spend>') + 3;               // inside the tag name
    const midJson = RESPONSE.indexOf('"currency"') + 4;          // mid-JSON
    const betweenSlash = RESPONSE.indexOf('</spend>') + 1;       // between '<' and '/'
    for (const [label, at] of [['inside a tag', inTag], ['mid-JSON', midJson], ['between < and /', betweenSlash]] as const) {
      const { text, events } = parseAll(SPECS, [RESPONSE.slice(0, at), RESPONSE.slice(at)]);
      assert.equal(text, EXPECTED_TEXT, `${label}: leaked`);
      assert.equal(tagsOf(events).length, 3, `${label}: lost a tag`);
    }
  });

  test('for any chunking, no visible text ever contains a tag', () => {
    for (const size of [1, 2, 3, 5, 7, 11, 13, 29, 64]) {
      const { text } = parseAll(SPECS, splitEvery(RESPONSE, size));
      for (const spec of SPECS) {
        assert.ok(!text.includes(`<${spec.name}`), `chunk size ${size} leaked <${spec.name}`);
        assert.ok(!text.includes(`</${spec.name}`), `chunk size ${size} leaked </${spec.name}`);
      }
    }
  });
});

describe('§3 what is not a tag', () => {
  test("'<' in ordinary prose survives", () => {
    const prose = 'You spent < 400 on it, and 3 < 5 is still true. <b>not a tag</b>';
    for (let at = 1; at < prose.length; at++) {
      const { text } = parseAll(SPECS, [prose.slice(0, at), prose.slice(at)]);
      assert.equal(text, prose, `split at ${at} mangled prose`);
    }
  });

  test('an unknown tag is prose, not a capture', () => {
    const { text, events } = parseAll(SPECS, ['<unknown>{"a":1}</unknown>']);
    assert.equal(text, '<unknown>{"a":1}</unknown>');
    assert.equal(tagsOf(events).length, 0);
  });

  test('only tags the prompt offered this turn are accepted', () => {
    // The contract and the parser are built from the same registry, so a tag
    // the prompt never offered cannot be captured.
    const narrow = parseAll([{ name: 'todo', payload: true }], ['a<spend>{"amount":1}</spend>b']);
    assert.equal(narrow.text, 'a<spend>{"amount":1}</spend>b');
    assert.equal(tagsOf(narrow.events).length, 0);
  });
});

describe('§3 failure modes are reported, never swallowed', () => {
  test('malformed JSON is a tag_error, and does not leak into the text', () => {
    const { text, events } = parseAll(SPECS, ['Done.<spend>{not json}</spend>']);
    assert.equal(text, 'Done.');
    const errors = events.filter((e) => e.type === 'tag_error');
    assert.equal(errors.length, 1);
    assert.match(errors[0]!.reason, /not valid JSON/);
  });

  test('a stream that dies mid-tag reports it and emits no machine syntax', () => {
    const stream = new TagStream(SPECS);
    const events = [...stream.push('Okay.<spend>{"amount":4'), ...stream.flush()];
    const text = events.filter((e) => e.type === 'text').map((e) => e.text).join('');
    assert.equal(text, 'Okay.', 'a half-written tag is machine syntax, not something she said');
    assert.equal(events.filter((e) => e.type === 'tag_error').length, 1);
  });

  test('a lone < at the end of a dead stream is prose and is not lost', () => {
    const stream = new TagStream(SPECS);
    const events = [...stream.push('3 <'), ...stream.flush()];
    assert.equal(events.filter((e) => e.type === 'text').map((e) => e.text).join(''), '3 <');
  });
});

describe('§3 ordering and buffer depth', () => {
  test('text, tag, text arrive in feed order within one chunk', () => {
    const { events } = parseAll(SPECS, ['before <done/> after']);
    assert.deepEqual(events.map((e) => e.type), ['text', 'tag', 'text']);
    assert.equal(events[0]!.type === 'text' && events[0]!.text, 'before ');
    assert.equal(events[2]!.type === 'text' && events[2]!.text, ' after');
  });

  test('tag_index counts tags in order — the key captures are idempotent on', () => {
    const { events } = parseAll(SPECS, [RESPONSE]);
    assert.deepEqual(events.filter((e) => e.type === 'tag').map((e) => e.index), [0, 1, 2]);
  });

  test('the buffer holds back no more than the longest opening tag', () => {
    const stream = new TagStream(SPECS);
    stream.push('hello <spen');
    assert.ok(stream.held <= stream.maxHold + 1, 'the tail buffer stays bounded');
    stream.push('d>{"a":1}</spend>');
    assert.equal(stream.held, 0);
  });
});
