// GATE: touch target floor (design.md §11, TOKENS.md §3).
//
// --tap-min is the one geometry token with an accessibility contract: 44px,
// and 41 elements in the reference set sit exactly on it.  Lowering it breaks
// the set quietly, because nothing looks wrong at 40px — it just misses.
import { walk, rel, read as readFile, lineOf, report, ROOT, type Violation } from './lib.ts';
import { TOKEN_FILE, ROLE_FILE } from './token-parse.ts';

const FLOOR_PX = 44;
const violations: Violation[] = [];

// 1. The token itself, everywhere it is defined (a per-theme block could lower it).
for (const file of [TOKEN_FILE, ROLE_FILE, ...walk(`${ROOT}/packages`, ['.css']), ...walk(`${ROOT}/apps`, ['.css'])]) {
  const source = readFile(file);
  const re = /--tap-min\s*:\s*([0-9.]+)px/g;
  let m: RegExpExecArray | null;
  let found = false;
  while ((m = re.exec(source)) !== null) {
    found = true;
    const px = Number(m[1]);
    if (px < FLOOR_PX) {
      violations.push({ file: rel(file), line: lineOf(source, m.index), message: `--tap-min is ${px}px, below the ${FLOOR_PX}px floor` });
    }
  }
  if (file === TOKEN_FILE && !found) {
    violations.push({ file: rel(file), line: 0, message: '--tap-min is not defined — the touch-target floor has no token' });
  }
}

// 2. Interactive rules must reach the floor.  An interactive element is one
//    whose selector names a control, or which carries data-tap.
const INTERACTIVE = /(^|[\s,>+~])(button|a|input|select|textarea|\[role="(button|link|switch|tab|menuitem|checkbox|radio)"\]|\[data-tap\])[\s,{:.[]/i;
const SIZE = /\b(min-height|height|min-block-size)\s*:\s*([0-9.]+)px/g;

const sheets = [...walk(`${ROOT}/packages`, ['.css']), ...walk(`${ROOT}/apps`, ['.css'])];
for (const file of sheets) {
  const source = readFile(file);
  for (const block of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = block[1] ?? '';
    const body = block[2] ?? '';
    if (!INTERACTIVE.test(`${selector} {`)) continue;
    SIZE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = SIZE.exec(body)) !== null) {
      const px = Number(m[2]);
      if (px < FLOOR_PX) {
        violations.push({
          file: rel(file),
          line: lineOf(source, (block.index ?? 0) + selector.length + (m.index ?? 0)),
          message: `interactive selector '${selector.trim().slice(0, 60)}' sets ${m[1]}: ${px}px — use var(--tap-min)`,
        });
      }
    }
  }
}

console.log(`  floor ${FLOOR_PX}px · ${sheets.length} application stylesheet(s) scanned`);
report('tokens:tap', violations, sheets.length + 1);
