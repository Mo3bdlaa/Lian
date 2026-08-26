// Her identity, her dials, quiet hours, and who you talk to.
// (UI-UX §15, §23, §28, Q13.)
//
// The dials are the load-bearing screen here, and what makes them right is
// what they are NOT: no sliders, no percentages, no "personality score". Q13
// says five dials with five NAMED stops each, and a stop is a way of being
// rather than an amount — so the control is a row of five words and the
// stored value is one of those words. A slider would be a number with a
// costume on, and a number is exactly what LESSONS §6 says this product does
// not show about a relationship.
import { html, icon, type Html } from '../dom.ts';
import { t } from '../copy.ts';
import type { Snapshot } from '../state.ts';

export type Settings = {
  user: { name: string | null };
  assistant: { name: string; gender: 'female' | 'male'; personality: Record<string, string> };
  quietHours: { enabled: boolean; startHour: number; endHour: number; days: number[]; allowSecurity: boolean };
  assistants: { id: string; name: string; gender: 'female' | 'male'; current: boolean }[];
};

export const DIALS = ['warmth', 'playfulness', 'proactivity', 'directness', 'encouragement'] as const;
export const STOPS = ['least', 'low', 'mid', 'high', 'most'] as const;

export function identityScreen(me: Snapshot, data: Settings): Html {
  const language = me.user.language;
  const gender = me.assistant.gender;
  return html`
    <h1 class="screen__title">${t('identity.title', language, gender)}</h1>

    <form class="card profile__section" data-action="save-setting" data-field="assistantName">
      <label class="profile__label" for="her-name">${t('identity.her_name', language, gender)}</label>
      <input class="field__input" id="her-name" name="value" value="${data.assistant.name}" autocomplete="off">
      <div class="profile__foot"><button class="button" type="submit">${t('action.save', language, gender)}</button></div>
    </form>

    <form class="card profile__section" data-action="save-setting" data-field="userName">
      <label class="profile__label" for="your-name">${t('identity.your_name', language, gender)}</label>
      <input class="field__input" id="your-name" name="value" value="${data.user.name ?? ''}" autocomplete="off">
      <div class="profile__foot"><button class="button" type="submit">${t('action.save', language, gender)}</button></div>
    </form>

    <div class="section">${t('identity.gender', language, gender)}</div>
    <div class="chips">
      ${(['female', 'male'] as const).map((option) => html`<button
          class="chip ${data.assistant.gender === option ? 'chip--on' : ''}"
          data-action="set-gender" data-key="${option}">
        ${t(option === 'female' ? 'identity.female' : 'identity.male', language, gender)}
      </button>`)}
    </div>
  `;
}

export function dialsScreen(me: Snapshot, data: Settings): Html {
  const language = me.user.language;
  const gender = me.assistant.gender;
  return html`
    <h1 class="screen__title">${t('dials.title', language, gender)}</h1>
    <p class="screen__lede">${t('dials.lede', language, gender)}</p>
    ${DIALS.map((dial) => html`
      <div class="section">${t(`dials.${dial}` as 'dials.warmth', language, gender)}</div>
      <div class="chips">
        ${STOPS.map((stop) => html`<button
            class="chip ${(data.assistant.personality[dial] ?? 'mid') === stop ? 'chip--on' : ''}"
            data-action="set-dial" data-key="${dial}" data-stop="${stop}">
          ${t(`dials.${stop}` as 'dials.mid', language, gender)}
        </button>`)}
      </div>`)}
  `;
}

/** Hours as a plain 0–23 list. No timezone picker: quiet hours are in the
 *  time zone the account already has, which is the one the briefing uses. */
const HOURS = Array.from({ length: 24 }, (_unused, hour) => hour);

export function quietHoursScreen(me: Snapshot, data: Settings): Html {
  const language = me.user.language;
  const gender = me.assistant.gender;
  const quiet = data.quietHours;
  return html`
    <h1 class="screen__title">${t('quiet.title', language, gender)}</h1>
    <p class="screen__lede">${t('quiet.lede', language, gender)}</p>

    <button class="row" data-action="toggle-quiet">
      <span class="row__label">${t('quiet.on', language, gender)}</span>
      ${icon(quiet.enabled ? 'i-check-circle' : 'i-dot', 'sm', 'icon--muted')}
    </button>

    ${!quiet.enabled ? '' : html`
      <div class="section">${t('quiet.from', language, gender)}</div>
      <div class="chips chips--wrap">
        ${HOURS.map((hour) => html`<button class="chip ${quiet.startHour === hour ? 'chip--on' : ''}"
            data-action="set-quiet-start" data-key="${String(hour)}">${String(hour).padStart(2, '0')}</button>`)}
      </div>
      <div class="section">${t('quiet.to', language, gender)}</div>
      <div class="chips chips--wrap">
        ${HOURS.map((hour) => html`<button class="chip ${quiet.endHour === hour ? 'chip--on' : ''}"
            data-action="set-quiet-end" data-key="${String(hour)}">${String(hour).padStart(2, '0')}</button>`)}
      </div>`}

    <p class="screen__lede">${t('quiet.security_always', language, gender)}</p>
  `;
}

/**
 * Who you talk to (UI-UX §15).
 *
 * One assistant today. The screen exists rather than being hidden because the
 * single-assistant state is one of the states the spec lists — and saying
 * "one, for now" is more honest than a drawer item that leads nowhere.
 */
export function assistantsScreen(me: Snapshot, data: Settings): Html {
  const language = me.user.language;
  const gender = me.assistant.gender;
  return html`
    <h1 class="screen__title">${t('assistants.title', language, gender)}</h1>
    ${data.assistants.map((assistant) => html`<div class="row row--static">
      ${icon('i-assistants', 'sm', 'icon--muted')}
      <span class="row__label">${assistant.name}
        ${assistant.current ? html`<span class="row__sub">${t('assistants.current', language, gender)}</span>` : ''}
      </span>
    </div>`)}
    ${data.assistants.length > 1 ? '' : html`<p class="screen__lede">${t('assistants.only_one', language, gender)}</p>`}
  `;
}
