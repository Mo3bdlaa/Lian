// GATE: Arabic never assumes the user's gender (LESSONS §10).
//
// DECISIONS §30 records what happened when this was claimed rather than
// checked: "This was claimed here before it was true: a review of all 652
// Arabic strings found 38 that broke it."  So it is checked, on every commit,
// by importing the catalogue rather than regexing a source file.
//
// The rule is about DIRECTION OF ADDRESS, not letters — which is why every
// entry declares an addressee, and why feminine forms spoken to Lian pass.
import { report, type Violation } from './lib.ts';
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

console.log(`  ${checked} Arabic string(s) checked, ${addressedToUser} of them addressed to the user`);
report('arabic:address', violations, checked);
