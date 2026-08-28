// GATE: a setting that is read is not a setting that is connected.
//
// LESSONS §25. `trustedProxies` had an environment variable, a parser, a
// validation test, documentation, and a field on `ServerOptions`. `app.ts`
// never passed it. Everything about the feature was true except that it did
// anything — every request was attributed to the socket, which meant one
// rate-limit bucket for everyone behind a proxy and no location at all.
//
// A setting looks like plumbing, so nothing in review pauses on it. And the
// test that existed asserted the WRONG END: that '2' parsed to 2, which was
// true and meant nothing.
//
// THE RULE: every field on Config is read somewhere other than config.ts.
// That is not proof it is USED correctly — only a behavioural test proves
// that, and §25 says so — but it is proof the wire exists, which is the half
// that was missing and the half a grep can see.
import { walk, rel, read, report, ROOT, type Violation } from './lib.ts';

const CONFIG = 'apps/server/src/config.ts';

/**
 * Fields that are genuinely config-internal, and why.
 *
 * Each one is read by loadConfig itself to decide something else — so a
 * requirement that it be read ELSEWHERE would be asking for a use that
 * should not exist.
 */
const INTERNAL: Record<string, string> = {
  nodeEnv: 'decides which of the checks in loadConfig are required rather than degraded.',
};

const source = read(`${ROOT}/${CONFIG}`);

/**
 * The fields of the Config type.
 *
 * Read from the type rather than from the returned object literal: the
 * literal spreads and nests, and a field that is only in the type is exactly
 * the kind of thing this is looking for.
 */
const TYPE = /export type Config = \{([\s\S]*?)\n\};/.exec(source);
if (TYPE === null) throw new Error(`could not find the Config type in ${CONFIG}`);

// `readonly name:` at any nesting depth. Nested objects (storage, stripe,
// vapid) declare their own fields, and those are read through the parent, so
// only the TOP level is required to be wired — a nested field with no reader
// is a smaller problem and one this gate would report noisily.
const TOP_LEVEL = /^  readonly ([a-zA-Z0-9_]+)\??:/gm;
const fields = [...TYPE[1]!.matchAll(TOP_LEVEL)].map((match) => match[1]!);

const consumers = walk(`${ROOT}/apps`, ['.ts'])
  .concat(walk(`${ROOT}/packages`, ['.ts']))
  .filter((file) => rel(file) !== CONFIG && !file.endsWith('.test.ts'));
const haystack = consumers.map((file) => read(file)).join('\n');

const violations: Violation[] = [];
const exempt: string[] = [];

for (const field of fields) {
  const reason = INTERNAL[field];
  if (reason !== undefined) { exempt.push(`${field.padEnd(22)} ${reason}`); continue; }
  // `config.field`, `deps.config.field`, or destructured `{ field }` from a
  // config. The last is loose on purpose: a false negative here is a setting
  // that IS wired, and this gate is about the ones that are not.
  const used = new RegExp(`\\bconfig\\.${field}\\b|\\b${field}\\b\\s*[,}]`).test(haystack);
  if (!used) {
    violations.push({
      file: CONFIG, line: 1,
      message: `\`${field}\` is on Config and nothing outside ${CONFIG} reads it. `
        + 'A setting with an environment variable, a parser, a test and documentation is still inert '
        + 'if nobody passes it — that is LESSONS §25, and the feature it belonged to did nothing for a '
        + 'whole run while everything about it was true. Wire it, or take it off Config.',
    });
  }
}

if (exempt.length > 0) {
  console.log(`  ${exempt.length} field(s) read only by loadConfig itself:`);
  for (const line of exempt) console.log(`    ${line}`);
}
console.log(`  ${fields.length} config field(s) checked`);
report('settings:wired', violations, fields.length);
