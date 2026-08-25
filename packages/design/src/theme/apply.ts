// ==========================================================================
// THIS FILE IS THE ONLY PLACE THE RUNTIME WRITES THE THEME, and all it writes
// is one attribute.  The theme is DECIDED in ./resolve.ts; the values live in
// design-system/lian-tokens.css.
//
// It never sets a colour, a custom property, or an inline style.  If you are
// here to make something a different colour at runtime: don't.  Give the
// element a role token, or add a role to tier 2 of lian-tokens.css.
// tools/gates/theme-single-writer.ts fails the build on any colour write
// outside this file, including this one.
// ==========================================================================
import type { ThemeName } from './resolve.ts';
import { isDark } from './resolve.ts';

export const THEME_ATTRIBUTE = 'data-t';
export const DIRECTION_ATTRIBUTE = 'dir';
/** Cookie so the server renders the same attribute the client would, no flash. */
export const THEME_COOKIE = 'lian_t';
export const DIRECTION_COOKIE = 'lian_dir';

export type Direction = 'ltr' | 'rtl';

/** What the server puts on <html>.  Same two attributes the client writes. */
export function themeAttributes(theme: ThemeName, dir: Direction): Record<string, string> {
  return { [THEME_ATTRIBUTE]: theme, [DIRECTION_ATTRIBUTE]: dir };
}

type AttributeTarget = { setAttribute(name: string, value: string): void };

/** The single runtime write. */
export function applyTheme(root: AttributeTarget, theme: ThemeName, dir: Direction): void {
  root.setAttribute(THEME_ATTRIBUTE, theme);
  root.setAttribute(DIRECTION_ATTRIBUTE, dir);
}

/**
 * Pre-hydration fallback (LESSONS §7: "CSS is only the pre-hydration
 * fallback").  Inlined in <head> before first paint.  It repeats the same two
 * attribute writes from a cookie and computes nothing resolve.ts does not —
 * if this script and resolve.ts ever disagree, resolve.ts is right and the
 * next render corrects it.
 */
export function preHydrationScript(fallbackTheme: ThemeName, fallbackDir: Direction): string {
  return [
    '(function(){try{',
    `var m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=([^;]+)/);`,
    `var d=document.cookie.match(/(?:^|; )${DIRECTION_COOKIE}=([^;]+)/);`,
    'var t=m?decodeURIComponent(m[1]):null;var dir=d?decodeURIComponent(d[1]):null;',
    "var ok={day:1,quiet:1,night:1,'night-warm':1,'night-quiet':1};",
    `document.documentElement.setAttribute('${THEME_ATTRIBUTE}', ok[t]?t:'${fallbackTheme}');`,
    `document.documentElement.setAttribute('${DIRECTION_ATTRIBUTE}', dir==='rtl'||dir==='ltr'?dir:'${fallbackDir}');`,
    '}catch(e){}})()',
  ].join('');
}

/** For <meta name="theme-color">: reads the token, never a literal. */
export function themeColorVar(theme: ThemeName): string {
  return isDark(theme) ? 'var(--canvas)' : 'var(--canvas)';
}
