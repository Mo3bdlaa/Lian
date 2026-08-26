// Every gate, shown to fail.
//
// LESSONS §15. This suite exists because a gate's own pattern was wrong for
// months and nobody could tell: `boundaries.ts` matched `@lian/([a-z]+)`,
// which has no digit in it, so every import of `@lian/i18n` was skipped while
// the gate printed green on every commit. It is the same shape as the
// `--bw-1-5` miss — a sound rule with the wrong scope is indistinguishable
// from a working one until something is planted in front of it.
//
// So each gate is pointed at a fixture tree, twice: once clean, to prove the
// fixture is not failing for an unrelated reason, and once with a deliberate
// violation of the rule, to prove the gate objects to THAT.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { addressViolations } from '../../packages/i18n/src/arabic.ts';

const REPO = resolve(new URL('../..', import.meta.url).pathname);
const roots: string[] = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** A tree with the files a gate needs, plus whatever the test plants. */
function fixture(files: Record<string, string>, copies: string[] = []): string {
  const root = mkdtempSync(join(tmpdir(), 'lian-gate-'));
  roots.push(root);
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, contents);
  }
  for (const path of copies) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    copyFileSync(join(REPO, path), full);
  }
  return root;
}

function run(gate: string, root: string): { ok: boolean; output: string } {
  const result = spawnSync(process.execPath, [join(REPO, 'tools', 'gates', `${gate}.ts`)], {
    env: { ...process.env, LIAN_GATE_ROOT: root },
    encoding: 'utf8',
  });
  return { ok: result.status === 0, output: `${result.stdout}${result.stderr}` };
}

/**
 * The shape of every case below: the same tree, twice.
 *
 * If `clean` passes and `dirty` fails with a message naming the rule, the
 * gate has been shown to run — which is the whole point of the file.
 */
function proves(gate: string, options: { clean: Record<string, string>; dirty: Record<string, string>; says: RegExp; copies?: string[] }): void {
  const passing = run(gate, fixture(options.clean, options.copies));
  assert.ok(passing.ok, `${gate} failed on a clean tree, so the case below proves nothing:\n${passing.output}`);

  const failing = run(gate, fixture({ ...options.clean, ...options.dirty }, options.copies));
  assert.ok(!failing.ok, `${gate} PASSED a deliberate violation:\n${failing.output}`);
  assert.match(failing.output, options.says, `${gate} objected, but not about the rule under test:\n${failing.output}`);
}

const TOKENS = ['design-system/lian-tokens.css', 'packages/design/src/tokens/lian-type-roles.css'];

describe('every gate objects to a deliberate violation (LESSONS §15)', () => {
  test('boundaries: a capability importing the prompt (§13)', () => {
    proves('boundaries', {
      clean: { 'packages/capabilities/src/thing.ts': `import { plan } from '@lian/domain';\nexport const x = plan;\n` },
      dirty: { 'packages/capabilities/src/thing.ts': `import { assemblePrompt } from '@lian/prompt';\nexport const x = assemblePrompt;\n` },
      says: /may not import 'prompt'|LESSONS §13/,
    });
  });

  test('boundaries: a package whose name has a digit is still checked', () => {
    // The bug this file was written for. `@lian/i18n` must be checked like
    // anything else, and a pattern of [a-z]+ silently skips it.
    proves('boundaries', {
      clean: { 'packages/db/src/thing.ts': `import { x } from '@lian/domain';\nexport const y = x;\n` },
      dirty: { 'packages/db/src/thing.ts': `import { t } from '@lian/i18n';\nexport const y = t;\n` },
      says: /'db' may not import 'i18n'/,
    });
  });

  test('boundaries: SQL outside @lian/db (§11)', () => {
    proves('boundaries', {
      clean: { 'packages/runtime/src/thing.ts': `export const q = 'nothing to see';\n` },
      dirty: { 'packages/runtime/src/thing.ts': "export const q = `SELECT id FROM memories WHERE assistant_id = $1`;\n" },
      says: /SQL outside @lian\/db/,
    });
  });

  test('analysis:path: a system prompt outside the two sanctioned places (§1)', () => {
    proves('analysis-path', {
      clean: { 'packages/runtime/src/thing.ts': `export const note = 'short';\n` },
      dirty: {
        'packages/runtime/src/thing.ts':
          "export const system = `You are a careful assistant who reads what the person said and returns a JSON array of the things worth keeping, with no commentary at all.`;\n",
      },
      says: /a system prompt outside the two sanctioned places/,
      copies: ['packages/analysis/src/prompts.ts'],
    });
  });

  test('db:scoping: a query that does not filter on its scope column (§11)', () => {
    proves('db-scoping', {
      clean: {
        'packages/db/src/repositories/thing.ts':
          "export const q = `SELECT id FROM memories WHERE assistant_id = $1 AND deleted_at IS NULL`;\n",
      },
      dirty: {
        'packages/db/src/repositories/thing.ts':
          "export const q = `SELECT id FROM memories WHERE deleted_at IS NULL`;\n",
      },
      says: /without assistant_id|scoped table/,
    });
  });

  test('tokens:raw: a raw hex colour in application code (§9)', () => {
    proves('tokens-raw', {
      clean: { 'apps/web/styles/thing.css': `.a { color: var(--text); }\n` },
      dirty: { 'apps/web/styles/thing.css': `.a { color: #3B2948; }\n` },
      says: /raw hex colour/,
      copies: TOKENS,
    });
  });

  test('tokens:raw: a numeric type token in application code (the role tier)', () => {
    proves('tokens-raw', {
      clean: { 'apps/web/styles/thing.css': `.a { font-size: var(--t-body-fs); }\n` },
      dirty: { 'apps/web/styles/thing.css': `.a { font-size: var(--fs-15); }\n` },
      says: /numeric type token/,
      copies: TOKENS,
    });
  });

  test('tokens:raw: a raw shadow, which the rule once could not see', () => {
    // The lookahead in this rule backtracked past its own whitespace, so
    // `box-shadow: var(--elev-1)` — the correct spelling — was reported and
    // a literal shadow would have been reported identically. Both halves are
    // asserted here: the correct one passes, the raw one does not.
    proves('tokens-raw', {
      clean: { 'apps/web/styles/thing.css': `.a { box-shadow: var(--elev-1); }\n` },
      dirty: { 'apps/web/styles/thing.css': `.a { box-shadow: 0 10px 30px rgba(0,0,0,.1); }\n` },
      says: /raw shadow/,
      copies: TOKENS,
    });
  });

  test('tokens:audit: a token reference that resolves to nothing (§9)', () => {
    proves('tokens-audit', {
      clean: { 'apps/web/styles/thing.css': `.a { color: var(--text); }\n` },
      dirty: { 'apps/web/styles/thing.css': `.a { color: var(--nothing-defines-this); }\n` },
      says: /resolves to nothing/,
      copies: TOKENS,
    });
  });

  test('tokens:tap: an interactive control below the 44px floor', () => {
    proves('tokens-tap', {
      clean: { 'apps/web/styles/thing.css': `button { min-height: var(--tap-min); }\n` },
      dirty: { 'apps/web/styles/thing.css': `button { min-height: 32px; }\n` },
      says: /below the 44px floor|use var\(--tap-min\)/,
      copies: TOKENS,
    });
  });

  test('tokens:tap: lowering the token itself', () => {
    // The subtler failure: nothing looks wrong at 40px, it just misses.
    const root = fixture({ 'apps/web/styles/thing.css': `button { min-height: var(--tap-min); }\n` }, TOKENS);
    const tokens = join(root, 'design-system/lian-tokens.css');
    writeFileSync(tokens, `:root { --tap-min:40px; }\n`);
    const result = run('tokens-tap', root);
    assert.ok(!result.ok, 'the floor can be lowered without the gate noticing');
    assert.match(result.output, /below the 44px floor/);
  });

  test('tokens:contrast: a text pair under 4.5:1 (§9)', () => {
    const root = fixture({}, TOKENS);
    // Muted text, moved to something that fails against the canvas it sits on.
    const tokens = join(root, 'design-system/lian-tokens.css');
    const source = spawnSync('cat', [tokens], { encoding: 'utf8' }).stdout;
    writeFileSync(tokens, source.replace('--day-muted:#6B5B76', '--day-muted:#C9C1D7'));
    const result = run('tokens-contrast', root);
    assert.ok(!result.ok, 'a failing contrast pair passed');
    assert.match(result.output, /4\.5|contrast/i);
  });

  test('theme:single-writer: a second place writing the theme (§7)', () => {
    proves('theme-single-writer', {
      clean: { 'apps/web/src/thing.ts': `export const x = 1;\n` },
      dirty: { 'apps/web/src/thing.ts': `export const go = () => document.documentElement.setAttribute('data-t', 'night');\n` },
      says: /writes the theme attribute|writes a root attribute/,
      copies: ['packages/design/src/theme/apply.ts', 'packages/design/src/theme/resolve.ts', 'design-system/lian-tokens.css'],
    });
  });

  test('theme:single-writer: a colour assigned at runtime (§7)', () => {
    proves('theme-single-writer', {
      clean: { 'apps/web/src/thing.ts': `export const x = 1;\n` },
      dirty: { 'apps/web/src/thing.ts': `export const paint = (node: HTMLElement) => { node.style.background = 'var(--canvas)'; };\n` },
      says: /assigns a colour at runtime/,
      copies: ['packages/design/src/theme/apply.ts', 'packages/design/src/theme/resolve.ts', 'design-system/lian-tokens.css'],
    });
  });

  test('voice:cache: a second write path for audio (§8)', () => {
    proves('voice-cache', {
      clean: { 'packages/runtime/src/thing.ts': `export const x = 1;\n` },
      dirty: { 'packages/runtime/src/thing.ts': `export const save = async (cache: { put(v: unknown): Promise<void> }) => cache.put({});\n` },
      says: /writes to the voice cache/,
    });
  });

  test('arabic:address: Arabic written straight into a screen (§10)', () => {
    proves('arabic-address', {
      clean: { 'apps/web/src/thing.ts': `export const label = 'Settings';\n` },
      dirty: { 'apps/web/src/thing.ts': `export const label = 'الإعدادات';\n` },
      says: /Arabic outside the catalogue/,
    });
  });

  test('arabic:address: a second-person verb addressed to the user (§10)', () => {
    // The catalogue is imported by the gate rather than read from the tree,
    // so this plants the violation in front of the rule itself.
    const found = addressViolations('إنت عايز تكمل؟', 'user');
    assert.ok(found.length > 0, 'a second-person predicate addressed to the user was not caught');
    assert.match(found[0]!.why, /gender/);
    // And the same words spoken TO HER are correct, so the rule is about
    // direction of address rather than about letters.
    assert.deepEqual(addressViolations('أنا عايزة أكمل', 'assistant'), []);
  });

  test('lessons:index: a lesson with no test (§14)', () => {
    proves('lessons-index', {
      clean: { 'LESSONS.md': '# LESSONS\n\n## 1. Prompt assembly\n\nSomething.\n' },
      dirty: { 'LESSONS.md': '# LESSONS\n\n## 1. Prompt assembly\n\nSomething.\n\n## 99. A brand new lesson\n\nUncovered.\n' },
      says: /§99|no coverage|not covered/i,
      copies: [
        'packages/prompt/src/assemble.ts', 'packages/prompt/src/assemble.test.ts',
        'packages/runtime/src/turn.test.ts', 'tools/gates/boundaries.ts',
        'packages/analysis/src/prompts.ts', 'tools/gates/analysis-path.ts',
      ],
    });
  });
});
