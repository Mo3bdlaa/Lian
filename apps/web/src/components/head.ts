// The chat header (UI-UX §3).
//
// Her mark, her name, and a short mood PHRASE. What is deliberately absent is
// listed in the spec and worth repeating here, because each one is the kind
// of thing that gets added later by someone being helpful: no online dot, no
// mood score, no percentage, no "AI assistant" label.
import { html, icon, type Html } from '../dom.ts';
import { t } from '../copy.ts';
import type { Snapshot } from '../state.ts';

export function head(me: Snapshot, options: { back?: string; title?: string } = {}): Html {
  const language = me.user.language;
  if (options.title !== undefined) {
    return html`<header class="head">
      <button class="head__button" data-action="back" aria-label="${t('action.back', language, me.assistant.gender)}">
        ${icon('i-back', 'md', 'icon--flip')}
      </button>
      <div class="head__names"><div class="head__name">${options.title}</div></div>
    </header>`;
  }
  return html`<header class="head">
    <button class="head__button" data-action="drawer" aria-label="${t('nav.menu', language, me.assistant.gender)}">
      ${icon('i-menu')}
    </button>
    <div class="head__avatar">${icon('i-mark', 'sm')}</div>
    <div class="head__names">
      <div class="head__name">${me.assistant.name}</div>
      <div class="head__mood">${me.assistant.moodPhrase}</div>
    </div>
  </header>`;
}
