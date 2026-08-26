import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { refreshMood, presentation, type MoodPorts } from './mood.ts';
import { MOODS } from '@lian/domain';

function fakePorts(messages: string[], unanswered = 0) {
  const stored: { mood: string }[] = [];
  const ports: MoodPorts = {
    async recentUserMessages() { return messages; },
    async unansweredStreak() { return unanswered; },
    async setMood(_a, mood) { stored.push({ mood }); },
  };
  return { ports, stored };
}

const NOW = new Date('2026-05-18T10:00:00Z');
const base = { assistantId: 'a-1', language: 'en' as const, now: NOW };

describe('Q9 mood is derived, never declared', () => {
  test('a heavy week reads quiet', async () => {
    const fake = fakePorts(['I am exhausted and the week has been rough', 'stressed about the presentation', 'sorry, hard day']);
    const result = await refreshMood(base, fake.ports);
    assert.equal(result.mood, 'quiet');
    assert.ok(result.signals.userAffect < 0);
    assert.deepEqual(fake.stored, [{ mood: 'quiet' }], 'stored once, read by both consumers');
  });

  test('a light and active week reads warm', async () => {
    const fake = fakePorts(Array.from({ length: 8 }, () => 'finally finished it, feeling good, thanks'));
    assert.equal((await refreshMood(base, fake.ports)).mood, 'warm');
  });

  test('silence reads quiet rather than warm — she does not perform warmth at no one', async () => {
    assert.equal((await refreshMood(base, fakePorts([]).ports)).mood, 'quiet');
  });

  test('her own unanswered messages lower the answered ratio, and nothing else does', async () => {
    const answered = await refreshMood(base, fakePorts(['a', 'b'], 0).ports);
    const ignored = await refreshMood(base, fakePorts(['a', 'b'], 4).ports);
    assert.equal(answered.signals.answeredRatio, 1);
    assert.ok(ignored.signals.answeredRatio < 1);
  });

  test('Arabic messages are read with the Arabic lexicon', async () => {
    const fake = fakePorts(['تعبان النهاردة، الشغل تقيل', 'مش قادر أركز']);
    const result = await refreshMood({ ...base, language: 'ar' }, fake.ports);
    assert.ok(result.signals.userAffect < 0, 'the heuristic must work in both languages, not only in English');
    assert.equal(result.mood, 'quiet');
  });
});

describe('one mood, two consumers', () => {
  test('the same value picks the palette and the phrase', () => {
    const day = presentation('warm', { localHour: 14, preference: 'auto', language: 'en', gender: 'female', incognito: false });
    assert.equal(day.theme, 'day');
    assert.equal(day.phrase, 'Feeling warm today');

    const night = presentation('warm', { localHour: 2, preference: 'auto', language: 'en', gender: 'female', incognito: false });
    assert.equal(night.theme, 'night-warm', 'warm at 2am stays night with warmer accents');
    assert.equal(night.phrase, 'Late-night warmth');
  });

  test('every mood × band has an authored phrase in both languages', () => {
    for (const mood of MOODS) {
      for (const hour of [14, 2]) {
        for (const language of ['en', 'ar'] as const) {
          const { phrase } = presentation(mood, { localHour: hour, preference: 'auto', language, gender: 'female', incognito: false });
          assert.ok(phrase.length > 0, `${mood} at ${hour}h in ${language} has no phrase`);
        }
      }
    }
  });

  test('PRD §27 incognito suppresses the mood label entirely', () => {
    const { phrase, theme } = presentation('warm', { localHour: 14, preference: 'auto', language: 'en', gender: 'female', incognito: true });
    assert.equal(phrase, 'Incognito', 'the role line shows instead of how she feels');
    assert.equal(theme, 'day', 'but the palette still follows mood and time');
  });

  test('the accessibility override pins luminance without flattening mood', () => {
    const themes = MOODS.map((mood) => presentation(mood, { localHour: 14, preference: 'always-dark', language: 'en', gender: 'female', incognito: false }).theme);
    assert.deepEqual(themes, ['night-warm', 'night-quiet', 'night']);
  });
});
