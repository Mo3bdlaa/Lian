import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { maybeRollSummary, ROLL_THRESHOLD, type SummaryPorts } from './summary.ts';
import { scriptedModel } from '@lian/analysis/test-fakes';

function messages(count: number, from = 0) {
  return Array.from({ length: count }, (_, i) => ({
    id: `m${from + i}`,
    role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
    body: `message ${from + i}`,
    createdAt: new Date(2026, 4, 18, 0, from + i),
  }));
}

function fakePorts(pending: ReturnType<typeof messages>) {
  const writes: { summary: string; coversThroughId: string; addedMessages: number }[] = [];
  let stored: { summary: string; coversThroughAt: Date } | null = null;
  const ports: SummaryPorts = {
    async get() { return stored; },
    async unsummarised() { return pending; },
    async put(_a, _c, input) {
      writes.push({ summary: input.summary, coversThroughId: input.coversThroughId, addedMessages: input.addedMessages });
      stored = { summary: input.summary, coversThroughAt: input.coversThroughAt };
    },
  };
  return { ports, writes };
}

const input = { assistantId: 'a-1', conversationId: 'c-1', windowSize: 60 };

describe('the rolling summary', () => {
  test('does nothing while the conversation fits the window', async () => {
    const fake = fakePorts([]);
    const model = scriptedModel('should not be called');
    assert.deepEqual(await maybeRollSummary(input, { model, ports: fake.ports }), { status: 'nothing_to_do' });
    assert.equal(model.calls.length, 0);
  });

  test('waits until enough has fallen out to be worth a model call', async () => {
    const fake = fakePorts(messages(ROLL_THRESHOLD - 1));
    const model = scriptedModel('a summary');
    const result = await maybeRollSummary(input, { model, ports: fake.ports });
    assert.equal(result.status, 'not_yet');
    assert.equal(model.calls.length, 0, 'a long conversation should cost the same as a short one per turn');
  });

  test('rolls forward and records how far it covered', async () => {
    const fake = fakePorts(messages(ROLL_THRESHOLD));
    const result = await maybeRollSummary(input, { model: scriptedModel('They postponed the trip.'), ports: fake.ports });
    assert.deepEqual(result, { status: 'rolled', covered: ROLL_THRESHOLD });
    assert.equal(fake.writes.length, 1);
    assert.equal(fake.writes[0]!.coversThroughId, `m${ROLL_THRESHOLD - 1}`, 'the cursor lands on the last message it read');
  });

  test('the previous summary is carried into the next roll, not discarded', async () => {
    const fake = fakePorts(messages(ROLL_THRESHOLD));
    const model = scriptedModel('First summary.', 'Second summary.');
    await maybeRollSummary(input, { model, ports: fake.ports });
    await maybeRollSummary(input, { model, ports: fake.ports });
    assert.match(model.calls[1]!.user, /SUMMARY SO FAR:\nFirst summary\./, 'rewritten forward, not regenerated');
  });

  test('a model that returns nothing does not advance the cursor', async () => {
    // Otherwise those messages are in neither the window nor the summary,
    // which is the one way this silently loses a conversation.
    const fake = fakePorts(messages(ROLL_THRESHOLD));
    const result = await maybeRollSummary(input, { model: scriptedModel('   '), ports: fake.ports });
    assert.deepEqual(result, { status: 'nothing_to_do' });
    assert.equal(fake.writes.length, 0);
  });

  test('an over-long summary is cut at a sentence, not mid-clause', async () => {
    const long = Array.from({ length: 260 }, (_, i) => (i % 12 === 11 ? 'end.' : `word${i}`)).join(' ');
    const fake = fakePorts(messages(ROLL_THRESHOLD));
    await maybeRollSummary(input, { model: scriptedModel(long), ports: fake.ports });
    const written = fake.writes[0]!.summary;
    assert.ok(written.split(/\s+/).length <= 200, 'the cap is a product statement about how much of the past she carries');
    assert.ok(written.endsWith('.') || written.endsWith('…'));
  });
});
