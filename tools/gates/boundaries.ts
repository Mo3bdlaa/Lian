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
  // prompt talks to the database through ports declared in domain, never to db
  // directly: it must stay assemblable from fakes in a unit test.
  prompt: ['domain', 'i18n'],
  // capabilities: no prompt (§13), no db (ports only).
  capabilities: ['domain', 'i18n'],
  auth: ['domain', 'i18n'],
  voice: ['domain'],
  // composition roots: they wire ports to implementations.
  runtime: ['domain', 'i18n', 'design', 'prompt', 'llm', 'capabilities', 'auth', 'voice', 'db'],
  jobs: ['domain', 'i18n', 'prompt', 'llm', 'capabilities', 'voice', 'db', 'runtime'],
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
    const deep = spec.match(/^@lian\/([a-z]+)\/(.+)$/);
    if (deep) {
      violations.push({ file: path, line, message: `deep import '${spec}' — import '@lian/${deep[1]}' by package name; internals are internal` });
      continue;
    }
    const m = spec.match(/^@lian\/([a-z]+)$/);
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

report('boundaries', violations, files.length);
