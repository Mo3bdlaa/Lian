// Parse the token layer.  Shared by the token gates so they all read the same
// file the product reads — never a copy of its values.
import { read, ROOT } from './lib.ts';

export const TOKEN_FILE = `${ROOT}/design-system/lian-tokens.css`;
export const ROLE_FILE = `${ROOT}/packages/design/src/tokens/lian-type-roles.css`;

/** Every custom property defined anywhere in a stylesheet, with its raw value. */
export function definedProperties(css: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /(--[a-zA-Z0-9-]+)\s*:\s*([^;}]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    // A property may be defined once per theme block; keep the first (`:root`).
    if (!out.has(m[1]!)) out.set(m[1]!, m[2]!.trim());
  }
  return out;
}

/** Every custom property referenced through var(). */
export function referencedProperties(source: string): { name: string; index: number }[] {
  const out: { name: string; index: number }[] = [];
  const re = /var\(\s*(--[a-zA-Z0-9-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) out.push({ name: m[1]!, index: m.index });
  return out;
}

export const THEMES = ['day', 'quiet', 'night', 'night-warm', 'night-quiet'] as const;
export type Theme = (typeof THEMES)[number];

export const COLOUR_ROLES = [
  'canvas', 'surface', 'raised', 'bubble-mine', 'accent', 'accent-alt', 'decor', 'edge',
  'border', 'text', 'muted', 'on-text', 'destructive', 'nav-active', 'button-fill',
  'button-ink', 'board',
] as const;
export type ColourRole = (typeof COLOUR_ROLES)[number];

/** theme -> role -> hex, read out of tier 1 of lian-tokens.css. */
export function tierOnePalettes(): Map<Theme, Map<ColourRole, string>> {
  const defined = definedProperties(read(TOKEN_FILE));
  const palettes = new Map<Theme, Map<ColourRole, string>>();
  for (const theme of THEMES) {
    const roles = new Map<ColourRole, string>();
    for (const role of COLOUR_ROLES) {
      const value = defined.get(`--${theme}-${role}`);
      if (value !== undefined && /^#[0-9a-fA-F]{3,6}$/.test(value)) roles.set(role, value);
    }
    palettes.set(theme, roles);
  }
  return palettes;
}
