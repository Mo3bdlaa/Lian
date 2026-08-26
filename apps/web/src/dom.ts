// Rendering.
//
// The client renders HTML strings and hands them to the DOM. Two consequences
// are load-bearing, so they are stated here rather than discovered:
//
//   1. EVERYTHING interpolated is escaped. A message body is text the person
//      typed or text a model produced, and neither is markup. `html` escapes
//      every value by default; markup that is genuinely markup goes through
//      `raw`, which is greppable and rare.
//   2. Rendering is a pure function of state, so a screen can be rendered in
//      a test with no browser at all — which is how the token rules and the
//      copy get tested without a headless Chrome in the loop.
export type Html = { readonly __html: string };

export const raw = (markup: string): Html => ({ __html: markup });

export function esc(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function part(value: unknown): string {
  if (value === null || value === undefined || value === false) return '';
  if (Array.isArray(value)) return value.map(part).join('');
  if (typeof value === 'object' && '__html' in (value as Html)) return (value as Html).__html;
  return esc(value);
}

/** The one template tag. Interpolations are escaped unless wrapped in raw(). */
export function html(strings: TemplateStringsArray, ...values: unknown[]): Html {
  let out = strings[0] ?? '';
  for (const [index, value] of values.entries()) out += part(value) + (strings[index + 1] ?? '');
  return raw(out);
}

export const render = (markup: Html): string => markup.__html;

/** An icon from the shared sprite (design-system/lian-defs.js). */
export function icon(name: string, size: 'sm' | 'md' | 'lg' = 'md', extraClass = ''): Html {
  const viewBox = name === 'i-mark' ? '0 0 99.22 128' : '0 0 24 24';
  return raw(`<svg class="icon icon--${size} ${esc(extraClass)}" viewBox="${viewBox}" aria-hidden="true"><use href="#${esc(name)}"></use></svg>`);
}

/** Class list from a map, so a conditional class is not string concatenation. */
export function cls(...parts: (string | false | null | undefined | Record<string, boolean>)[]): string {
  const out: string[] = [];
  for (const item of parts) {
    if (item === false || item === null || item === undefined) continue;
    if (typeof item === 'string') out.push(item);
    else for (const [name, on] of Object.entries(item)) if (on) out.push(name);
  }
  return out.join(' ');
}
