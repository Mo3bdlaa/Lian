import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { relationshipView } from './relationship.ts';
import { STAGE_KEYS, stageFor, nextStage, STAGE_THRESHOLDS, publicView, type Stage } from '@lian/domain';

describe('§6 the relationship is prose, never a score', () => {
  test('the view carries no number of any kind', () => {
    const view = relationshipView(3, 'en', 'female');
    const serialised = JSON.stringify(view);
    // The rule is kept by the number never reaching the renderer, so this
    // asserts the shape of what crosses the wire rather than how it is drawn.
    assert.ok(!/\d/.test(serialised), `a digit reached the client: ${serialised.match(/.{0,40}\d.{0,40}/)?.[0]}`);
    for (const forbidden of ['days', 'progress', 'percent', 'level', 'score', 'next', 'qualifying']) {
      assert.ok(!Object.keys(view).includes(forbidden), `'${forbidden}' is how a progress bar gets built`);
    }
  });

  test('publicView from the domain exposes a key and nothing else', () => {
    assert.deepEqual(Object.keys(publicView(4)), ['stageKey']);
  });

  test('all five stages are described, with exactly one marked current', () => {
    const view = relationshipView(2, 'en', 'female');
    assert.equal(view.stages.length, 5);
    assert.equal(view.stages.filter((s) => s.current).length, 1);
    assert.equal(view.stages.findIndex((s) => s.current), 1);
    assert.deepEqual(view.stages.map((s) => s.key), [...STAGE_KEYS]);
  });

  test('the footer says the thing that stops it reading as a ladder', () => {
    assert.match(relationshipView(1, 'en', 'female').footer, /does not go backwards/);
  });

  test('both languages render, and neither leaks a number', () => {
    for (const language of ['en', 'ar'] as const) {
      for (const gender of ['female', 'male'] as const) {
        const view = relationshipView(5, language, gender);
        assert.ok(view.now.length > 10);
        assert.ok(!/\d|[٠-٩]/.test(JSON.stringify(view)), 'Arabic-Indic digits count too');
      }
    }
  });

  test('Q3 stages are earned at the named thresholds and never go backwards', () => {
    assert.equal(stageFor(0), 1);
    for (const [stage, days] of Object.entries(STAGE_THRESHOLDS)) {
      assert.equal(stageFor(days), Number(stage) as Stage, `${days} days is stage ${stage}`);
      if (days > 0) assert.ok(stageFor(days - 1) < Number(stage), 'one day short is one stage short');
    }
    // Absence does not demote her.
    assert.equal(nextStage(4, 0), 4);
    assert.equal(nextStage(2, 999), 5);
  });
});
