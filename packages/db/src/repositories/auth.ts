// Devices, sessions, sign-in attempts, and the new-device confirmation.
//
// Q10: a sign-in from an unrecognised device is HELD until the user confirms
// by email.  That is what makes her line — "someone tried to sign in from a
// new device and I stopped them" — a description of something that happened,
// rather than a claim.  A false claim there would poison the ownership
// positioning specifically, which is the whole product.
import type { Sql } from '../client.ts';
import { db } from '../client.ts';
import type { UserScope } from '../scope.ts';

export type Device = {
  id: string; fingerprint: string; label: string | null; userAgent: string | null;
  locationLabel: string | null; firstSeenAt: Date; lastSeenAt: Date; trustedAt: Date | null; revokedAt: Date | null;
};
type DeviceRow = {
  id: string; fingerprint: string; label: string | null; user_agent: string | null;
  location_label: string | null; first_seen_at: Date; last_seen_at: Date; trusted_at: Date | null; revoked_at: Date | null;
};
const D_COLUMNS = 'id, fingerprint, label, user_agent, location_label, first_seen_at, last_seen_at, trusted_at, revoked_at';
const toDevice = (r: DeviceRow): Device => ({
  id: r.id, fingerprint: r.fingerprint, label: r.label, userAgent: r.user_agent, locationLabel: r.location_label,
  firstSeenAt: r.first_seen_at, lastSeenAt: r.last_seen_at, trustedAt: r.trusted_at, revokedAt: r.revoked_at,
});

export async function findDevice(scope: UserScope, fingerprint: string, sql: Sql = db()): Promise<Device | null> {
  const { rows } = await sql.query<DeviceRow>(
    `SELECT ${D_COLUMNS} FROM devices WHERE user_id = $1 AND fingerprint = $2`,
    [scope.userId, fingerprint],
  );
  return rows[0] === undefined ? null : toDevice(rows[0]);
}

export async function upsertDevice(
  scope: UserScope,
  input: { fingerprint: string; userAgent?: string | null; locationLabel?: string | null; label?: string | null },
  sql: Sql = db(),
): Promise<Device> {
  const { rows } = await sql.query<DeviceRow>(
    `INSERT INTO devices (user_id, fingerprint, user_agent, location_label, label)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, fingerprint)
     DO UPDATE SET last_seen_at = now(), user_agent = coalesce(EXCLUDED.user_agent, devices.user_agent)
     RETURNING ${D_COLUMNS}`,
    [scope.userId, input.fingerprint, input.userAgent ?? null, input.locationLabel ?? null, input.label ?? null],
  );
  return toDevice(rows[0]!);
}

export async function trustDevice(scope: UserScope, deviceId: string, sql: Sql = db()): Promise<void> {
  await sql.query(
    `UPDATE devices SET trusted_at = now(), revoked_at = NULL WHERE user_id = $1 AND id = $2`,
    [scope.userId, deviceId],
  );
}

export async function revokeDevice(scope: UserScope, deviceId: string, sql: Sql = db()): Promise<void> {
  await sql.query(`UPDATE devices SET revoked_at = now(), trusted_at = NULL WHERE user_id = $1 AND id = $2`, [scope.userId, deviceId]);
  await sql.query(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND device_id = $2 AND revoked_at IS NULL`, [scope.userId, deviceId]);
}

export async function listDevices(scope: UserScope, sql: Sql = db()): Promise<Device[]> {
  const { rows } = await sql.query<DeviceRow>(
    `SELECT ${D_COLUMNS} FROM devices WHERE user_id = $1 ORDER BY last_seen_at DESC`,
    [scope.userId],
  );
  return rows.map(toDevice);
}

// ── sessions ──────────────────────────────────────────────────────────────
export async function createSession(
  scope: UserScope,
  input: { deviceId: string | null; tokenHash: string; expiresAt: Date },
  sql: Sql = db(),
): Promise<string> {
  const { rows } = await sql.query<{ id: string }>(
    `INSERT INTO sessions (user_id, device_id, token_hash, expires_at) VALUES ($1, $2, $3, $4) RETURNING id`,
    [scope.userId, input.deviceId, input.tokenHash, input.expiresAt],
  );
  return rows[0]!.id;
}

export async function sessionByToken(tokenHash: string, now: Date, sql: Sql = db()): Promise<{ id: string; userId: string; deviceId: string | null } | null> {
  // db-scoping:allow-unscoped — this is where a user id first comes FROM.
  // The session token is the credential; every scoped read in the product
  // happens after this returns, using the user it names.
  const { rows } = await sql.query<{ id: string; user_id: string; device_id: string | null }>(
    `SELECT id, user_id, device_id FROM sessions
     WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > $2`,
    [tokenHash, now],
  );
  return rows[0] === undefined ? null : { id: rows[0].id, userId: rows[0].user_id, deviceId: rows[0].device_id };
}

/** UI-UX §16 / DECISIONS §35: "Sign out everywhere", and the current session
 *  ends too — plainer than "lock all sessions", and it says what it does. */
export async function revokeAllSessions(scope: UserScope, sql: Sql = db()): Promise<number> {
  const { rowCount } = await sql.query(
    `UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
    [scope.userId],
  );
  return rowCount ?? 0;
}

// ── attempts ──────────────────────────────────────────────────────────────
export type AttemptOutcome = 'success' | 'bad_password' | 'unknown_email' | 'held_new_device' | 'confirmed' | 'denied';

export async function recordAttempt(
  input: { userId: string | null; email: string; fingerprint?: string | null; locationLabel?: string | null; userAgent?: string | null; outcome: AttemptOutcome },
  sql: Sql = db(),
): Promise<string> {
  const { rows } = await sql.query<{ id: string }>(
    `INSERT INTO sign_in_attempts (user_id, email_attempted, fingerprint, location_label, user_agent, outcome)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [input.userId, input.email, input.fingerprint ?? null, input.locationLabel ?? null, input.userAgent ?? null, input.outcome],
  );
  return rows[0]!.id;
}

export async function recentAttempts(scope: UserScope, limit: number, sql: Sql = db()): Promise<{ outcome: AttemptOutcome; locationLabel: string | null; createdAt: Date }[]> {
  const { rows } = await sql.query<{ outcome: AttemptOutcome; location_label: string | null; created_at: Date }>(
    `SELECT outcome, location_label, created_at FROM sign_in_attempts
     WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [scope.userId, limit],
  );
  return rows.map((r) => ({ outcome: r.outcome, locationLabel: r.location_label, createdAt: r.created_at }));
}

// ── the new-device hold (Q10) ─────────────────────────────────────────────
export async function createConfirmation(
  scope: UserScope,
  input: { deviceId: string; attemptId: string | null; tokenHash: string; expiresAt: Date },
  sql: Sql = db(),
): Promise<string> {
  const { rows } = await sql.query<{ id: string }>(
    `INSERT INTO device_confirmations (user_id, device_id, attempt_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [scope.userId, input.deviceId, input.attemptId, input.tokenHash, input.expiresAt],
  );
  return rows[0]!.id;
}

export async function claimConfirmation(
  tokenHash: string,
  decision: 'confirmed' | 'denied',
  now: Date,
  sql: Sql = db(),
): Promise<{ userId: string; deviceId: string } | null> {
  const column = decision === 'confirmed' ? 'confirmed_at' : 'denied_at';
  // db-scoping:allow-unscoped — the person clicking the emailed link is not
  // signed in yet, so there is no session to scope by: the single-use,
  // expiring token IS the credential, and the row it matches names the user.
  // Scoping this by user_id would require trusting a user id from the URL,
  // which is strictly worse.
  const { rows } = await sql.query<{ user_id: string; device_id: string }>(
    `UPDATE device_confirmations SET ${column} = $2
     WHERE token_hash = $1 AND confirmed_at IS NULL AND denied_at IS NULL AND expires_at > $2
     RETURNING user_id, device_id`,
    [tokenHash, now],
  );
  return rows[0] === undefined ? null : { userId: rows[0].user_id, deviceId: rows[0].device_id };
}
