// Run the test suite and fail on anything that is not a pass.
//
// THE TRAP THIS EXISTS FOR — and it is worse than HANDOFF has been saying.
//
// HANDOFF's advice for four runs has been "read the test summary, not the
// exit code", on the strength of one real incident:
//
//   pass 462, fail 0, cancelled 100  ← Postgres died mid-run
//
// That advice is not enough, and measuring it is how I found out. With
// DATABASE_URL simply unset, the suite reports:
//
//   tests 520, pass 520, fail 0, cancelled 0, skipped 0
//
// A PERFECT summary. Not one skipped test, because the database suites are
// `describe(…, { skip })` and node counts a skipped suite as a suite, never
// as its subtests — so 147 tests are not reported as skipped, they are not
// reported at all. Exit code zero. Nothing anywhere says a fifth of the suite
// did not exist.
//
// So the counters are checked, but the COUNT is the load-bearing assertion.
// A suite that shrinks is the only visible symptom of a suite that did not
// run, and that is what FLOOR below is for.
import { spawn } from 'node:child_process';

const EXPECTED_ZERO = ['fail', 'cancelled', 'skipped', 'todo'] as const;

const child = spawn('npm', ['test'], { stdio: ['ignore', 'pipe', 'inherit'] });

let output = '';
child.stdout.on('data', (chunk: Buffer) => {
  const text = chunk.toString();
  output += text;
  process.stdout.write(text);
});

const code: number = await new Promise((resolve) => child.on('close', (value) => resolve(value ?? 1)));

/** The last `# <name> <number>` line for a counter — node prints one summary. */
function counter(name: string): number | null {
  const matches = [...output.matchAll(new RegExp(`^# ${name} (\\d+)$`, 'gm'))];
  const last = matches.at(-1);
  return last === undefined ? null : Number(last[1]);
}

const tests = counter('tests');
if (tests === null) {
  console.error('\n✗ the run printed no test summary at all — it died before reporting.');
  process.exit(1);
}

const problems: string[] = [];
for (const name of EXPECTED_ZERO) {
  const value = counter(name);
  if (value !== null && value > 0) problems.push(`${name} ${value}`);
}

// The one that actually catches the common case. A `describe` that skips
// wholesale — no database, no browser — takes its subtests out of the count
// with every other number still reading clean, so the count is the only place
// it shows. A FLOOR rather than the exact number: it should be raised as the
// suite grows, and it is deliberately a little below the current total so a
// legitimately removed test does not fail the build on its own.
const FLOOR = 600;
if (tests < FLOOR) {
  problems.push(`only ${tests} tests ran, and there should be at least ${FLOOR} — see tools/ci-test.ts`);
}

if (problems.length > 0 || code !== 0) {
  console.error(`\n✗ tests: ${problems.length > 0 ? problems.join(', ') : `exit ${code}`}`);
  if (tests < FLOOR) {
    console.error('  a short run almost always means DATABASE_URL is not set: the database suites'
      + ' skip as whole suites, so their tests vanish from the count without being reported as skipped.');
  }
  if (counter('cancelled') !== null && counter('cancelled')! > 0) {
    console.error('  cancelled tests usually mean Postgres went away mid-run, or pgvector is missing.');
  }
  process.exit(1);
}

console.log(`\n✓ tests — ${tests} ran, ${tests} passed, nothing skipped or cancelled`);
