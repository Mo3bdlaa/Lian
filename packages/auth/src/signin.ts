// ==========================================================================
// Sign-in, and the new-device hold.
//
// Q10.  UI-UX §16 has her saying: "Someone tried to sign in from a new device
// and I stopped them. Was that you?"  That is a factual claim, and if the
// system merely LOGGED the attempt it would be a false one — which PRD §19
// names as a risk ("false sense of certainty") and which would poison the
// ownership positioning specifically, since that positioning is the product.
//
// So the sign-in is actually held: a correct password from an unrecognised
// device creates NO SESSION.  It creates a pending confirmation, emails a
// confirm/deny link, and asks her to raise it in chat.  Only a confirmation
// turns it into a session.  Now the sentence is a description.
// ==========================================================================
import { hashPassword, verifyPassword } from './password.ts';
import { newToken, hashToken } from './tokens.ts';
import type { AuthPorts } from './ports.ts';

export const SESSION_TTL_DAYS = 60;
export const CONFIRMATION_TTL_MINUTES = 30;

export type DeviceInfo = {
  readonly fingerprint: string;
  readonly userAgent: string | null;
  readonly locationLabel: string | null;
};

export type SignInResult =
  | { readonly status: 'signed_in'; readonly userId: string; readonly sessionToken: string }
  /** Correct password, unrecognised device.  No session exists. */
  | { readonly status: 'held_new_device'; readonly userId: string }
  /** Deliberately identical for a wrong password and an unknown email: the
   *  difference is an account-enumeration oracle. */
  | { readonly status: 'rejected' };

function expiry(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

export async function signUp(
  input: { email: string; password: string; timeZone: string; device: DeviceInfo },
  ports: AuthPorts,
  now: Date,
): Promise<{ userId: string; sessionToken: string }> {
  const user = await ports.createUser({
    email: input.email.trim().toLowerCase(),
    passwordHash: await hashPassword(input.password),
    timeZone: input.timeZone,
  });
  // The device someone signs up on is trusted by definition: it is the first
  // one, and there is nothing yet to protect it from.
  const device = await ports.upsertDevice(user.id, {
    fingerprint: input.device.fingerprint,
    userAgent: input.device.userAgent,
    locationLabel: input.device.locationLabel,
  });
  await ports.trustDevice(user.id, device.id);
  const { token, hash } = newToken();
  await ports.createSession(user.id, { deviceId: device.id, tokenHash: hash, expiresAt: expiry(now, SESSION_TTL_DAYS) });
  await ports.recordAttempt({ userId: user.id, email: user.email, fingerprint: input.device.fingerprint, locationLabel: input.device.locationLabel, userAgent: input.device.userAgent, outcome: 'success' });
  return { userId: user.id, sessionToken: token };
}

export async function signIn(
  input: { email: string; password: string; device: DeviceInfo },
  ports: AuthPorts,
  now: Date,
): Promise<SignInResult> {
  const email = input.email.trim().toLowerCase();
  const user = await ports.findUserByEmail(email);

  if (user === null) {
    await ports.recordAttempt({ userId: null, email, fingerprint: input.device.fingerprint, locationLabel: input.device.locationLabel, userAgent: input.device.userAgent, outcome: 'unknown_email' });
    // Spend comparable time so the absence of a user is not a timing oracle.
    await verifyPassword(input.password, 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
    return { status: 'rejected' };
  }

  if (!(await verifyPassword(input.password, user.passwordHash))) {
    await ports.recordAttempt({ userId: user.id, email, fingerprint: input.device.fingerprint, locationLabel: input.device.locationLabel, userAgent: input.device.userAgent, outcome: 'bad_password' });
    return { status: 'rejected' };
  }

  const known = await ports.findDevice(user.id, input.device.fingerprint);
  const recognised = known !== null && known.trustedAt !== null && known.revokedAt === null;

  if (recognised) {
    const { token, hash } = newToken();
    await ports.createSession(user.id, { deviceId: known.id, tokenHash: hash, expiresAt: expiry(now, SESSION_TTL_DAYS) });
    await ports.recordAttempt({ userId: user.id, email, fingerprint: input.device.fingerprint, locationLabel: input.device.locationLabel, userAgent: input.device.userAgent, outcome: 'success' });
    return { status: 'signed_in', userId: user.id, sessionToken: token };
  }

  // ── the hold ────────────────────────────────────────────────────────────
  // Note the order: the device row is created UNTRUSTED, no session is
  // created, and the attempt is recorded as held.  Everything after this
  // point is notification; nothing after it grants access.
  const device = await ports.upsertDevice(user.id, {
    fingerprint: input.device.fingerprint,
    userAgent: input.device.userAgent,
    locationLabel: input.device.locationLabel,
  });
  const attemptId = await ports.recordAttempt({
    userId: user.id, email, fingerprint: input.device.fingerprint,
    locationLabel: input.device.locationLabel, userAgent: input.device.userAgent, outcome: 'held_new_device',
  });
  const { token, hash } = newToken();
  const confirmationId = await ports.createConfirmation(user.id, {
    deviceId: device.id, attemptId, tokenHash: hash,
    expiresAt: new Date(now.getTime() + CONFIRMATION_TTL_MINUTES * 60_000),
  });
  await ports.sendDeviceConfirmation({ userId: user.id, email, token, locationLabel: input.device.locationLabel, userAgent: input.device.userAgent });
  await ports.raiseSecurityEvent({ userId: user.id, kind: 'held_new_device', locationLabel: input.device.locationLabel, confirmationId });

  return { status: 'held_new_device', userId: user.id };
}

/** The emailed link, or her Yes/No in chat.  Both land here. */
export async function resolveDeviceConfirmation(
  input: { token: string; decision: 'confirmed' | 'denied' },
  ports: AuthPorts,
  now: Date,
): Promise<{ status: 'confirmed'; userId: string; sessionToken: string } | { status: 'denied'; userId: string; sessionsRevoked: number } | { status: 'expired' }> {
  const claimed = await ports.claimConfirmation(hashToken(input.token), input.decision, now);
  if (claimed === null) return { status: 'expired' };

  if (input.decision === 'denied') {
    // "No, that wasn't me."  The device never becomes trusted, and every
    // existing session ends — if the password is known to someone else, a
    // session opened earlier is the thing that matters.
    const sessionsRevoked = await ports.revokeAllSessions(claimed.userId);
    await ports.recordAttempt({ userId: claimed.userId, email: '', fingerprint: null, locationLabel: null, userAgent: null, outcome: 'denied' });
    return { status: 'denied', userId: claimed.userId, sessionsRevoked };
  }

  await ports.trustDevice(claimed.userId, claimed.deviceId);
  const { token, hash } = newToken();
  await ports.createSession(claimed.userId, { deviceId: claimed.deviceId, tokenHash: hash, expiresAt: expiry(now, SESSION_TTL_DAYS) });
  await ports.recordAttempt({ userId: claimed.userId, email: '', fingerprint: null, locationLabel: null, userAgent: null, outcome: 'confirmed' });
  return { status: 'confirmed', userId: claimed.userId, sessionToken: token };
}
