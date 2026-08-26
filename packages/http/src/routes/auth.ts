// Auth routes.
//
// The only unusual one is sign-in, which can succeed and still not give you a
// session: a correct password from an unrecognised device is HELD (Q10), and
// the response says so rather than pretending to fail.
import { HttpError, type Handler, type RequestContext } from '../router.ts';
import { RATE_RULES, enforceRate, hashToken, requireSession, withIdempotency, type MiddlewarePorts } from '../middleware.ts';

export type AuthRoutePorts = MiddlewarePorts & {
  /** `consent` carries the two ANSWERS (UI-UX §22). Which text they answered
   *  about is the composition root's to say — the version travels with the
   *  copy, and this package may not read the copy. */
  signUp(input: { email: string; password: string; timeZone: string; device: DeviceFrom; consent: { isAdult: boolean; agreed: boolean } }): Promise<{ userId: string; sessionToken: string }>;
  signIn(input: { email: string; password: string; device: DeviceFrom }): Promise<{ status: 'signed_in'; userId: string; sessionToken: string } | { status: 'held_new_device'; userId: string } | { status: 'rejected' }>;
  resolveConfirmation(input: { token: string; decision: 'confirmed' | 'denied' }): Promise<{ status: string; sessionToken?: string }>;
  revokeAllSessions(userId: string): Promise<number>;
  now(): Date;
};

export type DeviceFrom = { fingerprint: string; userAgent: string | null; locationLabel: string | null };

/**
 * A device fingerprint from headers, not from a client-supplied id.
 *
 * It is weak on purpose and its weakness is bounded: a fingerprint that
 * collides means an extra confirmation email, and one that changes means the
 * same. It is never a credential — the session token is.
 */
export function fingerprintOf(context: RequestContext): DeviceFrom {
  const userAgent = context.headers['user-agent'] ?? null;
  const client = context.headers['x-lian-device'] ?? '';
  return {
    fingerprint: client !== '' ? client.slice(0, 128) : `ua:${Buffer.from(userAgent ?? 'unknown').toString('base64url').slice(0, 64)}`,
    userAgent,
    locationLabel: context.headers['x-lian-location'] ?? null,
  };
}

function sessionCookie(token: string, secure: boolean): string {
  // httpOnly so script cannot read it; SameSite=Lax so a cross-site form
  // cannot POST with it; 60 days to match the session's own life.
  const parts = [`lian_session=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${60 * 24 * 60 * 60}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

const EMAIL = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/;

export function authRoutes(ports: AuthRoutePorts, options: { secureCookies: boolean }): { method: 'POST'; pattern: string; handler: Handler }[] {
  return [
    {
      method: 'POST',
      pattern: '/api/auth/sign-up',
      handler: async (context) => {
        await enforceRate({ bucket: `auth:ip:${context.ip}`, rule: RATE_RULES.auth, now: ports.now() }, ports);
        const body = context.body<{ email?: string; password?: string; timeZone?: string; isAdult?: boolean; agreedToTerms?: boolean }>();
        const email = (body.email ?? '').trim().toLowerCase();
        if (!EMAIL.test(email)) throw new HttpError(400, 'bad_email', 'that does not look like an email address');
        // A floor, not a policy: length is the only password rule that
        // survives contact with people.
        if ((body.password ?? '').length < 10) throw new HttpError(400, 'weak_password', 'passwords need to be at least 10 characters');
        const timeZone = body.timeZone ?? 'UTC';

        // UI-UX §22. Refused HERE as well as in signUp(), so the reason
        // reaches the person as a specific status rather than a 500 — and so
        // the underage answer never becomes a created-then-deleted account.
        if (body.isAdult !== true) {
          throw new HttpError(403, 'under_age', 'this is not for under-18s');
        }
        if (body.agreedToTerms !== true) {
          throw new HttpError(400, 'consent_required', 'an account cannot be made without agreeing');
        }

        const result = await withIdempotency({ context, userId: null, route: 'sign-up' }, ports, async () => {
          const created = await ports.signUp({
            email, password: body.password!, timeZone, device: fingerprintOf(context),
            consent: { isAdult: true, agreed: true },
          });
          return { status: 201, json: { userId: created.userId, sessionToken: created.sessionToken } };
        });
        const token = (result.json as { sessionToken?: string }).sessionToken;
        return {
          status: result.status,
          json: result.json,
          ...(token === undefined ? {} : { headers: { 'set-cookie': sessionCookie(token, options.secureCookies) } }),
        };
      },
    },
    {
      method: 'POST',
      pattern: '/api/auth/sign-in',
      handler: async (context) => {
        const body = context.body<{ email?: string; password?: string }>();
        const email = (body.email ?? '').trim().toLowerCase();
        // Two buckets: per IP, and per account. The second is what stops a
        // password being guessed from a thousand addresses.
        await enforceRate({ bucket: `auth:ip:${context.ip}`, rule: RATE_RULES.auth, now: ports.now() }, ports);
        if (email !== '') {
          await enforceRate({ bucket: `auth:account:${hashToken(email)}`, rule: RATE_RULES.authPerAccount, now: ports.now() }, ports);
        }

        const outcome = await ports.signIn({ email, password: body.password ?? '', device: fingerprintOf(context) });

        if (outcome.status === 'rejected') {
          // Deliberately identical for a wrong password and an unknown email.
          throw new HttpError(401, 'rejected', 'that email and password do not match');
        }
        if (outcome.status === 'held_new_device') {
          // 200, not an error: nothing went wrong. The sign-in is waiting for
          // a confirmation the user has just been emailed.
          return { status: 200, json: { status: 'held_new_device', message: 'I have asked you to confirm this device by email.' } };
        }
        return {
          status: 200,
          json: { status: 'signed_in', userId: outcome.userId, sessionToken: outcome.sessionToken },
          headers: { 'set-cookie': sessionCookie(outcome.sessionToken, options.secureCookies) },
        };
      },
    },
    {
      method: 'POST',
      pattern: '/api/auth/confirm-device',
      handler: async (context) => {
        await enforceRate({ bucket: `auth:ip:${context.ip}`, rule: RATE_RULES.auth, now: ports.now() }, ports);
        const body = context.body<{ token?: string; decision?: string }>();
        const decision = body.decision === 'denied' ? 'denied' : 'confirmed';
        if ((body.token ?? '') === '') throw new HttpError(400, 'no_token', 'that link is missing its token');
        const result = await ports.resolveConfirmation({ token: body.token!, decision });
        if (result.status === 'expired') throw new HttpError(410, 'expired', 'that link has already been used or has expired');
        return {
          status: 200,
          json: { status: result.status },
          ...(result.sessionToken === undefined ? {} : { headers: { 'set-cookie': sessionCookie(result.sessionToken, options.secureCookies) } }),
        };
      },
    },
    {
      method: 'POST',
      pattern: '/api/auth/sign-out-everywhere',
      handler: async (context) => {
        const session = await requireSession(context, ports, ports.now());
        await enforceRate({ bucket: `write:${session.userId}`, rule: RATE_RULES.write, now: ports.now() }, ports);
        const result = await withIdempotency({ context, userId: session.userId, route: 'sign-out-everywhere' }, ports, async () => {
          const revoked = await ports.revokeAllSessions(session.userId);
          // DECISIONS §35: it says the current session ends too, because it does.
          return { status: 200, json: { revoked, message: 'I ended every session, including this one.' } };
        });
        return {
          status: result.status,
          json: result.json,
          headers: { 'set-cookie': 'lian_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' },
        };
      },
    },
  ];
}
