// The document.
//
// Server-rendered, and deliberately thin: two attributes on <html>, the
// stylesheets, the icon sprite, and one module. Everything else is the
// client.
//
// The two attributes are the point. LESSONS §7: the runtime writes ONE
// attribute and never a colour, and the server writes the same one — from the
// cookie before the session is known, and from the resolved theme after. The
// pre-hydration script repeats it from the cookie so there is no flash, and
// computes nothing resolve.ts does not.
import { preHydrationScript, themeAttributes, type Direction, type ThemeName } from '@lian/design';

export type ShellOptions = {
  readonly theme: ThemeName;
  readonly direction: Direction;
  readonly themeColor: string;
  readonly version: string;
  readonly title: string;
};

export function shell(options: ShellOptions): string {
  const attributes = themeAttributes(options.theme, options.direction);
  const attributeText = Object.entries(attributes).map(([name, value]) => `${name}="${value}"`).join(' ');
  const v = encodeURIComponent(options.version);
  return `<!doctype html>
<html ${attributeText} lang="${options.direction === 'rtl' ? 'ar' : 'en'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${options.title}</title>
<meta name="theme-color" content="${options.themeColor}">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icons/icon-192.png">
<link rel="apple-touch-icon" href="/icons/icon-192.png">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700&family=Tajawal:wght@400;500;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/lian-tokens.css?v=${v}">
<link rel="stylesheet" href="/css/lian-type-roles.css?v=${v}">
<link rel="stylesheet" href="/css/app.css?v=${v}">
<script>${preHydrationScript(options.theme, options.direction)}</script>
<script src="/lian-defs.js?v=${v}" defer></script>
</head>
<body>
<div id="app" class="app"></div>
<noscript>Lian needs JavaScript.</noscript>
<script type="module" src="/m/apps/web/src/main.js?v=${v}"></script>
</body>
</html>`;
}
