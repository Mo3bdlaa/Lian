import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { budgetFor, fitHistory, estimateTokens } from './budget.ts';
import { costMicros, modelEntry, MODELS } from './catalogue.ts';

describe('the token budgeter', () => {
  test('reserves output room out of the context window', () => {
    const budget = budgetFor({ contextTokens: 200_000, maxOutputTokens: 64_000, reserveForOutput: 2_000 });
    assert.equal(budget.inputBudget, 198_000);
    assert.equal(budget.maxOutputTokens, 2_000);
  });

  test('never reserves more output than the model can produce', () => {
    const budget = budgetFor({ contextTokens: 200_000, maxOutputTokens: 1_000, reserveForOutput: 8_000 });
    assert.equal(budget.maxOutputTokens, 1_000);
  });

  test('history is trimmed from the oldest end, and the drop is reported', () => {
    const messages = Array.from({ length: 10 }, (_, i) => ({ id: i }));
    const budget = { inputBudget: 100, maxOutputTokens: 10 };
    const { kept, dropped } = fitHistory(messages, 40, budget, () => 10);
    assert.equal(kept.length, 6);
    assert.equal(dropped, 4);
    assert.deepEqual(kept.map((m) => m.id), [4, 5, 6, 7, 8, 9], 'a conversation reads backwards from now');
  });

  test('a system prompt that fills the budget leaves no history, and says so', () => {
    const { kept, dropped } = fitHistory([{ id: 1 }], 200, { inputBudget: 100, maxOutputTokens: 10 }, () => 10);
    assert.deepEqual(kept, []);
    assert.equal(dropped, 1);
  });

  test('the estimator is monotonic and non-zero for non-empty text', () => {
    assert.ok(estimateTokens('a') >= 1);
    assert.ok(estimateTokens('a'.repeat(400)) > estimateTokens('a'.repeat(40)));
  });
});

describe('the model catalogue', () => {
  test('every model carries capabilities and a dated price', () => {
    for (const [id, entry] of Object.entries(MODELS)) {
      assert.equal(entry.id, id);
      assert.ok(entry.capabilities.streaming, `${id} must stream — the turn is a stream`);
      assert.ok(entry.capabilities.contextTokens > 0);
      assert.match(entry.pricing.pricedOn, /^\d{4}-\d{2}-\d{2}$/, `${id} has no price date`);
    }
  });

  test('an unknown model is an error, not a guess', () => {
    assert.throws(() => modelEntry('some-model-we-never-added'), /unknown model/);
  });

  test('cost is charged in whole micros, rounded up', () => {
    // 3k in, 200 out on Opus 5: 3000*5 + 200*25 = 20,000 micros = $0.020
    assert.equal(costMicros('claude-opus-5', { inputTokens: 3_000, outputTokens: 200 }), 20_000);
    assert.equal(costMicros('claude-opus-5', { inputTokens: 1, outputTokens: 0 }), 5);
  });
});
