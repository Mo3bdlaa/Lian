// The schedule, running the real thing.
//
// Six kinds of time-driven work — reminders, recurring habits, the morning
// briefing, proactive follow-ups, dreams and diary — plus the sweeps. The
// thing worth testing is not that each function exists but that the schedule
// runs each ONE at the right local hour for the person it belongs to.
//
// A schedule written in UTC works in London and reads as the middle of the
// afternoon in Dubai, which is the market this product starts in. So every
// assertion below is about somebody's local clock.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { db, closeDb, migrate, accounts, conversations, life, outreach, reflections, limits } from '@lian/db';
import { atLocalHour, localHour } from '@lian/domain';
import { deterministicEmbedder, EMBEDDING_DIMENSIONS, type AnalysisModel } from '@lian/analysis';
import { DEFAULT_MODEL, type Provider } from '@lian/llm';
import type { JobDeps } from '@lian/jobs';
import { scheduleRunner, SCHEDULE_HOURS } from './schedule.ts';

const HAS_DB = (process.env['DATABASE_URL'] ?? '') !== '';
const ZONE = 'Asia/Dubai'; // UTC+4, no daylight saving — the arithmetic is exact.
const DAY = '2026-05-18';  // a Monday

function provider(): Provider {
  return {
    id: 'fake',
    capabilities: () => ({ streaming: true, toolCalling: false, vision: false, contextTokens: 200_000, maxOutputTokens: 4_000 }),
    async stream(request, onDelta) {
      onDelta(request.model === DEFAULT_MODEL ? 'Morning — here is what is on today.' : '[]');
      return { usage: { inputTokens: 800, outputTokens: 40, cacheWriteTokens: 0, cacheReadTokens: 0 }, stopReason: 'end_turn' };
    },
  };
}

const analysis: AnalysisModel = {
  async complete() { return { text: '[]', usage: { inputTokens: 10, outputTokens: 2 } }; },
};

function deps(now: () => Date): JobDeps {
  return {
    provider: provider(), analysisModel: analysis,
    embedder: deterministicEmbedder(EMBEDDING_DIMENSIONS),
    push: null, // nothing to deliver to; the message is still written
    now,
  };
}

const created: string[] = [];

/** Somebody in Dubai who used the app today. */
async function person(options: { habit?: boolean; dueTask?: boolean } = {}) {
  const user = await accounts.createUser({ email: `sched-${Date.now()}-${Math.random()}@example.test`, passwordHash: 'x', timeZone: ZONE });
  created.push(user.id);
  const assistant = await accounts.createAssistant({ userId: user.id }, { name: 'Lian', gender: 'female' });
  const scope = { userId: user.id, assistantId: assistant.id };
  const conversation = await conversations.createConversation(scope, { kind: 'main' });
  // A message today, which is what makes them "active" to the batch jobs.
  const message = await conversations.appendMessage(scope, {
    conversationId: conversation.id, role: 'user', body: 'hello', tags: [], surface: 'chat', clientId: null,
  });
  await db().query(`UPDATE messages SET created_at = $2 WHERE assistant_id = $3 AND id = $1`, [message.id, new Date(`${DAY}T10:00:00Z`), assistant.id]);

  if (options.dueTask === true) {
    await life.createTask({ userId: user.id }, { kind: 'task', title: 'renew the licence', dueOn: DAY });
  }
  if (options.habit === true) {
    // Weekly, Mondays and Wednesdays. DAY is a Monday.
    await life.createTask({ userId: user.id }, { kind: 'habit', title: 'the gym', recurrence: { freq: 'weekly', days: [1, 3] } });
  }
  return { ...scope, conversationId: conversation.id };
}

describe('the schedule', { skip: HAS_DB ? false : 'DATABASE_URL not set' }, () => {
  before(async () => { await migrate(() => {}); });
  after(async () => {
    for (const userId of created) await accounts.deleteAccount({ userId });
    await closeDb();
  });

  test('proposals run at five in the morning WHERE THEY ARE', async () => {
    const scope = await person({ dueTask: true, habit: true });
    const now = atLocalHour(DAY, SCHEDULE_HOURS.propose, ZONE);
    assert.equal(localHour(now, ZONE), SCHEDULE_HOURS.propose);
    // 01:00 UTC — the hour a UTC-anchored schedule would call the middle of
    // the night and skip.
    assert.equal(now.toISOString(), `${DAY}T01:00:00.000Z`);

    const report = await scheduleRunner(deps(() => now))(now);
    assert.ok(report.proposed.assistants >= 1);

    const pending = await outreach.due(scope, new Date(`${DAY}T23:59:00Z`));
    const kinds = pending.map((row) => row.kind).sort();
    // The task they asked to be reminded of, the habit due today, and the
    // briefing — the briefing being the one she initiated.
    assert.ok(kinds.includes('reminder'), `expected a reminder, got ${kinds.join(', ')}`);
    assert.ok(kinds.includes('briefing'), `expected a briefing, got ${kinds.join(', ')}`);

    const reminder = pending.find((row) => row.kind === 'reminder')!;
    assert.equal(localHour(reminder.scheduledFor, ZONE), 9);
    const briefing = pending.find((row) => row.kind === 'briefing')!;
    assert.equal(localHour(briefing.scheduledFor, ZONE), 7);
  });

  test('nothing is proposed at an hour that is not the proposing hour', async () => {
    const scope = await person({ dueTask: true });
    const noon = atLocalHour(DAY, 12, ZONE);
    const report = await scheduleRunner(deps(() => noon))(noon);
    assert.equal(report.proposed.assistants, 0);
    assert.equal((await outreach.due(scope, new Date(`${DAY}T23:59:00Z`))).length, 0);
  });

  test('a due message is delivered by the tick, in her voice, on the scheduled surface', async () => {
    const scope = await person();
    await outreach.schedule(scope, {
      kind: 'reminder', source: 'user_requested',
      scheduledFor: new Date(`${DAY}T09:00:00Z`), dedupeKey: `t:${scope.assistantId}`,
    });
    const now = new Date(`${DAY}T09:05:00Z`);
    const report = await scheduleRunner(deps(() => now))(now);

    assert.ok(report.outreach.sent >= 1);
    const { rows } = await db().query<{ body: string; surface: string }>(
      `SELECT body, surface FROM messages WHERE assistant_id = $1 AND role = 'assistant'`, [scope.assistantId],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.surface, 'scheduled');
    assert.match(rows[0]!.body, /Morning/);
  });

  test('the diary is written at the end of their day, not the end of UTC', async () => {
    const scope = await person();
    const night = atLocalHour(DAY, SCHEDULE_HOURS.diary, ZONE);
    assert.equal(night.toISOString(), `${DAY}T19:00:00.000Z`);

    const report = await scheduleRunner(deps(() => night))(night);
    assert.ok((report.diary?.written ?? 0) >= 1, 'no diary was written');
    assert.equal(report.dreams, null, 'a dream is a different hour');

    const written = await reflections.recent(scope, 'diary', 5);
    assert.equal(written.length, 1);
    assert.equal(written[0]!.aboutDay, DAY, 'the diary is about the day that just ended');
  });

  test('a dream at two in the morning is about YESTERDAY', async () => {
    const scope = await person();
    const nextDay = '2026-05-19';
    const night = atLocalHour(nextDay, SCHEDULE_HOURS.dream, ZONE);

    const report = await scheduleRunner(deps(() => night))(night);
    assert.ok((report.dreams?.written ?? 0) >= 1, 'no dream was written');

    const written = await reflections.recent(scope, 'dream', 5);
    assert.equal(written.length, 1);
    // Filed under the day it is about, which is the day with messages in it.
    assert.equal(written[0]!.aboutDay, DAY);
  });

  test('one reflection a day, however often the ticker runs', async () => {
    const scope = await person();
    const night = atLocalHour(DAY, SCHEDULE_HOURS.diary, ZONE);
    const run = scheduleRunner(deps(() => night));
    await run(night);
    await run(new Date(night.getTime() + 5 * 60_000));
    await run(new Date(night.getTime() + 10 * 60_000));
    assert.equal((await reflections.recent(scope, 'diary', 5)).length, 1);
  });

  test('the sweeps run on every tick', async () => {
    const key = `sweep:${Date.now()}`;
    const now = atLocalHour(DAY, 12, ZONE);
    await limits.takeToken(key, 60, 10, new Date(now.getTime() - 48 * 60 * 60 * 1000));
    // A request that died mid-flight: claimed, never completed.
    await limits.claimIdempotency({ key: `stale-${key}`, userId: null, route: 'test', requestHash: 'h' });
    await db().query(`UPDATE idempotency_keys SET created_at = $2 WHERE key = $1`, [`stale-${key}`, new Date(now.getTime() - 60 * 60 * 1000)]);

    const report = await scheduleRunner(deps(() => now))(now);
    assert.ok(report.swept.rateLimits >= 1);
    assert.ok(report.swept.staleIdempotency >= 1);

    const remaining = await db().query<{ n: number }>(
      `SELECT count(*)::int AS n FROM idempotency_keys WHERE key = $1`, [`stale-${key}`],
    );
    assert.equal(remaining.rows[0]!.n, 0, 'a crashed request would lock the client out of retrying');
  });
});
