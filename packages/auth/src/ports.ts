// What the auth flow needs.  Adapted to @lian/db in the composition root.
export type AuthUser = { id: string; email: string; passwordHash: string; timeZone: string };
export type AuthDevice = { id: string; fingerprint: string; trustedAt: Date | null; revokedAt: Date | null };
export type AttemptOutcome =
  | 'success' | 'bad_password' | 'unknown_email' | 'held_new_device' | 'confirmed' | 'denied'
  /** Recovery (UI-UX §21). Both are shown on the security screen: a reset
   *  somebody did not ask for is exactly what that screen is for. */
  | 'reset_requested' | 'reset_completed';

export type AuthPorts = {
  findUserByEmail(email: string): Promise<AuthUser | null>;
  createUser(input: {
    email: string; passwordHash: string; timeZone: string;
    /** UI-UX §22, recorded at creation — an account that exists for even one
     *  request without a consent record was created without one. */
    consent: { isAdult: boolean; at: Date; version: string };
    /** What the sign-up screens were RENDERED in — an observation, not a
     *  preference, so onboarding still asks (migration 0017). */
    signupLanguage?: 'en' | 'ar' | null;
  }): Promise<AuthUser>;
  findDevice(userId: string, fingerprint: string): Promise<AuthDevice | null>;
  upsertDevice(userId: string, input: { fingerprint: string; userAgent: string | null; ip: string | null }): Promise<AuthDevice>;
  trustDevice(userId: string, deviceId: string): Promise<void>;
  createSession(userId: string, input: { deviceId: string | null; tokenHash: string; expiresAt: Date }): Promise<string>;
  revokeAllSessions(userId: string): Promise<number>;
  recordAttempt(input: { userId: string | null; email: string; fingerprint: string | null; ip: string | null; userAgent: string | null; outcome: AttemptOutcome }): Promise<string>;
  createConfirmation(userId: string, input: { deviceId: string; attemptId: string | null; tokenHash: string; expiresAt: Date }): Promise<string>;
  claimConfirmation(tokenHash: string, decision: 'confirmed' | 'denied', now: Date): Promise<{ userId: string; deviceId: string } | null>;
  /** Sends the confirm/deny link.  The email is the second factor. */
  sendDeviceConfirmation(input: { userId: string; email: string; token: string; ip: string | null; userAgent: string | null }): Promise<void>;
  /** Lets her raise it in chat, calmly (UI-UX §16).  Never a bank-style alert. */
  raiseSecurityEvent(input: { userId: string; kind: 'held_new_device' | 'password_reset'; ip: string | null; confirmationId: string }): Promise<void>;
  /** PRD §18's success metrics only exist if the events do.  Recorded here
   *  rather than by the caller, because the caller is where one gets
   *  forgotten. */
  recordEvent(input: { name: 'account_created' | 'session_started'; userId: string }): Promise<void>;
};

/**
 * What recovery needs, on top of AuthPorts.
 *
 * Separate so that the shape of a reset is visible in one place: four
 * operations, none of which can be used to ask whether an address has an
 * account.
 */
export type RecoveryPorts = {
  createPasswordReset(userId: string, input: { tokenHash: string; expiresAt: Date; ip: string | null; userAgent: string | null }): Promise<string>;
  claimPasswordReset(tokenHash: string, now: Date): Promise<{ userId: string } | null>;
  setPasswordHash(userId: string, passwordHash: string): Promise<void>;
  /** Sends the link. Like the device confirmation, the inbox is the factor. */
  sendPasswordReset(input: { userId: string; email: string; token: string }): Promise<void>;
};

/**
 * What confirming an address needs.
 *
 * `sendEmailVerification` returns whether a message actually went out —
 * unlike the other two send ports, which return void. It is the only one
 * whose result is shown to somebody: the app tells them the link cannot
 * arrive rather than leaving them waiting for mail nothing sends.
 */
export type VerificationPorts = {
  createEmailVerification(userId: string, input: { email: string; tokenHash: string; expiresAt: Date }): Promise<string>;
  claimEmailVerification(tokenHash: string, now: Date): Promise<{ userId: string } | null>;
  sendEmailVerification(input: { userId: string; email: string; token: string }): Promise<boolean>;
};
