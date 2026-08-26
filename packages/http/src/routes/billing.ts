// Billing (UI-UX §18).
//
// Four routes, and only one of them is interesting:
//
//   GET  /api/subscription           what they have, and what happens next
//   POST /api/subscription/checkout  a hosted page that takes the card
//   POST /api/subscription/portal    a hosted page that changes or cancels it
//   POST /api/stripe/webhook         ← the one that decides who is paying
//
// Nothing here takes a card number, a plan choice or an amount. There is one
// plan and the price is Stripe's; a route that accepted an amount would be a
// route somebody could send a different one to. The two hosted pages exist so
// that no card detail ever reaches this server, which is also the honest
// version of the "security/provider note" the spec asks the checkout to show.
import { HttpError, type Handler } from '../router.ts';
import { RATE_RULES, enforceRate, requireSession, withIdempotency, type MiddlewarePorts } from '../middleware.ts';

export type SubscriptionSummary = {
  plan: 'free' | 'paid';
  status: string | null;
  /** ISO. What "what remains until the renewal date" is measured against. */
  renewsOn: string | null;
  cancelAtPeriodEnd: boolean;
  /** Whether a portal session can be opened — false before there is a
   *  customer, which is most people. */
  manageable: boolean;
};

export type BillingPorts = MiddlewarePorts & {
  subscription(userId: string): Promise<SubscriptionSummary>;
  startCheckout(userId: string): Promise<{ url: string } | { unavailable: true }>;
  openPortal(userId: string): Promise<{ url: string } | { unavailable: true } | { noCustomer: true }>;
  /**
   * The RAW body and the signature header, in that order, because the
   * signature is over the bytes that arrived. A port that took a parsed
   * object could not be given what it needs to check.
   */
  handleWebhook(input: { body: string; signature: string }): Promise<{ handled: boolean; reason?: string }>;
  now(): Date;
};

export function billingRoutes(ports: BillingPorts): { method: 'GET' | 'POST'; pattern: string; handler: Handler }[] {
  return [
    {
      method: 'GET',
      pattern: '/api/subscription',
      handler: async (context) => {
        const session = await requireSession(context, ports, ports.now());
        await enforceRate({ bucket: `read:${session.userId}`, rule: RATE_RULES.read, now: ports.now() }, ports);
        return { status: 200, json: await ports.subscription(session.userId) };
      },
    },

    {
      method: 'POST',
      pattern: '/api/subscription/checkout',
      handler: async (context) => {
        const session = await requireSession(context, ports, ports.now());
        await enforceRate({ bucket: `write:${session.userId}`, rule: RATE_RULES.write, now: ports.now() }, ports);
        const result = await withIdempotency({ context, userId: session.userId, route: 'checkout' }, ports, async () => {
          const started = await ports.startCheckout(session.userId);
          if ('unavailable' in started) {
            throw new HttpError(503, 'billing_unconfigured', 'this deployment cannot take a payment yet');
          }
          return { status: 200, json: { url: started.url } };
        });
        return { status: result.status, json: result.json };
      },
    },

    {
      method: 'POST',
      pattern: '/api/subscription/portal',
      handler: async (context) => {
        const session = await requireSession(context, ports, ports.now());
        await enforceRate({ bucket: `write:${session.userId}`, rule: RATE_RULES.write, now: ports.now() }, ports);
        const result = await withIdempotency({ context, userId: session.userId, route: 'portal' }, ports, async () => {
          const opened = await ports.openPortal(session.userId);
          if ('unavailable' in opened) {
            throw new HttpError(503, 'billing_unconfigured', 'this deployment cannot take a payment yet');
          }
          if ('noCustomer' in opened) {
            throw new HttpError(409, 'nothing_to_manage', 'there is no subscription to manage yet');
          }
          return { status: 200, json: { url: opened.url } };
        });
        return { status: result.status, json: result.json };
      },
    },

    {
      method: 'POST',
      pattern: '/api/stripe/webhook',
      handler: async (context) => {
        // NO requireSession: Stripe has no session, and the signature is the
        // authentication. NO idempotency-key either — Stripe does not send
        // one, and the event id is the idempotency key instead (the handler
        // claims it).
        const signature = context.headers['stripe-signature'] ?? '';
        const outcome = await ports.handleWebhook({ body: context.rawBody, signature });
        if (!outcome.handled && outcome.reason !== undefined) {
          // 400 so Stripe records the failure, and it will retry. A signature
          // that never verifies retries a few times and stops, which is what
          // should happen to bytes we could not authenticate.
          throw new HttpError(400, 'bad_webhook', outcome.reason);
        }
        // 200 for everything that verified, INCLUDING event types nothing
        // acts on: an endpoint that errors on an unhandled type teaches
        // Stripe to retry it forever and eventually gets itself disabled.
        return { status: 200, json: { received: true } };
      },
    },
  ];
}
