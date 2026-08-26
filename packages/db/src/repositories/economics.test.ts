// The measurement that is supposed to replace the assumption.
//
// The free tier is priced on "one turn in ten pays a cache write", which
// implies ten-turn sessions and matches nothing observed. This is the query
// that will say what the real number is — so it has to be right before the
// first week of traffic, not after.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../client.ts';
import { HAS_DB, ready, freshUser, freshAssistant, done } from '../test-support.ts';
import * as conversations from './conversations.ts';
import * as economics from './economics.ts';
import type { AssistantScope } from '../scope.ts';

/** Writes a user message at a chosen instant — the column is the only thing
 *  the session query looks at. */
async function messageAt(scope: AssistantScope, conversationId: string, at: Date): Promise<void> {
  const message = await conversations.appendMessage(scope, {
    conversationId, role: 'user', body: 'hello', tags: [], surface: 'chat', clientId: null,
  });
  await db().query(`UPDATE messages SET created_at = $2 WHERE assistant_id = $3 AND id = $1`, [message.id, at, scope.assistantId]);
}

describe('turns per session', { skip: HAS_DB ? false : 'DATABASE_URL not set' }, () => {
  before(async () => { await ready(); });
  after(async () => { await done(); });

  async function withMessages(offsetsMinutes: number[]): Promise<AssistantScope> {
    const user = await freshUser();
    const scope = await freshAssistant(user);
    const conversation = await conversations.createConversation(scope, { kind: 'main' });
    const start = new Date('2026-05-18T06:00:00.000Z');
    for (const minutes of offsetsMinutes) {
      await messageAt(scope, conversation.id, new Date(start.getTime() + minutes * 60_000));
    }
    return scope;
  }

  test('a gap longer than the window starts a new session', async () => {
    // Three turns, an hour of silence, two turns: two sessions, not five and
    // not one.
    const scope = await withMessages([0, 2, 5, 65, 68]);
    const measured = await economics.turnsPerSession({ assistantId: scope.assistantId, gapMinutes: 30 });

    assert.equal(measured.sessions, 2);
    assert.equal(measured.turns, 5);
    assert.equal(measured.mean, 2.5);
    assert.deepEqual([...measured.histogram], [{ turns: 2, sessions: 1 }, { turns: 3, sessions: 1 }]);
  });

  test('the cache-write share is the share of turns that START a session', async () => {
    // This is the number the free tier is priced on, and this is where it
    // comes from: one write per session.
    const scope = await withMessages([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const measured = await economics.turnsPerSession({ assistantId: scope.assistantId });
    assert.equal(measured.sessions, 1);
    assert.equal(measured.turns, 10);
    // Ten-turn sessions are exactly the assumption in llm/catalogue.ts.
    assert.equal(measured.cacheWriteShare, 0.1);
  });

  test('one-turn sessions cost the most, and the query says so', async () => {
    // Someone who sends one message a day pays a cache write EVERY turn.
    // The assumption in the catalogue would understate them by ten times.
    const scope = await withMessages([0, 24 * 60, 48 * 60]);
    const measured = await economics.turnsPerSession({ assistantId: scope.assistantId });
    assert.equal(measured.sessions, 3);
    assert.equal(measured.cacheWriteShare, 1);
    assert.equal(measured.median, 1);
  });

  test('no traffic reports nothing rather than a plausible zero', async () => {
    const user = await freshUser();
    const scope = await freshAssistant(user);
    const measured = await economics.turnsPerSession({ assistantId: scope.assistantId });
    assert.equal(measured.sessions, 0);
    // Not a share of 0, which would read as "nobody pays a cache write".
    assert.equal(measured.cacheWriteShare, 0);
    assert.equal(measured.turns, 0);
  });

  test('the gap is reported next to the number that depends on it', async () => {
    const scope = await withMessages([0, 20]);
    const half = await economics.turnsPerSession({ assistantId: scope.assistantId, gapMinutes: 10 });
    const wide = await economics.turnsPerSession({ assistantId: scope.assistantId, gapMinutes: 30 });
    assert.equal(half.sessions, 2);
    assert.equal(wide.sessions, 1);
    // The same data, two answers: which is why the window travels with it.
    assert.equal(half.gapMinutes, 10);
    assert.equal(wide.gapMinutes, 30);
  });
});
