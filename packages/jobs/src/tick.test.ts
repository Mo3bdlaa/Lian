import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runTick, type DueOutreach, type TickPorts } from './tick.ts';
import { signTick, verifyTick } from './signature.ts';

const NOW = new Date('2026-05-18T23:30:00Z'); // 03:30 in Asia/Dubai — inside quiet hours

function outreach(overrides: Partial<DueOutreach> = {}): DueOutreach {
  return {
    id: 'o-1', userId: 'u-1', assistantId: 'a-1', conversationId: 'c-1',
    kind: 'follow_up', source: 'assistant_initiated', timeZone: 'Asia/Dubai', ...overrides,
  };
}

function fakePorts(overrides: Partial<TickPorts> = {}, due: DueOutreach[] = [outreach()]) {
  const delivered: string[] = [];
  const rescheduled: string[] = [];
  const cancelled: { id: string; reason: string }[] = [];
  const ports: TickPorts = {
    async dueOutreach() { return due; },
    async quietHours() { return { enabled: false, startHour: 22, endHour: 8, days: [], allowSecurity: true }; },
    async unansweredStreak() { return 0; },
    async daysSinceLastReachOut() { return 10; },
    async deliver(item) { delivered.push(item.id); return 'sent'; },
    async reschedule(id) { rescheduled.push(id); },
    async cancel(id, reason) { cancelled.push({ id, reason }); },
    ...overrides,
  };
  return { ports, delivered, rescheduled, cancelled };
}

describe('the proactive tick', () => {
  test('delivers what is due', async () => {
    const fake = fakePorts();
    const report = await runTick(NOW, fake.ports);
    assert.equal(report.sent, 1);
    assert.deepEqual(fake.delivered, ['o-1']);
  });

  test('§4 backoff silences HER messages when nobody answers', async () => {
    const fake = fakePorts({ async unansweredStreak() { return 5; } });
    const report = await runTick(NOW, fake.ports);
    assert.equal(report.sent, 0);
    assert.equal(report.silenced.length, 1);
  });

  test('§4 a reminder the USER asked for is never silenced by backoff', async () => {
    // The Noura failure, at the delivery layer: three unanswered self-set
    // reminders must not stop the fourth from arriving.
    const fake = fakePorts(
      { async unansweredStreak() { return 99; } },
      [outreach({ kind: 'reminder', source: 'user_requested' })],
    );
    const report = await runTick(NOW, fake.ports);
    assert.equal(report.sent, 1, 'they asked for this; silence about it is not a signal');
    assert.equal(fake.cancelled.length, 0);
  });

  test('§31 quiet hours defer rather than drop', async () => {
    const fake = fakePorts({
      async quietHours() { return { enabled: true, startHour: 22, endHour: 8, days: [], allowSecurity: true }; },
    });
    const report = await runTick(NOW, fake.ports);
    assert.equal(report.sent, 0);
    assert.deepEqual(fake.rescheduled, ['o-1'], 'a reminder they asked for still has to arrive');
    assert.equal(fake.cancelled.length, 0);
  });

  test('§31 a security alert reaches through quiet hours when allowed', async () => {
    const fake = fakePorts(
      { async quietHours() { return { enabled: true, startHour: 22, endHour: 8, days: [], allowSecurity: true }; } },
      [outreach({ kind: 'security', source: 'assistant_initiated' })],
    );
    assert.equal((await runTick(NOW, fake.ports)).sent, 1);
  });

  test('a turn that declines to send is reported, not counted as sent', async () => {
    const fake = fakePorts({ async deliver() { return 'skipped'; } });
    const report = await runTick(NOW, fake.ports);
    assert.equal(report.sent, 0);
    assert.equal(report.deferred.length, 1);
  });
});

describe('the tick endpoint signature', () => {
  const secret = 'shhh';
  const body = '{"batch":100}';
  const ts = Math.floor(NOW.getTime() / 1000);

  test('a correct signature verifies', () => {
    const signature = signTick(secret, ts, body);
    assert.deepEqual(verifyTick({ secret, timestamp: ts, body, signature, now: NOW }), { ok: true });
  });

  test('a tampered body, a wrong secret, or a stale timestamp does not', () => {
    const signature = signTick(secret, ts, body);
    assert.equal(verifyTick({ secret, timestamp: ts, body: '{"batch":1000}', signature, now: NOW }).ok, false);
    assert.equal(verifyTick({ secret: 'other', timestamp: ts, body, signature, now: NOW }).ok, false);
    const later = new Date(NOW.getTime() + 10 * 60_000);
    assert.equal(verifyTick({ secret, timestamp: ts, body, signature, now: later }).ok, false);
  });
});
