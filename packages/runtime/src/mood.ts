// Refreshing her mood.
//
// Q9: derived from signals, stored once, read by exactly two consumers — the
// state line of the assembled prompt, and theme resolution.  Both read the
// same stored value, so the palette and the way she writes cannot disagree.
//
// The theme machinery has existed since the first night with nothing real to
// resolve from.  This is the thing it resolves from.
import { deriveMood, affectFromMessages, activityFromCount, type Mood } from '@lian/domain';
import { resolveTheme, timeBand, type ThemeName, type ThemePreference } from '@lian/design';
import { moodPhrase, type Language, type AssistantGender } from '@lian/i18n';

export type MoodPorts = {
  /** The user's own recent messages, newest first.  Incognito is excluded by
   *  the repository — nothing said there shapes how she feels (Q12). */
  recentUserMessages(assistantId: string, since: Date, limit: number): Promise<string[]>;
  unansweredStreak(assistantId: string): Promise<number>;
  setMood(assistantId: string, mood: Mood, signals: unknown): Promise<void>;
};

export const AFFECT_WINDOW_HOURS = 36;
const SAMPLE = 30;

export type MoodRefresh = {
  readonly mood: Mood;
  readonly signals: { answeredRatio: number; recentActivity: number; userAffect: number };
};

export async function refreshMood(
  input: { assistantId: string; language: Language; now: Date },
  ports: MoodPorts,
): Promise<MoodRefresh> {
  const since = new Date(input.now.getTime() - AFFECT_WINDOW_HOURS * 60 * 60 * 1000);
  const messages = await ports.recentUserMessages(input.assistantId, since, SAMPLE);
  const unanswered = await ports.unansweredStreak(input.assistantId);

  const signals = {
    // Her own unanswered messages only — the same count LESSONS §4 governs,
    // read through the same repository function.
    answeredRatio: unanswered === 0 ? 1 : 1 / (1 + unanswered),
    recentActivity: activityFromCount(messages.length),
    userAffect: affectFromMessages(messages, input.language === 'ar' ? 'ar' : 'en'),
  };

  const mood = deriveMood(signals);
  await ports.setMood(input.assistantId, mood, signals);
  return { mood, signals };
}

/** The header line and the palette, from one mood.  Two consumers, one value. */
export function presentation(
  mood: Mood,
  input: { localHour: number; preference: ThemePreference; language: Language; gender: AssistantGender; incognito: boolean },
): { theme: ThemeName; phrase: string } {
  const band = timeBand(input.localHour);
  return {
    theme: resolveTheme({ localHour: input.localHour, mood, preference: input.preference }),
    phrase: moodPhrase(input.incognito ? 'incognito' : mood, band, input.language, input.gender),
  };
}
