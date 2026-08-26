// PRD §18's success metric, computed from real rows.
//
// The metric was named in the specs and measured nothing. These tests build
// cohorts by hand and check the arithmetic, because a retention number that
// is subtly wrong is worse than none: it gets quoted.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../client.ts';
import { HAS_DB, ready, freshUser, done } from '../test-support.ts';
import * as events from './events.ts';

/** A user who was here on these local days. */
async function userSeenOn(days: string[]) {
  const user = await freshUser();
  for (const day of days) {
    await events.record({ name: 'session_started', userId: user.userId, dayKey: day });
  }
  return user;
}

// These queries are global by design — a cohort is every user who arrived
// that day — so the tests own a date namespace rather than a set of rows, and
// clear it first.  Without this they pass on a fresh database and drift on a
// reused one, which is the worst kind of test.
const TEST_YEARS = "day_key LIKE '2031-%'";

describe('PRD §18 retention', { skip: HAS_DB ? false : 'DATABASE_URL not set' }, () => {
  before(async () => {
    await ready();
    await db().query(`DELETE FROM events WHERE ${TEST_YEARS}`);
  });
  after(async () => {
    await db().query(`DELETE FROM events WHERE ${TEST_YEARS}`);
    await done();
  });

  // Each test uses its own cohort day so they cannot interfere.
  test('D1 counts the users who came back the next day', async () => {
    const day = '2031-01-01';
    await userSeenOn([day, '2031-01-02']);       // returned
    await userSeenOn([day, '2031-01-02']);       // returned
    await userSeenOn([day]);                     // did not
    const result = await events.returnRate(day, 1);
    assert.deepEqual(result, { cohort: 3, returned: 2 });
  });

  test('"on day N" means exactly that, not "within N days"', async () => {
    // The cumulative reading flatters everything and mostly measures how long
    // the window is.  This is the stricter one, and the one that moves when
    // the product changes.
    const day = '2031-02-01';
    await userSeenOn([day, '2031-02-02', '2031-02-03']); // back on d1 and d2, NOT d7
    const d1 = await events.returnRate(day, 1);
    const d7 = await events.returnRate(day, 7);
    assert.deepEqual(d1, { cohort: 1, returned: 1 });
    assert.deepEqual(d7, { cohort: 1, returned: 0 });
  });

  test('the cohort is the FIRST day seen, so a returning user is not re-cohorted', async () => {
    const first = '2031-03-01';
    await userSeenOn([first, '2031-03-08']);
    // The same user appears on the 8th, but belongs to the 1st's cohort.
    assert.equal((await events.returnRate('2031-03-08', 1)).cohort, 0);
    assert.deepEqual(await events.returnRate(first, 7), { cohort: 1, returned: 1 });
  });

  test('the curve reports the denominator alongside the numbers', async () => {
    const day = '2031-04-01';
    await userSeenOn([day, '2031-04-02', '2031-04-08', '2031-05-01']);
    await userSeenOn([day]);
    const curve = await events.retentionCurve(day);
    // Counts, not percentages: a rate over a cohort of two is a rounding
    // error with a percent sign.
    assert.deepEqual(curve, { cohortDay: day, cohort: 2, d1: 1, d7: 1, d30: 1 });
  });

  test('day_key is the USER\'s local day, so a cohort is not smeared across a date line', async () => {
    // Two users in different zones, both "Tuesday" locally, are one cohort.
    const day = '2031-06-03';
    await userSeenOn([day]);
    await userSeenOn([day]);
    assert.equal((await events.returnRate(day, 1)).cohort, 2);
  });

  test('the onboarding funnel counts people, not events', async () => {
    const day = '2031-07-01';
    const user = await freshUser();
    await events.record({ name: 'account_created', userId: user.userId, dayKey: day });
    // Prompted three times; still one person.
    for (let i = 0; i < 3; i++) {
      await events.record({ name: 'notification_permission_granted', userId: user.userId, dayKey: day });
    }
    await events.record({ name: 'onboarding_completed', userId: user.userId, dayKey: day });
    const funnel = await events.onboardingFunnel(day);
    assert.equal(funnel['account_created'], 1);
    assert.equal(funnel['notification_permission_granted'], 1, 'one person, prompted three times');
    assert.equal(funnel['onboarding_completed'], 1);
  });

  test('cohorts too small to mean anything are not returned by default', async () => {
    // A cohort of one is an anecdote; reporting it as a rate invites reading
    // it as a trend.
    const day = '2031-08-01';
    await userSeenOn([day]);
    assert.deepEqual(await events.cohorts({ since: day }), []);
    const listed = await events.cohorts({ since: day, minimumSize: 1 });
    assert.ok(listed.some((c) => c.cohortDay === day && c.size === 1));
  });

  test('an event before signup is kept, and belongs to nobody', async () => {
    // user_id is nullable on purpose: a landing-page event is real, and
    // attributing it to the first user who happens to sign up would be worse
    // than losing it.
    await events.record({ name: 'installed_pwa', dayKey: '2031-09-01' });
    const { rows } = await db().query<{ n: number }>(
      `SELECT count(*)::int AS n FROM events WHERE user_id IS NULL AND day_key = $1`, ['2031-09-01'],
    );
    assert.equal(rows[0]!.n, 1);
    assert.equal((await events.returnRate('2031-09-01', 1)).cohort, 0, 'and it forms no cohort');
  });
});
