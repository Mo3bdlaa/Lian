// GATE: every query against a scoped table filters on its scope column.
//
// LESSONS §11: "Access paths that read one user's data from another context
// are a deliberate decision with legal weight, and must be decided explicitly
// rather than inherited."  A missing WHERE is how one gets inherited.
//
// So this is not a review item.  Every SQL string in @lian/db is parsed for
// the tables it touches; if a table is user- or assistant-scoped, the query
// must constrain that column (or, for INSERT, supply it).
import { walk, rel, read, lineOf, report, ROOT, type Violation } from './lib.ts';
import { USER_SCOPED_TABLES, ASSISTANT_SCOPED_TABLES, UNSCOPED_TABLES } from '../../packages/db/src/scope.ts';

const userScoped = new Set<string>(USER_SCOPED_TABLES);
const assistantScoped = new Set<string>(ASSISTANT_SCOPED_TABLES);
const unscoped = new Set<string>(UNSCOPED_TABLES);

/** Template literals and quoted strings that look like SQL. */
function sqlLiterals(source: string): { text: string; index: number }[] {
  const out: { text: string; index: number }[] = [];
  const re = /`([^`]*)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const text = m[1]!;
    if (/\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b/i.test(text)) out.push({ text, index: m.index });
  }
  return out;
}

/** `DO UPDATE SET` is not a table named "set"; a CTE is not a table at all. */
const SQL_NOISE = new Set(['set', 'values', 'select']);

function tablesIn(sql: string): string[] {
  const cte = new Set<string>();
  for (const m of sql.matchAll(/(?:\bWITH|,)\s+([a-z_][a-z0-9_]*)\s+AS\s*\(/gi)) cte.add(m[1]!.toLowerCase());
  const names = new Set<string>();
  for (const m of sql.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_][a-z0-9_]*)/gi)) {
    const name = m[1]!.toLowerCase();
    if (SQL_NOISE.has(name) || cte.has(name)) continue;
    names.add(name);
  }
  return [...names];
}

const violations: Violation[] = [];
const files = walk(`${ROOT}/packages/db/src`, ['.ts']).filter((f) => !f.endsWith('.test.ts'));
let queries = 0;

for (const file of files) {
  const path = rel(file);
  const source = read(file);
  for (const { text, index } of sqlLiterals(source)) {
    queries++;
    const line = lineOf(source, index);
    const isInsert = /^\s*INSERT\s+INTO/i.test(text);
    for (const table of tablesIn(text)) {
      if (unscoped.has(table)) continue;
      const scopeColumn = assistantScoped.has(table) ? 'assistant_id' : userScoped.has(table) ? 'user_id' : null;
      if (scopeColumn === null) {
        if (/^(schema_migrations|information_schema|pg_.*)$/.test(table)) continue;
        violations.push({ file: path, line, message: `table '${table}' is in no scope list — add it to packages/db/src/scope.ts, deliberately` });
        continue;
      }
      const constrained = isInsert
        ? new RegExp(`\\b${scopeColumn}\\b`).test(text)
        : new RegExp(`\\b${scopeColumn}\\s*=\\s*\\$`).test(text) || new RegExp(`\\b[a-z]\\.${scopeColumn}\\s*=\\s*\\$`).test(text);
      if (!constrained) {
        violations.push({
          file: path, line,
          message: `query touches scoped table '${table}' without ${scopeColumn} — one user's data must never be reachable from another context (LESSONS §11)\n      ${text.trim().split('\n')[0]!.slice(0, 90)}`,
        });
      }
    }
  }
}

console.log(`  ${queries} query literal(s) across ${files.length} repository file(s)`);
report('db:scoping', violations, files.length);
