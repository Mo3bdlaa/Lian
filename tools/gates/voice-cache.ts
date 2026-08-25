// GATE: one write path for audio (LESSONS §8).
//
// "Noura wrote TTS to cache from three places, not one.  Fixing the
// pre-generation path looked correct and delayed the write rather than
// preventing it — first playback still persisted the row.  When adding a
// 'don't persist this' rule, enumerate every write path before declaring it
// done."
//
// Enumerating them is this gate.  Only speak.ts may hold the cache port, and
// only @lian/db may write the table.
import { walk, rel, read, lineOf, report, stripComments, ROOT, type Violation } from './lib.ts';

const SOLE_CALLER = 'packages/voice/src/speak.ts';
const violations: Violation[] = [];
const files = [...walk(`${ROOT}/packages`, ['.ts']), ...walk(`${ROOT}/apps`, ['.ts'])];

for (const file of files) {
  const path = rel(file);
  if (path === SOLE_CALLER || path.endsWith('.test.ts')) continue;
  const code = stripComments(read(file));

  // The port type may be referenced (the composition root has to construct
  // one); calling .put() on it may not.
  for (const match of code.matchAll(/\bcache\s*\.\s*put\s*\(/g)) {
    violations.push({ file: path, line: lineOf(code, match.index), message: `writes to the voice cache — only ${SOLE_CALLER} may (LESSONS §8)` });
  }
  // The table itself is db's, and db is where the single INSERT lives.
  if (!path.startsWith('packages/db/')) {
    for (const match of code.matchAll(/INSERT\s+INTO\s+tts_cache/gi)) {
      violations.push({ file: path, line: lineOf(code, match.index), message: 'writes tts_cache directly (LESSONS §8)' });
    }
  }
}

console.log(`  sole write path: ${SOLE_CALLER}`);
report('voice:cache', violations, files.length);
