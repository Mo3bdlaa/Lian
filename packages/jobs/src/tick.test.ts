import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runTick, STALE_AFTER_HOURS, type DueOutreach, type TickPorts } from './tick.ts';
import { signTick, verifyTick } from './signature.ts';

const NOW = new Date('2026-05-18T23:30:00Z'); // 03:30 in Asia/Dubai — inside quiet hours

function outreach(overrides: Partial<DueOutreach> = {}): DueOutreach {
  return {
    id: 'o-1', userId: 'u-1', assistantId: 'a-1', conversationId: 'c-1',
    kind: 'follow_up', source: 'assistant_initiated', timeZone: 'Asia/Dubai',
    scheduledFor: NOW, ...overrides,
  };
}

function fakePorts(overrides: Partial<TickPorts> = {}, due: DueOutreach[] = [outreach()]) {
  const delivered: string[] = [];
  const rescheduled: string[] = [];
  const cancelled: { id: string; reason: string }[] = [];
  const claimed: string[] = [];
  const ports: TickPorts = {
    async dueOutreach() { return due; },
    async claim(id) { claimed.push(id); return true; },
    async quietHours() { return { enabled: false, startHour: 22, endHour: 8, days: [], allowSecurity: true }; },
    async unansweredStreak() { return 0; },
    async daysSinceLastReachOut() { return 10; },
    async deliver(item) { delivered.push(item.id); return 'sent'; },
    async reschedule(id) { rescheduled.push(id); },
    async cancel(id, reason) { cancelled.push({ id, reason }); },
    ...overrides,
  };
  return { ports, delivered, rescheduled, cancelled, claimed };
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

describe('the tick when the scheduler misbehaves', () => {
  test('a row another run already took is skipped, not delivered twice', async () => {
    // Two ticks overlapping. This one loses the claim; it must spend nothing.
    const fake = fakePorts({ async claim() { return false; } });
    const report = await runTick(NOW, fake.ports);

    assert.equal(report.sent, 0);
    assert.deepEqual(fake.delivered, [], 'both runs delivered — the person got the same message twice');
    assert.deepEqual(report.claimedElsewhere, ['o-1']);
  });

  test('the claim happens BEFORE delivery, not after it', async () => {
    // Ordering is the whole guarantee: a claim written after the push has
    // already happened prevents nothing. Recorded rather than reasoned about.
    const order: string[] = [];
    const fake = fakePorts({
      async claim(id) { order.push(`claim:${id}`); return true; },
      async deliver(item) { order.push(`deliver:${item.id}`); return 'sent'; },
    });
    await runTick(NOW, fake.ports);
    assert.deepEqual(order, ['claim:o-1', 'deliver:o-1']);
  });

  test('one delivery that throws does not take the rest of the batch with it', async () => {
    // The shape that mattered: the provider is down, the FIRST row hits it,
    // and ninety-nine other people hear nothing all day because of it.
    const due = [outreach({ id: 'o-1' }), outreach({ id: 'o-2' }), outreach({ id: 'o-3' })];
    const reached: string[] = [];
    const fake = fakePorts(
      {
        async deliver(item) {
          if (item.id === 'o-1') throw new Error('provider is down');
          reached.push(item.id);
          return 'sent';
        },
      },
      due,
    );

    const report = await runTick(NOW, fake.ports);

    assert.deepEqual(reached, ['o-2', 'o-3']);
    assert.equal(report.sent, 2);
    // And the failure is NAMED with its row, so a log answers "who did not
    // hear from her" rather than "something went wrong".
    assert.deepEqual(report.failed.map((f) => f.id), ['o-1']);
    assert.match(report.failed[0]!.reason, /provider is down/);
  });

  test('a failure anywhere in the row is contained, not just in delivery', async () => {
    // The database is what quietHours reads. A dropped connection there used
    // to be indistinguishable from a dropped connection anywhere else: the
    // whole batch, gone.
    const due = [outreach({ id: 'o-1' }), outreach({ id: 'o-2' })];
    let first = true;
    const fake = fakePorts(
      { async quietHours() { if (first) { first = false; throw new Error('connection terminated'); } return { enabled: false, startHour: 22, endHour: 8, days: [], allowSecurity: true }; } },
      due,
    );

    const report = await runTick(NOW, fake.ports);
    assert.deepEqual(fake.delivered, ['o-2']);
    assert.deepEqual(report.failed.map((f) => f.id), ['o-1']);
  });

  test('after a six-hour gap, HER stale message is dropped rather than delivered late', async () => {
    // "Shall we start the day" arriving at two in the afternoon is not a late
    // message, it is a wrong one — and it is what makes somebody switch
    // notifications off.
    const late = new Date(NOW.getTime() - (STALE_AFTER_HOURS + 2) * 3_600_000);
    const fake = fakePorts({}, [outreach({ scheduledFor: late })]);

    const report = await runTick(NOW, fake.ports);

    assert.equal(report.sent, 0);
    assert.deepEqual(fake.delivered, []);
    assert.deepEqual(report.silenced, [{ id: 'o-1', reason: 'stale' }]);
    assert.match(fake.cancelled[0]!.reason, /^stale by 6h$/);
    // Nothing was claimed: a row that is not going out costs no write.
    assert.deepEqual(fake.claimed, []);
  });

  test('after the same gap, a reminder the USER set still arrives — late beats never', async () => {
    // The §4 distinction again, at a different layer. They asked for this.
    const late = new Date(NOW.getTime() - (STALE_AFTER_HOURS + 2) * 3_600_000);
    const fake = fakePorts({}, [
      outreach({ kind: 'reminder', source: 'user_requested', scheduledFor: late }),
    ]);

    const report = await runTick(NOW, fake.ports);
    assert.equal(report.sent, 1, 'their own reminder was thrown away for being late');
    assert.deepEqual(report.silenced, []);
  });

  test('merely late is not stale — an hour behind still goes', async () => {
    const late = new Date(NOW.getTime() - 1 * 3_600_000);
    const fake = fakePorts({}, [outreach({ scheduledFor: late })]);
    assert.equal((await runTick(NOW, fake.ports)).sent, 1);
  });
});
