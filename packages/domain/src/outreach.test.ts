import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { backoffFor, isQuiet, SILENCE_AFTER } from './outreach.ts';

describe('§4 backoff', () => {
  test('she speaks freely while she is being answered', () => {
    assert.equal(backoffFor(0, 0).send, true);
    assert.equal(backoffFor(1, 0).send, true);
  });

  test('silence slows her down before it stops her', () => {
    assert.equal(backoffFor(2, 1).send, false);
    assert.equal(backoffFor(2, 2).send, true);
    assert.equal(backoffFor(3, 3).send, false);
    assert.equal(backoffFor(3, 7).send, true);
  });

  test('after enough silence she waits to be spoken to', () => {
    const decision = backoffFor(SILENCE_AFTER, 365);
    assert.equal(decision.send, false);
    assert.match(decision.reason, /waiting to be spoken to/);
  });
});

describe('§31 quiet hours are decided server-side', () => {
  const quiet = { enabled: true, startHour: 22, endHour: 8, days: [], allowSecurity: true };

  test('a window that crosses midnight is still one window', () => {
    assert.equal(isQuiet(quiet, 23, 1, 'ordinary'), true);
    assert.equal(isQuiet(quiet, 3, 1, 'ordinary'), true);
    assert.equal(isQuiet(quiet, 9, 1, 'ordinary'), false);
    assert.equal(isQuiet(quiet, 21, 1, 'ordinary'), false);
  });

  test('security may reach through, if the user allowed it', () => {
    assert.equal(isQuiet(quiet, 3, 1, 'security'), false);
    assert.equal(isQuiet({ ...quiet, allowSecurity: false }, 3, 1, 'security'), true);
  });

  test('specific days only apply on those days', () => {
    const weekdays = { ...quiet, days: [1, 2, 3, 4, 5] };
    assert.equal(isQuiet(weekdays, 23, 3, 'ordinary'), true);
    assert.equal(isQuiet(weekdays, 23, 6, 'ordinary'), false, 'Saturday is not quiet');
  });

  test('disabled quiet hours are never quiet', () => {
    assert.equal(isQuiet({ ...quiet, enabled: false }, 3, 1, 'ordinary'), false);
  });
});
