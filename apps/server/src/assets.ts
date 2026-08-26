// Serving the client.
//
// There is no build step here either. Node 22 strips TypeScript types itself,
// so the client is written in TypeScript, typechecked by the same `tsc
// --noEmit` as the server, scanned by the same gates — and served as plain
// modules the browser loads natively.
//
// The graph is walked from the entry module: relative imports follow, and a
// small whitelist of PURE @lian packages is served too, so the client imports
// the same copy catalogue and the same product rules the server does rather
// than a second copy of them. A package that touches node:fs or a database is
// not on that list and cannot get on it by accident — the walker resolves it
// and throws.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';

export type Asset = { contentType: string; body: string | Uint8Array };

const ROOT = resolve(new URL('../../..', import.meta.url).pathname);

/**
 * Packages the browser may load.
 *
 * Every one of these is pure: no filesystem, no database, no provider. That
 * is the whole criterion, and it is checked rather than trusted — a package
 * that imports node: anything fails the walk with the file that did it.
 */
const BROWSER_PACKAGES = new Set(['i18n', 'domain', 'design']);

/** Modules a browser must never receive, even from a whitelisted package. */
const FORBIDDEN = /^\s*import[^\n]*['"]node:/m;

const moduleUrl = (absolute: string): string => `/m/${relative(ROOT, absolute).replace(/\.ts$/, '.js')}`;

function resolveSpecifier(specifier: string, fromFile: string): string | null {
  if (specifier.startsWith('.')) return resolve(dirname(fromFile), specifier);
  const match = /^@lian\/([a-z0-9]+)$/.exec(specifier);
  if (match === null) return null;
  const name = match[1]!;
  if (!BROWSER_PACKAGES.has(name)) {
    throw new Error(`the client imports @lian/${name}, which is not in the browser whitelist (apps/server/src/assets.ts)`);
  }
  return join(ROOT, 'packages', name, 'src', 'index.ts');
}

const IMPORT = /(\bfrom\s*|\bimport\s*\(?\s*|\bexport\s+[^'"\n]*from\s*)(['"])([^'"]+)\2/g;

/** One module: types stripped, specifiers rewritten to served URLs. */
function transform(file: string, source: string): { code: string; imports: string[] } {
  const imports: string[] = [];
  const rewritten = source.replace(IMPORT, (whole, prefix: string, quote: string, specifier: string, offset: number) => {
    // A type-only import disappears when the types are stripped, so its
    // target is never fetched and must not be walked — which is how a client
    // module can name a type from a package it may not load.
    const line = source.slice(source.lastIndexOf('\n', offset) + 1, offset + whole.length);
    if (/\b(import|export)\s+type\b/.test(line)) return whole;
    const target = resolveSpecifier(specifier, file);
    if (target === null) return whole; // a bare specifier the browser resolves itself
    imports.push(target);
    return `${prefix}${quote}${moduleUrl(target)}${quote}`;
  });
  // 'strip' rather than 'transform': types are replaced by whitespace, so a
  // line number in a browser stack trace is the line number in the source.
  return { code: stripTypeScriptTypes(rewritten, { mode: 'strip' }), imports };
}

/** Every module reachable from the entry points, keyed by its served URL. */
export function clientModules(entries: readonly string[]): Record<string, Asset> {
  const out: Record<string, Asset> = {};
  const seen = new Set<string>();
  const queue = entries.map((entry) => resolve(ROOT, entry));

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    if (FORBIDDEN.test(source)) {
      throw new Error(`${relative(ROOT, file)} imports a node: module and cannot be sent to a browser`);
    }
    const { code, imports } = transform(file, source);
    out[moduleUrl(file)] = { contentType: 'text/javascript; charset=utf-8', body: code };
    queue.push(...imports);
  }
  return out;
}

export function file(path: string, contentType: string): Asset {
  return { contentType, body: readFileSync(resolve(ROOT, path), 'utf8') };
}

/** Stylesheets, in load order: tokens, then the role tier, then the app. */
export function stylesheets(): Record<string, Asset> {
  const css = 'text/css; charset=utf-8';
  const sheets: Record<string, Asset> = {
    '/css/lian-tokens.css': file('design-system/lian-tokens.css', css),
    '/css/lian-type-roles.css': file('packages/design/src/tokens/lian-type-roles.css', css),
  };
  const dir = resolve(ROOT, 'apps/web/styles');
  for (const name of readdirSync(dir)) {
    if (name.endsWith('.css')) sheets[`/css/${name}`] = file(`apps/web/styles/${name}`, css);
  }
  return sheets;
}

/** The icon sprite, and the app icons the manifest names. */
export function icons(): Record<string, Asset> {
  const out: Record<string, Asset> = {
    '/lian-defs.js': file('design-system/lian-defs.js', 'text/javascript; charset=utf-8'),
  };
  const dir = resolve(ROOT, 'apps/web/icons');
  for (const name of readdirSync(dir)) {
    if (name.endsWith('.png')) out[`/icons/${name}`] = { contentType: 'image/png', body: readFileSync(join(dir, name)) };
  }
  return out;
}

export const APP_CSS_ORDER = ['/css/lian-tokens.css', '/css/lian-type-roles.css', '/css/app.css'] as const;

/** Modified time of the newest file under a directory — the cache key for a
 *  deployment that has no build to stamp a version into. */
export function version(paths: readonly string[]): string {
  let newest = 0;
  const visit = (path: string): void => {
    const stat = statSync(path);
    if (stat.isDirectory()) for (const name of readdirSync(path)) visit(join(path, name));
    else newest = Math.max(newest, stat.mtimeMs);
  };
  for (const path of paths) visit(resolve(ROOT, path));
  return String(Math.round(newest));
}
