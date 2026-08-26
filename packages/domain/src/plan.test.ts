// The plan numbers have to agree with each other, and the agreement has to be
// checkable.  Last night they did not, and the mistake was a unit error — a
// monthly ceiling compared against a day of messages.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { limitsFor, monthlyMessageAllowance, messageBudget, PLAN_LIMITS } from './plan.ts';

describe('plan limits', () => {
  test('free names a message limit, so the ceiling must fund it for a month', () => {
    // The cost side lives in @lian/llm and is asserted in runtime/turn.test.ts,
    // where the model is known.  Here: the shape of the promise.
    assert.equal(limitsFor('free').messagesPerDay, 20);
    assert.equal(monthlyMessageAllowance('free'), 600);
    assert.ok(limitsFor('free').modelCostPerMonth > 0, 'a free plan with no ceiling is how these products die');
  });

  test('paid is unlimited in practice — the daily number is a runaway guard', () => {
    assert.ok(limitsFor('paid').messagesPerDay >= 10 * limitsFor('free').messagesPerDay);
    assert.ok(limitsFor('paid').modelCostPerMonth > limitsFor('free').modelCostPerMonth);
    assert.equal(limitsFor('paid').voice, true);
    assert.equal(limitsFor('free').voice, false, 'voice is paid-only (PRD §10)');
  });

  test('the approaching state is quiet and late, never a countdown', () => {
    assert.equal(messageBudget('free', 0).state, 'ok');
    assert.equal(messageBudget('free', 14).state, 'ok');
    assert.equal(messageBudget('free', 15).state, 'approaching');
    assert.equal(messageBudget('free', 20).state, 'reached');
    assert.equal(messageBudget('free', 25).remaining, 0, 'never negative');
  });

  test('memory capacity is per assistant and canon is not in it', () => {
    assert.equal(PLAN_LIMITS.free.activeMemoriesPerAssistant, 100);
    assert.ok(PLAN_LIMITS.paid.activeMemoriesPerAssistant > 1_000_000);
  });
});
