// Search, the briefing screen, and About you (UI-UX §11, §10, §12).
//
// Three review surfaces that share one property: none of them says anything
// in her voice that she did not say. The briefing shows the message SHE sent
// this morning, read back; where she said nothing, the screen shows the
// blocks alone rather than composing a second version of her. About you is
// the user's own words, and the lede says plainly that she never edits them.
import { html, icon, type Html } from '../dom.ts';
import { t } from '../copy.ts';
import { dateLabel, money as formatMoney } from '../format.ts';
import type { Snapshot } from '../state.ts';

export type Search = {
  query: string;
  conversations: { id: string; title: string | null; hits: { messageId: string; role: 'user' | 'assistant'; snippet: string; at: string }[] }[];
  memories: { id: string; statement: string; typeLabel: string }[];
};

export type Briefing = {
  day: string;
  line: string | null;
  today: { id: string; title: string; done: boolean }[];
  carriedOver: { id: string; title: string; dueOn: string | null }[];
  habits: { id: string; title: string; doneToday: boolean }[];
  pattern: string | null;
  money: { outMinor: number; currency: string } | null;
};

export type Profile = { sections: { section: string; body: string }[] };

export function searchScreen(me: Snapshot, data: Search | null): Html {
  const language = me.user.language;
  const gender = me.assistant.gender;
  const query = data?.query ?? '';
  const found = data !== null && (data.conversations.length > 0 || data.memories.length > 0);

  return html`
    <h1 class="screen__title">${t('search.title', language, gender)}</h1>
    <div class="find">
      ${icon('i-search', 'sm', 'icon--muted')}
      <input class="find__input" name="q" data-action="search" autocomplete="off" value="${query}"
        placeholder="${t('search.placeholder', language, gender)}"
        aria-label="${t('search.placeholder', language, gender)}">
    </div>

    ${query.trim() === ''
      ? html`<div class="empty"><div>${t('search.start', language, gender)}</div></div>`
      : !found
        ? html`<div class="empty"><div>${t('search.nothing', language, gender)}</div></div>`
        : html`
          ${data.conversations.length === 0 ? '' : html`<div class="section">${t('search.in_conversations', language, gender)}</div>`}
          ${data.conversations.map((conversation) => html`
            <div class="find__group">${conversation.title ?? t('search.untitled', language, gender)}</div>
            ${conversation.hits.map((hit) => html`
              <a class="row" href="/chat/${conversation.id}#${hit.messageId}" data-link>
                ${icon(hit.role === 'user' ? 'i-person' : 'i-mark', 'sm', 'icon--muted')}
                <span class="row__label">${hit.snippet}
                  <span class="row__sub">${dateLabel(hit.at.slice(0, 10), language, me.user.timeZone)}</span>
                </span>
              </a>`)}`)}

          ${data.memories.length === 0 ? '' : html`<div class="section">${t('search.in_memories', language, gender)}</div>`}
          ${data.memories.map((memory) => html`<a class="row" href="/memory" data-link>
            ${icon('i-memory', 'sm', 'icon--muted')}
            <span class="row__label">${memory.statement}
              <span class="row__sub">${memory.typeLabel}</span>
            </span>
          </a>`)}`}
  `;
}

export function briefingScreen(me: Snapshot, data: Briefing): Html {
  const language = me.user.language;
  const gender = me.assistant.gender;
  const empty = data.today.length === 0 && data.carriedOver.length === 0 && data.habits.length === 0;

  return html`
    <h1 class="screen__title">${t('briefing.title', language, gender)}</h1>
    ${data.line === null ? '' : html`<p class="observation">${data.line}</p>`}

    ${empty && data.line === null
      ? html`<div class="empty"><div class="empty__line">${t('briefing.nothing', language, gender)}</div></div>`
      : html`
        ${data.today.length === 0 ? '' : html`
          <div class="section">${t('briefing.today', language, gender)}</div>
          ${data.today.map((task) => html`<button class="row" data-action="open-task" data-id="${task.id}">
            ${icon(task.done ? 'i-check-circle' : 'i-tasks', 'sm', 'icon--muted')}
            <span class="row__label ${task.done ? 'row__label--done' : ''}">${task.title}</span>
          </button>`)}`}

        ${data.carriedOver.length === 0 ? '' : html`
          <div class="section">${t('briefing.carried_over', language, gender)}</div>
          ${data.carriedOver.map((task) => html`<button class="row" data-action="open-task" data-id="${task.id}">
            ${icon('i-clock', 'sm', 'icon--muted')}
            <span class="row__label">${task.title}</span>
            <!-- A task that never had a date is here too, and says so:
                 an empty value slot beside "call the bank" reads as a
                 rendering failure rather than as an answer. -->
            <span class="row__value">${task.dueOn === null
              ? t('briefing.no_date', language, gender)
              : dateLabel(task.dueOn, language, me.user.timeZone)}</span>
          </button>`)}`}

        ${data.habits.length === 0 ? '' : html`
          <div class="section">${t('briefing.habits', language, gender)}</div>
          ${data.habits.map((habit) => html`<button class="row" data-action="open-task" data-id="${habit.id}">
            ${icon(habit.doneToday ? 'i-check-circle' : 'i-refresh', 'sm', 'icon--muted')}
            <span class="row__label ${habit.doneToday ? 'row__label--done' : ''}">${habit.title}</span>
          </button>`)}`}`}

    ${data.pattern === null ? '' : html`
      <div class="section">${t('briefing.pattern', language, gender)}</div>
      <p class="observation">${data.pattern}</p>`}

    ${data.money === null ? '' : html`
      <div class="section">${t('briefing.money', language, gender)}</div>
      <div class="row row--static">
        ${icon('i-money', 'sm', 'icon--muted')}
        <span class="row__label">${t('briefing.money', language, gender)}</span>
        <span class="row__value">${formatMoney(data.money.outMinor, data.money.currency, language)}</span>
      </div>`}

    <a class="button button--plain" href="/chat" data-link>${t('briefing.ask', language, gender)}</a>
  `;
}

const PROFILE_SECTIONS = ['about', 'should_know', 'notes'] as const;

/**
 * About you (UI-UX §12).
 *
 * A form, and allowed to be one: PRD §14 forbids a create-first flow for
 * things she captures, and this is not that — it is what the person says
 * about themselves, which nobody else can say for them. It renders into her
 * system prompt as the `profile` block and she never writes to it.
 */
export function profileScreen(me: Snapshot, data: Profile, saved: string | null): Html {
  const language = me.user.language;
  const gender = me.assistant.gender;
  const bodyOf = (section: string): string => data.sections.find((row) => row.section === section)?.body ?? '';

  return html`
    <h1 class="screen__title">${t('profile.title', language, gender)}</h1>
    <p class="screen__lede">${t('profile.lede', language, gender)}</p>
    ${PROFILE_SECTIONS.map((section) => html`
      <form class="card profile__section" data-action="save-profile" data-section="${section}">
        <label class="profile__label" for="profile-${section}">${t(`profile.${section}` as 'profile.about', language, gender)}</label>
        <textarea class="profile__field" id="profile-${section}" name="body" rows="4">${bodyOf(section)}</textarea>
        <div class="profile__foot">
          ${saved === section ? html`<span class="profile__saved">${t('profile.saved', language, gender)}</span>` : ''}
          <button class="button" type="submit">${t('action.save', language, gender)}</button>
        </div>
      </form>`)}
  `;
}
