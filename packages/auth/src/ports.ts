// What the auth flow needs.  Adapted to @lian/db in the composition root.
export type AuthUser = { id: string; email: string; passwordHash: string; timeZone: string };
export type AuthDevice = { id: string; fingerprint: string; trustedAt: Date | null; revokedAt: Date | null };
export type AttemptOutcome = 'success' | 'bad_password' | 'unknown_email' | 'held_new_device' | 'confirmed' | 'denied';

export type AuthPorts = {
  findUserByEmail(email: string): Promise<AuthUser | null>;
  createUser(input: { email: string; passwordHash: string; timeZone: string }): Promise<AuthUser>;
  findDevice(userId: string, fingerprint: string): Promise<AuthDevice | null>;
  upsertDevice(userId: string, input: { fingerprint: string; userAgent: string | null; locationLabel: string | null }): Promise<AuthDevice>;
  trustDevice(userId: string, deviceId: string): Promise<void>;
  createSession(userId: string, input: { deviceId: string | null; tokenHash: string; expiresAt: Date }): Promise<string>;
  revokeAllSessions(userId: string): Promise<number>;
  recordAttempt(input: { userId: string | null; email: string; fingerprint: string | null; locationLabel: string | null; userAgent: string | null; outcome: AttemptOutcome }): Promise<string>;
  createConfirmation(userId: string, input: { deviceId: string; attemptId: string | null; tokenHash: string; expiresAt: Date }): Promise<string>;
  claimConfirmation(tokenHash: string, decision: 'confirmed' | 'denied', now: Date): Promise<{ userId: string; deviceId: string } | null>;
  /** Sends the confirm/deny link.  The email is the second factor. */
  sendDeviceConfirmation(input: { userId: string; email: string; token: string; locationLabel: string | null; userAgent: string | null }): Promise<void>;
  /** Lets her raise it in chat, calmly (UI-UX §16).  Never a bank-style alert. */
  raiseSecurityEvent(input: { userId: string; kind: 'held_new_device'; locationLabel: string | null; confirmationId: string }): Promise<void>;
};
