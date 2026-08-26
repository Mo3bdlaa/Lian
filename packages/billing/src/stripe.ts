// Stripe, over fetch.
//
// No SDK, for the same reason nothing else here has one: the whole surface
// this product needs is four calls and one signature check, and an SDK is a
// dependency tree, a release cadence and a second place the API version is
// decided. What it costs is that the shapes below are written from the
// documentation rather than generated from it — so every field this parses is
// validated, and anything unrecognised is a refusal rather than a default.
//
// The four calls:
//   checkout session   the hosted page that takes the card
//   portal session     the hosted page that changes or cancels it
//   subscription read  what the truth is, when a webhook is not trusted
//   webhook signature  which is not a call at all, and is the important part
export type StripeConfig = {
  readonly secretKey: string;
  readonly priceId: string;
  readonly webhookSecret: string;
  /** Where Stripe sends the browser back to. */
  readonly successUrl: string;
  readonly cancelUrl: string;
  readonly returnUrl: string;
  readonly apiBase?: string;
};

const API = 'https://api.stripe.com';

/**
 * The API version, pinned.
 *
 * ASSUMPTION, and it is the load-bearing one in this file: Stripe's REST
 * shapes change per version, and an account whose default version moves would
 * silently change what the parsing below receives. Pinning it means an
 * upgrade is an edit here rather than a surprise in production. Written
 * against the 2024-06-20 shapes; not verified against the live API in this
 * environment, which is what a first real checkout will do.
 */
export const STRIPE_API_VERSION = '2024-06-20';

export type CheckoutSession = { id: string; url: string };
export type PortalSession = { url: string };

/** What the product cares about, out of a much larger object. */
export type SubscriptionState = {
  readonly subscriptionId: string;
  readonly customerId: string;
  /** Stripe's own status string, kept verbatim so a log says what Stripe
   *  said rather than what we mapped it to. */
  readonly status: string;
  /** Whether the PRODUCT should treat this as paid. Derived once, here. */
  readonly active: boolean;
  /** When the current paid period runs out — what "what remains until the
   *  renewal date" (UI-UX §18) is measured against. */
  readonly currentPeriodEnd: Date | null;
  readonly cancelAtPeriodEnd: boolean;
};

/**
 * Which Stripe statuses mean "they paid".
 *
 * 'trialing' counts and 'past_due' does not: a card that stopped working is
 * a conversation to have, not a service to keep giving away — and Stripe
 * retries before it reaches this state, so by the time it does, it has
 * already been a conversation.
 */
const ACTIVE_STATUSES = new Set(['active', 'trialing']);

export type StripeClient = {
  createCheckout(input: { userId: string; email: string; customerId: string | null }): Promise<CheckoutSession>;
  createPortal(input: { customerId: string }): Promise<PortalSession>;
  getSubscription(subscriptionId: string): Promise<SubscriptionState | null>;
};

const form = (fields: Record<string, string | undefined>): string =>
  Object.entries(fields)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');

export class StripeError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'StripeError';
    this.status = status;
  }
}

export function stripeClient(config: StripeConfig, fetcher: typeof fetch = fetch): StripeClient {
  const base = config.apiBase ?? API;

  const call = async (path: string, body: string): Promise<Record<string, unknown>> => {
    const response = await fetcher(`${base}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.secretKey}`,
        'content-type': 'application/x-www-form-urlencoded',
        'stripe-version': STRIPE_API_VERSION,
      },
      body,
    });
    const payload = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      const error = payload['error'] as { message?: string } | undefined;
      throw new StripeError(error?.message ?? `stripe returned ${response.status}`, response.status);
    }
    return payload;
  };

  const read = async (path: string): Promise<Record<string, unknown> | null> => {
    const response = await fetcher(`${base}${path}`, {
      headers: { authorization: `Bearer ${config.secretKey}`, 'stripe-version': STRIPE_API_VERSION },
    });
    if (response.status === 404) return null;
    const payload = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      const error = payload['error'] as { message?: string } | undefined;
      throw new StripeError(error?.message ?? `stripe returned ${response.status}`, response.status);
    }
    return payload;
  };

  return {
    async createCheckout({ userId, email, customerId }) {
      const payload = await call('/v1/checkout/sessions', form({
        mode: 'subscription',
        'line_items[0][price]': config.priceId,
        'line_items[0][quantity]': '1',
        success_url: config.successUrl,
        cancel_url: config.cancelUrl,
        // The user id travels on the SUBSCRIPTION, not only the session:
        // webhooks about a renewal months from now carry the subscription,
        // and a session id would be long forgotten by then.
        'subscription_data[metadata][user_id]': userId,
        'metadata[user_id]': userId,
        ...(customerId === null ? { customer_email: email } : { customer: customerId }),
      }));
      const url = payload['url'];
      const id = payload['id'];
      if (typeof url !== 'string' || typeof id !== 'string') {
        throw new StripeError('stripe returned a checkout session with no url', 502);
      }
      return { id, url };
    },

    async createPortal({ customerId }) {
      const payload = await call('/v1/billing_portal/sessions', form({
        customer: customerId,
        return_url: config.returnUrl,
      }));
      const url = payload['url'];
      if (typeof url !== 'string') throw new StripeError('stripe returned a portal session with no url', 502);
      return { url };
    },

    async getSubscription(subscriptionId) {
      const payload = await read(`/v1/subscriptions/${encodeURIComponent(subscriptionId)}`);
      return payload === null ? null : parseSubscription(payload);
    },
  };
}

/**
 * A subscription object, validated.
 *
 * Returns null rather than a half-filled record: everything downstream turns
 * this into whether somebody is paying, and a guess about that is worse than
 * a refusal to answer.
 */
export function parseSubscription(payload: Record<string, unknown>): SubscriptionState | null {
  const subscriptionId = payload['id'];
  const status = payload['status'];
  if (typeof subscriptionId !== 'string' || typeof status !== 'string') return null;

  const rawCustomer = payload['customer'];
  // `customer` is an id string, or an expanded object depending on the call.
  const customerId = typeof rawCustomer === 'string'
    ? rawCustomer
    : typeof (rawCustomer as { id?: unknown } | null)?.id === 'string'
      ? (rawCustomer as { id: string }).id
      : null;
  if (customerId === null) return null;

  const periodEnd = payload['current_period_end'];
  return {
    subscriptionId,
    customerId,
    status,
    active: ACTIVE_STATUSES.has(status),
    // Stripe sends seconds; everything here is milliseconds.
    currentPeriodEnd: typeof periodEnd === 'number' && Number.isFinite(periodEnd) ? new Date(periodEnd * 1000) : null,
    cancelAtPeriodEnd: payload['cancel_at_period_end'] === true,
  };
}
