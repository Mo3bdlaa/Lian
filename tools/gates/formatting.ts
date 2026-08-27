// GATE: formatting for a reader happens in exactly one place.
//
// LESSONS §22.  Two files formatted dates and money for a person, and they
// disagreed — which is not a bug in either of them, it is a bug in there
// being two:
//
//   a capture chip read `AED 400 · gym · 2026-08-24`, three lines under a
//   day separator that said "25 August", because the chip had no formatter
//   and printed the column
//
//   `AED 127.50` rendered as `AED 127.5` in the Money headline, because the
//   client's formatter carried `minimumFractionDigits: 0`
//
// Both were found by LOOKING at a screenshot. Neither was findable in a test,
// because each call site was internally consistent and every assertion used
// `AED 400` — the one amount where two decimals and zero decimals agree.
//
// THE DISTINCTION THIS GATE MAKES, which is the whole of it: Intl is used for
// two different jobs in this product.
//
//   A CALCULATOR — `en-CA` for a YYYY-MM-DD key in a time zone, `en-US` with
//   hourCycle h23 for an hour number. The locale is FIXED because the output
//   is a machine key that must not change with who is reading. Those are
//   correct, and they are named below with the reason.
//
//   A SENTENCE — anything whose locale depends on the reader. That belongs in
//   packages/i18n/src/format.ts and nowhere else.
//
// The test is the locale: a call whose locale is a literal is a calculator, a
// call whose locale is computed from a language is a sentence. So this looks
// for the second kind outside the one file.
//
// AND FOR THE OTHER KIND, which the first version of this gate could not see.
// It watched for a SECOND `Intl` call, and the third copy of money formatting
// used none:
//
//     `${currency} ${(minor / 100).toFixed(2).replace(/\.00$/, '')}`
//
// which put `AED 400` in Latin digits inside an Arabic capture chip, three
// lines under a bubble reading ٤٠٠ درهم and beside a date in Eastern
// numerals. A gate that only knows one spelling of the mistake catches the
// mistake it was written for and nothing else — so `toFixed` is checked too,
// because it is what a hand-rolled number formatter is made of.
import { walk, rel, read, lineOf, report, ROOT, type Violation } from './lib.ts';

/** The one file allowed to format for a reader. */
const HOME = 'packages/i18n/src/format.ts';

/**
 * Intl calls whose locale is FIXED on purpose, and why.
 *
 * Each is a calculator. A fixed locale here is not an oversight — it is what
 * makes the output stable, and changing it would move somebody's day boundary
 * or their quiet hours.
 */
const CALCULATORS: Record<string, string> = {
  'packages/domain/src/time.ts':
    "the day key and the local hour. `en-CA` gives YYYY-MM-DD and `en-US` + hourCycle h23 gives 0–23; "
    + 'both are machine keys, and a reader-dependent locale would move somebody\'s midnight.',
  'packages/prompt/src/assemble.ts':
    'the local day and hour written into the environment block. The MODEL reads these, not a person.',
  'packages/runtime/src/adapters.ts': 'the day key an event is filed under.',
  'packages/jobs/src/wiring.ts': 'the day key an outreach is filed under.',
  'apps/web/src/format.ts':
    'dayOf() compares against the BROWSER\'s idea of today in the viewer\'s time zone. The comparison '
    + 'is a machine key; the formatting it delegates to @lian/i18n.',
};

/**
 * Hand-rolled number formatting whose output is NOT read by a person, and why.
 *
 * Same distinction as CALCULATORS above, for the other spelling. `toFixed`
 * is fine when the string is a machine key or is read by the model; it is
 * never fine in something somebody reads, because it knows nothing about
 * their digits, their separator or their currency's precision.
 */
const FIXED_POINT: Record<string, string> = {
  'packages/analysis/src/embed.ts':
    'serialising a vector for pgvector. The consumer is Postgres.',
  'packages/analysis/src/receipt.ts':
    'describeReading, whose only consumer is the attachment block in the prompt. The MODEL reads it.',
  'packages/capabilities/src/money/index.ts':
    'forTheModel(), the monthly total in the environment block. The MODEL reads it; the chip beside '
    + 'it goes through @lian/i18n, and that split is the whole of LESSONS §22.',
};

/** `x.toFixed(` — the primitive a hand-rolled number formatter is built on. */
const TO_FIXED = /\.toFixed\s*\(/g;

const violations: Violation[] = [];
const exemptions: string[] = [];
const files = walk(`${ROOT}/packages`, ['.ts']).concat(walk(`${ROOT}/apps`, ['.ts']))
  .filter((file) => !file.endsWith('.test.ts'));

// `new Intl.X(` and the argument that follows, which is the locale.
const INTL = /new Intl\.(DateTimeFormat|NumberFormat|RelativeTimeFormat|ListFormat|PluralRules)\s*\(\s*([^,)]*)/g;

let checked = 0;
for (const file of files) {
  const path = rel(file);
  if (path === HOME) continue;
  const source = read(file);
  const calls = [...source.matchAll(INTL)];
  if (calls.length === 0) continue;

  const reason = CALCULATORS[path];
  if (reason !== undefined) {
    exemptions.push(`${path.padEnd(40)} ${reason}`);
    continue;
  }
  // Counted only for files that are NOT exempt, or the line below reports
  // the exemptions twice — once by name and once as "other".
  checked += 1;

  for (const call of calls) {
    const locale = (call[2] ?? '').trim();
    // A quoted literal is a calculator in a file that has not declared itself
    // one — still worth objecting to, because the NEXT reader-facing call
    // will be added beside it.
    const kind = /^['"`]/.test(locale) ? 'a fixed locale' : `a locale computed from \`${locale.slice(0, 40)}\``;
    violations.push({
      file: path, line: lineOf(source, call.index),
      message: `Intl with ${kind}, outside ${HOME}. `
        + 'Formatting a date, a time, an amount or a count for a READER belongs in that one file — '
        + 'two places that do it will disagree, and the way that is found is by looking at a '
        + 'screenshot rather than by a failing test. If this is a CALCULATOR (a machine key whose '
        + 'locale is fixed on purpose), add the file to CALCULATORS in tools/gates/formatting.ts '
        + 'with the reason.',
    });
  }
}

// ── the other spelling ─────────────────────────────────────────────────────

let fixedPoint = 0;
for (const file of files) {
  const path = rel(file);
  if (path === HOME) continue;
  const source = read(file);
  const calls = [...source.matchAll(TO_FIXED)];
  if (calls.length === 0) continue;

  const reason = FIXED_POINT[path];
  if (reason !== undefined) {
    exemptions.push(`${path.padEnd(40)} ${reason}`);
    continue;
  }
  fixedPoint += 1;
  for (const call of calls) {
    violations.push({
      file: path, line: lineOf(source, call.index),
      message: `toFixed() outside ${HOME}. If this number is READ BY A PERSON it belongs in that `
        + 'file: toFixed knows nothing about their digits (٤٠٠ vs 400), their decimal separator, or '
        + "their currency's own precision, and a hand-rolled formatter is invisible to the Intl half "
        + 'of this gate — which is exactly how `AED 400` ended up inside an Arabic chip. If it is a '
        + 'machine key or something the MODEL reads, add the file to FIXED_POINT in '
        + 'tools/gates/formatting.ts with the reason.',
    });
  }
}

if (exemptions.length > 0) {
  console.log(`  ${exemptions.length} file(s) using Intl as a calculator:`);
  for (const line of exemptions) console.log(`    ${line}`);
}
console.log(`  ${checked} other file(s) with an Intl call, ${fixedPoint} with a hand-rolled one`);
report('formatting', violations, checked + fixedPoint + exemptions.length);
