// The five tabs (PRD §13, design.md §11).
import { html, icon, type Html } from '../dom.ts';
import { t } from '../copy.ts';
import { tabFor } from '../router.ts';
import type { Snapshot } from '../state.ts';

const TABS = [
  { key: 'chat', href: '/chat', icon: 'i-chat', copy: 'nav.chat' },
  { key: 'tasks', href: '/tasks', icon: 'i-tasks', copy: 'nav.tasks' },
  { key: 'money', href: '/money', icon: 'i-money', copy: 'nav.money' },
  { key: 'story', href: '/story', icon: 'i-story', copy: 'nav.story' },
  { key: 'settings', href: '/settings', icon: 'i-settings', copy: 'nav.settings' },
] as const;

export function nav(me: Snapshot, path: string): Html {
  const active = tabFor(path);
  return html`<nav class="nav" aria-label="${t('nav.menu', me.user.language, me.assistant.gender)}">
    ${TABS.map((tab) => html`<a class="nav__item" href="${tab.href}" data-link
        ${tab.key === active ? html`aria-current="page"` : ''}>
      ${icon(tab.icon)}
      <span>${t(tab.copy, me.user.language, me.assistant.gender)}</span>
    </a>`)}
  </nav>`;
}
