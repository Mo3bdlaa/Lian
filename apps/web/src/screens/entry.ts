// Welcome, sign up, sign in (UI-UX §1).
//
// The promise sentence is the product's first line and it is authored copy —
// "An AI secretary that remembers you — and that you actually own." The
// buttons say what they do. There is no marketing carousel, no feature grid
// and no "continue with" row, because there is no third party to continue
// with: the account is an email and a password on your own database.
import { html, icon, type Html } from '../dom.ts';
import { t, CONSENT_VERSION, LEGAL_REVIEWED, type LegalDocument } from '../copy.ts';
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
      <a class="button button--block" href="/consent" data-link>${t('entry.create', state.language)}</a>
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
    // UI-UX §21 lists "Forgot password" as one of the account screens, and
    // the place somebody looks for it is the screen that just refused them.
    recover: true,
  });
}

function credentials(
  state: EntryState,
  options: { action: string; submit: string; footnote: string | null; alternate: { href: string; label: string }; recover?: boolean },
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
      ${options.recover === true ? html`<a class="button button--plain button--block" href="/forgot" data-link>${t('recover.forgot', state.language)}</a>` : ''}
    </form>
  </div>`;
}

/**
 * Consent (UI-UX §22).
 *
 * The whole text is HERE, on the screen, before anything is agreed to —
 * "do not bury legal text behind external links" is the spec's line, and a
 * link to a page nobody opens is burying it with extra steps. Two answers,
 * both required, and the under-18 answer is a plain no rather than a form
 * that quietly refuses to submit.
 */
export function consent(state: EntryState & { adult: boolean | null; agreed: boolean }): Html {
  if (state.adult === false) {
    return html`<div class="entry">
      <div class="entry__body">
        ${icon('i-mark', 'lg')}
        <p class="entry__detail">${t('consent.under_age', state.language)}</p>
      </div>
      <div class="entry__actions">
        <a class="button button--quiet button--block" href="/welcome" data-link>${t('action.back', state.language)}</a>
      </div>
    </div>`;
  }

  const ready = state.adult === true && state.agreed;
  return html`<div class="entry entry--long">
    <div class="entry__body entry__form">
      <h1 class="entry__promise">${t('consent.title', state.language)}</h1>

      ${LEGAL_REVIEWED ? '' : html`<div class="legal__warning" role="note">
        <div class="legal__warning-title">${t('legal.unreviewed_title', state.language)}</div>
        <p class="consent__body">${t('legal.unreviewed_body', state.language)}</p>
      </div>`}

      <div class="consent__section">
        <h2 class="consent__heading">${t('consent.what_we_keep', state.language)}</h2>
        <p class="consent__body">${t('consent.what_we_keep_body', state.language)}</p>
      </div>
      <div class="consent__section">
        <h2 class="consent__heading">${t('consent.who_sees', state.language)}</h2>
        <p class="consent__body">${t('consent.who_sees_body', state.language)}</p>
      </div>
      <div class="consent__section">
        <h2 class="consent__heading">${t('consent.your_control', state.language)}</h2>
        <p class="consent__body">${t('consent.your_control_body', state.language)}</p>
      </div>

      <div class="consent__section">
        <h2 class="consent__heading">${t('consent.age_question', state.language)}</h2>
        <div class="consent__answers">
          <button class="button ${state.adult === true ? '' : 'button--quiet'}" data-action="consent-adult" data-value="yes">
            ${t('consent.age_yes', state.language)}
          </button>
          <button class="button button--quiet" data-action="consent-adult" data-value="no">
            ${t('consent.age_no', state.language)}
          </button>
        </div>
      </div>

      <div class="consent__links">
        <a class="button button--plain" href="/terms" data-link>${t('legal.terms_title', state.language)}</a>
        <a class="button button--plain" href="/privacy" data-link>${t('legal.privacy_title', state.language)}</a>
      </div>

      <button class="consent__agree" data-action="consent-agree" aria-pressed="${state.agreed ? 'true' : 'false'}">
        ${icon(state.agreed ? 'i-check-circle' : 'i-dot', 'sm')}
        <span>${t('consent.terms', state.language)}</span>
      </button>

      ${ready ? '' : html`<p class="entry__footnote">${t('consent.required', state.language)}</p>`}
      <a class="button button--block ${ready ? '' : 'button--disabled'}"
        href="${ready ? '/sign-up' : '/consent'}" ${ready ? html`data-link` : html`aria-disabled="true"`}>
        ${t('consent.continue', state.language)}
      </a>
    </div>
  </div>`;
}

/**
 * Account recovery (UI-UX §21).
 *
 * Two screens. The first says the same thing whether or not the address has
 * an account — that sentence is the security property, not a nicety, and the
 * screen has no branch that could contradict it.
 */
export function forgotPassword(state: EntryState & { sent: boolean; canEmail: boolean }): Html {
  return html`<div class="entry">
    <form class="entry__body entry__form" data-action="forgot">
      ${icon('i-key', 'lg')}
      <h1 class="entry__promise">${t('recover.title', state.language)}</h1>

      ${state.sent
        ? html`<p class="entry__detail">${t('recover.sent', state.language)}</p>
               ${state.canEmail ? '' : html`<p class="entry__footnote">${t('recover.no_email_yet', state.language)}</p>`}`
        : html`
            <p class="entry__detail">${t('recover.lede', state.language)}</p>
            <div class="field">
              <label class="field__label" for="email">${t('entry.email', state.language)}</label>
              <input class="field__input" id="email" name="email" type="email" autocomplete="email" inputmode="email" required>
            </div>
            ${state.error === null ? '' : html`<div class="field__error" role="alert">${state.error}</div>`}
            <button class="button button--block" type="submit" ${state.busy ? html`disabled` : ''}>
              ${state.busy ? t('action.loading', state.language) : t('recover.send', state.language)}
            </button>`}

      <a class="button button--plain button--block" href="/sign-in" data-link>${t('entry.sign_in', state.language)}</a>
    </form>
  </div>`;
}

export function resetPassword(state: EntryState): Html {
  return html`<div class="entry">
    <form class="entry__body entry__form" data-action="reset">
      ${icon('i-key', 'lg')}
      <h1 class="entry__promise">${t('recover.new_title', state.language)}</h1>
      <div class="field">
        <label class="field__label" for="password">${t('recover.new_password', state.language)}</label>
        <input class="field__input" id="password" name="password" type="password" autocomplete="new-password" required>
        <span class="field__label">${t('entry.password_hint', state.language)}</span>
      </div>
      ${state.error === null ? '' : html`<div class="field__error" role="alert">${state.error}</div>`}
      <button class="button button--block" type="submit" ${state.busy ? html`disabled` : ''}>
        ${state.busy ? t('action.loading', state.language) : t('recover.save', state.language)}
      </button>
      <a class="button button--plain button--block" href="/forgot" data-link>${t('recover.forgot', state.language)}</a>
    </form>
  </div>`;
}

/**
 * Following a confirmation link (UI-UX §21).
 *
 * Entry-shaped, because it is opened from an inbox — possibly in a browser
 * that has never seen this account, and possibly on a different device from
 * the one that signed up.
 */
export function confirmEmailScreen(state: EntryState & { done: boolean }): Html {
  return html`<div class="entry">
    <div class="entry__body">
      ${icon(state.done ? 'i-check-circle' : 'i-key', 'lg')}
      <h1 class="entry__promise">${t(state.done ? 'verify.confirmed' : 'verify.unconfirmed', state.language)}</h1>
      <p class="entry__detail">${state.done ? t('verify.done', state.language) : (state.error ?? t('verify.expired', state.language))}</p>
    </div>
    <div class="entry__actions">
      <a class="button button--block" href="/chat" data-link>${t('app.back_to_chat', state.language)}</a>
    </div>
  </div>`;
}

/**
 * Terms and Privacy, as screens (UI-UX §22).
 *
 * Inside the app, not behind a link to a website — that is the spec's rule,
 * and it is also the only version that works when somebody reads it on the
 * consent screen before an account exists. They are entry-shaped rather than
 * app-shaped (no header, no nav) so they render identically before and after
 * sign-up, and the same route serves both.
 *
 * The banner at the top is driven by LEGAL_REVIEWED, not written into the
 * markup, so removing it is one edit in one place and a test notices.
 */
export function legalScreen(state: EntryState & { document: LegalDocument; back: string }): Html {
  return html`<div class="entry entry--long">
    <div class="entry__body entry__form">
      <h1 class="entry__promise">${t(state.document.title, state.language)}</h1>

      ${LEGAL_REVIEWED ? '' : html`<div class="legal__warning" role="note">
        <div class="legal__warning-title">${t('legal.unreviewed_title', state.language)}</div>
        <p class="consent__body">${t('legal.unreviewed_body', state.language)}</p>
      </div>`}

      ${state.document.sections.map((section) => html`<div class="consent__section">
        <h2 class="consent__heading">${t(section.heading, state.language)}</h2>
        <p class="consent__body">${t(section.body, state.language)}</p>
      </div>`)}

      <p class="entry__footnote">${t('legal.last_updated', state.language).replace('{version}', CONSENT_VERSION)}</p>
      <a class="button button--quiet button--block" href="${state.back}" data-link>${t('action.back', state.language)}</a>
    </div>
  </div>`;
}

/**
 * Not found, and the outage state (coverage matrix).
 *
 * Both are her saying something rather than a status code: UI-UX §20's whole
 * point is that what went wrong arrives in her voice. Neither offers a
 * technical detail, because neither has one the person can use.
 */
export function notFound(state: EntryState): Html {
  return html`<div class="entry">
    <div class="entry__body">
      ${icon('i-none', 'lg')}
      <h1 class="entry__promise">${t('app.not_found_title', state.language)}</h1>
      <p class="entry__detail">${t('error.not_found', state.language)}</p>
    </div>
    <div class="entry__actions">
      <a class="button button--block" href="/chat" data-link>${t('app.back_to_chat', state.language)}</a>
    </div>
  </div>`;
}

export function outage(state: EntryState): Html {
  return html`<div class="entry">
    <div class="entry__body">
      ${icon('i-offline', 'lg')}
      <h1 class="entry__promise">${t('app.outage_title', state.language)}</h1>
      <p class="entry__detail">${t('error.outage', state.language)}</p>
    </div>
    <div class="entry__actions">
      <button class="button button--block" data-action="retry">${t('app.retry', state.language)}</button>
    </div>
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
