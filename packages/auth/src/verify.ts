// Confirming an email address.
//
// The third thing in this package shaped like a link in an inbox, and the
// only one that is not a credential: a reset link changes a password and a
// device link opens a session, but this one proves an address and nothing
// else. That difference decides everything below.
//
//   IT BLOCKS NOTHING. An unconfirmed address does not stop anybody signing
//   up, talking to her, or using any part of the product. A wall here would
//   be a wall in front of the first conversation, which is the one thing PRD
//   §8 will not have — and the risk it guards against is not urgent.
//
//   WHAT IT IS FOR IS RECOVERY. An address nobody has proved control of is an
//   address a reset link cannot usefully reach, most often because it was
//   mistyped at sign-up. The person will not find that out until the day they
//   need it, which is the worst possible day. So the product asks quietly and
//   repeatedly, and says why.
//
//   IT LIVES A DAY, not half an hour. It opens nothing, so a longer window
//   costs little, and somebody who signs up at midnight should still be able
//   to confirm over breakfast.
import { newToken, hashToken } from './tokens.ts';
import type { AuthPorts, VerificationPorts } from './ports.ts';

export const VERIFICATION_TTL_HOURS = 24;

export type VerificationRequest = { readonly userId: string; readonly email: string };

/**
 * Send (or resend) a confirmation link.
 *
 * Returns whether one went out, which is honest rather than useful: a
 * deployment with no transport creates the row and cannot deliver it, and the
 * screen says so instead of leaving somebody waiting.
 */
export async function sendEmailVerification(
  input: VerificationRequest,
  ports: AuthPorts & VerificationPorts,
  now: Date,
): Promise<{ readonly sent: boolean }> {
  const { token, hash } = newToken();
  await ports.createEmailVerification(input.userId, {
    email: input.email,
    tokenHash: hash,
    expiresAt: new Date(now.getTime() + VERIFICATION_TTL_HOURS * 60 * 60 * 1000),
  });
  return { sent: await ports.sendEmailVerification({ userId: input.userId, email: input.email, token }) };
}

export type VerificationOutcome =
  | { readonly status: 'confirmed'; readonly userId: string }
  /** Expired, spent, forged, or issued for an address the account no longer
   *  has — one answer for all four. */
  | { readonly status: 'invalid' };

export async function confirmEmail(
  input: { token: string },
  ports: VerificationPorts,
  now: Date,
): Promise<VerificationOutcome> {
  const claimed = await ports.claimEmailVerification(hashToken(input.token), now);
  return claimed === null ? { status: 'invalid' } : { status: 'confirmed', userId: claimed.userId };
}
