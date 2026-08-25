// GATE: token resolution (LESSONS §9, TOKENS.md §8).
//
// Auditing for raw values is not enough.  A var() pointing at a name that was
// never defined computes to nothing, and inside a shorthand the WHOLE
// declaration is dropped: `border: var(--bw-1-5) solid var(--edge)` becomes
// `0px none`, so an outline VANISHES rather than looking wrong.  Five tokens
// were missing after the design-system conversion for exactly this reason.
//
// So the check that matters is resolution, not spelling: diff every defined
// custom property against every referenced one, on every commit.
import { walk, rel, read, lineOf, report, ROOT, type Violation } from './lib.ts';
import { definedProperties, referencedProperties, TOKEN_FILE, ROLE_FILE } from './token-parse.ts';

const defined = new Set<string>([
  ...definedProperties(read(TOKEN_FILE)).keys(),
  ...definedProperties(read(ROLE_FILE)).keys(),
]);

const sources = [
  ...walk(`${ROOT}/packages`, ['.ts', '.tsx', '.css']),
  ...walk(`${ROOT}/apps`, ['.ts', '.tsx', '.css']),
];

const violations: Violation[] = [];
let referenceCount = 0;

for (const file of sources) {
  const source = read(file);
  for (const { name, index } of referencedProperties(source)) {
    referenceCount++;
    if (defined.has(name)) continue;
    // A file may define a property and reference it in the same breath.
    if (definedProperties(source).has(name)) continue;
    violations.push({
      file: rel(file),
      line: lineOf(source, index),
      message: `var(${name}) resolves to nothing — not defined in lian-tokens.css or lian-type-roles.css. Inside a shorthand this drops the whole declaration silently.`,
    });
  }
}

console.log(`  ${defined.size} defined, ${referenceCount} referenced across ${sources.length} file(s)`);
report('tokens:audit', violations, sources.length);
