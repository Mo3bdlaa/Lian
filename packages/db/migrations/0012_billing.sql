-- Billing (UI-UX §18).
--
-- One row per user, and `plan` on the user stays the single thing the product
-- reads: everything that gates a feature already asks limitsFor(user.plan),
-- and adding a second source of truth would mean every one of those places
-- could disagree with this table. So this table records WHY the plan is what
-- it is, and the webhook writes both together.
--
-- stripe_event_id is the idempotency key. Stripe delivers at least once and
-- retries on any non-2xx, so the same event arrives more than once as a
-- matter of course — a handler that is not idempotent will eventually
-- double-apply one.
CREATE TABLE IF NOT EXISTS subscriptions (
  user_id                uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  stripe_customer_id     text NOT NULL,
  stripe_subscription_id text,
  status                 text NOT NULL DEFAULT 'incomplete',
  current_period_end     timestamptz,
  cancel_at_period_end   boolean NOT NULL DEFAULT false,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_customer ON subscriptions (stripe_customer_id);
CREATE INDEX IF NOT EXISTS subscriptions_subscription ON subscriptions (stripe_subscription_id);

-- Events already applied. Kept rather than trusted-and-forgotten, because
-- "did we already act on this" is not answerable from the subscription row:
-- an out-of-order 'updated' after a 'deleted' would otherwise re-activate.
CREATE TABLE IF NOT EXISTS billing_events (
  stripe_event_id text PRIMARY KEY,
  user_id         uuid REFERENCES users(id) ON DELETE CASCADE,
  type            text NOT NULL,
  received_at     timestamptz NOT NULL DEFAULT now()
);
