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
import { deterministicEmbedder, toVectorLiteral } from '@lian/analysis';

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
    const embedder = deterministicEmbedder();

    const store = async (statement: string, salience: number) => {
      const [vector] = await embedder.embed([statement]);
      await memoriesRepo.remember(scope, {
        type: 'fact', statement, salience,
        embedding: toVectorLiteral(vector!), embeddingModel: embedder.id,
      }, 100);
    };
    await store('Their sister Dana lives in Cairo.', 0.5);
    await store('They are allergic to shellfish.', 0.5);
    await store('They renewed the gym membership in May.', 0.5);

    const [query] = await embedder.embed(['tell me about their sister']);
    const found = await memoriesRepo.retrieve(scope, toVectorLiteral(query!), 3);
    assert.match(found[0]!.statement, /sister Dana/, 'the relevant one ranks first, not the newest');
    assert.ok(found[0]!.similarity !== null && found[0]!.similarity > 0);
  });

  test('a memory with no embedding is still retrievable — a failed embedder loses nothing', async () => {
    const user = await freshUser();
    const scope = await freshAssistant(user);
    await memoriesRepo.remember(scope, { type: 'fact', statement: 'Stored before any embedder existed.' }, 100);

    const embedder = deterministicEmbedder();
    const [query] = await embedder.embed(['anything at all']);
    const found = await memoriesRepo.retrieve(scope, toVectorLiteral(query!), 5);
    assert.equal(found.length, 1);
    assert.equal(found[0]!.similarity, null, 'and it is visibly unsearchable rather than silently missing');

    const pending = await memoriesRepo.needingEmbedding(scope, 10);
    assert.equal(pending.length, 1, 'the backfill can find it');
    const [vector] = await embedder.embed([pending[0]!.statement]);
    await memoriesRepo.setEmbedding(scope, pending[0]!.id, toVectorLiteral(vector!), embedder.id);
    assert.equal((await memoriesRepo.needingEmbedding(scope, 10)).length, 0);
  });

  test('a near-duplicate is findable before it is written', async () => {
    const user = await freshUser();
    const scope = await freshAssistant(user);
    const embedder = deterministicEmbedder();
    const statement = 'Their sister Dana moved to Cairo.';
    const [vector] = await embedder.embed([statement]);
    await memoriesRepo.remember(scope, { type: 'person', statement, embedding: toVectorLiteral(vector!), embeddingModel: embedder.id }, 100);

    const [again] = await embedder.embed([statement]);
    assert.ok(await memoriesRepo.findSimilar(scope, toVectorLiteral(again!), 0.94), 'the same statement is a duplicate');
    const [different] = await embedder.embed(['They renewed the gym membership.']);
    assert.equal(await memoriesRepo.findSimilar(scope, toVectorLiteral(different!), 0.94), null);
  });
});
