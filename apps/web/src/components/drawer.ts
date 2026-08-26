// The one grouped drawer (PRD §13).
//
// Three groups, in the order the spec names them, and nothing else: this is
// secondary navigation, not a settings screen with a different shape.
import { html, icon, type Html } from '../dom.ts';
import { t } from '../copy.ts';
import type { Snapshot } from '../state.ts';

export const GROUPS = [
  {
    label: 'drawer.remember',
    items: [
      { href: '/memory', icon: 'i-memory', copy: 'drawer.memory' },
      { href: '/search', icon: 'i-search', copy: 'drawer.search' },
      { href: '/album', icon: 'i-album', copy: 'drawer.album' },
      { href: '/briefing', icon: 'i-briefing', copy: 'drawer.briefing' },
    ],
  },
  {
    label: 'drawer.life',
    items: [
      { href: '/health', icon: 'i-health', copy: 'drawer.health' },
      { href: '/assistants', icon: 'i-assistants', copy: 'drawer.assistants' },
      { href: '/profile', icon: 'i-person', copy: 'drawer.about_you' },
    ],
  },
  {
    label: 'drawer.trust',
    items: [
      { href: '/security', icon: 'i-shield', copy: 'drawer.security' },
      { href: '/data', icon: 'i-data', copy: 'drawer.data' },
      { href: '/subscription', icon: 'i-card', copy: 'drawer.subscription' },
    ],
  },
] as const;

export function drawer(me: Snapshot): Html {
  const language = me.user.language;
  const gender = me.assistant.gender;
  return html`
    <button class="scrim" data-action="close-drawer" aria-label="${t('drawer.close', language, gender)}"></button>
    <aside class="drawer" role="dialog" aria-label="${t('nav.menu', language, gender)}">
      <div class="head">
        <div class="head__avatar">${icon('i-mark', 'sm')}</div>
        <div class="head__names">
          <div class="head__name">${me.assistant.name}</div>
          <div class="head__mood">${me.assistant.moodPhrase}</div>
        </div>
      </div>
      ${GROUPS.map((group) => html`<div class="drawer__group">
        <div class="section">${t(group.label, language, gender)}</div>
        ${group.items.map((item) => html`<a class="drawer__item" href="${item.href}" data-link>
          ${icon(item.icon, 'md', 'icon--muted')}<span>${t(item.copy, language, gender)}</span>
        </a>`)}
      </div>`)}
    </aside>`;
}
