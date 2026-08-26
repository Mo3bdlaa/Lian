// GATE: module boundaries.
//
// The architecture is a dependency graph, and a graph that is only written
// down is a graph that drifts.  Three of these rules exist because LESSONS
// names the failure they prevent:
//
//   LESSONS §13 — `capabilities` may not import `prompt`.  The moment a
//                 capability can reach the persona, adding the next
//                 capability means rewriting the persona.
//   LESSONS §1  — nothing outside `prompt` may reach into its internals or
//                 carry persona text; one path builds the system prompt.
//   LESSONS §11 — SQL lives in `db` only, so scoping and deletion are
//                 enforced in one layer rather than at every call site.
import { walk, rel, read, lineOf, report, importsOf, stripComments, ROOT, type Violation } from './lib.ts';

/** Which @lian packages each package may import.  Absent = imports nothing. */
const ALLOWED: Record<string, string[]> = {
  domain: [],
  design: ['domain'],
  i18n: ['domain'],
  db: ['domain'],
  llm: ['domain'],
  // The non-voice prompt path (LESSONS §1, as restated).  It reads text and
  // returns JSON; it must never be able to name the persona.
  analysis: ['domain'],
  // prompt talks to the database through ports declared in domain, never to db
  // directly: it must stay assemblable from fakes in a unit test.
  prompt: ['domain', 'i18n'],
  // capabilities: no prompt (§13), no db (ports only).
  capabilities: ['domain', 'i18n'],
  auth: ['domain', 'i18n'],
  voice: ['domain'],
  push: ['domain'],
  // The HTTP layer is transport only: it knows about sessions and rate
  // limits, and reaches everything else through ports the app wires up.
  http: ['domain'],
  // composition roots: they wire ports to implementations.
  runtime: ['domain', 'i18n', 'design', 'prompt', 'llm', 'capabilities', 'auth', 'voice', 'db', 'analysis'],
  jobs: ['domain', 'i18n', 'prompt', 'llm', 'capabilities', 'voice', 'db', 'runtime', 'analysis', 'push'],
};

const SQL_KEYWORDS = /\b(SELECT\s+[\s\S]{0,200}?\bFROM\b|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+(TABLE|INDEX|TYPE)|ALTER\s+TABLE)\b/i;

const violations: Violation[] = [];
const files = walk(`${ROOT}/packages`, ['.ts']).concat(walk(`${ROOT}/apps`, ['.ts']));

for (const file of files) {
  const path = rel(file);
  const pkg = path.split('/')[1]!;
  const source = read(file);
  const code = stripComments(source);
  const isApp = path.startsWith('apps/');

  for (const { spec, index } of importsOf(code)) {
    const line = lineOf(code, index);

    // Cross-package deep imports: reach a package through its name only, so a
    // package's internals stay internal (§1).
    //
    // One sanctioned subpath: '@lian/<pkg>/test-fakes', and only from a test.
    // The alternative was exporting fakes from the production index, which
    // puts test scaffolding in the public API of every package — worse.  It
    // is declared in each package's exports map, so it is a real entry point
    // rather than a reach-in.
    // [a-z0-9]: '@lian/i18n' has a digit in it, and an earlier version of
    // this pattern silently skipped every import of it — a gate with a hole
    // in it reads exactly like a gate without one.
    const deep = spec.match(/^@lian\/([a-z0-9]+)\/(.+)$/);
    if (deep && deep[2] === 'test-fakes' && path.endsWith('.test.ts')) {
      continue;
    }
    // The second sanctioned subpath: '@lian/<pkg>/server' is the part of a
    // package that touches the filesystem, split out so the rest of the
    // package can be served to a browser. It is declared in the package's
    // exports map, so it is an entry point rather than a reach-in.
    if (deep && deep[2] === 'server') {
      continue;
    }
    if (deep) {
      violations.push({ file: path, line, message: `deep import '${spec}' — import '@lian/${deep[1]}' by package name; internals are internal` });
      continue;
    }
    const m = spec.match(/^@lian\/([a-z0-9]+)$/);
    if (!m) {
      // A relative import that climbs out of its own package is the same
      // violation wearing a different spelling.
      if (spec.startsWith('.') && /(^|\/)\.\.\/\.\.\/(?!.*\/src\/)/.test(spec) === false) {
        const climbs = (spec.match(/\.\.\//g) ?? []).length;
        const depth = path.split('/').length - 1;
        if (climbs >= depth - 1 && !isApp) {
          violations.push({ file: path, line, message: `relative import '${spec}' escapes its package — use '@lian/<package>'` });
        }
      }
      continue;
    }
    const target = m[1]!;
    if (isApp) continue; // apps are a composition root and may import anything
    const allowed = ALLOWED[pkg];
    if (allowed === undefined) {
      violations.push({ file: path, line, message: `package '${pkg}' has no entry in the boundary table — add one to tools/gates/boundaries.ts` });
      continue;
    }
    if (target === pkg) continue;
    if (!allowed.includes(target)) {
      const why =
        pkg === 'capabilities' && target === 'prompt'
          ? " — LESSONS §13: a capability composes INTO the prompt, it never reaches into it"
        : pkg === 'analysis' && target === 'prompt'
          ? ' — LESSONS §1: the non-voice path may not construct a persona. That is the whole condition it exists under.'
          : pkg === 'prompt' && target === 'db'
            ? ' — prompt reads through ports declared in @lian/domain so it stays testable with fakes'
            : '';
      violations.push({ file: path, line, message: `'${pkg}' may not import '${target}'${why}` });
    }
  }

  // SQL lives in @lian/db only (LESSONS §11: one layer owns scoping and deletion).
  if (pkg !== 'db' && !path.startsWith('apps/')) {
    const hit = SQL_KEYWORDS.exec(code);
    if (hit) violations.push({ file: path, line: lineOf(code, hit.index), message: `SQL outside @lian/db — repositories own every query so assistant/user scoping is enforced once` });
  }
}

// A scope built from a placeholder is not a scope.  `{ userId: '' } as
// AssistantScope` compiles, and quietly makes an assistant id sufficient to
// read a row — the inherited access path LESSONS §11 warns about.
// Both spellings: a placeholder value, and a DEFAULT that makes the argument
// optional.  The second was written by me and slipped past the first version
// of this rule, which is the argument for the rule existing.
const FAKE_SCOPE = /(userId|user_id|assistantId)\s*(:|=)\s*(''|""|`\s*`|'placeholder')/;
for (const file of files) {
  const path = rel(file);
  const code = stripComments(read(file));
  const hit = FAKE_SCOPE.exec(code);
  if (hit) {
    violations.push({
      file: path, line: lineOf(code, hit.index),
      message: 'a scope built with an empty userId — pass the real one (LESSONS §11: an access path across users is a deliberate decision, not an inherited one)',
    });
  }
}

// LESSONS §1: persona text lives in one place.  A stray copy of her voice in
// a job handler is exactly how the second assembly path grew last time.
const PERSONA_MARKERS = [/You are a secretary, more or less/, /never describe yourself as an AI/, /شغلك أقرب لسكرتير/];
for (const file of files) {
  const path = rel(file);
  if (path.startsWith('packages/prompt/src/personas/')) continue;
  const source = read(file);
  for (const marker of PERSONA_MARKERS) {
    const hit = marker.exec(source);
    if (hit) {
      violations.push({
        file: path, line: lineOf(source, hit.index),
        message: 'persona text outside packages/prompt/src/personas — one path builds the system prompt (LESSONS §1)',
      });
    }
  }
}

report('boundaries', violations, files.length);
