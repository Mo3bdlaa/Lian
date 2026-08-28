// Correction routes.
//
// UI-UX §4: every capture is tappable and correctable. These are the routes
// behind that tap — and there is deliberately no CREATE route among them
// (PRD §14: no add buttons anywhere). You can fix what she captured and
// delete it; you cannot type a new one into a form.
import { HttpError, type Handler } from '../router.ts';
import { RATE_RULES, enforceRate, requireSession, withIdempotency, type MiddlewarePorts } from '../middleware.ts';

export type CorrectionPorts = MiddlewarePorts & {
  correct(input: { userId: string; kind: CorrectionKind; id: string; patch: Record<string, unknown> }): Promise<{ ok: boolean; reason?: string }>;
  remove(input: { userId: string; kind: CorrectionKind; id: string }): Promise<boolean>;
  now(): Date;
};

/** What can be corrected. Adding one is a line here and a case in the
 *  adapter — the same shape as adding a capability. */
export const CORRECTION_KINDS = ['tasks', 'transactions', 'notes', 'health', 'memories'] as const;
export type CorrectionKind = (typeof CORRECTION_KINDS)[number];

function kindFrom(value: string): CorrectionKind {
  if (!(CORRECTION_KINDS as readonly string[]).includes(value)) {
    throw new HttpError(404, 'unknown_kind', 'I cannot find that');
  }
  return value as CorrectionKind;
}

export function correctionRoutes(ports: CorrectionPorts): { method: 'PATCH' | 'DELETE'; pattern: string; handler: Handler }[] {
  return [
    {
      method: 'PATCH',
      pattern: '/api/:kind/:id',
      handler: async (context) => {
        const session = await requireSession(context, ports, ports.now());
        await enforceRate({ bucket: `write:${session.userId}`, rule: RATE_RULES.write, now: ports.now() }, ports);
        const kind = kindFrom(context.params['kind']!);
        const patch = context.body<Record<string, unknown>>();
        if (Object.keys(patch).length === 0) throw new HttpError(400, 'empty_patch', 'there was nothing to change');

        const result = await withIdempotency({ context, userId: session.userId, route: `patch:${kind}` }, ports, async () => {
          const outcome = await ports.correct({ userId: session.userId, kind, id: context.params['id']!, patch });
          if (!outcome.ok) throw new HttpError(422, 'cannot_correct', outcome.reason ?? 'I could not change that');
          return { status: 200, json: { ok: true } };
        });
        return { status: result.status, json: result.json };
      },
    },
    {
      method: 'DELETE',
      pattern: '/api/:kind/:id',
      handler: async (context) => {
        const session = await requireSession(context, ports, ports.now());
        await enforceRate({ bucket: `write:${session.userId}`, rule: RATE_RULES.write, now: ports.now() }, ports);
        const kind = kindFrom(context.params['kind']!);

        const result = await withIdempotency({ context, userId: session.userId, route: `delete:${kind}` }, ports, async () => {
          const removed = await ports.remove({ userId: session.userId, kind, id: context.params['id']! });
          // 404 when nothing was removed, and the SAME 404 for "not yours"
          // and "no such id" — §17's rule that two answers are an existence
          // oracle, and §18's that a confirmation nobody earned is worse than
          // an error. A stranger deleting somebody else's task used to be
          // told `200 {deleted: false}`: nothing was removed, because the
          // repository is scoped, and they were congratulated anyway.
          //
          // The retry this used to protect is already protected, one layer
          // up: `withIdempotency` replays the stored response for a repeated
          // key, and the client sends a key on every non-GET (apps/web/src/
          // api.ts). So a flaky connection retrying gets the original 200 —
          // and a first-time delete of something that is not theirs gets the
          // truth.
          if (!removed) throw new HttpError(404, 'not_found', 'I cannot find that');
          return { status: 200, json: { deleted: true } };
        });
        return { status: result.status, json: result.json };
      },
    },
  ];
}
