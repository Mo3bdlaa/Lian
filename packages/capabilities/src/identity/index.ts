// Identity — what to call them, what language, what to call her.
//
// Named for what it captures rather than for when it runs.  The first draft
// called it `onboarding`, which collided with the SURFACE of the same name
// and made "a capability id appears nowhere outside its directory" fail
// against the surface enum.  That was a real smell rather than a fussy test:
// the capability is offered during onboarding, but the facts it captures are
// identity facts, and they can be changed later on a settings screen.
//
// It is not a wizard.  It is three facts she can capture from ordinary
// conversation, which is exactly what a capability is (LESSONS §13).  Its
// promptFragment returns null on every surface except onboarding, so she is
// not told about these tags for the rest of the relationship.
//
// PRD §14 still holds: no forms.  These are captured from what the person
// says, in whatever order they say it.
import type { Capability, CaptureOutcome, ExportSlice } from '@lian/domain';
import type { CapabilityPorts } from '../ports.ts';
import { line } from '../copy.ts';
// The eight names are authored once, in the catalogue, in both languages —
// inlining them here would be a second copy of a list the spec says to use
// exactly (UI-UX §47).
import { t, type CopyKey } from '@lian/i18n';

const LANGUAGE_STYLES = ['auto', 'en', 'ar-eg', 'ar-lv', 'ar-gulf', 'ar-mgh', 'ar-msa', 'fr'] as const;

type NamePayload = { name?: unknown };
type LanguagePayload = { style?: unknown };
type HerNamePayload = { name?: unknown; chosenByThem?: unknown };

export const identityCapability: Capability<CapabilityPorts> = {
  id: 'identity',

  tags: [
    { name: 'call_me', payload: true, usage: '{"name":"Adam"} — what they said to call them. Their name as they gave it, not a guess from their email.' },
    { name: 'language', payload: true, usage: `{"style":"${LANGUAGE_STYLES.join('|')}"} — the language they chose. Use 'auto' only if they said to match them.` },
    { name: 'my_name', payload: true, usage: '{"name":"Noor","chosenByThem":true} — the name they gave YOU. Set chosenByThem to false if you picked it because they asked you to.' },
  ],

  // Only during onboarding.  After that these are settings, changed on a
  // settings screen, and telling her about them every turn would invite her
  // to re-ask questions that are already answered.
  promptFragment(context) {
    if (context.surface !== 'onboarding') return null;
    return context.language === 'ar'
      ? 'حفظ اسم الشخص، واللغة اللي يفضلها، والاسم اللي يختاره ليك.'
      : 'Record what they want to be called, the language they prefer, and the name they give you.';
  },

  async describe() {
    // Nothing, deliberately.
    //
    // The inline confirmation row (UI-UX §4) is a MOMENT: "Adam", the instant
    // she records it. Reading the conversation back later, all three identity
    // tags point at the same row — the person, or her — so they cannot be
    // told apart by entity id, and three identical chips saying the person's
    // name would be noise. These facts are corrected on the settings screen,
    // which is where the capture row's route already points.
    return {};
  },

  async contextFragment() {
    // The onboarding block in the prompt already says what is still unknown;
    // repeating it here would be two sources for one fact.
    return null;
  },

  async handle({ context, tag }, ports): Promise<CaptureOutcome> {
    const payload = tag.payload ?? {};

    if (tag.name === 'call_me') {
      const name = typeof (payload as NamePayload).name === 'string' ? (payload as NamePayload).name as string : '';
      if (name.trim().length < 1 || name.length > 60) return { ok: false, reason: 'not a usable name' };
      await ports.identity.setUserName(context.userId, name.trim());
      return {
        ok: true, entityTable: 'users', entityId: context.userId,
        summary: { capability: 'identity', icon: 'i-person', line: name.trim(), correctionRoute: '/profile' },
      };
    }

    if (tag.name === 'language') {
      const style = (payload as LanguagePayload).style;
      if (typeof style !== 'string' || !(LANGUAGE_STYLES as readonly string[]).includes(style)) {
        return { ok: false, reason: 'not one of the languages offered' };
      }
      await ports.identity.setLanguage(context.userId, style);
      return {
        ok: true, entityTable: 'users', entityId: context.userId,
        // The NAME of the language, not its code. This chip is the moment
        // she confirms what she heard — the first correction a new person is
        // offered — and it read `ar-eg`. The eight names were authored for
        // the model's prompt and nowhere for the person (UI-UX §47).
        summary: {
          capability: 'identity', icon: 'i-language',
          // Gender is not passed: these eight are language NAMES, with no
          // masculine variant to choose between.
          line: t(`language.${style}` as CopyKey, context.language),
          correctionRoute: '/settings/language',
        },
      };
    }

    const name = typeof (payload as HerNamePayload).name === 'string' ? (payload as HerNamePayload).name as string : '';
    if (name.trim().length < 1 || name.length > 40) return { ok: false, reason: 'not a usable name' };
    // Q18: they always get to name her.  `chosenByThem: false` means she
    // picked it because they asked her to — which is a different fact from
    // never having been asked, and the settings screen can tell them apart.
    await ports.identity.setAssistantName(context.assistantId, name.trim(), (payload as HerNamePayload).chosenByThem !== false);
    return {
      ok: true, entityTable: 'assistants', entityId: context.assistantId,
      summary: { capability: 'identity', icon: 'i-mark', line: name.trim(), correctionRoute: '/settings/identity' },
    };
  },

  async exportFor(userId, ports): Promise<ExportSlice[]> {
    return [{ name: 'identity', rows: await ports.identity.exportFor(userId) }];
  },

  async purgeFor() {
    // The user row and the assistant row are deleted wholesale by account
    // deletion; there is nothing this capability owns separately.  Stated
    // rather than left implicit, because an empty purge is otherwise
    // indistinguishable from a forgotten one.
  },
};

export { LANGUAGE_STYLES };
