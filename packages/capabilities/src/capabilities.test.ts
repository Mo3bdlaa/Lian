// The three capabilities added after the interface was proven, plus the
// product rules each one is responsible for not breaking.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ownerOfTag, REGISTRY, tagSpecs } from './registry.ts';
import { observe } from './health/index.ts';
import { fakePorts } from './test-fakes.ts';
import type { CapabilityContext, HealthRecord } from '../src/index.ts';

const CONTEXT: CapabilityContext = {
  userId: 'u-1', assistantId: 'a-1', surface: 'chat', localDay: '2026-05-18',
  timeZone: 'Asia/Dubai', plan: 'free', language: 'en',
};

const handle = (name: string, payload: unknown, ports: ReturnType<typeof fakePorts>) =>
  ownerOfTag(name)!.handle({ context: CONTEXT, tag: { name, payload, index: 0 }, messageId: 'm-1' }, ports);

describe('adding a capability stayed cheap (§13)', () => {
  test('four capabilities, five tags, no name collisions', () => {
    assert.equal(REGISTRY.length, 4);
    const names = tagSpecs().map((s) => s.name);
    assert.deepEqual(names.sort(), ['habit', 'health', 'note', 'spend', 'todo']);
    assert.equal(new Set(names).size, names.length);
  });
});

describe('habits are tasks with a recurrence, and their own tag', () => {
  test('a habit is captured with its recurrence', async () => {
    const ports = fakePorts();
    const outcome = await handle('habit', { title: 'drink more water', freq: 'daily' }, ports);
    assert.ok(outcome.ok);
    assert.equal(ports.taskRows[0]!.kind, 'habit');
    assert.equal(outcome.entityTable, 'tasks', 'one table, one correction screen');
  });

  test('a habit with no usable recurrence is refused rather than becoming a task', async () => {
    const ports = fakePorts();
    assert.deepEqual(await handle('habit', { title: 'swim' }, ports), { ok: false, reason: 'a habit needs to be daily or weekly' });
    assert.deepEqual(await handle('habit', { title: 'swim', freq: 'weekly' }, ports), { ok: false, reason: 'a weekly habit needs days' });
    assert.equal(ports.taskRows.length, 0);
  });

  test('a one-off task keeps its due date; a habit does not get one', async () => {
    const ports = fakePorts();
    await handle('todo', { title: 'return the book', due: '2026-05-19' }, ports);
    await handle('habit', { title: 'swim', freq: 'weekly', days: [2, 5], due: '2026-05-19' }, ports);
    assert.equal(ports.taskRows[0]!.dueOn, '2026-05-19');
    assert.equal(ports.taskRows[1]!.dueOn, null, 'a recurring thing has no single due date');
  });
});

describe('notes', () => {
  test('a note is kept, not done', async () => {
    const ports = fakePorts();
    const outcome = await handle('note', { body: 'the landlord said the lease renews in March', title: 'Lease' }, ports);
    assert.ok(outcome.ok);
    assert.equal(ports.noteRows[0]!.title, 'Lease');
    assert.equal(ports.taskRows.length, 0, 'a note must not become a task');
    assert.equal(outcome.summary.line, 'Lease');
  });

  test('an empty note is refused', async () => {
    const ports = fakePorts();
    assert.deepEqual(await handle('note', { body: ' ' }, ports), { ok: false, reason: 'nothing to write down' });
  });

  test('a long untitled note is elided for the confirmation row, not stored short', async () => {
    const ports = fakePorts();
    const body = 'a'.repeat(120);
    const outcome = await handle('note', { body }, ports);
    assert.ok(outcome.ok && outcome.summary.line.length <= 48);
    assert.equal(ports.noteRows[0]!.body.length, 120, 'the row keeps everything');
  });

  test('the prompt fragment draws the line the user actually draws', () => {
    const notes = REGISTRY.find((c) => c.id === 'notes')!;
    assert.match(notes.tags[0]!.usage, /will not DO/, 'a model given both tags without the distinction uses whichever it saw last');
  });
});

describe('health is context, not a tracker', () => {
  test('a meal, a workout and a medication are all captured', async () => {
    const ports = fakePorts();
    for (const kind of ['meal', 'workout', 'medication']) {
      const outcome = await handle('health', { kind, description: `something ${kind}` }, ports);
      assert.ok(outcome.ok, kind);
    }
    assert.equal(ports.healthRows.length, 3);
  });

  test('an unknown kind is refused rather than filed as a meal', async () => {
    const ports = fakePorts();
    assert.deepEqual(await handle('health', { kind: 'sleep', description: 'eight hours' }, ports), { ok: false, reason: 'not a meal, a workout or a medication' });
  });

  test('nothing in the capture can carry a calorie, a macro or a score', async () => {
    const ports = fakePorts();
    await handle('health', { kind: 'meal', description: 'salmon and rice', calories: 600, protein: 40, score: 8 }, ports);
    const stored = ports.healthRows[0]! as HealthRecord & Record<string, unknown>;
    assert.deepEqual(Object.keys(stored).sort(), ['description', 'durationMinutes', 'id', 'kind', 'occurredAt']);
    assert.ok(!('calories' in stored) && !('score' in stored), 'there is nowhere to put one, by design');
  });

  test('the prompt fragment tells the model not to estimate', () => {
    const health = REGISTRY.find((c) => c.id === 'health')!;
    const fragment = health.promptFragment(CONTEXT)!;
    assert.match(fragment, /Never calories, macros, scores or grades/);
    assert.match(fragment, /you do not estimate/, 'a model volunteers a calorie count unless told not to');
  });

  test('the observation is arithmetic about what was logged, or nothing', () => {
    const at = (hour: number, day = 18) => new Date(Date.UTC(2026, 4, day, hour));
    const workouts: HealthRecord[] = [
      { id: '1', kind: 'workout', description: 'run', occurredAt: at(7), durationMinutes: 30 },
      { id: '2', kind: 'workout', description: 'weights', occurredAt: at(8, 19), durationMinutes: 40 },
    ];
    assert.match(observe(workouts, 'en')!, /moving in the mornings/);
    // Nothing to say is a valid answer — UI-UX §26.2 has one observation, not
    // a generated one every week.
    assert.equal(observe([], 'en'), null);
    assert.equal(observe([{ id: '1', kind: 'meal', description: 'toast', occurredAt: at(9), durationMinutes: null }], 'en'), null);
  });

  test('her health outreach is an observation, never a nag about a missed day', async () => {
    const ports = fakePorts();
    await ports.health.create('u-1', { kind: 'workout', description: 'run', occurredAt: new Date(Date.UTC(2026, 4, 18, 7)), durationMinutes: 30, originMessageId: 'm', originAssistantId: 'a-1' });
    await ports.health.create('u-1', { kind: 'workout', description: 'weights', occurredAt: new Date(Date.UTC(2026, 4, 19, 8)), durationMinutes: 40, originMessageId: 'm', originAssistantId: 'a-1' });
    const health = REGISTRY.find((c) => c.id === 'health')!;
    const candidates = await health.proposeOutreach!(CONTEXT, ports);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]!.kind, 'pattern');
    assert.match(candidates[0]!.reason, /mornings/);

    // With nothing logged there is nothing to say, and she says nothing —
    // "you haven't logged anything" is streak pressure with a friendlier face.
    assert.deepEqual(await health.proposeOutreach!(CONTEXT, fakePorts()), []);
  });
});
