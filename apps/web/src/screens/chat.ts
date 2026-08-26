// Chat.
//
// The screen the product is. Everything here is from UI-UX §3 (header,
// content, input), §4 (inline capture), §35 (reply), §36 (reactions), §37
// (streaming), §38 (the ~60-message window) and §39 (delete + provenance).
//
// Two rules shape the markup:
//   - Bubbles vary in width and are not cards in a list. "Avoid stacking
//     every message into a card" is the spec's line and the reason .bubble
//     has a max-width rather than a fixed one.
//   - Nothing here parses her text. Control tags are stripped server-side
//     before a byte reaches this file (LESSONS §3), so the client renders
//     what it is given — escaped, because a message body is text.
import { html, icon, type Html } from '../dom.ts';
import { t } from '../copy.ts';
import { dayOf, dateLabel, time } from '../format.ts';
import type { Message, Snapshot, State } from '../state.ts';

const REACTION_ICONS: Record<string, string> = {
  heart: 'i-heart', smile: 'i-r-smile', laugh: 'i-r-laugh', support: 'i-r-support', surprise: 'i-r-surprise',
};

export function chatScreen(state: State): Html {
  const me = state.me!;
  const language = me.user.language;
  const gender = me.assistant.gender;

  if (state.messages.length === 0 && !state.busy) {
    return html`<div class="empty">
      <div class="empty__line">${t('chat.empty', language, gender)}</div>
      <div>${t('chat.empty_hint', language, gender)}</div>
    </div>`;
  }

  const rows: Html[] = [];
  if (state.hasOlder) {
    // UI-UX §38: a quiet top affordance, never a spinner takeover.
    rows.push(html`<button class="chat__earlier" data-action="older">${t('chat.earlier', language, gender)}</button>`);
  }

  let lastDay = '';
  for (const message of state.messages) {
    const day = dayOf(message.at, me.user.timeZone, todayIn(me));
    const key = 'key' in day ? day.key : day.date;
    if (key !== lastDay) {
      lastDay = key;
      const label = 'key' in day
        ? t(day.key === 'today' ? 'chat.today' : 'chat.yesterday', language, gender)
        : dateLabel(day.date, language, me.user.timeZone);
      rows.push(html`<div class="chat__day">${label}</div>`);
    }
    rows.push(bubble(message, me, state));
  }

  if (state.error !== null) {
    // UI-UX §20: what went wrong arrives as something she says, in the
    // conversation, not as a toast over it.
    rows.push(html`<div class="chat__group chat__group--hers">
      <div class="bubble bubble--hers bubble--notice">${state.error}</div>
    </div>`);
  }

  if (state.limitLine !== null) {
    // PRD §11: her line, in the conversation, in her voice. Not a modal, not
    // a countdown, not an upsell.
    rows.push(html`<div class="chat__group chat__group--hers">
      <div class="bubble bubble--hers bubble--limit">${state.limitLine}</div>
    </div>`);
  }
  return html`${rows}${aside(me)}`;
}

/**
 * The desktop contextual panel (design.md §11).
 *
 * "Right optional contextual panel: memory or current topic" — and optional
 * is doing real work here. It renders from the snapshot the app already has,
 * so it costs no request; it is hidden below 1200px by CSS rather than
 * switched on a measured width; and nothing about the conversation depends on
 * it existing. What it shows is what she is holding, not a dashboard: where
 * the relationship stands, and how much she is keeping.
 */
function aside(me: Snapshot): Html {
  const language = me.user.language;
  const gender = me.assistant.gender;
  return html`<aside class="chat__aside" aria-label="${t('memory.title', language, gender)}">
    <div class="rail__label">${t('story.title', language, gender)}</div>
    <p class="chat__aside-line">${me.relationship.prose}</p>
    <div class="rail__label">${t('memory.title', language, gender)}</div>
    <a class="row" href="/memory" data-link>
      ${icon('i-memory', 'sm', 'icon--muted')}
      <span class="row__label">${t('memory.kept_so_far', language, gender).replace('{n}', String(me.limits.memoriesKept))}</span>
      ${icon('i-chevron', 'sm', 'icon--muted icon--flip')}
    </a>
    ${me.limits.memoriesPending === 0 ? '' : html`<a class="row" href="/memory" data-link>
      ${icon('i-clock', 'sm', 'icon--muted')}
      <span class="row__label">${t('memory.pending_title', language, gender)}</span>
      <span class="row__value">${String(me.limits.memoriesPending)}</span>
    </a>`}
  </aside>`;
}

const todayIn = (me: Snapshot): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: me.user.timeZone }).format(new Date());

function bubble(message: Message, me: Snapshot, state: State): Html {
  const mine = message.role === 'user';
  const language = me.user.language;
  const gender = me.assistant.gender;
  const failed = message.pending === 'failed';
  return html`<div class="chat__group ${mine ? 'chat__group--mine' : 'chat__group--hers'}" data-message="${message.id}">
    ${message.replyTo === null ? '' : html`<div class="bubble__quote">
      <span class="bubble__quote-who">${t('chat.replying_to', language, gender)} ${message.replyTo.role === 'user' ? (me.user.name ?? '') : me.assistant.name}</span>
      <span class="bubble__quote-line">${message.replyTo.body}</span>
    </div>`}
    ${message.attachments.map((attachment) => attachmentView(attachment, me))}
    <button class="bubble ${mine ? 'bubble--mine' : 'bubble--hers'}" data-action="message-actions" data-id="${message.id}"
      >${message.body}${message.pending === 'streaming' ? html`<span class="caret" aria-hidden="true"></span>` : ''}</button>
    ${mine || message.pending !== undefined || me.user.plan !== 'paid' ? '' : html`<button class="bubble__speak" data-action="speak" data-id="${message.id}"
      aria-label="${t('chat.play', language, gender)}">${icon('i-play', 'sm', 'icon--muted')}</button>`}
    ${message.reaction === null ? '' : html`<span class="reaction" data-action="message-actions" data-id="${message.id}">
      ${icon(REACTION_ICONS[message.reaction] ?? 'i-heart', 'sm')}
    </span>`}
    ${message.captures.map((capture) => html`<a class="row capture" href="${capture.correctionRoute}" data-link>
      ${icon(capture.icon, 'sm', 'icon--muted')}
      <span class="row__label">${capture.line}</span>
      ${icon('i-chevron', 'sm', 'icon--muted icon--flip')}
    </a>`)}
    <div class="chat__meta">
      ${failed
        ? html`<span class="chat__failed">${t('chat.not_sent', language, gender)}</span>
               <button class="button button--plain chat__retry" data-action="retry" data-id="${message.id}">${t('chat.try_again', language, gender)}</button>`
        : message.pending === 'sending' || message.pending === 'streaming'
          ? ''
          : time(message.at, language, me.user.timeZone)}
    </div>
  </div>`;
}

/**
 * What came with a message.
 *
 * Both go through /api/attachments/:id, which redirects to a URL that expires
 * in minutes — so the markup holds no durable link to anybody's photograph,
 * and a copied page source is worth nothing an hour later.
 */
function attachmentView(attachment: { id: string; kind: string; contentType: string }, me: Snapshot): Html {
  const language = me.user.language;
  const gender = me.assistant.gender;
  if (attachment.kind === 'audio') {
    // The native player: it already knows about scrubbing, the lock screen
    // and the system volume, and a hand-built one would know none of it.
    return html`<audio class="bubble__audio" controls preload="none"
      src="/api/attachments/${attachment.id}" aria-label="${t('chat.voice_note', language, gender)}"></audio>`;
  }
  return html`<a class="bubble__photo" href="/api/attachments/${attachment.id}" target="_blank" rel="noreferrer">
    <img src="/api/attachments/${attachment.id}" alt="${t('chat.photo_alt', language, gender)}" loading="lazy">
  </a>`;
}

/** The dots, while she is thinking and before the first delta (UI-UX §37). */
export function thinking(me: Snapshot): Html {
  return html`<div class="chat__group chat__group--hers" data-thinking>
    <div class="bubble bubble--hers bubble--thinking" aria-label="${t('chat.thinking', me.user.language, me.assistant.gender)}">
      <span class="dot"></span><span class="dot"></span><span class="dot"></span>
    </div>
  </div>`;
}

/** The composer (UI-UX §3: message field and voice, nothing else). */
export function composer(state: State): Html {
  const me = state.me!;
  const language = me.user.language;
  const gender = me.assistant.gender;
  return html`<div class="composer">
    ${state.replyTo === null ? '' : html`<div class="composer__reply">
      <span class="composer__reply-line">${state.replyTo.body}</span>
      <button class="head__button" data-action="cancel-reply" aria-label="${t('action.close', language, gender)}">${icon('i-close', 'sm')}</button>
    </div>`}
    <form class="composer__bar" data-action="send">
      <input class="composer__input" name="message" autocomplete="off"
        placeholder="${t('chat.input_placeholder', language, gender)}"
        aria-label="${t('chat.input_placeholder', language, gender)}">
      <label class="composer__icon" aria-label="${t('chat.photo', language, gender)}">
        ${icon('i-photo')}
        <input type="file" class="composer__file" accept="image/*" data-action="photo" hidden>
      </label>
      <button type="button" class="composer__icon" data-action="voice" aria-label="${t('chat.voice', language, gender)}">${icon('i-mic')}</button>
      <button type="submit" class="composer__icon composer__send" aria-label="${t('chat.send', language, gender)}">${icon('i-send', 'md', 'icon--flip')}</button>
    </form>
  </div>`;
}

/** Recording, in place of the bar (UI-UX §34). */
export function recorder(state: State, seconds: number): Html {
  const me = state.me!;
  const language = me.user.language;
  const gender = me.assistant.gender;
  return html`<div class="composer">
    <div class="composer__bar composer__bar--recording">
      <button type="button" class="button button--plain" data-action="cancel-voice">${t('chat.cancel', language, gender)}</button>
      <span class="composer__recording"><span class="dot dot--live"></span>${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}</span>
      <button type="button" class="composer__icon composer__send" data-action="stop-voice" aria-label="${t('chat.send', language, gender)}">${icon('i-send', 'md', 'icon--flip')}</button>
    </div>
  </div>`;
}

/** The compact action sheet on a message (UI-UX §35.1). */
export function actionSheet(state: State): Html {
  const me = state.me!;
  const language = me.user.language;
  const gender = me.assistant.gender;
  const acting = state.acting!;
  const message = state.messages.find((candidate) => candidate.id === acting.id);
  if (message === undefined) return html``;

  if (acting.mode === 'react') {
    return html`
      <button class="scrim" data-action="close-sheet" aria-label="${t('action.close', language, gender)}"></button>
      <div class="sheet reactions" role="dialog">
        ${Object.entries(REACTION_ICONS).map(([kind, name]) => html`<button
            class="reactions__item ${message.reaction === kind ? 'reactions__item--on' : ''}"
            data-action="react" data-id="${message.id}" data-kind="${kind}"
            aria-label="${t(`react.${kind}` as 'react.heart', language, gender)}">
          ${icon(name)}
        </button>`)}
      </div>`;
  }

  return html`
    <button class="scrim" data-action="close-sheet" aria-label="${t('action.close', language, gender)}"></button>
    <div class="sheet" role="dialog">
      <button class="sheet__action" data-action="reply" data-id="${message.id}">${icon('i-reply', 'md', 'icon--flip')}<span>${t('chat.reply', language, gender)}</span></button>
      <button class="sheet__action" data-action="react-picker" data-id="${message.id}">${icon('i-heart')}<span>${t('chat.react', language, gender)}</span></button>
      <button class="sheet__action" data-action="copy" data-id="${message.id}">${icon('i-note')}<span>${t('chat.copy', language, gender)}</span></button>
      <button class="sheet__action sheet__action--destructive" data-action="delete-message" data-id="${message.id}">${icon('i-trash')}<span>${t('chat.delete', language, gender)}</span></button>
    </div>`;
}

/**
 * Deleting a message, with its provenance (UI-UX §39).
 *
 * The two buttons are the whole point: what she derived from a message goes
 * with it unless the person says otherwise, and they cannot make that choice
 * without being told what was derived.
 */
export function deleteSheet(state: State, message: Message): Html {
  const me = state.me!;
  const language = me.user.language;
  const gender = me.assistant.gender;
  const derived = message.memoriesDerived;
  return html`
    <button class="scrim" data-action="close-sheet" aria-label="${t('action.close', language, gender)}"></button>
    <div class="sheet" role="dialog">
      <div class="sheet__title">${t('message.delete_title', language, gender)}</div>
      ${derived === 0 ? '' : html`<div class="sheet__body">
        ${t(derived === 1 ? 'message.helped_remember_one' : 'message.helped_remember_many', language, gender)}
      </div>`}
      <button class="sheet__action sheet__action--destructive" data-action="confirm-delete" data-id="${message.id}" data-keep="true">
        ${t('message.delete_only', language, gender)}
      </button>
      ${derived === 0 ? '' : html`<button class="sheet__action sheet__action--destructive" data-action="confirm-delete" data-id="${message.id}" data-keep="false">
        ${t('message.delete_with_memories', language, gender)}
      </button>`}
      <button class="sheet__action" data-action="close-sheet">${t('action.cancel', language, gender)}</button>
    </div>`;
}

/**
 * The permission ask, in the conversation (PRD §8, UI-UX §41).
 *
 * It appears only after she has remembered something — the server decides
 * that, and says so by putting `ask_notification_permission` in the snapshot.
 * The client never decides when to ask, because the ordering is a product
 * rule rather than a UI preference.
 *
 * Both buttons answer the server: "Not now" is an answer, and recording it is
 * what stops her asking again into a dialogue the browser will not re-show.
 */
export function permissionCard(me: Snapshot): Html {
  const language = me.user.language;
  const gender = me.assistant.gender;
  return html`<div class="chat__group chat__group--hers">
    <div class="card permission">
      <p class="permission__line">${t('permission.pre_prompt', language, gender)}</p>
      <p class="permission__detail">${t('permission.pre_prompt_detail', language, gender)}</p>
      <div class="sheet__row">
        <button class="button button--plain" data-action="permission-no">${t('action.not_now', language, gender)}</button>
        <button class="button" data-action="permission-yes">${t('permission.allow', language, gender)}</button>
      </div>
    </div>
  </div>`;
}

/** The install prompt (UI-UX §41), shown when the browser offers one. */
export function installCard(me: Snapshot): Html {
  const language = me.user.language;
  const gender = me.assistant.gender;
  // Its own class, not the permission card's: they are different offers, and
  // a test that cannot tell them apart is a test that passes when she asks
  // for the wrong one.
  return html`<div class="chat__group chat__group--hers">
    <div class="card install">
      <p class="install__line">${t('install.title', language, gender)}</p>
      <p class="install__detail">${t('install.detail', language, gender)}</p>
      <div class="sheet__row">
        <button class="button button--plain" data-action="install-no">${t('action.not_now', language, gender)}</button>
        <button class="button" data-action="install-yes">${t('install.action', language, gender)}</button>
      </div>
    </div>
  </div>`;
}
