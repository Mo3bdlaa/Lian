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
import { MAX_SCENARIO_LENGTH } from '@lian/domain';
import type { Snapshot } from '../state.ts';

export type Thread = {
  id: string;
  kind: 'main' | 'side' | 'incognito';
  title: string | null;
  retention: 'persist' | 'ephemeral';
  /** PRD §27's role. Null on everything that is not incognito. */
  scenarioText: string | null;
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
      <!-- UI-UX §46: the role is asked for HERE, on the start sheet, because
           a role set after the first message has already missed the message
           it was for. Optional, and the label says so. -->
      <label class="field">
        <span class="field__label">${t('scenario.ask', language, gender)}</span>
        <textarea class="field__input" name="scenarioText" rows="2"
          maxlength="${String(MAX_SCENARIO_LENGTH)}"
          placeholder="${t('scenario.example_1', language, gender)}"></textarea>
      </label>
      <p class="sheet__note">${t('scenario.optional', language, gender)}</p>
      <button class="button button--quiet button--block" data-action="new-thread" data-kind="incognito">
        ${t('threads.new_incognito', language, gender)}
      </button>
    </div>`;
}

/**
 * The persistent role chip (UI-UX §46), which is also the incognito banner.
 *
 * One element rather than two, because they say the same thing at the same
 * moment and a second strip above the conversation is a second thing to keep
 * in step. It is a BUTTON: §46's edit, clear and delete all hang off tapping
 * it, and there is nowhere else in the conversation they could hang from.
 *
 * Rendered from the thread's RETENTION and the server's copy of the role —
 * never from a client flag, because a chip that disagreed with what is
 * actually in the prompt is worse than no chip at all.
 */
export function incognitoChip(me: Snapshot, role: string | null): Html {
  const language = me.user.language;
  const gender = me.assistant.gender;
  return html`<button class="incognito" data-action="scenario">
    ${icon('i-incognito', 'sm')}
    <span class="incognito__lines">
      <span>${t('threads.incognito_note', language, gender)}</span>
      ${role === null ? '' : html`<span class="incognito__role">${t('scenario.playing', language, gender).replace('{role}', role)}</span>`}
    </span>
  </button>`;
}

/**
 * Edit the role, clear it, or delete the thread — §46's three, on one sheet.
 *
 * The textarea is prefilled with what is actually in effect, which is the
 * server's copy: someone who edits, fails, and reopens the sheet sees the
 * role she is still playing rather than the one they tried to set.
 */
export function scenarioSheet(me: Snapshot, thread: Thread): Html {
  const language = me.user.language;
  const gender = me.assistant.gender;
  return html`
    <button class="scrim" data-action="close-scenario" aria-label="${t('action.close', language, gender)}"></button>
    <div class="sheet" role="dialog" aria-label="${t('scenario.title', language, gender)}">
      <div class="sheet__title">${t('scenario.title', language, gender)}</div>
      <p class="sheet__note">${t('scenario.note', language, gender)}</p>
      <label class="field">
        <span class="field__label">${t('scenario.ask', language, gender)}</span>
        <textarea class="field__input" name="scenarioText" rows="3"
          maxlength="${String(MAX_SCENARIO_LENGTH)}"
          placeholder="${t('scenario.example_2', language, gender)}">${thread.scenarioText ?? ''}</textarea>
      </label>
      <button class="button button--block" data-action="scenario-save" data-id="${thread.id}">
        ${t('scenario.save', language, gender)}
      </button>
      ${thread.scenarioText === null ? '' : html`<button class="button button--plain button--block"
          data-action="scenario-clear" data-id="${thread.id}">
        ${t('scenario.clear', language, gender)}
      </button>`}
      <button class="button button--destructive button--block"
        data-action="end-thread" data-id="${thread.id}" data-kind="incognito">
        ${t('threads.delete_incognito', language, gender)}
      </button>
    </div>`;
}
