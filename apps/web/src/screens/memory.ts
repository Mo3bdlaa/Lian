// Memory (UI-UX §5).
//
// The trust screen. Everything she remembers, in her words, each one showing
// where it came from and each one removable. Three things the spec is firm
// about and this screen implements literally:
//
//   - every memory is editable and deletable, with no ceremony
//   - provenance is shown ("From your message on 18 May"), and a memory whose
//     source was deleted says so rather than appearing from nowhere
//   - the free plan's queue is VISIBLE (PRD §35): what she noticed and has
//     not been able to keep is a state, not a silent drop
import { html, icon, type Html } from '../dom.ts';
import { t } from '../copy.ts';
import { count, dateLabel } from '../format.ts';
import type { Snapshot } from '../state.ts';

export type Memory = {
  id: string; type: string; typeLabel: string; statement: string; status: 'active' | 'pending';
  createdAt: string; sourceMessageId: string | null; sourceRemovedKept: boolean;
};

export type MemoryState = {
  me: Snapshot;
  memories: Memory[];
  query: string;
  filter: string;
  editing: Memory | null;
  deleting: Memory | null;
};

const FILTERS = [
  { key: 'all', copy: 'memory.filter_all' },
  { key: 'fact', copy: 'memory.filter_fact' },
  { key: 'preference', copy: 'memory.filter_preference' },
  { key: 'topic', copy: 'memory.filter_topic' },
  { key: 'moment', copy: 'memory.filter_moment' },
  { key: 'person', copy: 'memory.filter_person' },
] as const;

export function memoryScreen(state: MemoryState): Html {
  const { me } = state;
  const language = me.user.language;
  const gender = me.assistant.gender;
  const shown = state.memories.filter((memory) => state.filter === 'all' || memory.type === state.filter);
  const kept = state.me.limits.memoriesKept;

  return html`
    <h1 class="screen__title">${t('memory.title', language, gender)}</h1>
    ${me.user.plan === 'free' ? html`<p class="screen__lede"
      >${state.me.limits.capacityLine} ${t('memory.kept_so_far', language, gender).replace('{n}', count(kept, language))}</p>` : ''}

    <input class="field__input" data-action="memory-search" value="${state.query}"
      placeholder="${t('memory.search', language, gender)}" aria-label="${t('memory.search', language, gender)}">

    <div class="chips">
      ${FILTERS.map((filter) => html`<button class="chip ${filter.key === state.filter ? 'chip--on' : ''}"
          data-action="memory-filter" data-key="${filter.key}">
        ${t(filter.copy, language, gender)}
      </button>`)}
    </div>

    ${shown.length === 0
      ? html`<div class="empty"><div class="empty__line">${t('memory.empty', language, gender)}</div></div>`
      : shown.map((memory) => memoryCard(memory, state))}
  `;
}

function memoryCard(memory: Memory, state: MemoryState): Html {
  const language = state.me.user.language;
  const gender = state.me.assistant.gender;
  return html`<article class="card memory ${memory.status === 'pending' ? 'memory--pending' : ''}" data-memory="${memory.id}">
    <div class="memory__type">
      ${memory.status === 'pending' ? t('memory.pending_title', language, gender) : memory.typeLabel}
    </div>
    <p class="memory__statement">${memory.statement}</p>
    <div class="memory__foot">
      <span class="memory__source">
        ${memory.sourceRemovedKept
          ? t('memory.source_removed', language, gender)
          : html`${t('memory.from_message', language, gender)} ${dateLabel(memory.createdAt.slice(0, 10), language, state.me.user.timeZone)}`}
      </span>
      <span class="memory__actions">
        <button class="head__button" data-action="memory-edit" data-id="${memory.id}" aria-label="${t('action.edit', language, gender)}">${icon('i-edit', 'sm')}</button>
        <button class="head__button" data-action="memory-delete" data-id="${memory.id}" aria-label="${t('action.delete', language, gender)}">${icon('i-trash', 'sm')}</button>
      </span>
    </div>
  </article>`;
}

/** Editing is a sheet with her sentence in a field, not a form with labels. */
export function memoryEditor(state: MemoryState): Html {
  const memory = state.editing!;
  const language = state.me.user.language;
  const gender = state.me.assistant.gender;
  return html`
    <button class="scrim" data-action="close-sheet" aria-label="${t('action.close', language, gender)}"></button>
    <form class="sheet" data-action="memory-save" data-id="${memory.id}">
      <div class="sheet__title">${t('memory.edit_title', language, gender)}</div>
      <textarea class="field__input memory__field" name="statement" rows="3">${memory.statement}</textarea>
      <div class="sheet__row">
        <button class="button button--quiet" type="button" data-action="close-sheet">${t('action.cancel', language, gender)}</button>
        <button class="button" type="submit">${t('action.save', language, gender)}</button>
      </div>
    </form>`;
}

export function memoryDeleteSheet(state: MemoryState): Html {
  const memory = state.deleting!;
  const language = state.me.user.language;
  const gender = state.me.assistant.gender;
  return html`
    <button class="scrim" data-action="close-sheet" aria-label="${t('action.close', language, gender)}"></button>
    <div class="sheet" role="dialog">
      <div class="sheet__title">${t('memory.delete_title', language, gender)}</div>
      <p class="sheet__body">${t('memory.delete_body', language, gender)}</p>
      <div class="sheet__row">
        <button class="button button--quiet" data-action="close-sheet">${t('action.cancel', language, gender)}</button>
        <button class="button button--destructive" data-action="memory-delete-confirm" data-id="${memory.id}">${t('action.delete', language, gender)}</button>
      </div>
    </div>`;
}
