// Read routes.
//
// Everything the screens need to draw, and nothing they do not. Two rules
// hold this file to that:
//
//   1. A read returns what a screen SHOWS, already resolved — her mood
//      phrase, the stage name, the memory capacity line. The client renders
//      strings; it does not re-derive product rules from raw columns, and it
//      cannot, because the copy is authored server-side (PRD §45) and the
//      theme is decided in one place (LESSONS §7).
//   2. Nothing here leaks what LESSONS §6 keeps: the client is told WHICH
//      relationship stage, never how far through it, and never the day count.
import { HttpError, type Handler } from '../router.ts';
import { RATE_RULES, enforceRate, requireSession, withIdempotency, type MiddlewarePorts } from '../middleware.ts';

export type Snapshot = {
  user: { id: string; name: string | null; timeZone: string; languageStyle: string; language: 'en' | 'ar'; plan: 'free' | 'paid'; themePreference: string };
  assistant: { id: string; name: string; gender: 'female' | 'male'; mood: string; moodPhrase: string };
  /** Decided server-side and written as one attribute (LESSONS §7). */
  theme: string;
  direction: 'ltr' | 'rtl';
  localHour: number;
  conversation: { id: string } | null;
  onboarding: { step: string } | null;
  relationship: { stageName: string; prose: string };
  limits: { messagesRemaining: number; memoriesKept: number; memoriesPending: number; memoryCapacity: number; capacityLine: string };
};

export type MessageView = {
  id: string;
  role: 'user' | 'assistant';
  body: string;
  at: string;
  surface: string | null;
  captures: { capability: string; icon: string; line: string; correctionRoute: string }[];
  reaction: string | null;
  replyTo: { id: string; role: string; body: string } | null;
  /** UI-UX §39: "this message helped me remember 2 things". */
  memoriesDerived: number;
};

export type MemoryView = {
  id: string; type: string; typeLabel: string; statement: string; status: 'active' | 'pending';
  createdAt: string; sourceMessageId: string | null; sourceRemovedKept: boolean;
};

export type TaskView = { id: string; kind: 'task' | 'habit'; title: string; dueOn: string | null; done: boolean };
export type NoteView = { id: string; title: string | null; body: string; createdAt: string };
export type MoneyView = {
  month: string; inMinor: number; outMinor: number; leftMinor: number; currency: string;
  categories: { category: string; totalMinor: number }[];
  recent: { id: string; line: string; amountMinor: number; direction: 'in' | 'out'; occurredOn: string; fromReceipt: boolean }[];
};
export type StoryView = { now: string; footer: string; stages: { key: string; name: string; prose: string; current: boolean }[] };
export type SecurityView = {
  devices: { id: string; label: string; lastSeen: string | null; current: boolean }[];
  attempts: { outcome: string; at: string; location: string | null }[];
};

export type ReadPorts = MiddlewarePorts & {
  snapshot(userId: string): Promise<Snapshot | null>;
  messages(input: {
    userId: string; conversationId: string;
    before: { at: string; id: string } | null;
    /** Only what is newer than this — the open app catching up. */
    since: { at: string; id: string } | null;
  }): Promise<{ messages: MessageView[]; hasOlder: boolean } | null>;
  react(input: { userId: string; messageId: string; kind: string | null }): Promise<string | null>;
  deleteMessage(input: { userId: string; messageId: string; keepDerived: boolean }): Promise<{ deleted: boolean; memoriesRemoved: number }>;
  memories(input: { userId: string; query: string | null }): Promise<MemoryView[]>;
  tasks(userId: string): Promise<{ tasks: TaskView[]; notes: NoteView[] }>;
  money(input: { userId: string; month: string | null }): Promise<MoneyView>;
  story(userId: string): Promise<StoryView>;
  security(input: { userId: string; deviceId: string | null }): Promise<SecurityView>;
  revokeDevice(input: { userId: string; deviceId: string }): Promise<boolean>;
  updateSettings(input: { userId: string; patch: Record<string, unknown> }): Promise<{ ok: boolean; reason?: string }>;
  /**
   * A voice note, transcribed. The transcript IS the message — there is no
   * object storage yet, so the audio is not kept, and a message whose body
   * is a transcript is one the whole product can already read, search and
   * remember.
   */
  transcribe(input: { userId: string; audio: string; contentType: string; durationSeconds: number }): Promise<
    { status: 'transcribed'; text: string } | { status: 'ceiling_reached' } | { status: 'unconfigured' } | { status: 'failed'; reason: string }
  >;
  now(): Date;
};

/** UI-UX §36's default set, in the order the picker shows them. */
export const REACTIONS = ['heart', 'smile', 'laugh', 'support', 'surprise'] as const;

export function readRoutes(ports: ReadPorts): { method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; pattern: string; handler: Handler }[] {
  return [
    {
      method: 'GET',
      pattern: '/api/me',
      handler: async (context) => {
        const session = await requireSession(context, ports, ports.now());
        await enforceRate({ bucket: `read:${session.userId}`, rule: RATE_RULES.read, now: ports.now() }, ports);
        const snapshot = await ports.snapshot(session.userId);
        if (snapshot === null) throw new HttpError(404, 'no_account', 'I cannot find that account');
        return { status: 200, json: snapshot };
      },
    },
    {
      method: 'GET',
      pattern: '/api/conversations/:id/messages',
      handler: async (context) => {
        const session = await requireSession(context, ports, ports.now());
        await enforceRate({ bucket: `read:${session.userId}`, rule: RATE_RULES.read, now: ports.now() }, ports);
        // Keyset, not offset: the window is stable while she is writing into
        // it (UI-UX §38 — "preserve exact scroll position").
        const at = context.query.get('before_at');
        const id = context.query.get('before_id');
        const sinceAt = context.query.get('since_at');
        const sinceId = context.query.get('since_id');
        const page = await ports.messages({
          userId: session.userId,
          conversationId: context.params['id']!,
          before: at !== null && id !== null ? { at, id } : null,
          since: sinceAt !== null && sinceId !== null ? { at: sinceAt, id: sinceId } : null,
        });
        if (page === null) throw new HttpError(404, 'no_conversation', 'I cannot find that conversation');
        return { status: 200, json: page };
      },
    },
    {
      method: 'GET',
      pattern: '/api/memories',
      handler: async (context) => {
        const session = await requireSession(context, ports, ports.now());
        await enforceRate({ bucket: `read:${session.userId}`, rule: RATE_RULES.read, now: ports.now() }, ports);
        const query = context.query.get('q');
        return { status: 200, json: { memories: await ports.memories({ userId: session.userId, query: query === '' ? null : query }) } };
      },
    },
    {
      method: 'GET',
      pattern: '/api/tasks',
      handler: async (context) => {
        const session = await requireSession(context, ports, ports.now());
        await enforceRate({ bucket: `read:${session.userId}`, rule: RATE_RULES.read, now: ports.now() }, ports);
        return { status: 200, json: await ports.tasks(session.userId) };
      },
    },
    {
      method: 'GET',
      pattern: '/api/money',
      handler: async (context) => {
        const session = await requireSession(context, ports, ports.now());
        await enforceRate({ bucket: `read:${session.userId}`, rule: RATE_RULES.read, now: ports.now() }, ports);
        return { status: 200, json: await ports.money({ userId: session.userId, month: context.query.get('month') }) };
      },
    },
    {
      method: 'GET',
      pattern: '/api/story',
      handler: async (context) => {
        const session = await requireSession(context, ports, ports.now());
        await enforceRate({ bucket: `read:${session.userId}`, rule: RATE_RULES.read, now: ports.now() }, ports);
        return { status: 200, json: await ports.story(session.userId) };
      },
    },
    {
      method: 'GET',
      pattern: '/api/security',
      handler: async (context) => {
        const session = await requireSession(context, ports, ports.now());
        await enforceRate({ bucket: `read:${session.userId}`, rule: RATE_RULES.read, now: ports.now() }, ports);
        return { status: 200, json: await ports.security({ userId: session.userId, deviceId: session.deviceId }) };
      },
    },
    {
      method: 'POST',
      pattern: '/api/security/devices/:id/revoke',
      handler: async (context) => {
        const session = await requireSession(context, ports, ports.now());
        await enforceRate({ bucket: `write:${session.userId}`, rule: RATE_RULES.write, now: ports.now() }, ports);
        const result = await withIdempotency({ context, userId: session.userId, route: 'revoke-device' }, ports, async () => {
          return { status: 200, json: { revoked: await ports.revokeDevice({ userId: session.userId, deviceId: context.params['id']! }) } };
        });
        return { status: result.status, json: result.json };
      },
    },
    {
      method: 'POST',
      pattern: '/api/voice',
      handler: async (context) => {
        const session = await requireSession(context, ports, ports.now());
        // Its own bucket: transcription costs money per second and a stuck
        // client retrying is the shape that runs a bill up.
        await enforceRate({ bucket: `chat:${session.userId}`, rule: RATE_RULES.chat, now: ports.now() }, ports);
        const body = context.body<{ audio?: string; contentType?: string; durationSeconds?: number }>();
        if (typeof body.audio !== 'string' || body.audio === '') throw new HttpError(400, 'no_audio', 'there was nothing to listen to');
        const result = await withIdempotency({ context, userId: session.userId, route: 'voice' }, ports, async () => {
          const outcome = await ports.transcribe({
            userId: session.userId,
            audio: body.audio!,
            contentType: body.contentType ?? 'audio/webm',
            durationSeconds: Number(body.durationSeconds ?? 0),
          });
          if (outcome.status === 'unconfigured') throw new HttpError(503, 'voice_unconfigured', 'this deployment has no speech key configured');
          if (outcome.status === 'ceiling_reached') throw new HttpError(429, 'voice_ceiling', 'that is all the voice I can do this month');
          if (outcome.status === 'failed') throw new HttpError(422, 'voice_failed', outcome.reason);
          return { status: 200, json: { text: outcome.text } };
        });
        return { status: result.status, json: result.json };
      },
    },
    {
      method: 'PATCH',
      pattern: '/api/settings',
      handler: async (context) => {
        const session = await requireSession(context, ports, ports.now());
        await enforceRate({ bucket: `write:${session.userId}`, rule: RATE_RULES.write, now: ports.now() }, ports);
        const body = context.body<Record<string, unknown>>();
        if (Object.keys(body).length === 0) throw new HttpError(400, 'empty_patch', 'there was nothing to change');
        const result = await withIdempotency({ context, userId: session.userId, route: 'settings' }, ports, async () => {
          const outcome = await ports.updateSettings({ userId: session.userId, patch: body });
          if (!outcome.ok) throw new HttpError(422, 'cannot_change', outcome.reason ?? 'I could not change that');
          return { status: 200, json: { ok: true } };
        });
        return { status: result.status, json: result.json };
      },
    },
    {
      method: 'POST',
      pattern: '/api/messages/:id/reactions',
      handler: async (context) => {
        const session = await requireSession(context, ports, ports.now());
        await enforceRate({ bucket: `write:${session.userId}`, rule: RATE_RULES.write, now: ports.now() }, ports);
        const body = context.body<{ kind?: string | null }>();
        const kind = body.kind ?? null;
        if (kind !== null && !(REACTIONS as readonly string[]).includes(kind)) {
          throw new HttpError(422, 'unknown_reaction', 'that is not one of the reactions');
        }
        const result = await withIdempotency({ context, userId: session.userId, route: 'react' }, ports, async () => {
          return { status: 200, json: { reaction: await ports.react({ userId: session.userId, messageId: context.params['id']!, kind }) } };
        });
        return { status: result.status, json: result.json };
      },
    },
    {
      method: 'DELETE',
      pattern: '/api/messages/:id',
      handler: async (context) => {
        const session = await requireSession(context, ports, ports.now());
        await enforceRate({ bucket: `write:${session.userId}`, rule: RATE_RULES.write, now: ports.now() }, ports);
        // UI-UX §39 / Q11: deleting a message removes what was derived from
        // it BY DEFAULT. Keeping it is the person explicitly choosing, and it
        // arrives as a query parameter because a DELETE has no body worth
        // relying on.
        const keepDerived = context.query.get('keep_derived') === 'true';
        const result = await withIdempotency({ context, userId: session.userId, route: 'delete-message' }, ports, async () => {
          const outcome = await ports.deleteMessage({ userId: session.userId, messageId: context.params['id']!, keepDerived });
          if (!outcome.deleted) throw new HttpError(404, 'no_message', 'I cannot find that message');
          return { status: 200, json: outcome };
        });
        return { status: result.status, json: result.json };
      },
    },
  ];
}
