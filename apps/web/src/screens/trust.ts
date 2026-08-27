// Settings, security, data (UI-UX §12, §16, §17).
//
// The three screens the product's promise lives on. Deletion is real and says
// so; the export is a plain file; the device list is what actually happened,
// including attempts that were held.
import { html, icon, type Html } from '../dom.ts';
import { t } from '../copy.ts';
import { dateLabel, time } from '../format.ts';
import type { Snapshot } from '../state.ts';

export type Security = {
  devices: { id: string; label: string; lastSeen: string | null; current: boolean }[];
  attempts: { outcome: string; at: string; location: string | null }[];
};

export function settingsScreen(me: Snapshot): Html {
  const language = me.user.language;
  const gender = me.assistant.gender;
  const appearance = me.user.themePreference === 'always-light' ? 'settings.appearance_light'
    : me.user.themePreference === 'always-dark' ? 'settings.appearance_dark'
    : 'settings.appearance_auto';
  return html`
    <h1 class="screen__title">${t('settings.title', language, gender)}</h1>

    <div class="section">${t('settings.her', language, gender)}</div>
    <a class="row" href="/settings/identity" data-link>
      <span class="row__label">${t('settings.identity', language, gender)}</span>
      <span class="row__value">${me.assistant.name}</span>
      ${icon('i-chevron', 'sm', 'icon--muted icon--flip')}
    </a>
    <a class="row" href="/settings/personality" data-link>
      <span class="row__label">${t('settings.personality', language, gender)}</span>
      ${icon('i-chevron', 'sm', 'icon--muted icon--flip')}
    </a>
    <a class="row" href="/settings/language" data-link>
      <span class="row__label">${t('settings.language', language, gender)}</span>
      <span class="row__value">${me.user.languageStyle === 'auto' ? t('settings.language_auto', language, gender) : me.user.languageStyle.toUpperCase()}</span>
      ${icon('i-chevron', 'sm', 'icon--muted icon--flip')}
    </a>

    <div class="section">${t('settings.reach', language, gender)}</div>
    <button class="row" data-action="notifications">
      <span class="row__label">${t('settings.notifications', language, gender)}</span>
      ${icon('i-bell', 'sm', 'icon--muted')}
    </button>
    <a class="row" href="/settings/quiet-hours" data-link>
      <span class="row__label">${t('settings.quiet_hours', language, gender)}</span>
      ${icon('i-chevron', 'sm', 'icon--muted icon--flip')}
    </a>

    <div class="section">${t('settings.appearance', language, gender)}</div>
    <div class="chips">
      ${(['auto', 'always-light', 'always-dark'] as const).map((preference) => html`<button
          class="chip ${me.user.themePreference === preference ? 'chip--on' : ''}"
          data-action="appearance" data-key="${preference}">
        ${t(preference === 'auto' ? 'settings.appearance_auto' : preference === 'always-light' ? 'settings.appearance_light' : 'settings.appearance_dark', language, gender)}
      </button>`)}
    </div>
    <p class="screen__lede">${t(appearance, language, gender)}</p>

    <div class="section">${t('settings.yours', language, gender)}</div>
    <a class="row" href="/security" data-link>
      <span class="row__label">${t('settings.security', language, gender)}</span>
      ${icon('i-chevron', 'sm', 'icon--muted icon--flip')}
    </a>
    <a class="row" href="/data" data-link>
      <span class="row__label">${t('data.title', language, gender)}</span>
      ${icon('i-chevron', 'sm', 'icon--muted icon--flip')}
    </a>
    <a class="row" href="/subscription" data-link>
      <span class="row__label">${t('settings.subscription', language, gender)}</span>
      <span class="row__value">${t(me.user.plan === 'paid' ? 'settings.plan_paid' : 'settings.plan_free', language, gender)}</span>
      ${icon('i-chevron', 'sm', 'icon--muted icon--flip')}
    </a>
  `;
}

export function securityScreen(me: Snapshot, data: Security): Html {
  const language = me.user.language;
  const gender = me.assistant.gender;
  return html`
    <h1 class="screen__title">${t('security.title', language, gender)}</h1>

    <div class="section">${t('security.trusted_devices', language, gender)}</div>
    ${data.devices.map((device) => html`<div class="row row--static">
      ${icon(device.current ? 'i-device' : 'i-laptop', 'sm', 'icon--muted')}
      <span class="row__label">
        ${device.label}
        <span class="row__sub">${device.current ? t('security.this_device', language, gender) : device.lastSeen === null ? '' : dateLabel(device.lastSeen.slice(0, 10), language, me.user.timeZone)}</span>
      </span>
      ${device.current ? '' : html`<button class="button button--plain" data-action="revoke-device" data-id="${device.id}">${t('security.revoke', language, gender)}</button>`}
    </div>`)}

    <div class="section">${t('security.recent_attempts', language, gender)}</div>
    ${data.attempts.map((attempt) => html`<div class="row row--static">
      ${icon(attempt.outcome === 'success' ? 'i-check' : attempt.outcome === 'held_new_device' ? 'i-shield' : 'i-lock', 'sm', 'icon--muted')}
      <span class="row__label">
        ${t(`security.outcome_${attempt.outcome}` as 'security.outcome_success', language, gender)}
        <span class="row__sub">${dateLabel(attempt.at.slice(0, 10), language, me.user.timeZone)} · ${time(attempt.at, language, me.user.timeZone)}</span>
      </span>
    </div>`)}

    <button class="button button--quiet button--block" data-action="sign-out-everywhere">
      ${t('settings.sign_out_everywhere', language, gender)}
    </button>
  `;
}

export type DataState = { export: { filename: string; archive: unknown } | null; confirming: boolean; typed: string; busy: boolean };

export function dataScreen(me: Snapshot, state: DataState): Html {
  const language = me.user.language;
  const gender = me.assistant.gender;
  const lines = ['data.delete_conversations', 'data.delete_memories', 'data.delete_story', 'data.delete_life', 'data.delete_account'] as const;

  return html`
    <h1 class="screen__title">${t('data.title', language, gender)}</h1>
    <p class="screen__lede">${t('data.all_yours', language, gender)}</p>

    ${state.export === null
      ? html`<button class="button button--block" data-action="export" ${state.busy ? html`disabled` : ''}>
          ${state.busy ? t('action.loading', language, gender) : t('data.export', language, gender)}
        </button>`
      : html`<div class="card">
          <div class="row__label">${t('data.export_ready', language, gender)}</div>
          <a class="button button--block" data-action="download" href="#" download="${state.export.filename}">${t('data.download', language, gender)}</a>
        </div>`}

    ${me.user.emailVerified ? '' : html`
      <div class="section">${t('verify.unconfirmed', language, gender)}</div>
      <!-- Quiet, and repeated, and it says WHY. Confirming blocks nothing;
           it is the thing that makes getting back in possible, and somebody
           who mistyped their address will not find that out until the worst
           possible day. -->
      <p class="screen__lede">${t('verify.why', language, gender)}</p>
      <button class="button button--quiet button--block" data-action="resend-verification">
        ${t('verify.send', language, gender)}
      </button>`}

    <div class="section">${t('legal.terms_title', language, gender)}</div>
    <a class="row" href="/terms" data-link>
      <span class="row__label">${t('legal.terms_title', language, gender)}</span>
      ${icon('i-chevron', 'sm', 'icon--muted icon--flip')}
    </a>
    <a class="row" href="/privacy" data-link>
      <span class="row__label">${t('legal.privacy_title', language, gender)}</span>
      ${icon('i-chevron', 'sm', 'icon--muted icon--flip')}
    </a>

    <div class="section">${t('data.delete_everything', language, gender)}</div>
    <p class="screen__lede">${t('data.delete_warning', language, gender)}</p>
    ${lines.map((line) => html`<div class="row row--static">
      ${icon('i-dot', 'sm', 'icon--muted')}<span class="row__label">${t(line, language, gender)}</span>
    </div>`)}

    ${state.confirming
      ? html`<form class="field" data-action="delete-everything">
          <label class="field__label" for="confirm">${t('data.type_delete', language, gender)}</label>
          <input class="field__input" id="confirm" name="confirm" autocomplete="off" value="${state.typed}">
          <button class="button button--destructive button--block" type="submit">${t('data.delete_everything', language, gender)}</button>
          <button class="button button--plain button--block" type="button" data-action="export">${t('data.export_first', language, gender)}</button>
        </form>`
      : html`<button class="button button--destructive button--block" data-action="delete-confirm">
          ${t('data.delete_everything', language, gender)}
        </button>`}
  `;
}

