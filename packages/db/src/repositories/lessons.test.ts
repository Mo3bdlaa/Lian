// The LESSONS constraints, against a real database.
//
// Each test names the failure it prevents.  These are not unit tests of a
// helper: they are the constraints themselves, executable.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../client.ts';
import { HAS_DB, ready, freshUser, freshAssistant, done } from '../test-support.ts';
import * as memories from './memories.ts';
import * as canon from './canon.ts';
import * as outreach from './outreach.ts';
import * as relationshipRepo from './relationship.ts';
import * as conversations from './conversations.ts';
import * as captures from './captures.ts';
import * as usage from './usage.ts';
import * as limits from './limits.ts';
import * as story from './story.ts';
import { nextStage, STAGE_THRESHOLDS } from '@lian/domain';

describe('LESSONS, enforced by the database', { skip: HAS_DB ? false : 'DATABASE_URL not set' }, () => {
  before(async () => { await ready(); });
  after(async () => { await done(); });

  // ── LESSONS §4 ──────────────────────────────────────────────────────────
  test('§4 backoff counts only her own unanswered messages', async () => {
    const user = await freshUser();
    const scope = await freshAssistant(user);

    // The exact Noura failure: the user sets three reminders for themselves
    // and answers none of them.  That is not her being ignored.
    for (let i = 0; i < 3; i++) {
      const row = await outreach.schedule(scope, { kind: 'reminder', source: 'user_requested', scheduledFor: new Date() });
      await outreach.markSent(scope, row!.id, null);
    }
    assert.equal(await outreach.unansweredStreak(scope), 0, 'user-requested reminders must not silence her');

    const hers = await outreach.schedule(scope, { kind: 'follow_up', source: 'assistant_initiated', scheduledFor: new Date() });
    await outreach.markSent(scope, hers!.id, null);
    assert.equal(await outreach.unansweredStreak(scope), 1);

    await outreach.markAnswered(scope, new Date());
    assert.equal(await outreach.unansweredStreak(scope), 0);
  });

  // ── LESSONS §5 ──────────────────────────────────────────────────────────
  test('§5 canon is retrieved unconditionally and is never dropped', async () => {
    const user = await freshUser();
    const scope = await freshAssistant(user);
    await canon.state(scope, { statement: 'I do not drink coffee.' });
    await canon.state(scope, { statement: 'I like the quiet before six.' });

    // Unconditional: all() takes no query, no embedding and no limit.
    const all = await canon.all(scope);
    assert.equal(all.length, 2);

    // Compaction MERGES.  Nothing disappears.
    const merged = await canon.compact(scope, all.map((c) => c.id), 'I keep early hours and I do not drink coffee.');
    const active = await canon.all(scope);
    assert.deepEqual(active.map((c) => c.id), [merged.id], 'only the merged statement is active');
    const everything = await canon.allIncludingMerged(scope);
    assert.equal(everything.length, 3, 'the sources are kept — a compaction that drops a statement is a §5 violation');
  });

  test('§5 canon is separate from memory and outside the free cap (Q4)', async () => {
    const user = await freshUser();
    const scope = await freshAssistant(user);
    for (let i = 0; i < 4; i++) await canon.state(scope, { statement: `about me ${i}` });
    // A capacity of zero: every candidate memory queues, and canon is untouched.
    const result = await memories.remember(scope, { type: 'fact', statement: 'user likes rain' }, 0);
    assert.equal(result.outcome, 'queued');
    assert.equal((await canon.all(scope)).length, 4);
    assert.equal(await memories.countActive(scope), 0);
  });

  // ── LESSONS §6 ──────────────────────────────────────────────────────────
  test('§6 the relationship stage cannot go backwards', async () => {
    const user = await freshUser();
    const scope = await freshAssistant(user);
    await db().query(`UPDATE relationship SET stage = 3, qualifying_days = 20 WHERE assistant_id = $1`, [scope.assistantId]);
    await assert.rejects(
      () => db().query(`UPDATE relationship SET stage = 2 WHERE assistant_id = $1`, [scope.assistantId]),
      /cannot go backwards/,
      'the database refuses, so a future recalculation job cannot demote her',
    );
    await assert.rejects(
      () => db().query(`UPDATE relationship SET qualifying_days = 1 WHERE assistant_id = $1`, [scope.assistantId]),
      /cannot decrease/,
    );
  });

  test('§6 a qualifying day counts once, however talkative the day was (Q3)', async () => {
    const user = await freshUser();
    const scope = await freshAssistant(user);
    let row = await relationshipRepo.creditQualifyingDay(scope, '2026-01-01', (d) => nextStage(1, d));
    assert.equal(row.qualifyingDays, 1);
    row = await relationshipRepo.creditQualifyingDay(scope, '2026-01-01', (d) => nextStage(1, d));
    assert.equal(row.qualifyingDays, 1, 'a second credit on the same local day is a no-op');
    row = await relationshipRepo.creditQualifyingDay(scope, '2026-01-02', (d) => nextStage(1, d));
    assert.equal(row.qualifyingDays, 2);
  });

  test('§6 stages are earned at the named thresholds, and only there', async () => {
    const user = await freshUser();
    const scope = await freshAssistant(user);
    let stage = 1 as 1 | 2 | 3 | 4 | 5;
    for (let day = 1; day <= STAGE_THRESHOLDS[3]; day++) {
      const row = await relationshipRepo.creditQualifyingDay(
        scope, `2026-01-${String(day).padStart(2, '0')}`, (d) => (stage = nextStage(stage, d)),
      );
      stage = row.stage;
    }
    assert.equal(stage, 3, `${STAGE_THRESHOLDS[3]} qualifying days reaches stage 3`);
  });

  // ── PRD §35 / Q5 ────────────────────────────────────────────────────────
  test('free memory: nothing is evicted, the queue is bounded and says so', async () => {
    const user = await freshUser();
    const scope = await freshAssistant(user);
    const CAP = 2;
    for (let i = 0; i < CAP; i++) {
      const r = await memories.remember(scope, { type: 'fact', statement: `kept ${i}` }, CAP);
      assert.equal(r.outcome, 'kept');
    }
    // At capacity: candidates queue, existing memories are untouched.
    for (let i = 0; i < memories.PENDING_QUEUE_CAP; i++) {
      const r = await memories.remember(scope, { type: 'fact', statement: `queued ${i}` }, CAP);
      assert.equal(r.outcome, 'queued');
    }
    assert.equal(await memories.countActive(scope), CAP, 'no oldest-memory eviction, ever');

    // Q5: the queue is capped.  The refusal is a visible state, not a silent drop.
    const overflow = await memories.remember(scope, { type: 'fact', statement: 'one too many' }, CAP);
    assert.equal(overflow.outcome, 'queue_full');
    assert.equal(await memories.countPending(scope), memories.PENDING_QUEUE_CAP);

    // Freeing room and promoting is possible without upgrading.
    const active = await memories.list(scope, 'active');
    await memories.forget(scope, active[0]!.id);
    const pending = await memories.list(scope, 'pending');
    assert.ok(await memories.promote(scope, pending[0]!.id));
    assert.equal(await memories.countActive(scope), CAP);
  });

  // ── Q11 / LESSONS §11 ───────────────────────────────────────────────────
  test('deleting a source removes derived memory by default; keeping is explicit', async () => {
    const user = await freshUser();
    const scope = await freshAssistant(user);
    const conversation = await conversations.createConversation(scope, { kind: 'main' });

    const makeSource = async (text: string) =>
      (await conversations.appendMessage(scope, { conversationId: conversation.id, role: 'user', body: text })).id;

    const a = await makeSource('I hate mornings');
    await memories.remember(scope, { type: 'preference', statement: 'dislikes mornings', sourceMessageId: a }, 100);
    assert.equal((await memories.derivedFrom(scope, a)).length, 1);
    const removed = await memories.deleteSourceMessage(scope, a, { keepDerived: false });
    assert.deepEqual(removed, { derivedRemoved: 1, derivedKept: 0 });
    assert.equal((await memories.derivedFrom(scope, a)).length, 0);

    const b = await makeSource('my sister is called Dana');
    await memories.remember(scope, { type: 'person', statement: 'sister: Dana', sourceMessageId: b }, 100);
    const kept = await memories.deleteSourceMessage(scope, b, { keepDerived: true });
    assert.deepEqual(kept, { derivedRemoved: 0, derivedKept: 1 });
    const [survivor] = await memories.list(scope, 'active');
    assert.equal(survivor!.sourceRemovedKept, true, 'the Memory screen can say "Source removed — kept by you"');
  });

  // ── Q7 ──────────────────────────────────────────────────────────────────
  test('a capture is idempotent per tag, and a regenerate voids the old ones', async () => {
    const user = await freshUser();
    const scope = await freshAssistant(user);
    const conversation = await conversations.createConversation(scope, { kind: 'main' });
    const message = await conversations.appendMessage(scope, { conversationId: conversation.id, role: 'assistant', body: 'Okay, logged AED 400 for the gym today.' });
    const entityId = message.id; // stand-in for the transaction row

    const first = await captures.claim(user, { messageId: message.id, tagIndex: 0, capability: 'money', entityTable: 'transactions', entityId });
    assert.ok(first, 'the first claim wins');
    const second = await captures.claim(user, { messageId: message.id, tagIndex: 0, capability: 'money', entityTable: 'transactions', entityId });
    assert.equal(second, null, 'a retried stream must not log AED 400 twice');

    const voided = await captures.voidForMessage(user, message.id);
    assert.equal(voided.length, 1, 'regeneration voids what the previous version captured');
    assert.ok(voided[0]!.voidedAt);
  });

  // ── Q12 ─────────────────────────────────────────────────────────────────
  test('incognito is always ephemeral, excluded from search, and really deleted', async () => {
    const user = await freshUser();
    const scope = await freshAssistant(user);
    const incognito = await conversations.createConversation(scope, { kind: 'incognito', scenarioText: 'Be a skeptical customer.' });
    assert.equal(incognito.retention, 'ephemeral');
    await conversations.createConversation(scope, { kind: 'main' });

    const searchable = await conversations.listSearchable(scope);
    assert.equal(searchable.length, 1);
    assert.equal(searchable[0]!.kind, 'main', 'incognito never appears in search');

    // And the search itself, not just the listing: the same sentence said in
    // both threads must come back once. A thread that turns up in search is a
    // thread that was kept, which is the one thing incognito promises it is
    // not.
    const said = `spinach and ${Date.now()}`;
    const main = searchable[0]!;
    await conversations.appendMessage(scope, { conversationId: main.id, role: 'user', body: said });
    await conversations.appendMessage(scope, { conversationId: incognito.id, role: 'user', body: said });
    const hits = await conversations.search(scope, { query: said, limit: 10 });
    assert.equal(hits.length, 1, 'the incognito copy must not be searchable');
    assert.equal(hits[0]!.conversationId, main.id);

    // Arabic is searched the same way English is (migration 0010): a match
    // inside a word, not a match on a whitespace-delimited token.
    await conversations.appendMessage(scope, { conversationId: main.id, role: 'user', body: 'رحت للشغل بدري' });
    const arabic = await conversations.search(scope, { query: 'شغل', limit: 10 });
    assert.ok(
      arabic.some((hit) => hit.body.includes('للشغل')),
      'شغل must match للشغل — a tokeniser that splits on whitespace would miss it',
    );

    // The database refuses a memory-writing incognito thread outright.
    await assert.rejects(
      () => db().query(
        `INSERT INTO conversations (assistant_id, kind, retention) VALUES ($1, 'incognito', 'persist')`,
        [scope.assistantId],
      ),
      /incognito_is_ephemeral/,
    );

    assert.equal(await conversations.hardDeleteConversation(scope, incognito.id), true);
    assert.equal(await conversations.getConversation(scope, incognito.id), null);
  });

  // ── LESSONS §12 ─────────────────────────────────────────────────────────
  test('§12 limits are database rows, and a refusal does not keep counting up', async () => {
    const user = await freshUser();
    const day = '2026-05-18';
    for (let i = 0; i < 3; i++) {
      const r = await usage.reserve(user, 'messages', day, 3);
      assert.equal(r.granted, true);
    }
    const refused = await usage.reserve(user, 'messages', day, 3);
    assert.equal(refused.granted, false);
    assert.equal(refused.value, 3, 'a refused request does not increment');
    // The model-cost ceiling is the same mechanism, in the same table.
    const cost = await usage.reserve(user, 'model_cost_micros', '2026-05', 1000, 400);
    assert.equal(cost.granted, true);
    assert.equal((await usage.reserve(user, 'model_cost_micros', '2026-05', 1000, 700)).granted, false);
  });

  test('§12 the FIRST reservation of a period is bounded too', async () => {
    // The bug this pins, found auditing the plan gate rather than by a
    // failing test:  `ON CONFLICT DO UPDATE ... WHERE` bounds the UPDATE
    // branch only.  With no row yet there is no conflict, so the ceiling
    // was never consulted and the first reservation of a period was granted
    // whatever it asked for.
    //
    // The test above passes either way — it reserves one unit at a time
    // against a ceiling of three, and its larger reservation (400 of 1000)
    // fits.  That is the whole reason this went unseen: the missing guard is
    // invisible to every case that fits inside the ceiling anyway.
    const user = await freshUser();

    // What it cost a real person.  Voice is paid-only, and the free plan's
    // STT ceiling is ZERO — enforced entirely here.  So a free account's
    // first voice note of each calendar month was transcribed and billed,
    // every month, for as long as the account existed.
    const firstOfTheMonth = await usage.reserve(user, 'stt_seconds', '2026-05', 0, 30);
    assert.equal(firstOfTheMonth.granted, false, 'a zero ceiling granted thirty seconds');
    assert.equal(await usage.current(user, 'stt_seconds', '2026-05'), 0, 'a refusal must not leave a row behind');

    // And the general case: one reservation larger than the entire ceiling.
    const wholeMonthAtOnce = await usage.reserve(await freshUser(), 'messages', '2026-05-18', 20, 5_000);
    assert.equal(wholeMonthAtOnce.granted, false);

    // The boundary, both sides — the guard is `<=`, and an off-by-one here
    // would refuse the last message of every day.
    const edge = await freshUser();
    assert.equal((await usage.reserve(edge, 'messages', '2026-05-18', 20, 20)).granted, true);
    assert.equal((await usage.reserve(await freshUser(), 'messages', '2026-05-18', 20, 21)).granted, false);
  });

  test('§12 a rate rule of zero closes the route rather than letting one through', async () => {
    // Same shape as the reservation above, in the other database-backed
    // counter — and not reachable today, because every rule in RATE_RULES is
    // at least three. It is pinned because setting a limit to zero is how
    // somebody closes a route in a hurry, and "one request per window gets
    // through, silently" is the worst possible answer to "is it off".
    const now = new Date('2026-05-18T09:00:00.000Z');
    const closed = await limits.takeToken(`gate-closed-${Date.now()}`, 60, 0, now);
    assert.equal(closed.allowed, false);

    const bucket = `gate-two-${Date.now()}`;
    assert.equal((await limits.takeToken(bucket, 60, 2, now)).allowed, true);
    assert.equal((await limits.takeToken(bucket, 60, 2, now)).allowed, true);
    assert.equal((await limits.takeToken(bucket, 60, 2, now)).allowed, false, 'the third took a token it did not have');
  });

  test('§11 a stage milestone is written once, however many days pass', async () => {
    // Derived milestones are re-derived on a schedule that runs every day
    // forever. Without the key, "you reached Finding a rhythm" is written
    // again every night and a timeline of the relationship becomes a
    // timeline of the loop.
    const user = await freshUser();
    const scope = await freshAssistant(user);

    for (let day = 0; day < 5; day += 1) {
      await story.record(scope, {
        type: 'milestone', titleKey: 'stage.finding_a_rhythm.name',
        occurredAt: new Date(`2026-05-${18 + day}T09:00:00Z`), dedupeKey: 'stage:2',
      });
    }
    const timeline = await story.timeline(scope, { limit: 50 });
    assert.equal(timeline.length, 1, 'a milestone was written more than once');
    // And the FIRST one wins: a milestone that already happened does not
    // change, and re-titling one retroactively rewrites somebody's history
    // under them.
    assert.equal(timeline[0]!.occurredAt.toISOString(), '2026-05-18T09:00:00.000Z');
    assert.equal(timeline[0]!.derived, true, 'a keyed row must read back as derived, or it renders a key');

    // Deletion is real (§11): a timeline is somebody's year.
    assert.equal(await story.purge(scope), 1);
    assert.equal((await story.timeline(scope, { limit: 50 })).length, 0);
  });

  test('§11 a moment can be taken off the timeline; a milestone cannot', async () => {
    // Both are her words on somebody's permanent record, so both have to be
    // removable — except that a MILESTONE is not removable in any meaningful
    // sense: it carries a dedupe key and the nightly tick re-derives it, so
    // "deleting" one would put it back that night. An event that reappears
    // after somebody removes it reads as the product ignoring them, and is
    // worse than a button that was never offered.
    const user = await freshUser();
    const scope = await freshAssistant(user);

    await story.record(scope, {
      type: 'milestone', titleKey: 'story.began', occurredAt: new Date('2026-05-01T09:00:00Z'), dedupeKey: 'began',
    });
    const moment = await story.add(scope, {
      type: 'moment', title: 'the day they called the bank', body: null, occurredAt: new Date('2026-05-18T12:00:00Z'),
    });
    // Hers reads back as NOT derived — which is what makes the screen render
    // her sentence rather than resolving it as a copy key, and what decides
    // whether the remove button is offered at all.
    assert.equal(moment.derived, false);
    assert.equal((await story.timeline(scope, { limit: 50 })).length, 2);

    assert.equal(await story.remove(scope, moment.id), true);
    const left = await story.timeline(scope, { limit: 50 });
    assert.equal(left.length, 1);
    assert.equal(left[0]!.type, 'milestone');

    // The milestone is refused, and refused the same way a stranger's row is:
    // false, with nothing said about why.
    assert.equal(await story.remove(scope, left[0]!.id), false);
    assert.equal((await story.timeline(scope, { limit: 50 })).length, 1);
    // And twice is not an error, it is nothing — a repeated DELETE from a
    // retried request must not read as success the second time either.
    assert.equal(await story.remove(scope, moment.id), false);

    // Another assistant's, from the same user, is not removable either.
    const other = await freshAssistant(user);
    const theirs = await story.add(scope, { type: 'moment', title: 'ours', body: null, occurredAt: new Date('2026-05-19T12:00:00Z') });
    assert.equal(await story.remove(other, theirs.id), false, 'a moment was reachable from another assistant');
  });

  test('§11 deleting a moment does not touch memory', async () => {
    // `story.remove_body` promises exactly this — "What I remember about you
    // is separate, and stays" — and the promises gate holds the statement
    // itself as the marker. This is the behaviour behind the sentence:
    // somebody tidying their story must not silently be making her forget
    // them.
    const user = await freshUser();
    const scope = await freshAssistant(user);
    await memories.remember(scope, { type: 'fact', statement: 'They run every morning.' }, 100);
    const moment = await story.add(scope, {
      type: 'moment', title: 'the morning run', body: null, occurredAt: new Date('2026-05-18T12:00:00Z'),
    });

    assert.equal(await story.remove(scope, moment.id), true);
    assert.equal(await memories.countActive(scope), 1, 'removing a moment removed a memory');
  });

  // ── LESSONS §11, scoping ────────────────────────────────────────────────
  test('§11 one assistant cannot read another assistant memory or canon', async () => {
    const user = await freshUser();
    const lian = await freshAssistant(user, 'Lian');
    const noor = await freshAssistant(user, 'Noor');
    await memories.remember(lian, { type: 'fact', statement: 'only Lian knows this' }, 100);
    await canon.state(lian, { statement: 'I am Lian.' });

    assert.equal((await memories.list(noor, 'active')).length, 0, 'separate memory, no shared awareness');
    assert.equal((await canon.all(noor)).length, 0);
    // …and the same across users.
    const other = await freshUser();
    const stranger = await freshAssistant(other);
    assert.equal((await memories.list(stranger, 'active')).length, 0);
  });
});

// ── added in the memory run ─────────────────────────────────────────────────
import * as memoriesRepo from './memories.ts';

// Vectors, made here rather than imported from @lian/analysis: the database
// package does not depend on the embedder, and these tests are about the SQL
// — the index, the ordering, the dimension — not about embedding quality.  A
// bag-of-words vector is enough to make "the relevant one ranks first" a real
// assertion about the query.
const DIMENSIONS = 1024;
function vec(text: string): string {
  const values = new Array<number>(DIMENSIONS).fill(0);
  for (const word of text.toLowerCase().split(/[^a-z]+/).filter(Boolean)) {
    let hash = 0;
    for (const character of word) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
    values[hash % DIMENSIONS] = values[hash % DIMENSIONS]! + 1;
  }
  const length = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0)) || 1;
  return `[${values.map((value) => (value / length).toFixed(6)).join(',')}]`;
}

describe('memory retrieval and canon, against the database', { skip: HAS_DB ? false : 'DATABASE_URL not set' }, () => {
  before(async () => { await ready(); });

  test('§5 the database refuses to delete canon', async () => {
    const user = await freshUser();
    const scope = await freshAssistant(user);
    const statement = await canon.state(scope, { statement: 'I keep early hours.' });
    await assert.rejects(
      () => db().query(`DELETE FROM canon WHERE id = $1`, [statement.id]),
      /canon is never deleted/,
      'not a convention and not a code path — a rule',
    );
    // Deleting the assistant still works: canon goes with her, by cascade.
    await db().query(`DELETE FROM assistants WHERE id = $1`, [scope.assistantId]);
    const { rows } = await db().query(`SELECT 1 FROM canon WHERE id = $1`, [statement.id]);
    assert.equal(rows.length, 0);
  });

  test('§5 a compaction that would drop a statement fails loudly', async () => {
    const user = await freshUser();
    const scope = await freshAssistant(user);
    const a = await canon.state(scope, { statement: 'I do not drink coffee.' });
    const b = await canon.state(scope, { statement: 'I like the quiet before six.' });

    const merged = await canon.compact(scope, [a.id, b.id], 'I keep early hours and I do not drink coffee.');
    assert.deepEqual((await canon.all(scope)).map((c) => c.id), [merged.id]);
    assert.equal((await canon.allIncludingMerged(scope)).length, 3, 'the sources are still there');
    assert.deepEqual((await canon.sourcesOf(scope, merged.id)).map((c) => c.id), [a.id, b.id]);

    // A compaction naming a statement that is already merged would absorb
    // fewer sources than it claims — that is a partial merge, and it throws.
    await assert.rejects(
      () => canon.compact(scope, [a.id, b.id], 'A second merge of the same two.'),
      /merged 0 of 2|compaction lost canon/,
    );
  });

  test('semantic retrieval returns the relevant memory, not the most recent', async () => {
    const user = await freshUser();
    const scope = await freshAssistant(user);
    const store = async (statement: string, salience: number) => {
      await memoriesRepo.remember(scope, {
        type: 'fact', statement, salience, embedding: vec(statement), embeddingModel: 'test-bag-of-words',
      }, 100);
    };
    await store('Their sister Dana lives in Cairo.', 0.5);
    await store('They are allergic to shellfish.', 0.5);
    await store('They renewed the gym membership in May.', 0.5);

    const found = await memoriesRepo.retrieve(scope, vec('tell me about their sister Dana'), 3);
    assert.match(found[0]!.statement, /sister Dana/, 'the relevant one ranks first, not the newest');
    assert.ok(found[0]!.similarity !== null && found[0]!.similarity > 0);
  });

  test('a memory with no embedding is still retrievable — a failed embedder loses nothing', async () => {
    const user = await freshUser();
    const scope = await freshAssistant(user);
    await memoriesRepo.remember(scope, { type: 'fact', statement: 'Stored before any embedder existed.' }, 100);

    const found = await memoriesRepo.retrieve(scope, vec('anything at all'), 5);
    assert.equal(found.length, 1);
    assert.equal(found[0]!.similarity, null, 'and it is visibly unsearchable rather than silently missing');

    const pending = await memoriesRepo.needingEmbedding(scope, 10);
    assert.equal(pending.length, 1, 'the backfill can find it');
    await memoriesRepo.setEmbedding(scope, pending[0]!.id, vec(pending[0]!.statement), 'test-bag-of-words');
    assert.equal((await memoriesRepo.needingEmbedding(scope, 10)).length, 0);
  });

  test('a near-duplicate is findable before it is written', async () => {
    const user = await freshUser();
    const scope = await freshAssistant(user);
    const statement = 'Their sister Dana moved to Cairo.';
    await memoriesRepo.remember(scope, { type: 'person', statement, embedding: vec(statement), embeddingModel: 'test-bag-of-words' }, 100);

    assert.ok(await memoriesRepo.findSimilar(scope, vec(statement), 0.94), 'the same statement is a duplicate');
    assert.equal(await memoriesRepo.findSimilar(scope, vec('They renewed the gym membership.'), 0.94), null);
  });
});
