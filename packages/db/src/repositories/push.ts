// Push subscriptions.
//
// A subscription is a URL that goes stale without telling anyone: the browser
// is reinstalled, site data is cleared, the service rotates its endpoints.
// Revoking on the push service's word (404/410) is the only thing that keeps
// the table honest.
import type { Sql } from '../client.ts';
import { db } from '../client.ts';
import type { UserScope } from '../scope.ts';

export type PushSubscription = { id: string; endpoint: string; p256dh: string; auth: string; deviceId: string | null };

type Row = { id: string; endpoint: string; p256dh: string; auth: string; device_id: string | null };
const COLUMNS = 'id, endpoint, p256dh, auth, device_id';
const toSubscription = (r: Row): PushSubscription => ({
  id: r.id, endpoint: r.endpoint, p256dh: r.p256dh, auth: r.auth, deviceId: r.device_id,
});

export async function save(
  scope: UserScope,
  input: { endpoint: string; p256dh: string; auth: string; deviceId?: string | null },
  sql: Sql = db(),
): Promise<PushSubscription> {
  // The same browser re-subscribing returns the same endpoint; revive it
  // rather than accumulating a second row.
  const { rows } = await sql.query<Row>(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, device_id, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (endpoint) DO UPDATE SET
       p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
       device_id = coalesce(EXCLUDED.device_id, push_subscriptions.device_id),
       revoked_at = NULL, last_seen_at = now()
     RETURNING ${COLUMNS}`,
    [scope.userId, input.endpoint, input.p256dh, input.auth, input.deviceId ?? null],
  );
  return toSubscription(rows[0]!);
}

export async function active(scope: UserScope, sql: Sql = db()): Promise<PushSubscription[]> {
  const { rows } = await sql.query<Row>(
    `SELECT ${COLUMNS} FROM push_subscriptions WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at`,
    [scope.userId],
  );
  return rows.map(toSubscription);
}

/** Called when the push service says the subscription is gone. */
export async function revoke(scope: UserScope, subscriptionId: string, sql: Sql = db()): Promise<void> {
  await sql.query(
    `UPDATE push_subscriptions SET revoked_at = now() WHERE user_id = $1 AND id = $2 AND revoked_at IS NULL`,
    [scope.userId, subscriptionId],
  );
}

export async function touch(scope: UserScope, subscriptionId: string, sql: Sql = db()): Promise<void> {
  await sql.query(
    `UPDATE push_subscriptions SET last_seen_at = now() WHERE user_id = $1 AND id = $2`,
    [scope.userId, subscriptionId],
  );
}

export async function purge(scope: UserScope, sql: Sql = db()): Promise<void> {
  await sql.query(`DELETE FROM push_subscriptions WHERE user_id = $1`, [scope.userId]);
}
