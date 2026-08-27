// GATE: nothing is declared in one place and connected in none.
//
// LESSONS §20.  The eighth run found three of these in one afternoon, all
// with the same shape and all invisible to every other gate:
//
//   - `conversations.scenario_text`, its CHECK constraint, the prompt block
//     that renders it, its zone, and an injection test — with no way for a
//     person to set it.  The feature had five of its six parts.
//   - `story_events`, with the three types UI-UX §8 names and an index, and
//     no repository, route or screen.  The coverage matrix said ✅.
//   - `/settings/language` in ROUTES, and no case in screenFor, so it
//     rendered the CONVERSATION with the address bar still saying
//     /settings/language — and it is where the onboarding capture chip
//     points, so it was the first correction a new person was offered.
//
// Each of those looks finished from wherever you happen to be standing.  A
// migration reviewer sees a table; a prompt reviewer sees a block; a router
// reviewer sees a route.  Nothing reads across the seam, so nothing objects.
//
// This gate reads across two seams:
//
//   1. every table a migration creates is named by @lian/db
//   2. every route in ROUTES has a case in screenFor
//
// It is deliberately narrow.  It does not know what "wired" means in general
// and does not try — it knows two specific seams where the product has
// actually shipped a hole, and a gate that is honest about its scope is worth
// more than one that claims to be a graph analyser.
//
// Exemptions are named, printed on every run, and each says why.  A table
// with no repository is allowed to exist; it is not allowed to exist by
// accident.
import { walk, rel, read, report, ROOT, type Violation } from './lib.ts';
import { readdirSync } from 'node:fs';

/**
 * Tables that deliberately have no repository, with the reason.
 *
 * Printed every run.  `story_events` is here rather than absent because the
 * timeline is a real, unbuilt feature and this is the list that says so out
 * loud — see docs/FIRST-IMPRESSIONS.md and HANDOFF.
 */
const TABLES_WITHOUT_A_REPOSITORY: Record<string, string> = {
  story_events:
    "UI-UX §8's timeline is NOT BUILT. The table has held its three types since "
    + 'migration 0001 and nothing has ever written a row. Kept because the schema is '
    + 'right and the feature is wanted; listed because a coverage matrix said ✅.',
};

const violations: Violation[] = [];
const exemptions: string[] = [];

// ── seam 1: tables ─────────────────────────────────────────────────────────

const migrations = `${ROOT}/packages/db/migrations`;
const tables = new Map<string, string>();
for (const file of readdirSync(migrations).filter((name) => name.endsWith('.sql')).sort()) {
  for (const match of read(`${migrations}/${file}`).matchAll(/CREATE TABLE (?:IF NOT EXISTS )?([a-z_]+)/gi)) {
    tables.set(match[1]!.toLowerCase(), `packages/db/migrations/${file}`);
  }
}

// Everything @lian/db is, in one string. A table is "wired" if any of it
// names the table — a repository, the migration runner, or the scope list's
// own declaration that a table is unscoped on purpose.
const dbFiles = walk(`${ROOT}/packages/db/src`, ['.ts']).filter((file) => !file.endsWith('.test.ts'));
const dbSource = dbFiles.map((file) => read(file)).join('\n');
// The scope lists name every table by design, so they cannot be the evidence
// that one is used — a table added to them and nowhere else is exactly the
// hole this looks for.
const scopeless = dbFiles
  .filter((file) => !file.endsWith('/scope.ts'))
  .map((file) => read(file))
  .join('\n');

for (const [table, where] of tables) {
  const named = new RegExp(`\\b${table}\\b`).test(scopeless);
  const reason = TABLES_WITHOUT_A_REPOSITORY[table];
  if (named) {
    if (reason !== undefined) {
      violations.push({
        file: 'tools/gates/wired.ts', line: 1,
        message: `'${table}' is listed as having no repository, and something in @lian/db names it now. `
          + 'Remove it from TABLES_WITHOUT_A_REPOSITORY — a stale exemption is how the next one hides.',
      });
    }
    continue;
  }
  if (reason !== undefined) {
    exemptions.push(`${table.padEnd(22)} ${reason}`);
    continue;
  }
  violations.push({
    file: where, line: 1,
    message: `table '${table}' is created by a migration and named by no repository. `
      + 'Either something should read or write it, or it belongs in '
      + 'TABLES_WITHOUT_A_REPOSITORY in tools/gates/wired.ts with the reason.',
  });
}

// A table that is in neither list would mean the scope gate and this one
// disagree about what exists; asserted rather than assumed.
if (tables.size === 0) {
  violations.push({ file: 'packages/db/migrations', line: 1, message: 'no CREATE TABLE found — this gate is looking in the wrong place' });
}
void dbSource;

// ── seam 2: routes ─────────────────────────────────────────────────────────

const routerPath = `${ROOT}/apps/web/src/router.ts`;
const mainPath = `${ROOT}/apps/web/src/main.ts`;
const router = read(routerPath);
const main = read(mainPath);

const declared = new Map<string, string>();
for (const match of router.matchAll(/\{\s*pattern:\s*'([^']+)',\s*screen:\s*'([a-zA-Z]+)'\s*\}/g)) {
  declared.set(match[2]!, match[1]!);
}

// screenFor's switch, and the entry screens, which are rendered before there
// is an account and so never reach it.
const screenFor = main.slice(main.indexOf('function screenFor'));
const handled = new Set<string>();
for (const match of screenFor.matchAll(/case '([a-zA-Z]+)':/g)) handled.add(match[1]!);
// ENTRY is a record literal whose keys are screen names, in three forms:
// shorthand (`welcome,`), named (`resetPassword,`) and arrow-valued
// (`consent: (state) => …`). Rather than parse three shapes, a screen counts
// as handled if its NAME appears anywhere in the literal at all. That can
// only fail in the safe direction: a name appearing solely as a VALUE there
// would mean it is the renderer for an entry screen, which is the thing being
// checked for.
const entryStart = main.indexOf('const ENTRY');
const entry = main.slice(entryStart, main.indexOf('\n};', entryStart));
// The conversation is the default arm, which is correct FOR THE CONVERSATION.
handled.add('chat');

if (declared.size === 0 || handled.size <= 1) {
  violations.push({ file: 'tools/gates/wired.ts', line: 1, message: 'could not read ROUTES or screenFor — this gate is looking in the wrong place' });
}

for (const [screen, pattern] of declared) {
  if (handled.has(screen) || new RegExp(`\\b${screen}\\b`).test(entry)) continue;
  violations.push({
    file: rel(routerPath), line: 1,
    message: `'${pattern}' declares screen '${screen}' and screenFor has no case for it, `
      + 'so it falls to the default and renders the CONVERSATION with that path in the address bar. '
      + 'Either give it a case in apps/web/src/main.ts, or take the route out.',
  });
}

if (exemptions.length > 0) {
  console.log(`  ${exemptions.length} table(s) deliberately without a repository:`);
  for (const line of exemptions) console.log(`    ${line}`);
}
console.log(`  ${tables.size} table(s), ${declared.size} route(s)`);
report('wired', violations, tables.size + declared.size);
