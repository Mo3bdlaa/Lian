// LESSONS §1 and §2, as tests rather than as discipline.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { assemblePrompt } from './assemble.ts';
import { SURFACES, SURFACE_CONFIG, type Surface } from './surfaces.ts';
import { BLOCK_IDS, BLOCK_ZONE, ZONES, zoneRank } from './zones.ts';
import { MissingContextError, MissingPersonaError } from './errors.ts';
import { SCENARIO_OVERRIDE_PREFIX } from './blocks.ts';
import { fakePorts, FIXED_NOW, ASSISTANT, USER } from './test-fakes.ts';
import type { PromptPorts } from './ports.ts';

const GOLDEN_DIR = new URL('./__golden__/', import.meta.url).pathname;
const UPDATE = process.env['UPDATE_GOLDEN'] === '1';

function request(surface: Surface, conversationId: string | null = 'c-1') {
  return { userId: 'u-1', assistantId: 'a-1', surface, conversationId, now: FIXED_NOW, retrievalQuery: null, memoryLimit: 8 };
}

// ── order ─────────────────────────────────────────────────────────────────
describe('block order is data, protected by a test', () => {
  test('BLOCK_IDS is exactly this list, in exactly this order', () => {
    // Changing this array is a deliberate act.  If you are here because this
    // test failed: the order of the prompt just changed. Confirm it is what
    // you meant, then update the list.
    assert.deepEqual([...BLOCK_IDS], [
      'identity', 'canon', 'relationship', 'profile', 'memory',
      'capabilities', 'environment', 'conversation', 'earlier',
      'scenario',
      'contract', 'directive',
    ]);
  });

  test('zones never go backwards — recency is structural', () => {
    let highest = 0;
    for (const id of BLOCK_IDS) {
      const rank = zoneRank(BLOCK_ZONE[id]);
      assert.ok(rank >= highest, `${id} (${BLOCK_ZONE[id]}) appears after a later zone`);
      highest = rank;
    }
    assert.deepEqual([...ZONES], ['foundation', 'override', 'trailing']);
  });

  test('every block id has a zone, and every zone is reachable', () => {
    for (const id of BLOCK_IDS) assert.ok(ZONES.includes(BLOCK_ZONE[id]), `${id} has no zone`);
    const used = new Set(BLOCK_IDS.map((id) => BLOCK_ZONE[id]));
    for (const zone of ZONES) assert.ok(used.has(zone), `zone '${zone}' has no blocks`);
  });

  test('§2 the scenario is rendered AFTER the persona, on every surface that has one', async () => {
    const result = await assemblePrompt(request('incognito', 'c-2'), fakePorts());
    const ids = result.blocks.map((b) => b.id);
    assert.ok(ids.includes('scenario'), 'incognito renders the scenario');
    assert.ok(ids.indexOf('scenario') > ids.indexOf('identity'), 'scenario must follow the persona — Noura stayed a secretary through an entire scenario because it did not');
  });

  test('§2 the scenario states that it overrides — the user is not asked to', async () => {
    const result = await assemblePrompt(request('incognito', 'c-2'), fakePorts());
    assert.ok(result.text.includes(SCENARIO_OVERRIDE_PREFIX), 'the override sentence belongs to the assembler');
    assert.ok(result.text.indexOf(SCENARIO_OVERRIDE_PREFIX) > result.text.indexOf('You are Lian'));
    assert.ok(/REPLACES/.test(SCENARIO_OVERRIDE_PREFIX), 'placing it correctly is half the fix; saying it overrides is the other half');
  });

  test('§1 the most important instruction is last, on every surface', async () => {
    for (const surface of SURFACES) {
      const result = await assemblePrompt(request(surface, surface === 'incognito' ? 'c-2' : 'c-1'), fakePorts());
      assert.equal(result.blocks.at(-1)?.id, 'directive', `${surface}: the directive must be last — models weight the end of the prompt`);
      assert.ok(result.text.trimEnd().endsWith(result.text.trimEnd().split('\n').at(-1)!.trim()));
    }
  });
});

// ── one path ──────────────────────────────────────────────────────────────
describe('one path, all surfaces', () => {
  test('every surface assembles through the same function', async () => {
    for (const surface of SURFACES) {
      const result = await assemblePrompt(request(surface, surface === 'incognito' ? 'c-2' : 'c-1'), fakePorts());
      assert.ok(result.text.length > 200, `${surface} produced a suspiciously short prompt`);
      assert.ok(result.text.includes('You are Lian'), `${surface} lost the persona — this is the Noura bug`);
      assert.equal(result.surface, surface);
    }
  });

  test('the rolling summary sits after the conversation frame, before any override', async () => {
    const withEarlier = fakePorts({
      loadEarlier: async () => ({ summary: 'They decided to postpone the trip. You said you would check on Thursday.', messageCount: 140 }),
    });
    const result = await assemblePrompt(request('chat'), withEarlier);
    const ids = result.blocks.map((b) => b.id);
    assert.ok(ids.includes('earlier'));
    assert.ok(ids.indexOf('earlier') > ids.indexOf('conversation'), 'the frame comes before the contents');
    assert.ok(ids.indexOf('earlier') < ids.indexOf('contract'));
    assert.match(result.text, /EARLIER IN THIS CONVERSATION/);
  });

  test('a conversation that still fits the window carries no summary block', async () => {
    const result = await assemblePrompt(request('chat'), fakePorts());
    assert.ok(!result.blocks.some((b) => b.id === 'earlier'));
  });

  test('a surface that omits a block omits only that block', async () => {
    const onboarding = await assemblePrompt(request('onboarding'), fakePorts());
    assert.ok(!onboarding.blocks.some((b) => b.id === 'memory'), 'onboarding has nothing to remember yet');
    assert.ok(onboarding.blocks.some((b) => b.id === 'canon'), 'but it still knows what she has said about herself');
  });

  test('incognito is the only surface that writes nothing (Q12)', () => {
    const writes = SURFACES.filter((s) => SURFACE_CONFIG[s].writesMemory);
    const silent = SURFACES.filter((s) => !SURFACE_CONFIG[s].writesMemory);
    assert.deepEqual(silent.sort(), ['incognito', 'security']);
    assert.ok(writes.includes('proactive'), 'her own outreach still writes memory');
  });

  test('incognito tells her plainly that nothing is kept', async () => {
    const result = await assemblePrompt(request('incognito', 'c-2'), fakePorts());
    assert.match(result.text, /NOTHING here is kept/);
    assert.equal(result.writesMemory, false);
  });
});

// ── missing context is an error, not a default ────────────────────────────
describe('§1 missing context throws — fault injection over every required port', () => {
  const REQUIRED: (keyof PromptPorts)[] = ['loadAssistant', 'loadUser', 'loadRelationship', 'loadMood'];

  for (const port of REQUIRED) {
    test(`${port} returning null is a MissingContextError`, async () => {
      const ports = fakePorts({ [port]: async () => null } as Partial<PromptPorts>);
      await assert.rejects(
        () => assemblePrompt(request('proactive'), ports),
        (error: unknown) => {
          assert.ok(error instanceof MissingContextError, `${port} fell back to a default instead of failing`);
          return true;
        },
      );
    });
  }

  test('a missing conversation is an error when one was asked for', async () => {
    const ports = fakePorts({ loadConversation: async () => null });
    await assert.rejects(() => assemblePrompt(request('chat', 'c-1'), ports), MissingContextError);
  });

  test('a background surface with no conversation is fine — null is a value, not an absence', async () => {
    const result = await assemblePrompt(request('dream', null), fakePorts());
    assert.ok(!result.blocks.some((b) => b.id === 'conversation'));
  });

  test('an unauthored voice throws rather than falling back to English', async () => {
    const ports = fakePorts({ loadUser: async () => ({ ...USER, languageStyle: 'fr' }) });
    await assert.rejects(() => assemblePrompt(request('chat'), ports), MissingPersonaError);
  });

  test('both genders are authored in both scripts, and neither is derived', async () => {
    const female = await assemblePrompt(request('chat'), fakePorts());
    const male = await assemblePrompt(request('chat'), fakePorts({ loadAssistant: async () => ({ ...ASSISTANT, gender: 'male' }) }));
    assert.notEqual(female.text, male.text);
    // If the male voice were a pronoun swap, replacing pronouns would make
    // them equal.  PRD §45 says it is not one, so this must stay true.
    const normalise = (s: string) => s.replace(/\b(she|her|hers|إنتي|بتحتفظي|قلتيه)\b/gi, '·').replace(/\b(he|him|his|إنت|بتمسك|قلته)\b/gi, '·');
    assert.notEqual(normalise(female.text), normalise(male.text), 'the male voice must be authored, not derived');
  });
});

// ── golden snapshots ──────────────────────────────────────────────────────
describe('golden snapshots — every surface, byte for byte', () => {
  test('no surface is missing a snapshot', () => {
    if (!existsSync(GOLDEN_DIR)) mkdirSync(GOLDEN_DIR, { recursive: true });
    for (const surface of SURFACES) {
      const path = `${GOLDEN_DIR}${surface}.txt`;
      assert.ok(UPDATE || existsSync(path), `no golden snapshot for surface '${surface}' — add one (UPDATE_GOLDEN=1 npm test) and read it before committing`);
    }
  });

  for (const surface of SURFACES) {
    test(`${surface} is unchanged`, async () => {
      const result = await assemblePrompt(request(surface, surface === 'incognito' ? 'c-2' : 'c-1'), fakePorts());
      const path = `${GOLDEN_DIR}${surface}.txt`;
      if (UPDATE) { writeFileSync(path, result.text); return; }
      assert.equal(result.text, readFileSync(path, 'utf8'), `the assembled prompt for '${surface}' changed`);
    });
  }
});
