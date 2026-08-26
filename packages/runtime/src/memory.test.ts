// Absorbing a turn: where extraction meets the capacity rules.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { absorbExchange, DUPLICATE_SIMILARITY, type MemoryPorts } from './memory.ts';
import { scriptedModel } from '@lian/analysis/test-fakes';
import { deterministicEmbedder } from '@lian/analysis';

const EXCHANGE = {
  userMessage: 'My sister Dana moved to Cairo last month.',
  assistantMessage: "Noted. I don't drink coffee myself, but I'll remember the time difference.",
  userMessageId: 'm-user',
  assistantMessageId: 'm-assistant',
};

const MEMORIES = JSON.stringify([{ type: 'person', statement: 'Their sister Dana moved to Cairo.', salience: 0.8 }]);
const CANON = JSON.stringify([{ category: 'preference', statement: 'You do not drink coffee.' }]);

function fakePorts(overrides: Partial<MemoryPorts> = {}) {
  const stored: { statement: string; embedding: string | null; embeddingModel: string | null }[] = [];
  const canon: { statement: string }[] = [];
  const events: string[] = [];
  let active = 0;
  let pending = 0;
  let queueCap = 20;
  const ports: MemoryPorts = {
    async countActive() { return active; },
    async countPending() { return pending; },
    async findSimilar() { return null; },
    async remember(_a, input, capacity) {
      if (active < capacity) { active += 1; stored.push(input); return { outcome: 'kept', id: `m${stored.length}` }; }
      if (pending >= queueCap) return { outcome: 'queue_full' };
      pending += 1; stored.push(input);
      return { outcome: 'queued', id: `m${stored.length}` };
    },
    async existingCanon() { return canon; },
    async stateCanon(_a, input) { canon.push({ statement: input.statement }); },
    async recordEvent(input) { events.push(input.name); },
    ...overrides,
  };
  return {
    ports, stored, canon, events,
    set active(value: number) { active = value; },
    set pending(value: number) { pending = value; },
    set cap(value: number) { queueCap = value; },
  };
}

const input = { userId: 'u-1', assistantId: 'a-1', plan: 'free' as const, localDay: '2026-05-18', exchange: EXCHANGE };

describe('absorbing a turn', () => {
  test('extracted memory is stored with an embedding and its source', async () => {
    const fake = fakePorts();
    const report = await absorbExchange(input, {
      model: scriptedModel(MEMORIES, '[]'), embedder: deterministicEmbedder(), ports: fake.ports,
    });
    assert.equal(report.kept, 1);
    assert.equal(fake.stored[0]!.statement, 'Their sister Dana moved to Cairo.');
    assert.ok(fake.stored[0]!.embedding!.startsWith('['), 'stored as a pgvector literal');
    assert.equal(fake.stored[0]!.embeddingModel, deterministicEmbedder().id, 'which embedder made it is recorded');
    assert.deepEqual(fake.events, ['memory_saved']);
  });

  test('a failed embedding stores the memory anyway, unsearchable but not lost', async () => {
    const broken = { id: 'broken', dimensions: 1024, embed: async () => { throw new Error('provider down'); } };
    const fake = fakePorts();
    const report = await absorbExchange(input, { model: scriptedModel(MEMORIES, '[]'), embedder: broken, ports: fake.ports });
    assert.equal(report.kept, 1, 'she should be less precise, never forgetful');
    assert.equal(fake.stored[0]!.embedding, null);
    assert.equal(fake.stored[0]!.embeddingModel, null, 'so the backfill can find it');
  });

  test('a near-duplicate of an existing memory is not stored again', async () => {
    const fake = fakePorts({ async findSimilar() { return { id: 'existing', statement: 'Their sister Dana moved to Cairo.' }; } });
    const report = await absorbExchange(input, {
      model: scriptedModel(MEMORIES, '[]'), embedder: deterministicEmbedder(), ports: fake.ports,
    });
    assert.equal(report.duplicates, 1);
    assert.equal(report.kept, 0);
    assert.equal(fake.stored.length, 0);
    assert.ok(DUPLICATE_SIMILARITY > 0.9, 'the threshold is deliberately strict — a false merge loses a memory');
  });

  test('PRD §35 at capacity a candidate queues, and nothing is evicted', async () => {
    const fake = fakePorts();
    fake.active = 100; // the free cap
    const report = await absorbExchange(input, {
      model: scriptedModel(MEMORIES, '[]'), embedder: deterministicEmbedder(), ports: fake.ports,
    });
    assert.equal(report.queued, 1);
    assert.equal(report.kept, 0);
    assert.deepEqual(fake.events, ['memory_queued']);
  });

  test('Q5 at the queue cap it is refused, and the refusal is countable', async () => {
    const fake = fakePorts();
    fake.active = 100;
    fake.pending = 20;
    const report = await absorbExchange(input, {
      model: scriptedModel(MEMORIES, '[]'), embedder: deterministicEmbedder(), ports: fake.ports,
    });
    assert.equal(report.refused, 1, 'the turn can say so — bounded and truthful beats silent');
    assert.equal(fake.stored.length, 0);
  });

  test('§5 canon is extracted separately and is outside the memory cap (Q4)', async () => {
    const fake = fakePorts();
    fake.active = 100;   // memory is completely full…
    fake.pending = 20;   // …and so is the queue
    const report = await absorbExchange(input, {
      model: scriptedModel(MEMORIES, CANON), embedder: deterministicEmbedder(), ports: fake.ports,
    });
    assert.equal(report.refused, 1, 'memory had no room');
    assert.equal(report.canonAdded, 1, 'and canon was stored anyway — it is her identity, not memory about the user');
    assert.equal(fake.canon[0]!.statement, 'You do not drink coffee.');
  });

  test('§5 canon already stated is not stated twice', async () => {
    const fake = fakePorts();
    await absorbExchange(input, { model: scriptedModel('[]', CANON), embedder: null, ports: fake.ports });
    await absorbExchange(input, { model: scriptedModel('[]', CANON), embedder: null, ports: fake.ports });
    assert.equal(fake.canon.length, 1, 'repeating herself must not grow canon without bound');
  });

  test('Q11 every stored memory carries exactly one source message', async () => {
    const fake = fakePorts();
    await absorbExchange(input, {
      model: scriptedModel(JSON.stringify([
        { type: 'person', statement: 'Their sister Dana moved to Cairo.', salience: 0.8 },
        { type: 'fact', statement: 'They keep forgetting the time difference.', salience: 0.4 },
      ]), '[]'),
      embedder: deterministicEmbedder(), ports: fake.ports,
    });
    assert.equal(fake.stored.length, 2);
  });

  test('an exchange with nothing worth keeping writes nothing at all', async () => {
    const fake = fakePorts();
    const report = await absorbExchange(input, { model: scriptedModel('[]', '[]'), embedder: deterministicEmbedder(), ports: fake.ports });
    assert.deepEqual({ ...report }, { kept: 0, queued: 0, refused: 0, duplicates: 0, canonAdded: 0, rejected: 0 });
    assert.deepEqual(fake.events, [], 'the common case is free');
  });
});
