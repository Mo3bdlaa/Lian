// GATE: Arabic never assumes the user's gender (LESSONS §10).
//
// DECISIONS §30 records what happened when this was claimed rather than
// checked: "This was claimed here before it was true: a review of all 652
// Arabic strings found 38 that broke it."  So it is checked, on every commit,
// by importing the catalogue rather than regexing a source file.
//
// The rule is about DIRECTION OF ADDRESS, not letters — which is why every
// entry declares an addressee, and why feminine forms spoken to Lian pass.
import { report, walk, rel, read, lineOf, stripComments, ROOT, type Violation } from './lib.ts';
import { CATALOG } from '../../packages/i18n/src/catalog.ts';
import { addressViolations } from '../../packages/i18n/src/arabic.ts';

const violations: Violation[] = [];
let checked = 0;
let addressedToUser = 0;

for (const [key, entry] of Object.entries(CATALOG)) {
  const variants: [string, string][] = [['ar', entry.ar]];
  if ('arMale' in entry && typeof entry.arMale === 'string') variants.push(['arMale', entry.arMale]);

  for (const [field, text] of variants) {
    checked++;
    if (entry.addressee === 'user') addressedToUser++;
    for (const violation of addressViolations(text, entry.addressee)) {
      violations.push({
        file: 'packages/i18n/src/catalog.ts',
        line: 0,
        message: `${key}.${field}: «${violation.word}» — ${violation.why}\n      ${text}`,
      });
    }
  }

  // A string that has an English form and no Arabic one is a translation pass
  // waiting to happen, which is the thing §10 rules out.
  if (entry.ar.trim() === '') {
    violations.push({ file: 'packages/i18n/src/catalog.ts', line: 0, message: `${key}: no Arabic — Arabic is a first-class language, not a later pass (LESSONS §10)` });
  }
}

// ── rule 2: a SCREEN's Arabic comes from the catalogue ────────────────────
//
// Rule 1 can only check what it can see. An Arabic label written straight
// into a screen is a string the address rule never reads, so the letters are
// not allowed in the presentation layer at all.
//
// SCOPE, decided rather than assumed: apps/ and packages/http — everything
// that renders to a person. Arabic that is addressed to the MODEL stays where
// it is: the personas (LESSONS §1 keeps persona text on one path), the
// capabilities' prompt fragments, and the Arabic word lists in affect and
// extraction. Those are not copy, and moving them into a copy catalogue would
// break the boundary that keeps them on one path.
const ARABIC = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;
const sources = [
  ...walk(`${ROOT}/apps`, ['.ts', '.tsx', '.css']),
  ...walk(`${ROOT}/packages/http`, ['.ts', '.tsx', '.css']),
].filter((file) => !file.endsWith('.test.ts'));

let scanned = 0;
for (const file of sources) {
  const path = rel(file);
  const source = read(file);
  // A pragma with a reason, printed on every run like every other exemption.
  const pragma = /arabic:allow-inline\s+—\s+(.+)/.exec(source);
  if (pragma !== null) continue;
  scanned += 1;
  const code = stripComments(source);
  for (const line of code.split('\n').entries()) {
    const [index, text] = line;
    if (!ARABIC.test(text)) continue;
    violations.push({
      file: path, line: index + 1,
      message: `Arabic outside the catalogue — add it to packages/i18n/src/catalog.ts with an addressee, or the address rule can never see it`,
    });
  }
}

console.log(`  ${checked} Arabic string(s) checked, ${addressedToUser} of them addressed to the user`);
console.log(`  ${scanned} source file(s) scanned for Arabic outside the catalogue`);
report('arabic:address', violations, checked);
