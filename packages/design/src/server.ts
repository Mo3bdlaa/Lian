// The part of the design package that touches the filesystem.
//
// It is a SEPARATE entry point — `@lian/design/server` — because the rest of
// this package is pure and the browser loads it: theme resolution and the
// single attribute writer are the same modules on both sides, which is what
// keeps LESSONS §7's "one decision point" true across the network as well as
// inside the process. A `node:fs` import in the index would make the whole
// package unservable.
//
// Reading a brand colour at runtime.
//
// design-system/lian-tokens.css is the single source for every colour in the
// product, and the gates enforce that no source file writes a hex literal.
// Two places genuinely need a literal rather than a CSS variable: the web
// app manifest, which the OS parses as JSON, and <meta name="theme-color">.
//
// So instead of retyping the value there, it is read from the token file —
// which means changing the token changes the manifest, and nothing has to
// remember to follow.
import { readFileSync } from 'node:fs';

const TOKEN_FILE = new URL('../../../design-system/lian-tokens.css', import.meta.url);

export type BrandToken = 'brand-plum' | 'brand-cream' | 'brand-blush' | 'brand-lilac' | 'brand-ink';

let cache: Map<string, string> | null = null;

function tokens(): Map<string, string> {
  if (cache !== null) return cache;
  const source = readFileSync(TOKEN_FILE, 'utf8');
  const found = new Map<string, string>();
  for (const match of source.matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9A-Fa-f]{3,8})/g)) {
    found.set(match[1]!, match[2]!);
  }
  cache = found;
  return found;
}

export function brandColor(name: BrandToken): string {
  const value = tokens().get(name);
  // Loudly, at boot: a manifest with an undefined colour renders as a white
  // flash on install, which is the kind of thing nobody traces back here.
  if (value === undefined) throw new Error(`--${name} is not defined in design-system/lian-tokens.css`);
  return value;
}
