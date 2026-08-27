// GATE: a LIMIT is a page, not a sample (LESSONS §16).
//
// The general form of §16 is "any query that limits before filtering is
// reporting on its window, not on its subject". Most of that is judgement — a
// gate cannot see a filter applied downstream in TypeScript. But the sharp
// edge of it is mechanical and this is that edge:
//
//   A LIMIT with no ORDER BY returns an ARBITRARY subset. Postgres is free to
//   return the same rows every time, and on a busy table it usually will. So
//   the batch job that "processes fifty accounts a tick" processes the same
//   fifty forever, reports considered: 50, and looks healthy.
//
// This is not a style rule about determinism in tests. It is the difference
// between a job that eventually covers everyone and one that never does.
//
// Two shapes are exempt because a LIMIT means something else in them:
//   LIMIT 1 on an existence check — any row will do, by construction
//   an aggregate with no GROUP BY — there is exactly one row to return
//
// Anything else exempts itself the way db-scoping does: a pragma above the
// query, with a reason, printed on every run.
import { walk, rel, read, lineOf, report, ROOT, type Violation } from './lib.ts';

const PRAGMA = /db-paging:allow-unordered\s+—\s+(.+)/;

/** Template literals that look like SQL. */
function sqlLiterals(source: string): { text: string; index: number }[] {
  const out: { text: string; index: number }[] = [];
  const re = /`([^`]*)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const text = m[1]!;
    if (/\bSELECT\b/i.test(text)) out.push({ text, index: m.index });
  }
  return out;
}

/**
 * An aggregate with no GROUP BY returns one row whatever the ordering.
 * `count(*)`, `max(...)`, `sum(...)` and friends — checked against the SELECT
 * list rather than the whole query, so a count in a subquery beside a real
 * row-returning SELECT does not exempt the outer one.
 */
function isSingleRowAggregate(sql: string): boolean {
  const selectList = /SELECT\s+([\s\S]*?)\s+FROM\b/i.exec(sql)?.[1] ?? '';
  if (/\bGROUP\s+BY\b/i.test(sql)) return false;
  return /\b(count|sum|avg|min|max|bool_or|bool_and)\s*\(/i.test(selectList);
}

/** `LIMIT 1` where any single row is as good as another. */
const LIMIT_ONE = /\bLIMIT\s+1\b(?!\d)/i;

const violations: Violation[] = [];
const exemptions: string[] = [];
const files = walk(`${ROOT}/packages/db/src`, ['.ts']).filter((file) => !file.endsWith('.test.ts'));
let limited = 0;

for (const file of files) {
  const path = rel(file);
  const source = read(file);
  for (const { text, index } of sqlLiterals(source)) {
    if (!/\bLIMIT\b/i.test(text)) continue;
    limited += 1;
    const line = lineOf(source, index);

    const preceding = source.slice(0, index).split('\n').slice(-10).join('\n');
    const pragma = PRAGMA.exec(preceding);
    if (pragma) { exemptions.push(`${path}:${line}  ${pragma[1]!.trim()}`); continue; }

    if (LIMIT_ONE.test(text) || isSingleRowAggregate(text)) continue;
    if (/\bORDER\s+BY\b/i.test(text)) continue;

    violations.push({
      file: path, line,
      message:
        'LIMIT with no ORDER BY — that is an arbitrary sample, not a page, and a batch built on it '
        + 'serves the same rows forever while reporting the batch size as coverage (LESSONS §16)\n'
        + `      ${text.trim().split('\n')[0]!.slice(0, 90)}`,
    });
  }
}

console.log(`  ${limited} limited query/queries across ${files.length} repository file(s)`);
if (exemptions.length > 0) {
  console.log(`  ${exemptions.length} recorded unordered limit(s):`);
  for (const e of exemptions) console.log(`    ${e}`);
}
report('db:paging', violations, files.length);
