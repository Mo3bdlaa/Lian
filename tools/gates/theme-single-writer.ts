// GATE: the runtime writes one attribute and never a colour (LESSONS §7).
//
// Noura's globals.css looked like the source of truth and was not: a runtime
// module overrode every token per mood, so editing the CSS left the old
// palette live.  The repair is not "document both layers" — it is to delete
// the second layer.  Exactly one file may touch the theme attribute, and
// nothing anywhere may set a colour at runtime.
import { walk, rel, read, lineOf, report, stripComments, ROOT, type Violation } from './lib.ts';

/** The single writer.  Changing this line is the whole decision. */
const SOLE_WRITER = 'packages/design/src/theme/apply.ts';
/** Resolution is allowed to name the attribute in prose and types. */
const DECIDER = 'packages/design/src/theme/resolve.ts';

const FORBIDDEN: { re: RegExp; message: string; writerMayDoThis: boolean }[] = [
  { re: /\.setProperty\(\s*['"`]--/g, message: 'sets a CSS custom property at runtime — the values live in lian-tokens.css and are repointed by one attribute', writerMayDoThis: false },
  { re: /\.style\.(background|backgroundColor|color|borderColor|fill|stroke|boxShadow)\s*=/g, message: 'assigns a colour at runtime', writerMayDoThis: false },
  { re: /setAttribute\(\s*['"`]data-t['"`]/g, message: `writes the theme attribute — only ${SOLE_WRITER} may`, writerMayDoThis: true },
  { re: /dataset\.t\s*=/g, message: `writes the theme attribute — only ${SOLE_WRITER} may`, writerMayDoThis: true },
  { re: /documentElement\.setAttribute/g, message: `writes a root attribute — only ${SOLE_WRITER} may`, writerMayDoThis: true },
];

const violations: Violation[] = [];
const files = [...walk(`${ROOT}/packages`, ['.ts', '.tsx']), ...walk(`${ROOT}/apps`, ['.ts', '.tsx'])];

for (const file of files) {
  const path = rel(file);
  const code = stripComments(read(file));
  const isWriter = path === SOLE_WRITER;
  for (const { re, message, writerMayDoThis } of FORBIDDEN) {
    if (isWriter && writerMayDoThis) continue;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code)) !== null) {
      violations.push({ file: path, line: lineOf(code, m.index), message: `${message}  (found: ${m[0]})` });
    }
  }
}

// The two headers LESSONS §7 asks for, checked rather than trusted: "the place
// where colour is decided must be obvious from the file that looks like it
// decides colour.  If there are two layers, say so at the top of both."
const headerChecks: { file: string; must: RegExp; what: string }[] = [
  { file: SOLE_WRITER, must: /ONLY PLACE THE RUNTIME WRITES THE THEME/i, what: 'the writer must say it is the only writer' },
  { file: DECIDER, must: /THIS FILE DECIDES THE THEME/i, what: 'the decider must say it decides' },
  { file: 'design-system/lian-tokens.css', must: /token layer/i, what: 'the token file must say it names values' },
];
for (const check of headerChecks) {
  const head = read(`${ROOT}/${check.file}`).slice(0, 1400);
  if (!check.must.test(head)) {
    violations.push({ file: check.file, line: 1, message: `header missing: ${check.what} (LESSONS §7)` });
  }
}

console.log(`  sole writer: ${SOLE_WRITER}`);
report('theme:single-writer', violations, files.length);
