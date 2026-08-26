// Subscriptions.
//
// `plan` on the user is what the product reads — every gate already asks
// limitsFor(user.plan) — so this repository always writes both together, in
// one statement where it can. A subscription row that says 'active' beside a
// user row that says 'free' is a person who paid and cannot tell.
import type { Sql } from '../client.ts';
import { db } from '../client.ts';
import type { UserScope } from '../scope.ts';

export type Subscription = {
  userId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
  status: string;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
};

type Row = {
  user_id: string; stripe_customer_id: string; stripe_subscription_id: string | null;
  status: string; current_period_end: Date | null; cancel_at_period_end: boolean;
};
const COLUMNS = 'user_id, stripe_customer_id, stripe_subscription_id, status, current_period_end, cancel_at_period_end';
const toSubscription = (r: Row): Subscription => ({
  userId: r.user_id, stripeCustomerId: r.stripe_customer_id, stripeSubscriptionId: r.stripe_subscription_id,
  status: r.status, currentPeriodEnd: r.current_period_end, cancelAtPeriodEnd: r.cancel_at_period_end,
});

export async function get(scope: UserScope, sql: Sql = db()): Promise<Subscription | null> {
  const { rows } = await sql.query<Row>(`SELECT ${COLUMNS} FROM subscriptions WHERE user_id = $1`, [scope.userId]);
  return rows[0] === undefined ? null : toSubscription(rows[0]);
}

/** The user a Stripe customer belongs to. The webhook has a customer id and
 *  needs a user; this is the one lookup that goes that way. */
export async function userForCustomer(customerId: string, sql: Sql = db()): Promise<{ userId: string } | null> {
  // db-scoping:allow-unscoped — this is the lookup that PRODUCES a scope,
  // from an identifier Stripe supplies. Every write after it is scoped by
  // the user_id it returns.
  const { rows } = await sql.query<{ user_id: string }>(
    `SELECT user_id FROM subscriptions WHERE stripe_customer_id = $1`,
    [customerId],
  );
  return rows[0] === undefined ? null : { userId: rows[0].user_id };
}

/** Remember which customer a user is, before they have paid for anything —
 *  so a second checkout reuses the customer rather than making a stranger. */
export async function linkCustomer(scope: UserScope, customerId: string, sql: Sql = db()): Promise<void> {
  await sql.query(
    `INSERT INTO subscriptions (user_id, stripe_customer_id) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET stripe_customer_id = $2, updated_at = now()`,
    [scope.userId, customerId],
  );
}

/**
 * Apply what Stripe says, to the subscription AND to the plan, together.
 *
 * One statement each, one transaction: a crash between them is a person who
 * paid and is still on the free plan, or the reverse.
 */
export async function apply(
  scope: UserScope,
  input: {
    customerId: string; subscriptionId: string | null; status: string; active: boolean;
    currentPeriodEnd: Date | null; cancelAtPeriodEnd: boolean;
  },
  sql: Sql = db(),
): Promise<void> {
  await sql.query('BEGIN');
  try {
    await sql.query(
      `INSERT INTO subscriptions (user_id, stripe_customer_id, stripe_subscription_id, status, current_period_end, cancel_at_period_end)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id) DO UPDATE SET
         stripe_customer_id = $2, stripe_subscription_id = $3, status = $4,
         current_period_end = $5, cancel_at_period_end = $6, updated_at = now()`,
      [scope.userId, input.customerId, input.subscriptionId, input.status, input.currentPeriodEnd, input.cancelAtPeriodEnd],
    );
    await sql.query(`UPDATE users SET plan = $2 WHERE id = $1`, [scope.userId, input.active ? 'paid' : 'free']);
    await sql.query('COMMIT');
  } catch (error) {
    await sql.query('ROLLBACK');
    throw error;
  }
}

/**
 * Claim a Stripe event id.
 *
 * Returns false if it has been seen before. Stripe delivers at least once and
 * retries on any non-2xx, so a repeat is routine rather than suspicious — but
 * applying one twice is not.
 */
export async function claimEvent(
  input: { eventId: string; userId: string | null; type: string },
  sql: Sql = db(),
): Promise<boolean> {
  // db-scoping:allow-unscoped — the event arrives before a user is known, and
  // user_id is written as data rather than used as a filter.
  const { rowCount } = await sql.query(
    `INSERT INTO billing_events (stripe_event_id, user_id, type) VALUES ($1, $2, $3)
     ON CONFLICT (stripe_event_id) DO NOTHING`,
    [input.eventId, input.userId, input.type],
  );
  return (rowCount ?? 0) > 0;
}
