import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { proposeOutreach, MAX_PENDING_ASSISTANT_INITIATED, type CandidatePorts } from './candidates.ts';
import { runReflections, type ReflectPorts } from './reflect.ts';
import type { OutreachCandidate } from '@lian/domain';

const NOW = new Date('2026-05-18T10:00:00Z');
const input = {
  userId: 'u-1', assistantId: 'a-1', localDay: '2026-05-18', timeZone: 'Asia/Dubai',
  plan: 'free' as const, language: 'en' as const, now: NOW,
};

function candidate(overrides: Partial<OutreachCandidate> = {}): OutreachCandidate {
  return {
    kind: 'follow_up', source: 'assistant_initiated', scheduledFor: NOW,
    dedupeKey: `k${Math.random()}`, reason: 'something', ...overrides,
  };
}

function fakePorts(candidates: OutreachCandidate[], overrides: Partial<CandidatePorts> = {}) {
  const scheduled: OutreachCandidate[] = [];
  const seen = new Set<string>();
  const ports: CandidatePorts = {
    async fromCapabilities() { return candidates; },
    async unsurfacedReflection() { return null; },
    async unansweredStreak() { return 0; },
    async daysSinceLastReachOut() { return 5; },
    async schedule({ candidate: c }) {
      if (seen.has(c.dedupeKey)) return false;
      seen.add(c.dedupeKey);
      scheduled.push(c);
      return true;
    },
    ...overrides,
  };
  return { ports, scheduled };
}

describe('composing what she reaches out about', () => {
  test('capability candidates are scheduled', async () => {
    const fake = fakePorts([candidate({ source: 'user_requested', kind: 'reminder' })]);
    const report = await proposeOutreach(input, fake.ports);
    assert.equal(report.scheduled, 1);
  });

  test('three good candidates do not become three messages', async () => {
    // This is the failure the file exists to prevent: every source being
    // individually reasonable and the user getting a handful of messages.
    const fake = fakePorts([candidate(), candidate(), candidate()]);
    const report = await proposeOutreach(input, fake.ports);
    assert.equal(report.scheduled, MAX_PENDING_ASSISTANT_INITIATED);
    assert.equal(report.heldBack, 2);
  });

  test("the user's own reminders are NOT subject to that limit", async () => {
    // They asked for each of these.  Suppressing the third would be the
    // product quietly deciding it knows better.
    const fake = fakePorts([
      candidate({ source: 'user_requested', kind: 'reminder' }),
      candidate({ source: 'user_requested', kind: 'reminder' }),
      candidate({ source: 'user_requested', kind: 'reminder' }),
    ]);
    const report = await proposeOutreach(input, fake.ports);
    assert.equal(report.scheduled, 3);
    assert.equal(report.heldBack, 0);
  });

  test('§4 while she is being ignored, she proposes nothing of her own', async () => {
    const fake = fakePorts([candidate()], { async unansweredStreak() { return 5; } });
    const report = await proposeOutreach(input, fake.ports);
    assert.equal(report.scheduled, 0);
    assert.equal(report.heldBack, 1);
  });

  test('§4 but a reminder they set still goes out while she is being ignored', async () => {
    const fake = fakePorts(
      [candidate({ source: 'user_requested', kind: 'reminder' })],
      { async unansweredStreak() { return 99; } },
    );
    assert.equal((await proposeOutreach(input, fake.ports)).scheduled, 1);
  });

  test('an unsurfaced reflection becomes a candidate, once', async () => {
    const fake = fakePorts([], { async unsurfacedReflection() { return { id: 'r-1', body: 'You mentioned the presentation twice this week.' }; } });
    const report = await proposeOutreach(input, fake.ports);
    assert.equal(report.scheduled, 1);
    assert.equal(fake.scheduled[0]!.dedupeKey, 'reflection:r-1', 'the key is the reflection, so it cannot be raised twice');
  });

  test('an already-scheduled candidate is a duplicate, not a second message', async () => {
    const twice = candidate({ source: 'user_requested', kind: 'reminder', dedupeKey: 'task:1:2026-05-18' });
    const fake = fakePorts([twice, { ...twice }]);
    const report = await proposeOutreach(input, fake.ports);
    assert.equal(report.scheduled, 1);
    assert.equal(report.duplicate, 1);
  });
});

describe('dreams and diary', () => {
  function reflectPorts(overrides: Partial<ReflectPorts> = {}) {
    const stored: string[] = [];
    const reflected: string[] = [];
    const ports: ReflectPorts = {
      async dueForReflection() { return [{ assistantId: 'a-1', userId: 'u-1', timeZone: 'Asia/Dubai', conversationId: 'c-1' }]; },
      async alreadyReflected() { return false; },
      async reflect(i) { reflected.push(i.assistantId); return 'It was a heavier week than they let on.'; },
      async store(_a, i) { stored.push(i.body); return true; },
      ...overrides,
    };
    return { ports, stored, reflected };
  }

  test('a diary entry is written once per day', async () => {
    const fake = reflectPorts();
    const report = await runReflections({ kind: 'diary', localDay: '2026-05-18' }, fake.ports);
    assert.deepEqual(report, { considered: 1, written: 1, skipped: 0 });
    assert.equal(fake.stored.length, 1);
  });

  test('a re-run of the job is not a second thought', async () => {
    const fake = reflectPorts({ async alreadyReflected() { return true; } });
    const report = await runReflections({ kind: 'diary', localDay: '2026-05-18' }, fake.ports);
    assert.equal(report.written, 0);
    assert.equal(report.skipped, 1);
    assert.equal(fake.reflected.length, 0, 'and it does not pay for a model call to find out');
  });

  test('an empty reflection is not stored', async () => {
    const fake = reflectPorts({ async reflect() { return '  '; } });
    assert.equal((await runReflections({ kind: 'dream', localDay: '2026-05-18' }, fake.ports)).written, 0);
    assert.equal(fake.stored.length, 0);
  });

  test('nothing written here is delivered — there is no sink to deliver to', () => {
    // The ReflectPorts surface has no send, no push and no message: the only
    // outputs are `store` and the return value.  "She thought about it while
    // you were away" has to be true before it can be said.
    const ports = reflectPorts().ports;
    assert.deepEqual(Object.keys(ports).sort(), ['alreadyReflected', 'dueForReflection', 'reflect', 'store']);
  });
});
