// ==========================================================================
// ACCOUNT RECOVERY.
//
// The product holds a year of somebody's life. Locking themselves out of it
// is the failure that makes everything else irrelevant, and a recovery path
// is also the biggest hole an attacker gets handed on purpose — so the two
// pressures are in tension in every decision below, and each one says which
// way it went and why.
//
//   1. REQUESTING A RESET SAYS THE SAME THING WHETHER OR NOT THE ACCOUNT
//      EXISTS. Anything else is an account-enumeration oracle, and the whole
//      of sign-in is already careful about that.
//   2. THE TOKEN IS SINGLE-USE AND SHORT-LIVED, stored hashed, and claimed by
//      the database rather than by a read-then-write.
//   3. REQUESTING A NEW ONE SPENDS THE OLD ONE. Two live links means the
//      older one — sitting in an inbox — still works.
//   4. A COMPLETED RESET ENDS EVERY OTHER SESSION. Recovery is what somebody
//      does when they think they have been compromised; leaving the intruder
//      signed in would make the recovery ceremonial.
//   5. THE DEVICE THAT COMPLETES THE RESET IS TRUSTED. Holding it would mean
//      emailing a second link to the same inbox that just proved control of
//      itself — ceremony that teaches people to click links.
//   6. SHE SAYS SO AFTERWARDS. A password changing is exactly the kind of
//      thing UI-UX §16 has her raise, calmly, in her own words.
// ==========================================================================
import { hashPassword } from './password.ts';
import { newToken, hashToken } from './tokens.ts';
import type { AuthPorts, RecoveryPorts } from './ports.ts';
import { SESSION_TTL_DAYS } from './signin.ts';

/**
 * How long a reset link lives.
 *
 * ASSUMPTION: 30 minutes, the same as a device confirmation. Long enough for
 * an email to arrive and be read, short enough that a link left in an inbox
 * is not a standing key. It is a security/annoyance trade with no measurement
 * behind it; if people start missing the window, this is the number.
 */
export const RESET_TTL_MINUTES = 30;

/** The floor, matching sign-up. Length is the only password rule that
 *  survives contact with people. */
export const MIN_PASSWORD_LENGTH = 10;

export type ResetRequest = {
  readonly email: string;
  readonly ip: string | null;
  readonly userAgent: string | null;
};

/**
 * Ask for a reset.
 *
 * ALWAYS returns the same thing. Not "we sent it if the account exists" as a
 * comment — the function has one return shape and no branch a caller could
 * expose. Whether an email was sent is not knowable from here.
 */
export async function requestPasswordReset(
  input: ResetRequest,
  ports: AuthPorts & RecoveryPorts,
  now: Date,
): Promise<{ readonly status: 'accepted' }> {
  const email = input.email.trim().toLowerCase();
  const user = await ports.findUserByEmail(email);

  if (user !== null) {
    const { token, hash } = newToken();
    await ports.createPasswordReset(user.id, {
      tokenHash: hash,
      expiresAt: new Date(now.getTime() + RESET_TTL_MINUTES * 60 * 1000),
      ip: input.ip,
      userAgent: input.userAgent,
    });
    await ports.sendPasswordReset({ userId: user.id, email: user.email, token });
    await ports.recordAttempt({
      userId: user.id, email, fingerprint: null,
      locationLabel: null, userAgent: input.userAgent, outcome: 'reset_requested',
    });
  } else {
    // Recorded WITHOUT a user, so a burst of requests for addresses that do
    // not exist is visible to whoever looks — that pattern is somebody
    // testing a list of emails against this endpoint.
    await ports.recordAttempt({
      userId: null, email, fingerprint: null,
      locationLabel: null, userAgent: input.userAgent, outcome: 'unknown_email',
    });
  }

  return { status: 'accepted' };
}

export type ResetOutcome =
  | { readonly status: 'reset'; readonly userId: string; readonly sessionToken: string; readonly sessionsRevoked: number }
  /** Expired, already used, or never existed — one answer for all three, for
   *  the same reason the request has one answer. */
  | { readonly status: 'invalid' }
  | { readonly status: 'weak_password' };

/**
 * Complete a reset: new password, new session, every other session gone.
 *
 * The ORDER matters and is not incidental. The token is claimed first, so a
 * failure anywhere after it cannot leave a live link behind. The password is
 * written before the sessions are revoked, so a crash between them leaves the
 * account recoverable with the NEW password rather than locked with sessions
 * that no longer exist.
 */
export async function completePasswordReset(
  input: { token: string; password: string; device: { fingerprint: string; userAgent: string | null; locationLabel: string | null } },
  ports: AuthPorts & RecoveryPorts,
  now: Date,
): Promise<ResetOutcome> {
  if (input.password.length < MIN_PASSWORD_LENGTH) return { status: 'weak_password' };

  const claimed = await ports.claimPasswordReset(hashToken(input.token), now);
  if (claimed === null) return { status: 'invalid' };

  await ports.setPasswordHash(claimed.userId, await hashPassword(input.password));

  // Decision 4: everything else ends. Including, deliberately, sessions on
  // devices the person still owns — they can sign in again with the password
  // they just chose, and the alternative leaves an intruder signed in.
  const sessionsRevoked = await ports.revokeAllSessions(claimed.userId);

  // Decision 5: this device is trusted. The inbox already proved control of
  // itself; a second link to the same inbox is ceremony.
  const device = await ports.upsertDevice(claimed.userId, {
    fingerprint: input.device.fingerprint,
    userAgent: input.device.userAgent,
    locationLabel: input.device.locationLabel,
  });
  await ports.trustDevice(claimed.userId, device.id);

  const { token, hash } = newToken();
  await ports.createSession(claimed.userId, {
    deviceId: device.id, tokenHash: hash,
    expiresAt: new Date(now.getTime() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000),
  });

  await ports.recordAttempt({
    userId: claimed.userId, email: '', fingerprint: input.device.fingerprint,
    locationLabel: input.device.locationLabel, userAgent: input.device.userAgent, outcome: 'reset_completed',
  });
  // Decision 6: she mentions it. Not a bank alert — UI-UX §16's register.
  await ports.raiseSecurityEvent({
    userId: claimed.userId, kind: 'password_reset',
    locationLabel: input.device.locationLabel, confirmationId: '',
  });

  return { status: 'reset', userId: claimed.userId, sessionToken: token, sessionsRevoked };
}
