// GATE: the non-voice prompt path stays non-voice (LESSONS §1, restated).
//
// "The constraint is not 'one path'. It is 'no second path can construct a
// persona'."  §1 allows a separate path for extraction, summarisation,
// titling and classification under exactly two conditions, and this gate is
// both of them:
//
//   1. ONE CLEARLY NAMED PLACE — every non-voice prompt is in
//      packages/analysis/src/prompts.ts, and nowhere else in the product may
//      define a system prompt at all.
//   2. LINT-BANNED FROM THE PERSONA — the import ban is in boundaries.ts;
//      this adds the part an import ban cannot catch, which is a persona
//      reconstructed by hand out of string literals.
import { walk, rel, read, lineOf, report, stripComments, ROOT, type Violation } from './lib.ts';

const PROMPT_FILE = 'packages/analysis/src/prompts.ts';
const VOICE_PACKAGE = 'packages/prompt/';

const violations: Violation[] = [];
const files = [...walk(`${ROOT}/packages`, ['.ts']), ...walk(`${ROOT}/apps`, ['.ts'])];

// ── condition 1: system prompts live in exactly two places ────────────────
// The voice path (packages/prompt) and the non-voice path (prompts.ts).  A
// third one is how the second assembly path grew last time.
const SYSTEM_PROMPT_SHAPE = /\b(system|systemPrompt)\s*[:=]\s*[`'"](?=[^`'"]{80,})/g;
for (const file of files) {
  const path = rel(file);
  if (path === PROMPT_FILE || path.startsWith(VOICE_PACKAGE) || path.endsWith('.test.ts') || path.includes('test-fakes')) continue;
  const code = stripComments(read(file));
  SYSTEM_PROMPT_SHAPE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SYSTEM_PROMPT_SHAPE.exec(code)) !== null) {
    violations.push({
      file: path, line: lineOf(code, match.index),
      message: `a system prompt outside the two sanctioned places. Voice prompts belong in ${VOICE_PACKAGE}; non-voice prompts belong in ${PROMPT_FILE} (LESSONS §1).`,
    });
  }
}

// ── condition 2: the non-voice path cannot CONSTRUCT a persona ───────────
// An import ban stops `import { personaFor }`.  It does not stop someone
// pasting her identity into an extraction prompt by hand, which would be the
// same failure with none of the same tests over it.
//
// What is checked is the thing that would actually go wrong: the voice path's
// own blocks appearing over here.  The WORD "canon" is not the problem — this
// package extracts canon, so it has to be able to say so.  A block header
// copied out of packages/prompt/src/blocks.ts is the problem, because that is
// a persona being reassembled.
const VOICE_BLOCK_HEADERS = [
  'WHAT YOU HAVE SAID ABOUT YOURSELF',
  'HOW WELL YOU KNOW EACH OTHER',
  'WHAT YOU REMEMBER ABOUT THEM',
  'WHAT THEY SAY ABOUT THEMSELVES',
  'WHAT YOU CAN DO',
  'HOW TO WRITE THIS MESSAGE',
  'WHAT TO DO NOW',
];
const PERSONA_MARKERS = [
  { re: /You are \{\{name\}\}|You are Lian\b/i, why: 'names the assistant — an analysis prompt has no identity' },
  { re: /\bin your own voice\b/i, why: 'an analysis prompt returns data, not a voice' },
  { re: /\bsecretary, more or less\b/i, why: 'persona text — this belongs only in packages/prompt/src/personas' },
];

for (const file of walk(`${ROOT}/packages/analysis/src`, ['.ts'])) {
  const path = rel(file);
  const source = read(file);
  for (const literal of source.matchAll(/`([^`]{40,})`/g)) {
    const text = literal[1]!;
    const at = lineOf(source, literal.index ?? 0);
    for (const header of VOICE_BLOCK_HEADERS) {
      if (text.includes(header)) {
        violations.push({ file: path, line: at, message: `«${header}» is a block from the voice path. Reproducing one here reconstructs a persona, which is the whole thing §1 forbids.` });
      }
    }
    for (const marker of PERSONA_MARKERS) {
      if (marker.re.test(text)) violations.push({ file: path, line: at, message: `non-voice prompt ${marker.why} (LESSONS §1)` });
    }
  }
}

// Every prompt this package ships must be declared in ANALYSIS_PROMPTS, so
// "one clearly named place" means a countable set rather than a directory.
const promptSource = read(`${ROOT}/${PROMPT_FILE}`);
const declared = [...(/ANALYSIS_PROMPTS = \[([^\]]+)\]/.exec(promptSource)?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
const exported = [...promptSource.matchAll(/export const ([A-Z_]+)_SYSTEM\b/g)].map((m) => m[1]!.toLowerCase());
for (const name of exported) {
  if (!declared.includes(name)) {
    violations.push({ file: PROMPT_FILE, line: 0, message: `${name.toUpperCase()}_SYSTEM is not listed in ANALYSIS_PROMPTS — the set of non-voice prompts must stay countable` });
  }
}
console.log(`  ${declared.length} declared non-voice prompt(s): ${declared.join(', ')}`);

console.log(`  voice prompts: ${VOICE_PACKAGE} · non-voice prompts: ${PROMPT_FILE}`);
report('analysis:path', violations, files.length);
