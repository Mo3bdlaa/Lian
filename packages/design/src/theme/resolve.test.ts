import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTheme, themeFor, timeBand, isDark, NIGHT_BAND } from './resolve.ts';
import { MOODS } from '@lian/domain';
import type { Mood } from '@lian/domain';
import type { ThemeName, ThemePreference } from './resolve.ts';

test('theme: three moods × two bands produce the five palettes', () => {
  const produced = new Set<ThemeName>();
  for (const band of ['day', 'night'] as const) for (const mood of MOODS) produced.add(themeFor(band, mood));
  assert.deepEqual([...produced].sort(), ['day', 'night', 'night-quiet', 'night-warm', 'quiet']);
});

test('theme: warm at 2am stays night with warmer accents (design.md §16)', () => {
  assert.equal(resolveTheme({ localHour: 2, mood: 'warm', preference: 'auto' }), 'night-warm');
  assert.equal(resolveTheme({ localHour: 2, mood: 'quiet', preference: 'auto' }), 'night-quiet');
  assert.equal(resolveTheme({ localHour: 2, mood: 'neutral', preference: 'auto' }), 'night');
});

test('theme: night band boundaries are the named constant', () => {
  assert.equal(timeBand(NIGHT_BAND.startsHour - 1), 'day');
  assert.equal(timeBand(NIGHT_BAND.startsHour), 'night');
  assert.equal(timeBand(NIGHT_BAND.endsHour - 1), 'night');
  assert.equal(timeBand(NIGHT_BAND.endsHour), 'day');
  assert.equal(timeBand(0), 'night');
});

test('theme: an out-of-range hour is an error, not a default (LESSONS §1 posture)', () => {
  assert.throws(() => timeBand(24), RangeError);
  assert.throws(() => timeBand(-1), RangeError);
  assert.throws(() => timeBand(2.5), RangeError);
});

test('theme: the override pins luminance without flattening mood', () => {
  // always-dark at noon: dark, but still three distinguishable appearances.
  const dark = MOODS.map((mood: Mood) => resolveTheme({ localHour: 12, mood, preference: 'always-dark' }));
  assert.deepEqual(dark, ['night-warm', 'night-quiet', 'night']);
  assert.ok(dark.every(isDark));
  // always-light at 3am: light, and quiet still reads as quiet.
  const light = MOODS.map((mood: Mood) => resolveTheme({ localHour: 3, mood, preference: 'always-light' }));
  assert.deepEqual(light, ['day', 'quiet', 'day']);
  assert.ok(light.every((t) => !isDark(t)));
});

test('theme: auto is the only preference that follows the clock', () => {
  const prefs: ThemePreference[] = ['auto', 'always-light', 'always-dark'];
  const byPref = prefs.map((preference) => [
    resolveTheme({ localHour: 12, mood: 'warm', preference }),
    resolveTheme({ localHour: 2, mood: 'warm', preference }),
  ]);
  assert.deepEqual(byPref[0], ['day', 'night-warm']); // auto changes with the hour
  assert.deepEqual(byPref[1], ['day', 'day']);
  assert.deepEqual(byPref[2], ['night-warm', 'night-warm']);
});

test('theme: resolution is total — every input produces a defined palette', () => {
  for (let hour = 0; hour < 24; hour++) {
    for (const mood of MOODS) {
      for (const preference of ['auto', 'always-light', 'always-dark'] as ThemePreference[]) {
        const theme = resolveTheme({ localHour: hour, mood, preference });
        assert.ok(['day', 'quiet', 'night', 'night-warm', 'night-quiet'].includes(theme));
      }
    }
  }
});
