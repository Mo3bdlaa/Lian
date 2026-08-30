// GATE: nothing in this tree compiles.
//
// The target is an Oracle Cloud Ampere A1 — arm64 — and two things in the
// deployment rest entirely on there being no compiled code in node_modules:
//
//   1. The Dockerfile installs dependencies on the BUILD platform and copies
//      `node_modules` into the arm64 image. That is sound only while nothing
//      in there is architecture-specific. One native dependency and the image
//      ships x86 binaries to an ARM box, where it fails at require() time —
//      at boot, in production, having passed every test on the build machine.
//   2. `npm ci` on the box needs no compiler, no python, no build-essential.
//      The image is `node:22-alpine` and stays that size.
//
// Neither is checkable by reading the Dockerfile, and both stop being true the
// moment somebody adds a dependency that happens to have a `binding.gyp`.
// So this reads what is actually installed.
//
// THREE THINGS ARE LOOKED FOR, because a native dependency can arrive in
// three different shapes and only one of them is obvious:
//
//   - a compiled `.node` binary, which is the shape everyone expects;
//   - a `binding.gyp` or a `prebuilds/` directory, which is a package that
//     WILL compile or download a binary even if it has not yet;
//   - an install/preinstall/postinstall script, which is how a package
//     fetches a platform binary without either of the above ever appearing.
//
// The third is the one that would slip through, and it is how most modern
// binary dependencies actually ship.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, report, type Violation } from './lib.ts';

const MODULES = join(ROOT, 'node_modules');

/**
 * Packages allowed to carry one of the three shapes.
 *
 * EMPTY, and that is the point — it is not an oversight to be filled in. A
 * name added here has to come with a note saying why the Dockerfile's
 * cross-architecture copy is still safe, because it is that line this gate
 * exists to protect.
 */
const ALLOWED = new Set<string>();

const violations: Violation[] = [];
let scanned = 0;

/** Walk installed packages, including scoped ones, not following symlinks. */
function packages(directory: string): { name: string; path: string }[] {
  if (!existsSync(directory)) return [];
  const found: { name: string; path: string }[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === '.bin' || entry.name === '.cache') continue;
    const path = join(directory, entry.name);
    if (entry.name.startsWith('@')) {
      for (const inner of readdirSync(path, { withFileTypes: true })) {
        if (inner.isDirectory()) found.push({ name: `${entry.name}/${inner.name}`, path: join(path, inner.name) });
      }
      continue;
    }
    found.push({ name: entry.name, path });
    // Nested node_modules — npm hoists, but a version conflict still nests.
    found.push(...packages(join(path, 'node_modules')));
  }
  return found;
}

/** Any `.node` file below a package, excluding its own nested node_modules
 *  (which are visited separately, so a finding is attributed to the right
 *  package rather than to whatever hoisted it). */
function compiledBinaries(directory: string, depth = 0): string[] {
  if (depth > 6 || !existsSync(directory)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...compiledBinaries(path, depth + 1));
    else if (entry.name.endsWith('.node')) found.push(path);
  }
  return found;
}

for (const { name, path } of packages(MODULES)) {
  if (ALLOWED.has(name)) continue;
  scanned += 1;

  const binaries = compiledBinaries(path);
  if (binaries.length > 0) {
    violations.push({
      file: binaries[0]!.replace(`${ROOT}/`, ''),
      line: 0,
      message: `${name} ships a compiled .node binary — the Dockerfile copies node_modules across architectures and cannot carry this`,
    });
  }

  for (const marker of ['binding.gyp', 'prebuilds']) {
    const at = join(path, marker);
    if (existsSync(at)) {
      violations.push({
        file: at.replace(`${ROOT}/`, ''),
        line: 0,
        message: `${name} has ${marker} — it compiles or downloads a platform binary, so node_modules stops being architecture-independent`,
      });
    }
  }

  const manifest = join(path, 'package.json');
  if (!existsSync(manifest) || !statSync(manifest).isFile()) continue;
  try {
    const scripts = (JSON.parse(readFileSync(manifest, 'utf8')) as { scripts?: Record<string, string> }).scripts ?? {};
    for (const hook of ['preinstall', 'install', 'postinstall']) {
      if (scripts[hook] !== undefined) {
        violations.push({
          file: manifest.replace(`${ROOT}/`, ''),
          line: 0,
          message: `${name} runs a ${hook} script (${scripts[hook]}) — that is how a package fetches a platform binary without a .node or a binding.gyp ever appearing`,
        });
      }
    }
  } catch {
    // A package.json that will not parse is npm's problem, not this gate's.
  }
}

report('no-native-deps', violations, scanned);
