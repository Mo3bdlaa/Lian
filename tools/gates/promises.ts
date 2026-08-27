// GATE: she may not promise what nothing performs.
//
// LESSONS §21.  The product's design is that she speaks for the machinery,
// which makes every seam between what she SAYS and what something else DOES a
// place she can be made to lie — warmly, in the first person, with nothing
// red anywhere.
//
// It happened, and in the worst possible place:
//
//     "remind me to call the bank"  →  "I'll remind you."
//
// A `<todo>` with no date stored `due_on NULL`, which matched no outreach
// query and no briefing block. No reminder would ever have fired. Every part
// was individually correct — the capture, the row, the chip, the screen — and
// the one sentence the product exists to make true was false the first time
// somebody asked for it.
//
// So: packages/domain/src/promises.ts is the list, and this is the rule.
//
//   1. Every capability TAG is classified — records, or commits. A tag added
//      without a classification fails the build, so a new promise cannot be
//      introduced without saying what keeps it.
//   2. Every commitment names a MECHANISM, and the marker proves the
//      mechanism is still there. Deleting the scheduler breaks the build
//      rather than breaking a promise.
//   3. Every promise-shaped SENTENCE in the catalogue is classified the same
//      way, in both directions: a listed key that no longer exists fails, and
//      a new "I'll…" that is not listed fails.
//
// It cannot know that a mechanism WORKS — that is what tests are for. What it
// can do is make it impossible for a promise and its mechanism to drift apart
// silently, which is the failure that actually happened.
import { read, report, ROOT, type Violation } from './lib.ts';
import { TAG_PROMISES, COPY_PROMISES } from '../../packages/domain/src/promises.ts';
import { REGISTRY } from '../../packages/capabilities/src/registry.ts';
import { CATALOG } from '../../packages/i18n/src/catalog.ts';

const violations: Violation[] = [];
const PROMISES_FILE = 'packages/domain/src/promises.ts';

// ── 1. every tag is classified, in both directions ─────────────────────────

const declaredTags = new Set(REGISTRY.flatMap((capability) => capability.tags.map((tag) => tag.name)));

for (const name of declaredTags) {
  if (TAG_PROMISES[name] === undefined) {
    violations.push({
      file: PROMISES_FILE, line: 1,
      message: `the tag '${name}' is not classified. Add it to TAG_PROMISES as 'records' `
        + '(it writes down something that already happened) or as \'commits\' with the mechanism '
        + 'that performs it. A tag she can emit is a thing she can say she has done.',
    });
  }
}
for (const name of Object.keys(TAG_PROMISES)) {
  if (!declaredTags.has(name)) {
    violations.push({
      file: PROMISES_FILE, line: 1,
      message: `'${name}' is classified as a tag and no capability declares it. `
        + 'Remove it — a stale entry is how the list stops describing the product.',
    });
  }
}

// ── 2. every commitment's mechanism is still there ─────────────────────────

for (const [name, promise] of [...Object.entries(TAG_PROMISES), ...Object.entries(COPY_PROMISES)]) {
  if (promise.kind !== 'commits') continue;
  for (const mechanism of promise.by) {
    let source: string;
    try {
      source = read(`${ROOT}/${mechanism.where}`);
    } catch {
      violations.push({
        file: PROMISES_FILE, line: 1,
        message: `'${name}' promises "${promise.says}" and names ${mechanism.where}, which does not exist. `
          + 'Either the mechanism moved and this should point at where it went, or it is gone and SHE MUST STOP SAYING IT.',
      });
      continue;
    }
    if (!mechanism.marker.test(source)) {
      violations.push({
        file: mechanism.where, line: 1,
        message: `'${name}' promises "${promise.says}", and the thing that performs it `
          + `(${String(mechanism.marker)}) is no longer in this file. `
          + 'A promise whose mechanism has been refactored away is a promise she still makes and nothing keeps.',
      });
    }
  }
}

// ── 3. promise-shaped copy is classified ───────────────────────────────────
//
// A denylist of the shapes that actually occur, not a grammar. It is checked
// against the ENGLISH, because the Arabic is authored beside it and a pattern
// that worked on both would be a worse pattern on each.

/**
 * First person, in her voice, about something she does or will do.
 *
 * The future half was the obvious half. The PRESENT half was added because
 * this gate let through the first sentence anybody reads from her — "I keep
 * track of what you tell me, and bring it back when it matters" — which is a
 * standing commitment with two mechanisms behind it and no "I'll" anywhere.
 * A promise does not have to be in the future tense to be a promise.
 *
 * A denylist of forms that actually occur, not a grammar: six strings match
 * the present-tense half, and each one is classified.
 */
const COMMITMENT = new RegExp(
  [
    // future
    "I'll", 'I will', "I'm going to", "I'd rather", "it'll live", 'we share one',
    // present, standing
    'I keep', 'I remember', 'I bring', 'I can reach', 'I hold', 'I look after',
  ].map((form) => `\\b${form.replace(/'/g, "['’]")}\\b`).join('|'),
  'i',
);

const classifiedCopy = new Set(Object.keys(COPY_PROMISES));

for (const [key, entry] of Object.entries(CATALOG)) {
  const promiseShaped = COMMITMENT.test((entry as { en: string }).en);
  if (promiseShaped && !classifiedCopy.has(key)) {
    violations.push({
      file: 'packages/i18n/src/catalog.ts', line: 1,
      message: `'${key}' says something in the first person about the future — `
        + `"${(entry as { en: string }).en.slice(0, 70)}…" — and is not in COPY_PROMISES. `
        + 'Classify it: either it records something (say why), or it commits to something '
        + 'and must name what performs it. If nothing does, the sentence comes out.',
    });
  }
}
for (const key of classifiedCopy) {
  if (!(key in CATALOG)) {
    violations.push({
      file: PROMISES_FILE, line: 1,
      message: `'${key}' is classified as copy and is not in the catalogue any more. Remove it.`,
    });
  }
}

const commitments = [...Object.values(TAG_PROMISES), ...Object.values(COPY_PROMISES)]
  .filter((promise) => promise.kind === 'commits').length;
console.log(`  ${declaredTags.size} tag(s), ${Object.keys(CATALOG).length} string(s), ${commitments} commitment(s) with a named mechanism`);
report('promises', violations, declaredTags.size + Object.keys(CATALOG).length);
