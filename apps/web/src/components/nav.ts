// The five tabs (PRD §13, design.md §11).
import { html, icon, type Html } from '../dom.ts';
import { t } from '../copy.ts';
import { tabFor } from '../router.ts';
import { GROUPS } from './drawer.ts';
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

/**
 * The desktop rail's second half (design.md §17, §19).
 *
 * The SAME groups the drawer shows, from the same array — at 900px+ the
 * drawer stops being a drawer and becomes part of a persistent rail, and two
 * copies of that list is how one of them quietly loses an entry.
 *
 * Rendered always and hidden below 900px by CSS rather than switched on a
 * measured width: a layout that depends on JavaScript knowing the viewport is
 * a layout that flickers on first paint and is wrong in a resized window.
 */
export function railGroups(me: Snapshot, path: string): Html {
  const language = me.user.language;
  const gender = me.assistant.gender;
  return html`<div class="rail__groups">
    ${GROUPS.map((group) => html`
      <div class="rail__label">${t(group.label, language, gender)}</div>
      ${group.items.map((item) => html`<a class="rail__item" href="${item.href}" data-link
          ${path.startsWith(item.href) ? html`aria-current="page"` : ''}>
        ${icon(item.icon, 'sm', 'icon--muted')}
        <span>${t(item.copy, language, gender)}</span>
      </a>`)}`)}
  </div>`;
}
