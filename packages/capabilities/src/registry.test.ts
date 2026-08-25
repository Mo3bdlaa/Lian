// LESSONS §13, as a test of the shape rather than of the two capabilities.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { REGISTRY, contributions, tagSpecs, ownerOfTag, outreachCandidates, exportAll, purgeAll } from './registry.ts';
import { fakePorts } from './test-fakes.ts';
import type { CapabilityContext } from '@lian/domain';

const CONTEXT: CapabilityContext = {
  userId: 'u-1', assistantId: 'a-1', surface: 'chat', localDay: '2026-05-18',
  timeZone: 'Asia/Dubai', plan: 'free', language: 'en',
};

describe('§13 a capability composes into the prompt', () => {
  test('no capability can reach the persona — it has no way to name it', () => {
    // The boundary gate enforces the import ban; this asserts the shape that
    // makes the ban sufficient.  A capability is handed a context with no
    // persona, no canon, no memory and no mood phrase in it.
    const keys = Object.keys(CONTEXT).sort();
    assert.deepEqual(keys, ['assistantId', 'language', 'localDay', 'plan', 'surface', 'timeZone', 'userId']);
  });

  test('every capability satisfies the whole contract, export and purge included', () => {
    for (const capability of REGISTRY) {
      assert.equal(typeof capability.promptFragment, 'function', `${capability.id}: promptFragment`);
      assert.equal(typeof capability.contextFragment, 'function', `${capability.id}: contextFragment`);
      assert.equal(typeof capability.handle, 'function', `${capability.id}: handle`);
      // LESSONS §11 is not optional per capability: export and deletion are
      // user-facing features, and a capability that cannot answer for its
      // rows makes "delete everything" a lie.
      assert.equal(typeof capability.exportFor, 'function', `${capability.id}: exportFor`);
      assert.equal(typeof capability.purgeFor, 'function', `${capability.id}: purgeFor`);
      assert.ok(capability.tags.length > 0, `${capability.id}: owns no tag`);
      for (const tag of capability.tags) assert.ok(tag.usage.length > 20, `${tag.name}: usage must show the model a real example`);
    }
  });

  test('tag names are unique across the registry', () => {
    const names = REGISTRY.flatMap((c) => c.tags.map((t) => t.name));
    assert.equal(new Set(names).size, names.length, 'two capabilities claiming one tag makes dispatch ambiguous');
  });

  test('the prompt contract and the parser are built from the same list', () => {
    const offered = REGISTRY.flatMap((c) => c.tags.map((t) => t.name)).sort();
    const parsed = tagSpecs().map((s) => s.name).sort();
    assert.deepEqual(parsed, offered, 'a tag the prompt never offered must not be parseable');
    for (const name of offered) assert.ok(ownerOfTag(name), `${name} has no owner`);
    assert.equal(ownerOfTag('not-a-tag'), undefined);
  });

  test('consumer 1: prompt assembly gets abilities, state and tags', async () => {
    const ports = fakePorts();
    await ports.tasks.create('u-1', { kind: 'task', title: 'return the book', dueOn: '2026-05-18', recurrence: null, originMessageId: 'm', originAssistantId: 'a-1' });
    const contributed = await contributions(CONTEXT, ports);
    assert.equal(contributed.length, REGISTRY.length);
    const tasks = contributed.find((c) => c.id === 'tasks')!;
    assert.match(tasks.ability, /Keep track/);
    assert.match(tasks.state!, /Due today: return the book/);
    assert.equal(tasks.tags[0]!.name, '<todo>', 'the prompt gets the bracketed form');
  });

  test('consumer 2: a tag dispatches to its owner and writes only its own rows', async () => {
    const ports = fakePorts();
    const outcome = await ownerOfTag('spend')!.handle(
      { context: CONTEXT, tag: { name: 'spend', payload: { amount: 400, currency: 'AED', category: 'gym' }, index: 0 }, messageId: 'm-1' },
      ports,
    );
    assert.ok(outcome.ok);
    assert.equal(outcome.entityTable, 'transactions');
    assert.equal(ports.txRows.length, 1);
    assert.equal(ports.taskRows.length, 0, 'money must not touch tasks');
    assert.equal(outcome.summary.line, 'AED 400 · gym · Today');
    assert.match(outcome.summary.correctionRoute, /^\/money\//, 'the row is tappable to correct');
  });

  test('consumer 3: outreach candidates declare their own source (LESSONS §4)', async () => {
    const ports = fakePorts();
    await ports.tasks.create('u-1', { kind: 'task', title: 'call the bank', dueOn: '2026-05-18', recurrence: null, originMessageId: 'm', originAssistantId: 'a-1' });
    const candidates = await outreachCandidates(CONTEXT, ports);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]!.source, 'user_requested', 'a reminder THEY asked for must never count toward her backing off');
    assert.ok(candidates[0]!.dedupeKey.includes('2026-05-18'), 'a reminder must not fire twice in a day');
  });

  test('consumers 4 and 5: export covers every capability, and purge empties them', async () => {
    const ports = fakePorts();
    await ports.tasks.create('u-1', { kind: 'task', title: 'x', dueOn: null, recurrence: null, originMessageId: 'm', originAssistantId: 'a-1' });
    await ports.money.create('u-1', { direction: 'out', amountMinor: 100, currency: 'AED', category: null, occurredOn: '2026-05-18', note: null, originMessageId: 'm', originAssistantId: 'a-1' });

    const slices = await exportAll('u-1', ports);
    assert.deepEqual(slices.map((s) => s.name).sort(), ['tasks', 'transactions']);
    assert.ok(slices.every((s) => s.rows.length > 0), 'an export that returns nothing is a broken promise');

    await purgeAll('u-1', ports);
    assert.equal(ports.taskRows.length, 0);
    assert.equal(ports.txRows.length, 0, 'deleting is real');
  });

  test('a capability id appears nowhere outside its directory and the registry', () => {
    // This is what makes "adding a capability is one directory and one line"
    // true rather than aspirational.
    const root = new URL('../../../', import.meta.url).pathname;
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (['node_modules', '.git', 'design-system', 'docs', '.pgdata'].includes(entry)) continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (!full.endsWith('.ts')) continue;
        const path = full.slice(root.length);
        if (path.startsWith('packages/capabilities/src/')) continue;   // its own home
        if (path.startsWith('packages/runtime/') || path.startsWith('packages/jobs/')) continue; // composition roots
        if (path.includes('.test.ts') || path.includes('test-fakes') || path.includes('test-support')) continue;
        // The schema names tables after the capability that owns them, which
        // is the point: `tasks` there is a table, not a reference to this
        // registry.  What §13 forbids is a HANDLER that knows the id.
        if (path.startsWith('packages/db/')) continue;
        if (path.startsWith('tools/')) continue;
        const source = readFileSync(full, 'utf8');
        for (const capability of REGISTRY) {
          if (new RegExp(`['"\`]${capability.id}['"\`]`).test(source)) offenders.push(`${path} names '${capability.id}'`);
        }
      }
    };
    walk(join(root, 'packages'));
    assert.deepEqual(offenders, [], 'a capability id outside its directory means the next capability is not free');
  });
});
