// Correcting a capture (UI-UX §4, §22).
//
// Every captured row is tappable, and this is what opens. It is a small,
// specific form — the only forms in the product — and the distinction that
// makes that consistent with PRD §14 is worth stating: you cannot CREATE
// anything here. There is no route that makes a task, a transaction or a
// note; there is only correcting one she already wrote down from something
// you said.
//
// The fields mirror the server's whitelist exactly. A field here that the
// server does not accept is a control that silently does nothing.
import { html, type Html } from '../dom.ts';
import { t } from '../copy.ts';
import type { Snapshot } from '../state.ts';

export type CorrectKind = 'tasks' | 'transactions' | 'notes' | 'health';

export type Correcting = {
  kind: CorrectKind;
  id: string;
  values: Record<string, string>;
};

type Field =
  | { name: string; label: string; kind: 'text' | 'date' | 'number' }
  | { name: string; label: string; kind: 'choice'; options: { value: string; label: string }[] };

export function fieldsFor(kind: CorrectKind, language: 'en' | 'ar', gender: 'female' | 'male'): Field[] {
  const label = (key: string): string => t(`correct.field_${key}` as 'correct.field_title', language, gender);
  switch (kind) {
    case 'tasks':
      return [
        { name: 'title', label: label('title'), kind: 'text' },
        { name: 'dueOn', label: label('date'), kind: 'date' },
      ];
    case 'transactions':
      return [
        { name: 'amountMinor', label: label('amount'), kind: 'number' },
        { name: 'category', label: label('category'), kind: 'text' },
        { name: 'occurredOn', label: label('date'), kind: 'date' },
        {
          name: 'direction', label: label('direction'), kind: 'choice',
          options: [
            { value: 'out', label: t('correct.direction_out', language, gender) },
            { value: 'in', label: t('correct.direction_in', language, gender) },
          ],
        },
        { name: 'note', label: label('note'), kind: 'text' },
      ];
    case 'notes':
      return [
        { name: 'title', label: label('title'), kind: 'text' },
        { name: 'body', label: label('body'), kind: 'text' },
      ];
    case 'health':
      return [
        { name: 'description', label: label('title'), kind: 'text' },
        { name: 'durationMinutes', label: label('amount'), kind: 'number' },
      ];
  }
}

const TITLE: Record<CorrectKind, 'correct.title_task'> = {
  tasks: 'correct.title_task',
  transactions: 'correct.title_transaction' as 'correct.title_task',
  notes: 'correct.title_note' as 'correct.title_task',
  health: 'correct.title_health' as 'correct.title_task',
};

const DELETE: Record<CorrectKind, 'correct.delete_task'> = {
  tasks: 'correct.delete_task',
  transactions: 'correct.delete_transaction' as 'correct.delete_task',
  notes: 'correct.delete_note' as 'correct.delete_task',
  health: 'correct.delete_note' as 'correct.delete_task',
};

export function correctionSheet(me: Snapshot, correcting: Correcting): Html {
  const language = me.user.language;
  const gender = me.assistant.gender;
  return html`
    <button class="scrim" data-action="close-sheet" aria-label="${t('action.close', language, gender)}"></button>
    <form class="sheet correct" data-action="correct-save" data-kind="${correcting.kind}" data-id="${correcting.id}">
      <div class="sheet__title">${t(TITLE[correcting.kind], language, gender)}</div>
      ${fieldsFor(correcting.kind, language, gender).map((field) => html`<label class="field">
        <span class="field__label">${field.label}</span>
        ${field.kind === 'choice'
          ? html`<div class="chips">${field.options.map((option) => html`<button type="button"
                class="chip ${correcting.values[field.name] === option.value ? 'chip--on' : ''}"
                data-action="correct-choice" data-name="${field.name}" data-value="${option.value}">${option.label}</button>`)}</div>`
          : html`<input class="field__input" name="${field.name}"
              type="${field.kind === 'date' ? 'date' : field.kind === 'number' ? 'number' : 'text'}"
              value="${correcting.values[field.name] ?? ''}">`}
      </label>`)}
      <p class="sheet__body">${t('correct.from_chat', language, gender)}</p>
      <div class="sheet__row">
        <button class="button button--quiet" type="button" data-action="close-sheet">${t('action.cancel', language, gender)}</button>
        <button class="button" type="submit">${t('action.save', language, gender)}</button>
      </div>
      <button class="button button--destructive button--block" type="button"
        data-action="correct-delete" data-kind="${correcting.kind}" data-id="${correcting.id}">
        ${t(DELETE[correcting.kind], language, gender)}
      </button>
    </form>`;
}
