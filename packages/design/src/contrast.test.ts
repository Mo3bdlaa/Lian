/* tokens-raw:allow-hex — this file IS the colour arithmetic: it verifies the
   gate's own maths against the ratios TOKENS.md publishes, so the values under
   test have to be literal. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contrastRatio, relativeLuminance, parseHex, CONTRAST_FLOOR } from './contrast.ts';

test('contrast: known anchors', () => {
  assert.equal(Math.round(contrastRatio('#000000', '#FFFFFF') * 100) / 100, 21);
  assert.equal(contrastRatio('#FFFFFF', '#FFFFFF'), 1);
  // order independent
  assert.equal(contrastRatio('#3B2948', '#FFF8F3'), contrastRatio('#FFF8F3', '#3B2948'));
});

test('contrast: matches the ratios TOKENS.md publishes for the day palette', () => {
  // TOKENS.md §6: --text on --canvas = 12.51, --muted on --canvas = 5.90
  assert.equal(Math.round(contrastRatio('#3B2948', '#FFF8F3') * 100) / 100, 12.51);
  assert.equal(Math.round(contrastRatio('#6B5B76', '#FFF8F3') * 100) / 100, 5.9);
  // quiet: --muted on --surface = 4.51, the lowest ratio in the set
  assert.equal(Math.round(contrastRatio('#6E6774', '#EFE8EA') * 100) / 100, 4.51);
});

test('contrast: shorthand hex and luminance bounds', () => {
  assert.deepEqual(parseHex('#fff'), { r: 255, g: 255, b: 255 });
  assert.equal(relativeLuminance(parseHex('#000000')), 0);
  assert.equal(relativeLuminance(parseHex('#FFFFFF')), 1);
});

test('contrast: floors are the three from LESSONS §9', () => {
  assert.equal(CONTRAST_FLOOR.text, 4.5);
  assert.equal(CONTRAST_FLOOR.boundary, 3);
  assert.equal(CONTRAST_FLOOR.decoration, 0);
});
