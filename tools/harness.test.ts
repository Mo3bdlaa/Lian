// The measuring instruments, measured.
//
// "The tests you write for it are as load-bearing as the ones for the code,
// because everything I decide from here reads its output." So these are
// written the way the product's are: each one names the real incident it
// exists to prevent, and each one fails if the rule is removed.
//
// No database. These are the DECISIONS the tools make, deliberately separated
// from the queries that feed them, which is what makes them testable at all.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  alarming, UnevidencedClaim, foreignRows, assertOwnRows,
  recallOf, recallVerdict, RECALL_FLOOR,
} from './harness.ts';

describe('rule 1 — an alarming claim names the rows it read', () => {
  test('a claim carries its query, its scope and its count', () => {
    const line = alarming('outreach rows: 2', {
      query: 'SELECT … FROM outreach WHERE assistant_id = $1', scope: 'a-1', rows: 2,
    });
    assert.match(line, /outreach rows: 2/);
    assert.match(line, /2 row\(s\)/);
    assert.match(line, /FROM outreach/);
    assert.match(line, /scoped to a-1/);
  });

  test('THE INCIDENT: a claim with no scope is refused, not printed', () => {
    // `outreach rows: 499` — every one scheduled three months in the past,
    // most of them cancelled, for an account one day old. It read as an
    // assistant who had been trying to get somebody's attention for a season.
    // They were the test suite's leftovers, and the line had every means to
    // say so.
    assert.throws(
      () => alarming('outreach rows: 499', { query: 'SELECT … FROM outreach', scope: '', rows: 499 }),
      (error: unknown) => error instanceof UnevidencedClaim && /no scope was named/.test((error as Error).message),
    );
  });

  test("'EVERY ACCOUNT' is a scope — the rule is naming it, not narrowing it", () => {
    // The tick report genuinely IS the whole database's: the scheduler is a
    // batch job over every account. That is not a bug and must not be made
    // unreportable; it has to be LABELLED, because unlabelled it reads as
    // sixty-two messages queued for the one person the session is about.
    const line = alarming('proposed 62, held back 42', {
      query: 'runSchedule()', scope: 'EVERY ACCOUNT', rows: 62,
    });
    assert.match(line, /scoped to EVERY ACCOUNT/);
  });

  test('a claim with no query named is refused', () => {
    assert.throws(
      () => alarming('something is wrong', { query: '', scope: 'a-1', rows: 3 }),
      UnevidencedClaim,
    );
  });

  test('a row count that is not a count is refused', () => {
    for (const rows of [-1, 1.5, Number.NaN]) {
      assert.throws(
        () => alarming('claim', { query: 'q', scope: 's', rows }),
        UnevidencedClaim,
        `rows=${rows} was accepted`,
      );
    }
  });
});

describe('rule 2 — a tool asserts its own isolation', () => {
  const scope = { userId: 'u-1', assistantId: 'a-1' };

  test('its own rows are not foreign', () => {
    const rows = [{ assistantId: 'a-1' }, { assistantId: 'a-1', userId: 'u-1' }, { userId: 'u-1' }];
    assert.deepEqual(foreignRows(rows, scope), []);
  });

  test("THE INCIDENT: a neighbour's rows are found", () => {
    const rows = [{ assistantId: 'a-1' }, { assistantId: 'a-2' }, { assistantId: 'a-3' }];
    assert.equal(foreignRows(rows, scope).length, 2);
    assert.throws(
      () => assertOwnRows('outreach', rows, scope),
      /2 of 3 row\(s\) do not belong/,
    );
  });

  test('A ROW WITH NO OWNER COLUMN IS FOREIGN, not "probably fine"', () => {
    // The read that caused this selected `kind, source, scheduled_for` and no
    // owner at all. There is nothing in those rows that can be shown to
    // belong to anybody — and "cannot be shown" is the answer, because the
    // alternative is a check that passes precisely when it has nothing to
    // check. That is the shape of every gate that went green while blind.
    const rows = [{ }, { }];
    assert.equal(foreignRows(rows, scope).length, 2);
  });

  test('a mismatch on EITHER id is foreign, not just on both', () => {
    // A row carrying the right assistant and the wrong user is a join gone
    // wrong, and it must not pass because one half agrees.
    assert.equal(foreignRows([{ assistantId: 'a-1', userId: 'u-2' }], scope).length, 1);
    assert.equal(foreignRows([{ assistantId: 'a-2', userId: 'u-1' }], scope).length, 1);
  });

  test('a scope that names only one id checks only that one', () => {
    // A tool that has an assistant and no user in hand still gets the check.
    assert.deepEqual(foreignRows([{ assistantId: 'a-1', userId: 'u-9' }], { assistantId: 'a-1' }), []);
  });

  test('an empty set is isolated — there is nothing to be wrong about', () => {
    assert.deepEqual(foreignRows([], scope), []);
    assert.doesNotThrow(() => assertOwnRows('nothing', [], scope));
  });
});

describe('rule 3 — a measurement says what it compared', () => {
  test('an index returning nothing is caught', () => {
    // §31, and the reason `npm run preflight db` exists: an ivfflat index
    // built by a migration on an empty table answered 2 of the 60 nearest,
    // and the only symptom in the product is a memory stored twice — no
    // error, no slowdown, nothing in a log.
    const exact = Array.from({ length: 60 }, (_, i) => `m${i}`);
    const measured = recallOf(['m0', 'm1'], exact);
    assert.equal(measured.kind, 'measured');
    assert.equal(measured.overlap, 2);
    assert.ok(measured.recall < 0.05);
    assert.equal(recallVerdict(measured), 'fail');
  });

  test('a rebuilt index passes', () => {
    const exact = Array.from({ length: 60 }, (_, i) => `m${i}`);
    assert.equal(recallVerdict(recallOf([...exact], exact)), 'pass');
  });

  test('AN EMPTY GROUND TRUTH IS NOT A PASS', () => {
    // 0/0. Every naive spelling of this renders as a tick — `NaN >= 0.8` is
    // false so it fails for the wrong reason, and `Math.max(1, n)` turns it
    // into a 0% that sends somebody to rebuild an index that was fine. The
    // absence of evidence gets its own case so neither can happen.
    const nothing = recallOf([], []);
    assert.equal(nothing.kind, 'no-ground-truth');
    assert.equal(recallVerdict(nothing), 'unmeasurable');
    assert.notEqual(recallVerdict(nothing), 'pass');
    assert.notEqual(recallVerdict(nothing), 'fail');
  });

  test('an approximate answer full of duplicates cannot inflate its own recall', () => {
    // Repeating one correct id sixty times is one hit, not sixty.
    const exact = Array.from({ length: 60 }, (_, i) => `m${i}`);
    const measured = recallOf(Array.from({ length: 60 }, () => 'm0'), exact);
    assert.equal(measured.kind === 'measured' && measured.overlap, 1);
    assert.equal(recallVerdict(measured), 'fail');
  });

  test('the floor is exactly at the boundary, and the boundary is asserted', () => {
    const exact = Array.from({ length: 10 }, (_, i) => `m${i}`);
    const eight = recallOf(exact.slice(0, 8), exact);
    assert.equal(eight.kind === 'measured' && eight.recall, RECALL_FLOOR);
    assert.equal(recallVerdict(eight), 'pass', 'exactly at the floor must pass, or the constant means something else');
    assert.equal(recallVerdict(recallOf(exact.slice(0, 7), exact)), 'fail');
  });
});
