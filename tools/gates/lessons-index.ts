// GATE: every lesson has a test, not a comment.
//
// "Every constraint in LESSONS gets a test, not a comment. A rule that isn't
// a failing build is a rule that comes back."
//
// This gate reads LESSONS.md, enumerates its sections, and requires each one
// to name at least one file that exists and contains its marker.  Adding a
// fifteenth lesson fails the build until it is covered — which is the only
// way an index like this stays true.
import { read, ROOT, report, type Violation } from './lib.ts';
import { existsSync } from 'node:fs';

type Coverage = { readonly where: string; readonly marker: RegExp };

// Section numbers are read from LESSONS.md's own headings, including
// fractional ones like §1a — a lesson added between two others should not
// have to renumber the file.
const COVERAGE: Record<string, Coverage[]> = {
  '1a': [
    { where: 'packages/domain/src/untrusted.ts', marker: /a memory can carry\s*\n?\/\/ instruction-shaped text|instruction-shaped text into the channel/ },
    { where: 'packages/runtime/src/injection.test.ts', marker: /tested as an attack rather than as a shape/ },
    { where: 'packages/domain/src/untrusted.test.ts', marker: /ordinary memories pass through unchanged/ },
    { where: 'packages/prompt/src/zones.ts', marker: /trust boundary as well as a caching decision/ },
  ],
  '1': [
    { where: 'packages/prompt/src/assemble.ts', marker: /THE ONE PATH THAT BUILDS THE SYSTEM PROMPT/ },
    { where: 'packages/prompt/src/assemble.test.ts', marker: /fault injection over every required port/ },
    { where: 'packages/runtime/src/turn.test.ts', marker: /assemble through the same path/ },
    { where: 'tools/gates/boundaries.ts', marker: /persona text outside/ },
    // The restated rule: a non-voice path is allowed, under two conditions.
    { where: 'packages/analysis/src/prompts.ts', marker: /THE NON-VOICE PROMPT PATH/ },
    { where: 'tools/gates/analysis-path.ts', marker: /reconstructs a persona|ONE CLEARLY NAMED PLACE/ },
  ],
  '2': [
    { where: 'packages/prompt/src/blocks.ts', marker: /SCENARIO_OVERRIDE_PREFIX/ },
    { where: 'packages/prompt/src/assemble.test.ts', marker: /the scenario states that it overrides/ },
  ],
  '3': [
    { where: 'packages/llm/src/tagstream.ts', marker: /tail buffer/ },
    { where: 'packages/llm/src/tagstream.test.ts', marker: /EVERY possible single split point/ },
  ],
  '4': [
    { where: 'packages/db/src/repositories/outreach.ts', marker: /unansweredStreak/ },
    { where: 'packages/jobs/src/deliver.test.ts', marker: /a real push with the real message in it/ },
    { where: 'packages/db/src/repositories/lessons.test.ts', marker: /backoff counts only her own unanswered messages/ },
    { where: 'packages/jobs/src/tick.test.ts', marker: /never silenced by backoff/ },
  ],
  '5': [
    { where: 'packages/db/src/repositories/canon.ts', marker: /Retrieval is UNCONDITIONAL/ },
    { where: 'packages/db/src/repositories/lessons.test.ts', marker: /canon is retrieved unconditionally and is never dropped/ },
    { where: 'packages/db/migrations/0003_vector_memory.sql', marker: /canon_is_never_deleted/ },
    { where: 'packages/db/src/repositories/lessons.test.ts', marker: /the database refuses to delete canon/ },
  ],
  '6': [
    { where: 'packages/domain/src/relationship.ts', marker: /STAGE_THRESHOLDS/ },
    { where: 'packages/db/src/repositories/lessons.test.ts', marker: /relationship stage cannot go backwards/ },
    { where: 'packages/runtime/src/relationship.test.ts', marker: /a digit reached the client/ },
  ],
  '7': [
    { where: 'packages/design/src/theme/resolve.ts', marker: /THIS FILE DECIDES THE THEME/ },
    { where: 'packages/design/src/theme/apply.ts', marker: /ONLY PLACE THE RUNTIME WRITES THE THEME/ },
    { where: 'tools/gates/theme-single-writer.ts', marker: /sets a CSS custom property at runtime/ },
    { where: 'packages/runtime/src/mood.test.ts', marker: /the same value picks the palette and the phrase/ },
  ],
  '8': [
    { where: 'packages/voice/src/speak.ts', marker: /THE ONLY PLACE AUDIO IS WRITTEN TO THE CACHE/ },
    { where: 'packages/voice/src/speak.test.ts', marker: /persist:false never writes/ },
    { where: 'tools/gates/voice-cache.ts', marker: /sole write path/ },
    { where: 'packages/voice/src/transcribe.ts', marker: /THE TRANSCRIPT IS THE MESSAGE BODY/ },
  ],
  '9': [
    { where: 'tools/gates/tokens-audit.ts', marker: /resolves to nothing/ },
    { where: 'tools/gates/tokens-raw.ts', marker: /raw hex colour/ },
    { where: 'tools/gates/tokens-contrast.ts', marker: /MISSING cell/ },
    { where: 'tools/gates/tokens-tap.ts', marker: /tap-min/ },
  ],
  '10': [
    { where: 'packages/i18n/src/arabic.ts', marker: /DIRECTION OF ADDRESS/ },
    { where: 'packages/i18n/src/arabic.test.ts', marker: /addressed to HER is correct and passes/ },
    { where: 'tools/gates/arabic-address.ts', marker: /addressee/ },
  ],
  '11': [
    { where: 'packages/db/src/scope.ts', marker: /deliberate decision with legal weight/ },
    { where: 'tools/gates/db-scoping.ts', marker: /without \$\{scopeColumn\}|scope predicate|scopeColumn/ },
    { where: 'packages/db/src/repositories/lessons.test.ts', marker: /one assistant cannot read another assistant memory/ },
    { where: 'packages/capabilities/src/registry.test.ts', marker: /export covers every capability/ },
    { where: 'packages/runtime/src/ownership.ts', marker: /walk the capability REGISTRY/ },
    { where: 'packages/db/src/repositories/ownership.test.ts', marker: /leaves NOTHING, in any table, checked generically/ },
  ],
  '12': [
    { where: 'packages/llm/src/keypool.ts', marker: /COOLDOWN_STATUSES/ },
    { where: 'packages/llm/src/keypool.test.ts', marker: /the pool state is in the store, not in the instance/ },
    { where: 'packages/db/src/repositories/usage.ts', marker: /not a rate limit/ },
    { where: 'packages/runtime/src/turn.test.ts', marker: /per-user model cost ceiling/ },
    { where: 'packages/jobs/src/signature.ts', marker: /HMAC/ },
    { where: 'packages/domain/src/plan.test.ts', marker: /voice is metered in both directions/ },
    { where: 'packages/runtime/src/turn.test.ts', marker: /the saving is a measured number, not a claim/ },
  ],
  '13': [
    { where: 'packages/domain/src/capability.ts', marker: /COMPOSES INTO THE PROMPT/ },
    { where: 'packages/capabilities/src/registry.test.ts', marker: /nothing dispatches on a capability id/ },
    { where: 'tools/gates/boundaries.ts', marker: /composes INTO the prompt/ },
    { where: 'packages/capabilities/src/capabilities.test.ts', marker: /adding a capability stayed cheap/ },
  ],
  '21': [
    { where: 'packages/domain/src/promises.ts', marker: /WHAT SHE IS ALLOWED TO PROMISE/ },
    { where: 'tools/gates/promises.ts', marker: /she may not promise what nothing performs/ },
    { where: 'tools/gates/gates.test.ts', marker: /every tag is classified, in both directions/ },
    { where: 'apps/server/src/http.test.ts', marker: /a task with no day is still somewhere she will raise it/ },
  ],
  '20': [
    { where: 'tools/gates/wired.ts', marker: /nothing is declared in one place and connected in none/ },
    { where: 'tools/gates/gates.test.ts', marker: /a route with no screen renders the CONVERSATION/ },
    { where: 'packages/llm/src/pooled.ts', marker: /validated at startup, and\s*\n?\/\/ discarded|LESSONS §12's rotation, finally connected/ },
    { where: 'docs/FIRST-IMPRESSIONS.md', marker: /./ },
  ],
  '19': [
    { where: 'packages/db/src/repositories/usage.ts', marker: /THE INSERT NEEDS ITS OWN GUARD/ },
    { where: 'packages/db/src/repositories/limits.ts', marker: /the way somebody closes a route in a hurry/ },
    { where: 'packages/db/src/repositories/lessons.test.ts', marker: /the FIRST reservation of a period is bounded too/ },
    { where: 'apps/server/src/attachments.test.ts', marker: /The test proving voice worked was the test\s*\n?\s*\/\/ proving the leak|proving the leak/ },
  ],
  '18': [
    { where: 'packages/db/src/repositories/auth.ts', marker: /Revoke a device, and say whether one actually was/ },
    { where: 'apps/server/src/hardening.test.ts', marker: /a stranger could \$\{attempt\.what\}|written by someone trying to get at somebody/ },
  ],
  '17': [
    { where: 'packages/db/src/repositories/conversations.ts', marker: /SCOPED BY ASSISTANT, not only by user/ },
    { where: 'apps/server/src/hardening.test.ts', marker: /every id-bearing route refuses a stranger/ },
  ],
  '16': [
    { where: 'packages/db/src/repositories/outreach.ts', marker: /ORDER BY is not decoration/ },
    { where: 'packages/jobs/src/reflect.ts', marker: /applied after a LIMIT is how a job silently serves/ },
    { where: 'packages/jobs/src/candidates.test.ts', marker: /a filter after a LIMIT starves the tail/ },
    { where: 'packages/jobs/src/candidates.test.ts', marker: /does not move the cursor past what it dropped/ },
    // The general form, as far as it can be checked mechanically.
    { where: 'tools/gates/db-paging.ts', marker: /a LIMIT is a page, not a sample/ },
    { where: 'tools/gates/gates.test.ts', marker: /db:paging: a LIMIT with no ORDER BY/ },
  ],
  '15': [
    // The lesson is the test file, so the marker is the failing case itself.
    { where: 'tools/gates/gates.test.ts', marker: /PASSED a deliberate violation/ },
    { where: 'tools/gates/gates.test.ts', marker: /failed on a clean tree, so the case below proves nothing/ },
    { where: 'tools/gates/lib.ts', marker: /a gate that has never been shown to fail|LIAN_GATE_ROOT/ },
  ],
  '14': [
    // Scope discipline is mostly a matter of what does NOT exist.  What can
    // be checked is checked: no calendar anywhere, separate memory per
    // assistant, and no relationship score crossing the network.
    { where: 'packages/prompt/src/personas/female.en.ts', marker: /You have no calendar access/ },
    { where: 'packages/domain/src/relationship.ts', marker: /must never cross the network/ },
    { where: 'packages/db/src/repositories/lessons.test.ts', marker: /separate memory, no shared awareness/ },
  ],
};

const lessons = read(`${ROOT}/LESSONS.md`);
const sections = [...lessons.matchAll(/^## (\d+[a-z]?)\.\s+(.+)$/gm)].map((m) => ({ number: m[1]!, title: m[2]!.trim() }));

const violations: Violation[] = [];
const rows: string[] = [];

if (sections.length === 0) violations.push({ file: 'LESSONS.md', line: 0, message: 'no numbered sections found — has the format changed?' });

for (const section of sections) {
  const coverage = COVERAGE[section.number];
  if (coverage === undefined || coverage.length === 0) {
    violations.push({
      file: 'LESSONS.md', line: 0,
      message: `§${section.number} "${section.title}" has no test.  Every constraint gets a test, not a comment — add one and map it in tools/gates/lessons-index.ts.`,
    });
    continue;
  }
  const missing: string[] = [];
  for (const entry of coverage) {
    const path = `${ROOT}/${entry.where}`;
    if (!existsSync(path)) { missing.push(`${entry.where} (no such file)`); continue; }
    if (!entry.marker.test(read(path))) missing.push(`${entry.where} (no longer contains ${entry.marker})`);
  }
  if (missing.length > 0) {
    violations.push({ file: 'LESSONS.md', line: 0, message: `§${section.number} "${section.title}" lost its cover: ${missing.join(', ')}` });
  }
  rows.push(`  §${String(section.number).padStart(2)} ${section.title.padEnd(28)} ${coverage.length} file(s)`);
}

console.log(`  ${sections.length} lesson(s) in LESSONS.md`);
for (const row of rows) console.log(row);
report('lessons:index', violations, sections.length);
