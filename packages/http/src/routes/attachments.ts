// Attachments: the three-step upload.
//
//   1. POST /api/attachments        — the server signs an upload URL
//   2. PUT  <the signed URL>        — the BROWSER sends the bytes, to storage
//   3. POST /api/attachments/:id/complete — the server confirms and charges
//
// Step 2 is the reason this is three steps rather than one: a photograph does
// not pass through the app server, so uploading one costs no memory, no
// bandwidth and no request timeout here. The cost is that the server must
// verify afterwards rather than trust — which it does by asking storage how
// large the object actually is, rather than believing the client.
import { HttpError, type Handler } from '../router.ts';
import { RATE_RULES, enforceRate, requireSession, withIdempotency, type MiddlewarePorts } from '../middleware.ts';

export type AttachmentPorts = MiddlewarePorts & {
  beginUpload(input: { userId: string; kind: string; contentType: string; conversationId: string | null }): Promise<
    | { status: 'ready'; id: string; url: string; method: string; headers: Record<string, string>; expiresIn: number }
    | { status: 'unsupported_type' }
    | { status: 'ceiling_reached'; heldBytes: number; ceiling: number }
    | { status: 'no_storage' }
  >;
  completeUpload(input: { userId: string; attachmentId: string }): Promise<
    | { status: 'ready'; id: string; bytes: number; kind: string }
    | { status: 'missing' }
    | { status: 'too_large'; bytes: number; limit: number }
    | { status: 'ceiling_reached' }
  >;
  attachmentUrl(input: { userId: string; attachmentId: string }): Promise<{ url: string; contentType: string } | null>;
  removeAttachment(input: { userId: string; attachmentId: string }): Promise<boolean>;
  now(): Date;
};

export function attachmentRoutes(ports: AttachmentPorts): { method: 'GET' | 'POST' | 'DELETE'; pattern: string; handler: Handler }[] {
  return [
    {
      method: 'POST',
      pattern: '/api/attachments',
      handler: async (context) => {
        const session = await requireSession(context, ports, ports.now());
        await enforceRate({ bucket: `write:${session.userId}`, rule: RATE_RULES.write, now: ports.now() }, ports);
        const body = context.body<{ kind?: string; contentType?: string; conversationId?: string }>();

        const result = await withIdempotency({ context, userId: session.userId, route: 'attachment' }, ports, async () => {
          const begun = await ports.beginUpload({
            userId: session.userId,
            kind: body.kind ?? '',
            contentType: body.contentType ?? '',
            conversationId: body.conversationId ?? null,
          });
          if (begun.status === 'unsupported_type') {
            throw new HttpError(415, 'unsupported_type', 'I cannot read that kind of file');
          }
          if (begun.status === 'no_storage') {
            // Honest rather than empty: a deployment with no bucket cannot
            // hold a photograph, and the client should say so rather than
            // fail at the upload.
            throw new HttpError(503, 'no_storage', 'this deployment has nowhere to store that yet');
          }
          if (begun.status === 'ceiling_reached') {
            throw new HttpError(413, 'storage_full', 'I am holding as much as I can for you — deleting something makes room');
          }
          return {
            status: 201,
            json: { id: begun.id, url: begun.url, method: begun.method, headers: begun.headers, expiresIn: begun.expiresIn },
          };
        });
        return { status: result.status, json: result.json };
      },
    },

    {
      method: 'POST',
      pattern: '/api/attachments/:id/complete',
      handler: async (context) => {
        const session = await requireSession(context, ports, ports.now());
        await enforceRate({ bucket: `write:${session.userId}`, rule: RATE_RULES.write, now: ports.now() }, ports);
        const result = await withIdempotency({ context, userId: session.userId, route: 'attachment:complete' }, ports, async () => {
          const done = await ports.completeUpload({ userId: session.userId, attachmentId: context.params['id']! });
          if (done.status === 'missing') throw new HttpError(404, 'no_attachment', 'I cannot find that upload');
          if (done.status === 'too_large') {
            throw new HttpError(413, 'too_large', 'that file is larger than I can keep');
          }
          if (done.status === 'ceiling_reached') {
            throw new HttpError(413, 'storage_full', 'I am holding as much as I can for you — deleting something makes room');
          }
          return { status: 200, json: { id: done.id, bytes: done.bytes, kind: done.kind } };
        });
        return { status: result.status, json: result.json };
      },
    },

    {
      method: 'GET',
      pattern: '/api/attachments/:id',
      handler: async (context) => {
        const session = await requireSession(context, ports, ports.now());
        await enforceRate({ bucket: `read:${session.userId}`, rule: RATE_RULES.read, now: ports.now() }, ports);
        const found = await ports.attachmentUrl({ userId: session.userId, attachmentId: context.params['id']! });
        if (found === null) throw new HttpError(404, 'no_attachment', 'I cannot find that');
        // A redirect to a short-lived signed URL rather than a proxy: the
        // bytes go browser-to-storage in both directions, and the URL expires
        // long before it could be shared usefully.
        return {
          status: 302, text: '',
          headers: { location: found.url, 'cache-control': 'private, no-store' },
        };
      },
    },

    {
      method: 'DELETE',
      pattern: '/api/attachments/:id',
      handler: async (context) => {
        const session = await requireSession(context, ports, ports.now());
        await enforceRate({ bucket: `write:${session.userId}`, rule: RATE_RULES.write, now: ports.now() }, ports);
        const result = await withIdempotency({ context, userId: session.userId, route: 'attachment:delete' }, ports, async () => {
          const deleted = await ports.removeAttachment({ userId: session.userId, attachmentId: context.params['id']! });
          // 404 for "not yours" AND for "no such id", the same as GET — a
          // 200 saying deleted:false is a different answer for the two, and
          // two different answers is an existence oracle.
          if (!deleted) throw new HttpError(404, 'no_attachment', 'I cannot find that');
          return { status: 200, json: { deleted: true } };
        });
        return { status: result.status, json: result.json };
      },
    },
  ];
}
