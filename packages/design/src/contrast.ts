// WCAG 2.1 relative luminance and contrast ratio.
//
// This lives in the design package rather than in the gate script because
// LESSONS §9 makes contrast a product property, not a lint detail: it is
// unit-tested here and consumed by tools/gates/tokens-contrast.ts, so the
// arithmetic behind the shipped table is itself covered.
export type Rgb = { r: number; g: number; b: number };

export function parseHex(hex: string): Rgb {
  const h = hex.trim().replace(/^#/, '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`not a hex colour: ${hex}`);
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(rgb: Rgb): number {
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(parseHex(a));
  const lb = relativeLuminance(parseHex(b));
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** The three floors from LESSONS §9 / TOKENS.md §9. */
export const CONTRAST_FLOOR = {
  /** WCAG 1.4.3 — normal text. */
  text: 4.5,
  /** WCAG 1.4.11 — a control the user must perceive in order to act. */
  boundary: 3,
  /** Exempt under both.  Not "unmeasured": recorded so the exemption is visible. */
  decoration: 0,
} as const;
