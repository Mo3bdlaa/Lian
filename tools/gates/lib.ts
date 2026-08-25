// Shared helpers for the CI gates.  Gates are plain Node scripts so they run
// with zero build step and fail the build on exit code 1.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const ROOT = new URL('../../', import.meta.url).pathname.replace(/\/$/, '');

const SKIP_DIRS = new Set(['node_modules', '.git', '.pgdata', 'dist', 'screens']);

export function walk(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full, exts));
    else if (exts.some((e) => entry.endsWith(e))) out.push(full);
  }
  return out;
}

export function rel(path: string): string {
  return relative(ROOT, path).split(sep).join('/');
}

export function read(path: string): string {
  return readFileSync(path, 'utf8');
}

/** Line number (1-indexed) of a character offset. */
export function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

export type Violation = { file: string; line: number; message: string };

export function report(gate: string, violations: Violation[], checked: number): never {
  if (violations.length === 0) {
    console.log(`✓ ${gate} — ${checked} file(s) checked, no violations`);
    process.exit(0);
  }
  console.error(`✗ ${gate} — ${violations.length} violation(s):\n`);
  for (const v of violations) console.error(`  ${v.file}:${v.line}\n    ${v.message}`);
  console.error('');
  process.exit(1);
}

/** Every `import ... from 'x'`, `export ... from 'x'`, and `import('x')` specifier. */
export function importsOf(source: string): { spec: string; index: number }[] {
  const out: { spec: string; index: number }[] = [];
  const patterns = [
    /(?:^|\n)\s*import\s[^;\n]*?from\s*['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*export\s[^;\n]*?from\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) out.push({ spec: m[1]!, index: m.index });
  }
  return out;
}

/** Strip line and block comments so a gate never fires on prose. */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:])\/\/[^\n]*/g, (_m, p1: string) => p1);
}
