// Health.
//
// PRD §6.6 / UI-UX §26: conversational context, NOT a tracker.  No calories,
// no macros, no body score, no rings, no streak pressure, no grades — and the
// absence has to survive contact with a language model, which will happily
// volunteer a calorie estimate if nothing tells it not to.  So the prompt
// fragment says so, and there is nowhere to put a number if it did.
import type { Capability, CaptureOutcome, ExportSlice, OutreachCandidate } from '@lian/domain';
import type { CapabilityPorts, HealthRecord } from '../ports.ts';
import { line } from '../copy.ts';

type HealthPayload = { kind?: unknown; description?: unknown; at?: unknown; minutes?: unknown };

const KINDS = ['meal', 'workout', 'medication'] as const;

function startOfWeek(localDay: string): Date {
  const day = new Date(`${localDay}T00:00:00Z`);
  const isoWeekday = ((day.getUTCDay() + 6) % 7) + 1;
  return new Date(day.getTime() - (isoWeekday - 1) * 24 * 60 * 60 * 1000);
}

/**
 * One observation in her voice (UI-UX §26.2), from what is actually there.
 *
 * Deliberately not a model call: an observation invented by a model about
 * someone's health is the exact "false sense of certainty" PRD §19 lists as a
 * risk.  These are arithmetic about what was logged, or nothing.
 */
export function observe(entries: readonly HealthRecord[], language: 'en' | 'ar'): string | null {
  const workouts = entries.filter((entry) => entry.kind === 'workout');
  if (workouts.length >= 2) {
    const mornings = workouts.filter((entry) => entry.occurredAt.getUTCHours() < 12).length;
    if (mornings >= workouts.length - 1 && mornings >= 2) {
      return line(language, 'You have been moving in the mornings this week.', 'الحركة بقت الصبح الأسبوع ده.');
    }
    return line(language, `That is ${workouts.length} times you have moved this week.`, `دي ${workouts.length} مرات حركة الأسبوع ده.`);
  }
  const meals = entries.filter((entry) => entry.kind === 'meal');
  if (meals.length >= 4) {
    return line(language, 'You have been eating at home more this week.', 'الأكل بقى في البيت أكتر الأسبوع ده.');
  }
  return null;
}

export const healthCapability: Capability<CapabilityPorts> = {
  id: 'health',

  tags: [
    {
      name: 'health', payload: true,
      usage: '{"kind":"meal|workout|medication","description":"grilled salmon, rice and salad","at":"2026-05-18T13:00:00Z","minutes":30} — something they ate, did, or took. Never add a number they did not say.',
    },
  ],

  promptFragment(context) {
    return context.language === 'ar'
      ? 'تسجيل الأكل والحركة والدوا لما يتقال. من غير سعرات ولا تقييم ولا درجات — ده سياق، مش متابعة.'
      : 'Note meals, movement and medication when they mention them. Never calories, macros, scores or grades — this is context, not tracking, and you do not estimate.';
  },

  async contextFragment(context, ports) {
    const from = startOfWeek(context.localDay);
    const to = new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);
    const entries = await ports.health.week(context.userId, from, to);
    if (entries.length === 0) return null;
    const observation = observe(entries, context.language);
    const counts = `${entries.filter((e) => e.kind === 'meal').length} meals, ${entries.filter((e) => e.kind === 'workout').length} workouts`;
    return observation === null
      ? line(context.language, `This week: ${counts}.`, `الأسبوع ده: ${counts}.`)
      : observation;
  },

  async handle({ context, tag, messageId }, ports): Promise<CaptureOutcome> {
    const payload = (tag.payload ?? {}) as HealthPayload;
    const kind = typeof payload.kind === 'string' && (KINDS as readonly string[]).includes(payload.kind)
      ? (payload.kind as HealthRecord['kind'])
      : null;
    if (kind === null) return { ok: false, reason: 'not a meal, a workout or a medication' };
    const description = typeof payload.description === 'string' ? payload.description.trim() : '';
    if (description.length < 2) return { ok: false, reason: 'nothing described' };

    const occurredAt = typeof payload.at === 'string' && !Number.isNaN(Date.parse(payload.at))
      ? new Date(payload.at)
      : new Date(`${context.localDay}T12:00:00Z`);
    const minutes = typeof payload.minutes === 'number' && Number.isFinite(payload.minutes) && payload.minutes > 0
      ? Math.round(payload.minutes)
      : null;

    const entry = await ports.health.create(context.userId, {
      kind, description, occurredAt, durationMinutes: minutes,
      originMessageId: messageId, originAssistantId: context.assistantId,
    });

    const label = minutes === null ? description : `${minutes} min · ${description}`;
    return {
      ok: true, entityTable: 'health_entries', entityId: entry.id,
      summary: {
        capability: 'health', icon: kind === 'workout' ? 'i-workout' : kind === 'medication' ? 'i-medication' : 'i-meal',
        line: label.length > 52 ? `${label.slice(0, 51)}…` : label,
        correctionRoute: `/health/${entry.id}`,
      },
    };
  },

  async proposeOutreach(context, ports): Promise<OutreachCandidate[]> {
    // Only ever an observation she noticed, never a nag about a missed day —
    // UI-UX §26.2 bans streak pressure, and a "you haven't logged" message is
    // streak pressure with a friendlier face.
    const from = startOfWeek(context.localDay);
    const to = new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);
    const entries = await ports.health.week(context.userId, from, to);
    const observation = observe(entries, context.language);
    if (observation === null) return [];
    return [{
      kind: 'pattern', source: 'assistant_initiated',
      scheduledFor: new Date(`${context.localDay}T18:00:00Z`),
      dedupeKey: `health:pattern:${context.localDay.slice(0, 7)}`,
      reason: observation,
    }];
  },

  async exportFor(userId, ports): Promise<ExportSlice[]> {
    return [{ name: 'health', rows: await ports.health.all(userId) }];
  },

  async purgeFor(userId, ports): Promise<void> {
    await ports.health.purge(userId);
  },
};
