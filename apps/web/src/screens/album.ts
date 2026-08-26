// Health and the album (UI-UX §26, §27).
//
// Both screens are review surfaces, and both are shaped by what they REFUSE
// to show. Health has no calories, no macros, no score, no rings, no grades
// and no streak — and the view it renders has nowhere to put one, so the
// absence survives a future edit rather than depending on this file staying
// disciplined. The album has no upload form, no likes and no comments: an
// item is a picture that arrived in a conversation, and the only action on it
// is going back to where it was said.
import { html, icon, type Html } from '../dom.ts';
import { t } from '../copy.ts';
import { dateLabel, count } from '../format.ts';
import type { Snapshot } from '../state.ts';

export type Health = {
  from: string;
  observation: string | null;
  days: { day: string; label: string; entries: { id: string; kind: string; line: string; icon: string }[] }[];
  habits: { id: string; title: string; doneThisWeek: number }[];
};

export type Album = {
  items: { id: string; at: string; source: 'user' | 'assistant'; conversationId: string | null; messageId: string }[];
  hasOlder: boolean;
};

export function healthScreen(me: Snapshot, data: Health): Html {
  const language = me.user.language;
  const gender = me.assistant.gender;

  if (data.days.length === 0 && data.habits.length === 0) {
    return html`<h1 class="screen__title">${t('health.title', language, gender)}</h1>
      <div class="empty"><div class="empty__line">${t('health.empty', language, gender)}</div></div>`;
  }

  return html`
    <h1 class="screen__title">${t('health.title', language, gender)}</h1>
    ${data.observation === null
      // §26.2 wants one observation in her voice. When there is not enough to
      // notice anything, the screen says what it is instead of inventing one.
      ? html`<p class="screen__lede">${t('health.not_a_tracker', language, gender)}</p>`
      : html`<p class="observation">${data.observation}</p>`}

    ${data.days.map((day) => html`
      <div class="section">${dateLabel(day.day, language, me.user.timeZone)}</div>
      ${day.entries.map((entry) => html`<button class="row" data-action="open-health" data-id="${entry.id}">
        ${icon(entry.icon, 'sm', 'icon--muted')}
        <span class="row__label">${entry.line}</span>
      </button>`)}`)}

    ${data.habits.length === 0 ? '' : html`
      <div class="section">${t('health.habits', language, gender)}</div>
      ${data.habits.map((habit) => html`<div class="row row--static">
        ${icon('i-refresh', 'sm', 'icon--muted')}
        <span class="row__label">${habit.title}</span>
        <span class="row__value">${t('health.days_count', language, gender).replace('{n}', count(habit.doneThisWeek, language))}</span>
      </div>`)}`}
  `;
}

export function albumScreen(me: Snapshot, data: Album, viewing: string | null): Html {
  const language = me.user.language;
  const gender = me.assistant.gender;

  if (data.items.length === 0) {
    return html`<h1 class="screen__title">${t('album.title', language, gender)}</h1>
      <div class="empty"><div class="empty__line">${t('album.empty', language, gender)}</div></div>`;
  }

  const open = viewing === null ? null : data.items.find((item) => item.id === viewing) ?? null;

  return html`
    <h1 class="screen__title">${t('album.title', language, gender)}</h1>
    <div class="album">
      ${data.items.map((item) => html`<button class="album__cell" data-action="open-photo" data-id="${item.id}">
        <img src="/api/attachments/${item.id}" alt="" loading="lazy">
      </button>`)}
    </div>
    ${!data.hasOlder ? '' : html`<button class="button button--plain" data-action="album-older">${t('album.more', language, gender)}</button>`}
    ${open === null ? '' : viewer(me, open)}
  `;
}

/**
 * The full-screen viewer (§27.4): edge to edge, a way out, where it came
 * from, and nothing else. No likes, no comments, no share — the spec lists
 * those as things NOT to build, and this is the screen they would go on.
 */
function viewer(me: Snapshot, item: Album['items'][number]): Html {
  const language = me.user.language;
  const gender = me.assistant.gender;
  const source = item.source === 'user'
    ? t('album.from_you', language, gender)
    : t('album.from_her', language, gender).replace('{name}', me.assistant.name);
  return html`<div class="viewer" data-action="close-photo">
    <img class="viewer__image" src="/api/attachments/${item.id}" alt="">
    <div class="viewer__bar">
      <span class="viewer__meta">${dateLabel(item.at.slice(0, 10), language, me.user.timeZone)} · ${source}</span>
      ${item.conversationId === null ? '' : html`<a class="button button--plain" href="/chat/${item.conversationId}" data-link>
        ${t('album.open_in_chat', language, gender)}
      </a>`}
      <button class="head__button" data-action="close-photo" aria-label="${t('album.close', language, gender)}">${icon('i-close', 'sm')}</button>
    </div>
  </div>`;
}
