// Tasks & notes, money, our story (PRD §6.4, §6.5, §10).
//
// Review-and-correct screens. What is missing from all three is the point:
// there is no add button anywhere (PRD §14). Everything on them arrived
// through conversation, and everything is tappable to fix.
import { html, icon, type Html } from '../dom.ts';
import { t } from '../copy.ts';
import { dateLabel, money as formatMoney } from '../format.ts';
import type { Snapshot } from '../state.ts';

export type Task = { id: string; kind: 'task' | 'habit'; title: string; dueOn: string | null; done: boolean };
export type Note = { id: string; title: string | null; body: string; createdAt: string };
export type Money = {
  month: string; inMinor: number; outMinor: number; leftMinor: number; currency: string;
  categories: { category: string; totalMinor: number }[];
  recent: { id: string; line: string; amountMinor: number; direction: 'in' | 'out'; occurredOn: string; fromReceipt: boolean }[];
};
export type Story = { now: string; footer: string; stages: { key: string; name: string; prose: string; current: boolean }[] };

export function tasksScreen(me: Snapshot, data: { tasks: Task[]; notes: Note[] }): Html {
  const language = me.user.language;
  const gender = me.assistant.gender;
  const habits = data.tasks.filter((task) => task.kind === 'habit');
  const tasks = data.tasks.filter((task) => task.kind === 'task');

  if (data.tasks.length === 0 && data.notes.length === 0) {
    return html`<h1 class="screen__title">${t('tasks.title', language, gender)}</h1>
      <div class="empty"><div class="empty__line">${t('tasks.empty', language, gender)}</div>
      <div>${t('tasks.correct_hint', language, gender)}</div></div>`;
  }

  return html`
    <h1 class="screen__title">${t('tasks.title', language, gender)}</h1>
    ${tasks.length === 0 ? '' : html`<div class="section">${t('tasks.today', language, gender)}</div>`}
    ${tasks.map((task) => html`<button class="row" data-action="open-task" data-id="${task.id}">
      ${icon(task.done ? 'i-check-circle' : 'i-tasks', 'sm', 'icon--muted')}
      <span class="row__label ${task.done ? 'row__label--done' : ''}">${task.title}</span>
      <span class="row__value">${task.dueOn === null ? t('tasks.no_date', language, gender) : dateLabel(task.dueOn, language, me.user.timeZone)}</span>
    </button>`)}

    ${habits.length === 0 ? '' : html`<div class="section">${t('tasks.habits', language, gender)}</div>`}
    ${habits.map((habit) => html`<button class="row" data-action="open-task" data-id="${habit.id}">
      ${icon('i-refresh', 'sm', 'icon--muted')}
      <span class="row__label">${habit.title}</span>
    </button>`)}

    ${data.notes.length === 0 ? '' : html`<div class="section">${t('tasks.notes', language, gender)}</div>`}
    ${data.notes.map((note) => html`<button class="row" data-action="open-note" data-id="${note.id}">
      ${icon('i-note', 'sm', 'icon--muted')}
      <span class="row__label">${note.title ?? note.body}</span>
    </button>`)}
  `;
}

export function moneyScreen(me: Snapshot, data: Money): Html {
  const language = me.user.language;
  const gender = me.assistant.gender;
  const amount = (minor: number): string => formatMoney(minor, data.currency, language);

  if (data.recent.length === 0 && data.inMinor === 0 && data.outMinor === 0) {
    return html`<h1 class="screen__title">${t('money.title', language, gender)}</h1>
      <div class="empty"><div class="empty__line">${t('money.empty', language, gender)}</div></div>`;
  }

  return html`
    <h1 class="screen__title">${t('money.title', language, gender)}</h1>
    <div class="card money__headline">
      <div class="money__label">${t('money.left', language, gender)}</div>
      <div class="money__figure">${amount(data.leftMinor)}</div>
      <div class="money__flow">
        <span>${t('money.in', language, gender)} <strong>${amount(data.inMinor)}</strong></span>
        <span>${t('money.out', language, gender)} <strong>${amount(data.outMinor)}</strong></span>
      </div>
    </div>

    ${data.categories.length === 0 ? '' : html`
      <div class="section">${t('money.where', language, gender)}</div>
      ${data.categories.slice(0, 4).map((category) => html`<div class="row row--static">
        <span class="row__label">${category.category}</span>
        <span class="row__value">${amount(category.totalMinor)}</span>
      </div>`)}`}

    <div class="section">${t('money.recent', language, gender)}</div>
    ${data.recent.map((transaction) => html`<button class="row" data-action="open-money" data-id="${transaction.id}">
      ${icon(transaction.fromReceipt ? 'i-receipt' : 'i-money', 'sm', 'icon--muted')}
      <span class="row__label">
        ${transaction.line}
        <span class="row__sub">${dateLabel(transaction.occurredOn, language, me.user.timeZone)} · ${transaction.fromReceipt ? t('money.from_receipt', language, gender) : t('money.from_chat', language, gender)}</span>
      </span>
      <span class="row__value">${amount(transaction.amountMinor)}</span>
    </button>`)}
  `;
}

/**
 * Our story (PRD §10).
 *
 * LESSONS §6 is what shapes this screen: the stage has a NAME and prose, and
 * there is no progress bar, no day count and no percentage — because the
 * client is never told how far through a stage they are. The footer says
 * plainly that nothing is being unlocked.
 */
export function storyScreen(me: Snapshot, data: Story): Html {
  const language = me.user.language;
  const gender = me.assistant.gender;
  return html`
    <h1 class="screen__title">${t('story.title', language, gender)}</h1>
    <p class="screen__lede">${t('story.not_a_score', language, gender)}</p>
    ${data.stages.map((stage) => html`<article class="card stage ${stage.current ? 'stage--now' : ''}">
      <div class="stage__name">${stage.name}</div>
      <p class="stage__prose">${stage.prose}</p>
    </article>`)}
    <p class="screen__lede">${t('story.nothing_to_lose', language, gender)}</p>
  `;
}
