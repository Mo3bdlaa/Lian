// The chat header (UI-UX §3).
//
// Her mark, her name, and a short mood PHRASE. What is deliberately absent is
// listed in the spec and worth repeating here, because each one is the kind
// of thing that gets added later by someone being helpful: no online dot, no
// mood score, no percentage, no "AI assistant" label.
import { html, icon, type Html } from '../dom.ts';
import { t } from '../copy.ts';
import type { Snapshot } from '../state.ts';

/**
 * `incognito` suppresses the mood phrase (PRD §27).
 *
 * The reason is not decoration. The mood phrase is HER mood — the real one,
 * from the real conversation — and showing it above a thread where she is
 * playing an interviewer attributes a feeling to a part she is acting. The
 * label replaces it rather than sitting beside it, because two states in one
 * slot is how you end up reading neither.
 */
export function head(me: Snapshot, options: { back?: string; title?: string; incognito?: boolean } = {}): Html {
  const language = me.user.language;
  if (options.title !== undefined) {
    return html`<header class="head">
      <button class="head__button" data-action="back" aria-label="${t('action.back', language, me.assistant.gender)}">
        ${icon('i-back', 'md', 'icon--flip')}
      </button>
      <div class="head__names"><div class="head__name">${options.title}</div></div>
    </header>`;
  }
  return html`<header class="head ${options.incognito === true ? 'head--incognito' : ''}">
    <button class="head__button" data-action="drawer" aria-label="${t('nav.menu', language, me.assistant.gender)}">
      ${icon('i-menu')}
    </button>
    <div class="head__avatar">${icon('i-mark', 'sm')}</div>
    <div class="head__names">
      <div class="head__name">${me.assistant.name}</div>
      <div class="head__mood">${options.incognito === true
        ? t('mood.incognito', language, me.assistant.gender)
        : me.assistant.moodPhrase}</div>
    </div>
    <button class="head__button" data-action="threads" aria-label="${t('threads.title', language, me.assistant.gender)}">
      ${icon('i-more')}
    </button>
  </header>`;
}
