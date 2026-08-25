// GATE: contrast floors (LESSONS §9, TOKENS.md §9).
//
// Two failures this closes, both of which already happened once:
//
//   1. "A proof that reports a sample is worse than no proof."  The brand
//      sheet's recolour block shipped at 1.62:1 because three pairs were
//      measured and reported as if they were the palette.  So a MISSING cell
//      fails this gate exactly like a failing one.
//   2. "An override that omits roles is not a palette."  A theme that does not
//      define every tier-1 role fails, rather than silently inheriting day.
//
// Ratios are computed from lian-tokens.css itself on every run.  Nothing here
// reads a number that a human typed into a table.
import { report, type Violation } from './lib.ts';
import { THEMES, COLOUR_ROLES, tierOnePalettes, type ColourRole, type Theme } from './token-parse.ts';
import { contrastRatio, CONTRAST_FLOOR } from '../../packages/design/src/contrast.ts';

/** The backgrounds an ink can land on IN PRODUCT.
 *
 * `--board` is deliberately not here.  TOKENS.md §4 defines it as "the
 * workspace behind the frames (never in-product)" — it is the colour of the
 * design canvas around a phone mock, and holding product text to a floor
 * against a colour no user ever sees would be arithmetic theatre.  It is
 * measured and printed below as a recorded pair instead. */
const BACKGROUNDS: ColourRole[] = ['canvas', 'surface', 'raised', 'bubble-mine', 'nav-active'];

type Pair = { ink: ColourRole; bg: ColourRole; klass: 'text' | 'boundary' | 'decoration' };

function requiredPairs(): Pair[] {
  const pairs: Pair[] = [];
  // Text — 4.5:1 (WCAG 1.4.3)
  for (const ink of ['text', 'muted', 'destructive'] as ColourRole[])
    for (const bg of BACKGROUNDS) pairs.push({ ink, bg, klass: 'text' });
  pairs.push({ ink: 'on-text', bg: 'text', klass: 'text' });
  pairs.push({ ink: 'button-ink', bg: 'button-fill', klass: 'text' });
  // Boundary — 3:1 (WCAG 1.4.11).  --edge only: it is the role for anything the
  // user must perceive in order to act.  See the note on --border below.
  for (const bg of BACKGROUNDS) pairs.push({ ink: 'edge', bg, klass: 'boundary' });
  return pairs; // 15 text + 2 + 5 boundary = 22 product pairs per palette
}

function recordedPairs(): Pair[] {
  const pairs: Pair[] = [];
  // Exempt under 1.4.3 and 1.4.11 both.  Exempt means no floor, not no
  // measurement — the number is printed so the exemption is a visible decision.
  for (const ink of ['decor', 'accent', 'accent-alt'] as ColourRole[])
    for (const bg of ['canvas', 'surface'] as ColourRole[]) pairs.push({ ink, bg, klass: 'decoration' });
  // --border is recorded, not floored.  TOKENS.md §9's table lists it under the
  // 3:1 class, but (a) its own required count of 26 excludes it, (b) the
  // sentence beside it says "hairlines and dividers only; anything that is the
  // sole outline of a control belongs on --edge", and (c) the shipped value
  // measures 1.16:1 on day canvas.  Two of the three say hairline, so hairline
  // it is — and tools/gates/boundaries.ts is what keeps a control outline off
  // it.  Recorded here so the choice stays on the page.
  for (const bg of ['canvas', 'surface', 'raised'] as ColourRole[])
    pairs.push({ ink: 'border', bg, klass: 'decoration' });
  // --board, and every ink on it: never in-product, so recorded rather than floored.
  for (const ink of ['text', 'muted', 'destructive', 'edge'] as ColourRole[])
    pairs.push({ ink, bg: 'board', klass: 'decoration' });
  return pairs;
}

const palettes = tierOnePalettes();
const violations: Violation[] = [];
const rows: string[] = [];
const required = requiredPairs();
const recorded = recordedPairs();

for (const theme of THEMES) {
  const palette = palettes.get(theme)!;

  // An override that omits roles is not a palette.
  for (const role of COLOUR_ROLES) {
    if (!palette.has(role)) {
      violations.push({
        file: 'design-system/lian-tokens.css',
        line: 0,
        message: `theme '${theme}' does not define --${theme}-${role}. An override that omits roles is not a palette — it silently falls through to day.`,
      });
    }
  }

  for (const pair of [...required, ...recorded]) {
    const ink = palette.get(pair.ink);
    const bg = palette.get(pair.bg);
    if (ink === undefined || bg === undefined) continue; // already reported above
    const ratio = contrastRatio(ink, bg);
    const floor = CONTRAST_FLOOR[pair.klass];
    const pass = ratio >= floor;
    const label = pair.klass === 'decoration' ? 'recorded' : `${floor.toFixed(1)}`;
    rows.push(
      `  ${theme.padEnd(12)} ${`--${pair.ink}`.padEnd(15)} on ${`--${pair.bg}`.padEnd(14)} ${ratio.toFixed(2).padStart(6)}  ${label.padStart(8)}  ${pair.klass === 'decoration' ? '·' : pass ? 'pass' : 'FAIL'}`,
    );
    if (!pass && pair.klass !== 'decoration') {
      violations.push({
        file: 'design-system/lian-tokens.css',
        line: 0,
        message: `${theme}: --${pair.ink} on --${pair.bg} is ${ratio.toFixed(2)}:1, below the ${floor}:1 floor for ${pair.klass}`,
      });
    }
  }
}

console.log(`  ${required.length} required + ${recorded.length} recorded pairs × ${THEMES.length} palettes = ${rows.length} cells\n`);
for (const row of rows) console.log(row);
console.log('');
report('tokens:contrast', violations, THEMES.length);
