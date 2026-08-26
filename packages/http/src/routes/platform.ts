// Push subscription, the tick, export, deletion, and the PWA files.
import { HttpError, type Handler } from '../router.ts';
import { RATE_RULES, enforceRate, requireSession, withIdempotency, type MiddlewarePorts } from '../middleware.ts';

export type PlatformPorts = MiddlewarePorts & {
  saveSubscription(input: { userId: string; endpoint: string; p256dh: string; auth: string; deviceId: string | null }): Promise<{ id: string }>;
  removeSubscription(input: { userId: string; endpoint: string }): Promise<boolean>;
  /** The permission was asked and NOT granted — declined, dismissed, or a
   *  browser that refused to ask.  Recorded so she does not ask twice. */
  markNotificationAsked(input: { userId: string; outcome: 'denied' | 'dismissed' | 'unsupported' }): Promise<void>;
  vapidPublicKey(): string | null;
  verifyTick(input: { timestamp: number; body: string; signature: string; now: Date }): { ok: boolean; reason?: string };
  runTick(now: Date): Promise<unknown>;
  exportEverything(userId: string): Promise<{ archive: unknown; filename: string }>;
  deleteEverything(userId: string): Promise<unknown>;
  now(): Date;
};

/** UI-UX §17: deletion asks for a typed word. The word is checked server-side
 *  as well as in the UI, because a confirmation that only exists in a screen
 *  is not a confirmation. */
export const DELETE_CONFIRMATION = 'DELETE';

export function platformRoutes(ports: PlatformPorts): { method: 'GET' | 'POST'; pattern: string; handler: Handler }[] {
  return [
    // ── push ──────────────────────────────────────────────────────────────
    {
      method: 'GET',
      pattern: '/api/push/key',
      handler: async () => {
        const key = ports.vapidPublicKey();
        if (key === null) {
          // Honest rather than empty: a deployment without VAPID keys cannot
          // do the thing the product is named for, and the client should be
          // able to say so.
          throw new HttpError(503, 'push_unconfigured', 'this deployment has no push keys configured');
        }
        return { status: 200, json: { publicKey: key } };
      },
    },
    {
      method: 'POST',
      pattern: '/api/push/subscribe',
      handler: async (context) => {
        const session = await requireSession(context, ports, ports.now());
        await enforceRate({ bucket: `write:${session.userId}`, rule: RATE_RULES.write, now: ports.now() }, ports);
        const body = context.body<{ endpoint?: string; keys?: { p256dh?: string; auth?: string } }>();
        const endpoint = body.endpoint ?? '';
        const p256dh = body.keys?.p256dh ?? '';
        const auth = body.keys?.auth ?? '';
        if (!endpoint.startsWith('https://')) throw new HttpError(400, 'bad_endpoint', 'that is not a push endpoint');
        if (p256dh === '' || auth === '') throw new HttpError(400, 'bad_keys', 'that subscription is missing its keys');

        const result = await withIdempotency({ context, userId: session.userId, route: 'push:subscribe' }, ports, async () => {
          const saved = await ports.saveSubscription({ userId: session.userId, endpoint, p256dh, auth, deviceId: session.deviceId });
          return { status: 201, json: { id: saved.id } };
        });
        return { status: result.status, json: result.json };
      },
    },
    {
      method: 'POST',
      pattern: '/api/push/unsubscribe',
      handler: async (context) => {
        const session = await requireSession(context, ports, ports.now());
        await enforceRate({ bucket: `write:${session.userId}`, rule: RATE_RULES.write, now: ports.now() }, ports);
        const body = context.body<{ endpoint?: string }>();
        const result = await withIdempotency({ context, userId: session.userId, route: 'push:unsubscribe' }, ports, async () => {
          const removed = await ports.removeSubscription({ userId: session.userId, endpoint: body.endpoint ?? '' });
          return { status: 200, json: { removed } };
        });
        return { status: result.status, json: result.json };
      },
    },

    {
      method: 'POST',
      pattern: '/api/push/prompted',
      handler: async (context) => {
        // PRD §8 asks for the permission after the first remembered moment,
        // and onboarding does not move on until it has been asked. Without
        // this route a person who says no is asked again every turn, forever
        // — the browser remembers the refusal, so she would be asking a
        // dialogue that never appears.
        const session = await requireSession(context, ports, ports.now());
        await enforceRate({ bucket: `write:${session.userId}`, rule: RATE_RULES.write, now: ports.now() }, ports);
        const body = context.body<{ outcome?: string }>();
        const outcome = body.outcome === 'denied' ? 'denied' : body.outcome === 'unsupported' ? 'unsupported' : 'dismissed';
        const result = await withIdempotency({ context, userId: session.userId, route: 'push:prompted' }, ports, async () => {
          await ports.markNotificationAsked({ userId: session.userId, outcome });
          return { status: 200, json: { asked: true, outcome } };
        });
        return { status: result.status, json: result.json };
      },
    },

    // ── the tick ──────────────────────────────────────────────────────────
    {
      method: 'POST',
      pattern: '/api/tick',
      handler: async (context) => {
        // No session: the caller is a scheduler, and it proves itself with an
        // HMAC over the body and a timestamp (Q16). Rate limited by IP anyway,
        // because an unauthenticated endpoint that does work is an
        // unauthenticated endpoint that does work.
        await enforceRate({ bucket: `tick:${context.ip}`, rule: RATE_RULES.write, now: ports.now() }, ports);
        const timestamp = Number(context.headers['x-lian-timestamp'] ?? '');
        const signature = context.headers['x-lian-signature'] ?? '';
        if (!Number.isFinite(timestamp) || signature === '') throw new HttpError(401, 'unsigned', 'that request was not signed');
        const verdict = ports.verifyTick({ timestamp, body: context.rawBody, signature, now: ports.now() });
        if (!verdict.ok) throw new HttpError(401, 'bad_signature', verdict.reason ?? 'that signature did not verify');
        return { status: 200, json: await ports.runTick(ports.now()) };
      },
    },

    // ── ownership (LESSONS §11) ───────────────────────────────────────────
    {
      method: 'POST',
      pattern: '/api/data/export',
      handler: async (context) => {
        const session = await requireSession(context, ports, ports.now());
        await enforceRate({ bucket: `heavy:${session.userId}`, rule: RATE_RULES.heavy, now: ports.now() }, ports);
        const result = await withIdempotency({ context, userId: session.userId, route: 'export' }, ports, async () => {
          const { archive, filename } = await ports.exportEverything(session.userId);
          return { status: 200, json: { filename, archive } };
        });
        return { status: result.status, json: result.json };
      },
    },
    {
      method: 'POST',
      pattern: '/api/data/delete',
      handler: async (context) => {
        const session = await requireSession(context, ports, ports.now());
        await enforceRate({ bucket: `heavy:${session.userId}`, rule: RATE_RULES.heavy, now: ports.now() }, ports);
        const body = context.body<{ confirm?: string }>();
        if (body.confirm !== DELETE_CONFIRMATION) {
          throw new HttpError(400, 'confirmation_required', `type ${DELETE_CONFIRMATION} to confirm`);
        }
        const result = await withIdempotency({ context, userId: session.userId, route: 'delete-everything' }, ports, async () => {
          const report = await ports.deleteEverything(session.userId);
          // UI-UX §17: one warm line, then a neutral completion state.
          return { status: 200, json: { ...(report as object), message: 'Thank you for the time we had.' } };
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
