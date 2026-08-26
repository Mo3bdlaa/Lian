// Generating the app icons from the mark.
//
//   node tools/icons.ts
//
// The PWA needs raster icons — the OS draws the home screen, and iOS in
// particular will not take an SVG. There is no rasteriser in this repository
// and adding one for six PNGs would be a dependency with a build step behind
// it, so the browser that is already here does the drawing: the mark on the
// brand canvas, screenshotted at each size.
//
// The output is committed. Regenerate it when the mark or the brand colour
// changes; the test in apps/web/src/pwa.test.ts fails if an icon the
// manifest names is missing.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { Browser, chromiumPath } from './browser.ts';
import { brandColor } from '@lian/design/server';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = `${ROOT}apps/web/icons`;

/** Sizes the manifest names, plus the maskable pair Android wants. */
const SIZES = [
  { size: 192, name: 'icon-192.png', maskable: false },
  { size: 512, name: 'icon-512.png', maskable: false },
  { size: 192, name: 'icon-192-maskable.png', maskable: true },
  { size: 512, name: 'icon-512-maskable.png', maskable: true },
] as const;

if (chromiumPath() === null) {
  console.error('no chromium available — icons unchanged');
  process.exit(69);
}

const mark = readFileSync(`${ROOT}design-system/lian-mark.svg`, 'utf8')
  .replace(/var\(--lian-brand-ink[^)]*\)/g, brandColor('brand-plum'));

mkdirSync(OUT, { recursive: true });
const browser = await Browser.launch();

for (const { size, name, maskable } of SIZES) {
  // Maskable icons are cropped to a circle by the OS, so the mark sits inside
  // the safe zone (80% of the width) rather than filling the square.
  const inset = maskable ? 0.56 : 0.74;
  const page = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
    <style>svg{width:100%;height:auto;display:block}</style></head><body style="margin:0">
    <div style="width:${size}px;height:${size}px;background:${brandColor('brand-cream')};display:flex;align-items:center;justify-content:center">
      <div style="width:${Math.round(size * inset * (99.22 / 128))}px">${mark}</div>
    </div></body></html>`;
  await browser.setViewport(size, size, 1, false);
  await browser.goto(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`);
  writeFileSync(`${OUT}/${name}`, await browser.screenshot());
  console.log(`${name}  ${size}×${size}${maskable ? ' maskable' : ''}`);
}

await browser.close();
