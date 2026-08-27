// The reporting queries, and the promise that they are measurements.
//
// A report that reads across every account is one edit away from being the
// admin data path this product does not have. What keeps it a measurement is
// that its queries return counts, totals and quantiles and NOTHING that
// identifies a person — so that is asserted here rather than reviewed.
//
// The retention definitions are tested too, because "D7 retention" means four
// different things and the one implemented is the strict reading. A test that
// only checked the number was non-zero would pass for the flattering version.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { db, closeDb } from '../client.ts';
import { ready, HAS_DB } from '../test-support.ts';
import * as accounts from './accounts.ts';
import * as events from './events.ts';
import * as economics from './economics.ts';

const created: string[] = [];

async function person(firstDay: string, laterDays: readonly string[]): Promise<string> {
  const user = await accounts.createUser({
    email: `rep-${Date.now()}-${Math.random()}@example.test`, passwordHash: 'x', timeZone: 'Asia/Dubai',
    consent: { isAdult: true, at: new Date(), version: 'test' },
  });
  created.push(user.id);
  await events.record({ name: 'account_created', userId: user.id, dayKey: firstDay });
  for (const day of laterDays) await events.record({ name: 'message_sent', userId: user.id, dayKey: day });
  return user.id;
}

describe('the reporting queries', { skip: HAS_DB ? false : 'DATABASE_URL not set' }, () => {
  before(async () => { await ready(); });
  after(async () => {
    for (const userId of created) await accounts.deleteAccount({ userId });
    await closeDb();
  });

  test('a cohort is FIRST day, and returning is EXACTLY day N', async () => {
    // Six accounts on one day, with different return patterns. The cohort
    // day is far in the past so no other test's data lands on it.
    const day = '2019-03-04';
    await person(day, ['2019-03-05']);                 // D1 only
    await person(day, ['2019-03-05', '2019-03-11']);   // D1 and D7
    await person(day, ['2019-03-11']);                 // D7 only
    await person(day, ['2019-04-03']);                 // D30 only
    await person(day, ['2019-03-06']);                 // D2 — counts for none
    await person(day, []);                             // never came back

    const curve = await events.retentionCurve(day);
    assert.equal(curve.cohort, 6);
    assert.equal(curve.d1, 2, 'D1 is the two who returned on day 1 exactly');
    assert.equal(curve.d7, 2);
    assert.equal(curve.d30, 1);

    // The strict reading is the point: a day-2 return is not a D1 return,
    // and it is not a D7 return either. The cumulative version would have
    // counted it in both and looked better.
    const d2 = await events.returnRate(day, 2);
    assert.equal(d2.returned, 1);
  });

  test('an account whose first day is later is NOT in an earlier cohort', async () => {
    const day = '2019-05-06';
    await person(day, []);
    // Someone who started the day after, and was active on the cohort's day
    // N, must not inflate it — they were not there at the start.
    await person('2019-05-07', ['2019-05-07', '2019-05-13']);
    const curve = await events.retentionCurve(day);
    assert.equal(curve.cohort, 1);
    assert.equal(curve.d7, 0);
  });

  test('a cohort below the meaningful size is not listed', async () => {
    // MEANINGFUL_COHORT exists so a rate over four people is never printed
    // as a percentage.
    const day = '2019-07-08';
    await person(day, []);
    const listed = await events.cohorts({ since: '2019-01-01' });
    assert.ok(!listed.some((cohort) => cohort.cohortDay === day), 'a cohort of one was offered as a rate');
    const all = await events.cohorts({ since: '2019-01-01', minimumSize: 1 });
    assert.ok(all.some((cohort) => cohort.cohortDay === day));
  });

  test('nothing a report reads identifies a person', async () => {
    // The line between a measurement and a back door. Every value in every
    // shape these return is a number — no id, no email, no text.
    const day = '2019-09-10';
    await person(day, ['2019-09-11']);

    const shapes: unknown[] = [
      await events.retentionCurve(day),
      await events.returnRate(day, 1),
      await events.onboardingFunnel(day),
      await economics.planCounts(),
      await economics.counterPressure({ kind: 'model_cost_micros', periodKey: '2019-09', ceiling: 1_000 }),
      { total: await economics.monthlySpendMicros('2019-09') },
      await economics.turnsPerSession(),
      ...(await events.cohorts({ since: '2019-01-01', minimumSize: 1 })),
    ];

    const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    for (const shape of shapes) {
      const json = JSON.stringify(shape);
      assert.ok(!UUID.test(json), `a report shape carries an id: ${json.slice(0, 120)}`);
      assert.ok(!json.includes('@'), `a report shape carries an email: ${json.slice(0, 120)}`);
    }
  });

  test('counter pressure counts the accounts that were told no', async () => {
    const userId = await person('2019-11-12', []);
    const period = '2019-11';
    // Two accounts on one meter: one over the ceiling, one just under it.
    await db().query(
      `INSERT INTO usage_counters (user_id, kind, period_key, value) VALUES ($1, 'model_cost_micros', $2, 1000)`,
      [userId, period],
    );
    const other = await person('2019-11-12', []);
    await db().query(
      `INSERT INTO usage_counters (user_id, kind, period_key, value) VALUES ($1, 'model_cost_micros', $2, 950)`,
      [other, period],
    );

    const pressure = await economics.counterPressure({ kind: 'model_cost_micros', periodKey: period, ceiling: 1_000 });
    assert.equal(pressure.accounts, 2);
    assert.equal(pressure.total, 1_950);
    assert.equal(pressure.max, 1_000);
    assert.equal(pressure.atCeiling, 1, 'one account has already been refused');
    assert.equal(pressure.nearCeiling, 1, 'and one is within a tenth of it — the number that moves first');
  });

  test('an empty period reports zero accounts rather than throwing', async () => {
    // The empty state has to be honest: "nothing measured" and "measured
    // zero" look the same in a report unless the query says which.
    const pressure = await economics.counterPressure({ kind: 'tts_chars', periodKey: '1999-01', ceiling: 100 });
    assert.equal(pressure.accounts, 0);
    assert.equal(pressure.total, 0);
    assert.equal(pressure.max, 0);
  });
});
