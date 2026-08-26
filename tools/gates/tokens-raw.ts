// GATE: no raw design values in application code (LESSONS §9).
//
// Every colour, radius, spacing value, type size, weight, line-height, stroke
// width, elevation and motion value is a named token in one place.  This gate
// covers packages/ and apps/ — our code.  design-system/ is the built
// reference and was audited when it was produced.
//
// It also enforces the role tier: numeric --fs-* / --lh-* / --fw-* tokens stay
// defined for the reference screens, but application code uses --t-<role>-*.
// Without this, "no raw font size" is satisfied while --fs-15 vs --fs-16 is
// still being chosen by feel.
import { walk, rel, read, lineOf, report, stripComments, ROOT, type Violation } from './lib.ts';

// A file may exempt itself from one rule with a pragma that states a reason:
//     /* tokens-raw:allow-hex — this file IS the colour arithmetic */
// Exemptions are printed on every run.  TOKENS.md §9's lesson is that an
// exemption has to stay visible, or it stops being a decision.
const RULES: { id: string; re: RegExp; message: string }[] = [
  { id: 'hex', re: /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b(?![0-9a-zA-Z])/g, message: 'raw hex colour — use a semantic role token (--text, --surface, --edge …)' },
  { id: 'radius', re: /\b(?:border-radius|borderRadius)\s*:\s*['"]?\d/g, message: 'raw radius — use --r-card / --r-bubble / --r-panel / --r-sheet / --r-chip / --r-nav' },
  { id: 'font-size', re: /\b(?:font-size|fontSize)\s*:\s*['"]?\d/g, message: 'raw font size — use --t-<role>-fs' },
  { id: 'font-weight', re: /\b(?:font-weight|fontWeight)\s*:\s*['"]?\d/g, message: 'raw font weight — use --t-<role>-fw' },
  { id: 'line-height', re: /\b(?:line-height|lineHeight)\s*:\s*['"]?\d/g, message: 'raw line-height — use --t-<role>-lh' },
  { id: 'stroke-width', re: /\b(?:stroke-width|strokeWidth)\s*:\s*['"]?\d/g, message: 'raw stroke width — use --icon-stroke' },
  // The lookahead sits directly after the colon on purpose: with `\s*`
  // before it the pattern backtracks to zero whitespace and then "fails" to
  // see var( past the space, so `box-shadow: var(--elev-1)` — the correct
  // spelling — was reported as a violation.
  { id: 'shadow', re: /\bbox-shadow\s*:(?!\s*var\()/g, message: 'raw shadow — use --elev-1 / --elev-2' },
  { id: 'duration', re: /\btransition(?:-duration)?\s*:\s*[^;\n]*\b\d+m?s\b/g, message: 'raw duration — use --dur-fast / --dur-base / --dur-slow' },
  { id: 'numeric-type', re: /var\(\s*--(?:fs|lh|fw)-\d/g, message: 'numeric type token in application code — use the role tier (--t-body-fs, --t-h2-lh, --t-label-fw …). The numeric tokens exist for the reference screens.' },
];

const violations: Violation[] = [];
const exemptions: string[] = [];
const files = [
  ...walk(`${ROOT}/packages`, ['.ts', '.tsx', '.css']),
  ...walk(`${ROOT}/apps`, ['.ts', '.tsx', '.css']),
].filter((f) => !f.endsWith('lian-type-roles.css')); // the role tier is where roles point at numerics

for (const file of files) {
  const path = rel(file);
  const source = read(file);
  const code = file.endsWith('.css') ? source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')) : stripComments(source);
  for (const { id, re, message } of RULES) {
    const pragma = new RegExp(`tokens-raw:allow-${id}\\s+—\\s+(.+)`).exec(source);
    if (pragma) {
      exemptions.push(`${path}  allow-${id}: ${pragma[1]!.trim().replace(/\s*\*\/\s*$/, '')}`);
      continue;
    }
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code)) !== null) {
      violations.push({ file: path, line: lineOf(code, m.index), message: `${message}  (found: ${m[0].trim().slice(0, 48)})` });
    }
  }
}

if (exemptions.length > 0) {
  console.log(`  ${exemptions.length} recorded exemption(s):`);
  for (const e of exemptions) console.log(`    ${e}`);
}
report('tokens:raw', violations, files.length);
