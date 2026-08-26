// Subscription (UI-UX §18).
//
// One plan, one price, one action. What is deliberately absent: a comparison
// table, a "most popular" badge, a countdown, a discount, and any mention of
// what is lost by not subscribing. §19 says the upgrade action stays
// secondary, and this is the one screen where it is allowed to be the primary
// thing — because you got here by asking.
//
// No card field. The card is Stripe's hosted page, which is also the honest
// version of the "security/provider note" the spec asks for: the note is true
// because there is nowhere here to type a number.
import { html, icon, type Html } from '../dom.ts';
import { t } from '../copy.ts';
import { dateLabel } from '../format.ts';
import type { Snapshot } from '../state.ts';

export type Plan = {
  plan: 'free' | 'paid';
  status: string | null;
  renewsOn: string | null;
  cancelAtPeriodEnd: boolean;
  manageable: boolean;
};

export function planScreen(me: Snapshot, data: Plan, justSubscribed: boolean): Html {
  const language = me.user.language;
  const gender = me.assistant.gender;
  const paid = data.plan === 'paid';

  return html`
    <h1 class="screen__title">${t('plan.title', language, gender)}</h1>

    ${justSubscribed && paid
      // Her line, not a receipt. The receipt is Stripe's and arrives by email.
      ? html`<p class="observation">${t('plan.success', language, gender)}</p>`
      : ''}

    <div class="card plan__current">
      <div class="plan__name">${t(paid ? 'plan.paid' : 'plan.free', language, gender)}</div>
      ${paid ? '' : html`<div class="plan__price">${t('plan.price', language, gender)}</div>`}
      ${data.renewsOn === null ? '' : html`<div class="plan__renewal">
        ${t(data.cancelAtPeriodEnd ? 'plan.ends_on' : 'plan.renews_on', language, gender)
          .replace('{date}', dateLabel(data.renewsOn.slice(0, 10), language, me.user.timeZone))}
      </div>`}
    </div>

    ${data.cancelAtPeriodEnd
      // §18: what remains, what changes, how to come back — and no retention
      // guilt, which means no "are you sure" and no list of what they lose.
      ? html`<p class="screen__lede">${t('plan.after_cancel', language, gender)}</p>
             <p class="screen__lede">${t('plan.resubscribe', language, gender)}</p>`
      : ''}

    ${paid ? '' : html`
      <div class="section">${t('plan.what_changes', language, gender)}</div>
      ${[
        { key: 'plan.voice', icon: 'i-mic' },
        { key: 'plan.proactive', icon: 'i-bell' },
        { key: 'plan.memory', icon: 'i-memory' },
        { key: 'plan.messages', icon: 'i-chat' },
      ].map((row) => html`<div class="row row--static">
        ${icon(row.icon, 'sm', 'icon--muted')}
        <span class="row__label">${t(row.key as 'plan.voice', language, gender)}</span>
      </div>`)}`}

    <div class="plan__actions">
      ${paid
        ? data.manageable
          ? html`<button class="button button--block" data-action="manage-plan">${t('plan.manage', language, gender)}</button>`
          : ''
        : html`<button class="button button--block" data-action="upgrade">${t('plan.upgrade', language, gender)}</button>`}
      <p class="entry__footnote">${t('plan.card_note', language, gender)}</p>
    </div>
  `;
}
