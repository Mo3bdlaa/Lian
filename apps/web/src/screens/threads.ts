// The conversation switcher (UI-UX §14).
//
// A sheet rather than a screen, because switching thread is something you do
// from inside a conversation rather than a place you go. Three kinds, and the
// difference between them is stated on the sheet rather than assumed:
//
//   main       where she lives. It cannot be closed.
//   side       same memory, same her, separate thread.
//   incognito  nothing here is kept — and the sheet says so in the words the
//              spec gives, before anybody starts one.
import { html, icon, type Html } from '../dom.ts';
import { t } from '../copy.ts';
import { count } from '../format.ts';
import type { Snapshot } from '../state.ts';

export type Thread = {
  id: string;
  kind: 'main' | 'side' | 'incognito';
  title: string | null;
  retention: 'persist' | 'ephemeral';
  lastMessageAt: string | null;
  messages: number;
  current: boolean;
};

const KIND_COPY = { main: 'threads.main', side: 'threads.side', incognito: 'threads.incognito' } as const;
const KIND_ICON = { main: 'i-chat', side: 'i-reply', incognito: 'i-incognito' } as const;

export function threadSheet(me: Snapshot, threads: Thread[], openId: string | null): Html {
  const language = me.user.language;
  const gender = me.assistant.gender;
  return html`
    <button class="scrim" data-action="close-threads" aria-label="${t('action.close', language, gender)}"></button>
    <div class="sheet" role="dialog" aria-label="${t('threads.title', language, gender)}">
      <div class="sheet__title">${t('threads.title', language, gender)}</div>

      ${threads.map((thread) => html`<div class="thread ${thread.id === openId ? 'thread--open' : ''}">
        <button class="row" data-action="open-thread" data-id="${thread.id}">
          ${icon(KIND_ICON[thread.kind], 'sm', 'icon--muted')}
          <span class="row__label">${thread.title ?? t(KIND_COPY[thread.kind], language, gender)}
            <span class="row__sub">
              ${thread.messages === 0
                ? t('threads.empty_thread', language, gender)
                : t('threads.messages', language, gender).replace('{n}', count(thread.messages, language))}
            </span>
          </span>
          ${thread.current ? icon('i-check', 'sm', 'icon--muted') : ''}
        </button>
        ${thread.kind === 'main' ? '' : html`<button class="button button--plain thread__end"
            data-action="end-thread" data-id="${thread.id}" data-kind="${thread.kind}">
          ${t(thread.kind === 'incognito' ? 'threads.delete_incognito' : 'threads.close', language, gender)}
        </button>`}
      </div>`)}

      <div class="section">${t('threads.side', language, gender)}</div>
      <p class="sheet__note">${t('threads.side_note', language, gender)}</p>
      <button class="button button--block" data-action="new-thread" data-kind="side">
        ${t('threads.new_side', language, gender)}
      </button>

      <div class="section">${t('threads.incognito', language, gender)}</div>
      <!-- §14's short phrase, verbatim, BEFORE anybody starts one. The
           detail below it is the same promise spelled out. -->
      <p class="sheet__note sheet__note--strong">${t('threads.incognito_note', language, gender)}</p>
      <p class="sheet__note">${t('threads.incognito_detail', language, gender)}</p>
      <button class="button button--quiet button--block" data-action="new-thread" data-kind="incognito">
        ${t('threads.new_incognito', language, gender)}
      </button>
    </div>`;
}

/**
 * The at-a-glance incognito state (UI-UX §14).
 *
 * A tinted strip above the conversation with the label and the sentence. It
 * is rendered from the thread's RETENTION rather than from a client flag: the
 * server decides what is kept, and a banner that could disagree with it would
 * be worse than no banner.
 */
export function incognitoBanner(me: Snapshot): Html {
  const language = me.user.language;
  const gender = me.assistant.gender;
  return html`<div class="incognito" role="note">
    ${icon('i-incognito', 'sm')}
    <span>${t('threads.incognito_note', language, gender)}</span>
  </div>`;
}
