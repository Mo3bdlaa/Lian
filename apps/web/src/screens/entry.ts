// Welcome, sign up, sign in (UI-UX §1).
//
// The promise sentence is the product's first line and it is authored copy —
// "An AI secretary that remembers you — and that you actually own." The
// buttons say what they do. There is no marketing carousel, no feature grid
// and no "continue with" row, because there is no third party to continue
// with: the account is an email and a password on your own database.
import { html, icon, type Html } from '../dom.ts';
import { t } from '../copy.ts';
import type { Language } from '../format.ts';

type EntryState = { language: Language; error: string | null; busy: boolean };

export function welcome(state: EntryState): Html {
  return html`<div class="entry">
    <div class="entry__body">
      ${icon('i-lockup', 'lg', 'entry__lockup')}
      <h1 class="entry__promise">${t('entry.promise', state.language)}</h1>
      <p class="entry__detail">${t('entry.detail', state.language)}</p>
    </div>
    <div class="entry__actions">
      <a class="button button--block" href="/sign-up" data-link>${t('entry.create', state.language)}</a>
      <a class="button button--quiet button--block" href="/sign-in" data-link>${t('entry.have_one', state.language)}</a>
    </div>
  </div>`;
}

export function signUp(state: EntryState): Html {
  return credentials(state, {
    action: 'sign-up',
    submit: t('action.continue', state.language),
    footnote: t('entry.terms_note', state.language),
    alternate: { href: '/sign-in', label: t('entry.have_one', state.language) },
  });
}

export function signIn(state: EntryState): Html {
  return credentials(state, {
    action: 'sign-in',
    submit: t('entry.sign_in', state.language),
    footnote: null,
    alternate: { href: '/sign-up', label: t('entry.create', state.language) },
  });
}

function credentials(
  state: EntryState,
  options: { action: string; submit: string; footnote: string | null; alternate: { href: string; label: string } },
): Html {
  return html`<div class="entry">
    <form class="entry__body entry__form" data-action="${options.action}">
      ${icon('i-lockup', 'lg', 'entry__lockup')}
      <div class="field">
        <label class="field__label" for="email">${t('entry.email', state.language)}</label>
        <input class="field__input" id="email" name="email" type="email" autocomplete="email" inputmode="email" required>
      </div>
      <div class="field">
        <label class="field__label" for="password">${t('entry.password', state.language)}</label>
        <input class="field__input" id="password" name="password" type="password"
          autocomplete="${options.action === 'sign-up' ? 'new-password' : 'current-password'}" required>
        ${options.action === 'sign-up' ? html`<span class="field__label">${t('entry.password_hint', state.language)}</span>` : ''}
      </div>
      ${state.error === null ? '' : html`<div class="field__error" role="alert">${state.error}</div>`}
      <button class="button button--block" type="submit" ${state.busy ? html`disabled` : ''}>
        ${state.busy ? t('action.loading', state.language) : options.submit}
      </button>
      ${options.footnote === null ? '' : html`<p class="entry__footnote">${options.footnote}</p>`}
      <a class="button button--plain button--block" href="${options.alternate.href}" data-link>${options.alternate.label}</a>
    </form>
  </div>`;
}

/**
 * The new-device hold (Q10, UI-UX §16).
 *
 * A correct password from an unrecognised device does not sign you in, and
 * this screen says so calmly rather than as an error: nothing went wrong.
 */
export function heldDevice(state: EntryState): Html {
  return html`<div class="entry">
    <div class="entry__body">
      ${icon('i-shield', 'lg')}
      <h1 class="entry__promise">${t('entry.held_device', state.language)}</h1>
      <p class="entry__detail">${t('security.new_device', state.language)}</p>
    </div>
    <div class="entry__actions">
      <a class="button button--quiet button--block" href="/sign-in" data-link>${t('action.back', state.language)}</a>
    </div>
  </div>`;
}
