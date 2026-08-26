// Chat, over server-sent events.
//
// SSE rather than a websocket: a turn is one request and one stream of
// responses, which is exactly what SSE is for, and it survives proxies,
// reconnects and HTTP/2 without a second protocol to operate.
//
// What crosses this wire is already clean — the tag stream strips control
// tags server-side (LESSONS §3), so nothing here can leak one even if the
// model emits it mid-chunk.
import { HttpError, type Handler } from '../router.ts';
import { RATE_RULES, enforceRate, requireSession, withIdempotency, type MiddlewarePorts } from '../middleware.ts';

export type ChatTurn = {
  userId: string;
  conversationId: string;
  message: string | null;
  clientId: string;
  /** An attachment already uploaded and confirmed. The route never sees the
   *  bytes — only an id it hands on. */
  attachmentId: string | null;
  onText(delta: string): void;
  onCapture(summary: unknown): void;
  onCaptureFailed(reason: string): void;
  onMemoryQueueFull(): void;
};

export type ChatRoutePorts = MiddlewarePorts & {
  runChatTurn(input: ChatTurn): Promise<{ status: string; messageId?: string; line?: string }>;
  conversationBelongsTo(userId: string, conversationId: string): Promise<boolean>;
  now(): Date;
};

export const MAX_MESSAGE_LENGTH = 8_000;

export function chatRoutes(ports: ChatRoutePorts): { method: 'POST'; pattern: string; handler: Handler }[] {
  return [
    {
      method: 'POST',
      pattern: '/api/conversations/:id/messages',
      handler: async (context) => {
        const session = await requireSession(context, ports, ports.now());
        await enforceRate({ bucket: `chat:${session.userId}`, rule: RATE_RULES.chat, now: ports.now() }, ports);

        const conversationId = context.params['id']!;
        if (!(await ports.conversationBelongsTo(session.userId, conversationId))) {
          // 404 rather than 403: whether a conversation exists is not
          // something a stranger should be able to learn.
          throw new HttpError(404, 'no_conversation', 'I cannot find that conversation');
        }

        const body = context.body<{ message?: string; clientId?: string; attachmentId?: string }>();
        const message = (body.message ?? '').trim();
        const attachmentId = typeof body.attachmentId === 'string' && body.attachmentId !== '' ? body.attachmentId : null;
        // A photographed receipt with no words is a whole message: the
        // picture is the thing they sent. So empty is only empty when there
        // is nothing attached either.
        if (message === '' && attachmentId === null) throw new HttpError(400, 'empty_message', 'there was nothing in that message');
        if (message.length > MAX_MESSAGE_LENGTH) throw new HttpError(400, 'message_too_long', 'that is longer than I can take in one message');
        const clientId = body.clientId ?? context.headers['idempotency-key'] ?? '';
        if (clientId === '') throw new HttpError(400, 'idempotency_key_required', 'every write needs an idempotency-key header');

        return {
          stream: async (write, close) => {
            // Idempotency wraps the whole turn: a retried POST replays the
            // finished answer rather than paying for a second one.
            const outcome = await withIdempotency(
              { context, userId: session.userId, route: 'chat' },
              ports,
              async () => {
                const collected: string[] = [];
                const result = await ports.runChatTurn({
                  userId: session.userId,
                  conversationId,
                  message,
                  clientId,
                  attachmentId,
                  onText: (delta) => { collected.push(delta); write('text', { delta }); },
                  onCapture: (summary) => write('capture', summary),
                  onCaptureFailed: (reason) => write('capture_failed', { reason }),
                  onMemoryQueueFull: () => write('memory_queue_full', {}),
                });
                return { status: 200, json: { ...result, text: collected.join('') } };
              },
            );

            if (outcome.replayed) {
              // A replay has no stream to re-play, so it arrives whole. The
              // client renders it the same way either way.
              const replayed = outcome.json as { text?: string };
              if (typeof replayed.text === 'string' && replayed.text !== '') write('text', { delta: replayed.text });
            }

            const result = outcome.json as { status: string; line?: string };
            // An attachment that could not be read: her sentence, in the
            // conversation, rather than a toast. Nothing was charged and no
            // message was written, so the client re-enables the composer.
            if (result.status === 'attachment_failed' && typeof result.line === 'string') {
              write('attachment_failed', { line: result.line });
            }
            if (result.status === 'message_limit_reached' || result.status === 'cost_ceiling_reached') {
              // PRD §11: her line, not a modal. It travels as an event so the
              // client shows it in the conversation like anything she says.
              write('limit', { line: result.line });
            }
            write('done', { status: result.status, replayed: outcome.replayed });
            close();
          },
        };
      },
    },
  ];
}
