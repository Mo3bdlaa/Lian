// The jobs composition root.
//
// Everything above this file is testable with fakes; this is where the ports
// meet @lian/db and @lian/runtime.  It is also the only place that knows a
// proactive message and a chat message are the same function call with a
// different surface — which is the point (LESSONS §1).
import * as db from '@lian/db';
import { runTurn, promptPorts, capabilityPorts, turnPorts, type TurnSink } from '@lian/runtime';
import { contributions, outreachCandidates } from '@lian/capabilities';
import { DEFAULT_MODEL, type Provider } from '@lian/llm';
import type { Embedder, AnalysisModel } from '@lian/analysis';
import type { AssistantScope } from '@lian/db';
import type { SendConfig } from '@lian/push';
import { deliver, notificationFor, type DeliverPorts } from './deliver.ts';
import type { TickPorts, DueOutreach } from './tick.ts';
import type { CandidatePorts } from './candidates.ts';
import type { ReflectPorts, ReflectionKind } from './reflect.ts';

export type JobDeps = {
  provider: Provider;
  analysisModel: AnalysisModel;
  embedder: Embedder | null;
  /** VAPID keys and contact.  Null only in a deployment that has not
   *  generated them yet — and a proactive turn then reports nowhereToSend
   *  rather than pretending it delivered. */
  push: SendConfig | null;
  now: () => Date;
};

const language = (style: string): 'en' | 'ar' => (style.startsWith('ar') ? 'ar' : 'en');

/** A sink that keeps the text instead of streaming it — she is not being
 *  watched while this runs. */
function collectingSink(): TurnSink & { text_: () => string } {
  let collected = '';
  return {
    text: (delta) => { collected += delta; },
    capture: () => {},
    captureFailed: () => {},
    text_: () => collected,
  };
}

export function deliverPorts(userId: string): DeliverPorts {
  return {
    async subscriptions(forUserId) {
      return (await db.push.active({ userId: forUserId })).map((row) => ({
        id: row.id, endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth,
      }));
    },
    async revoke(forUserId, subscriptionId) { await db.push.revoke({ userId: forUserId }, subscriptionId); },
    async touch(forUserId, subscriptionId) { await db.push.touch({ userId: forUserId }, subscriptionId); },
  };
}

export function tickPorts(deps: JobDeps): TickPorts {
  return {
    async dueOutreach(now, limit) {
      return db.outreach.dueAcrossAssistants(now, limit);
    },
    async quietHours(userId) {
      return db.outreach.quietHoursFor(userId);
    },
    async unansweredStreak(assistantId) {
      const owner = await db.outreach.ownerOf(assistantId);
      if (owner === null) return 0;
      return db.outreach.unansweredStreak({ userId: owner.userId, assistantId });
    },
    async daysSinceLastReachOut(assistantId, now) {
      const owner = await db.outreach.ownerOf(assistantId);
      if (owner === null) return Number.MAX_SAFE_INTEGER;
      return db.outreach.daysSinceLastReachOut({ userId: owner.userId, assistantId }, now);
    },

    async deliver(outreach: DueOutreach) {
      const scope: AssistantScope = { userId: outreach.userId, assistantId: outreach.assistantId };
      const user = await db.accounts.getUser({ userId: outreach.userId });
      const assistant = await db.accounts.getAssistant(scope);
      if (user === null || assistant === null) return 'skipped';

      const sink = collectingSink();
      // The same function chat uses.  Surface is the only difference.
      const result = await runTurn(
        {
          userId: outreach.userId, assistantId: outreach.assistantId, conversationId: outreach.conversationId,
          surface: outreach.kind === 'briefing' ? 'briefing' : outreach.kind === 'security' ? 'security' : outreach.kind === 'reminder' ? 'scheduled' : 'proactive',
          plan: user.plan, timeZone: user.timeZone, language: language(user.languageStyle),
          model: DEFAULT_MODEL, now: deps.now(), userMessage: null, clientId: null, replacingMessageId: null,
        },
        {
          prompt: promptPorts(outreach.userId, deps.embedder),
          capabilities: capabilityPorts(outreach.userId),
          turn: turnPorts(outreach.userId),
          provider: deps.provider,
          absorb: async () => ({ kept: 0, queued: 0, refused: 0 }),
        },
        sink,
      );

      if (result.status !== 'done') return 'skipped';
      await db.outreach.markSent(scope, outreach.id, result.messageId);

      // The message exists either way — it is in the conversation, and she
      // will not repeat it.  Delivery is separate, and its failure is
      // reported rather than swallowed: "she texts you first" is the product,
      // so a message nobody could receive is worth seeing in a log.
      if (deps.push === null) return 'sent';
      const report = await deliver(
        {
          userId: outreach.userId,
          message: notificationFor({
            assistantName: assistant.name,
            text: result.text,
            url: `/chat/${outreach.conversationId}`,
            tag: outreach.kind,
          }),
        },
        deps.push,
        deliverPorts(outreach.userId),
      );
      if (report.nowhereToSend) {
        await db.events.record({
          name: 'proactive_sent', userId: outreach.userId, assistantId: outreach.assistantId,
          dayKey: new Intl.DateTimeFormat('en-CA', { timeZone: outreach.timeZone }).format(deps.now()),
          properties: { delivered: false, expired: report.expired, retry: report.retry },
        });
      }
      return 'sent';
    },

    async reschedule(outreachId, to) {
      await db.outreach.reschedule(outreachId, to);
    },
    async cancel(outreachId, reason) {
      await db.outreach.cancel(outreachId, reason);
    },
  };
}

export function candidatePorts(): CandidatePorts {
  return {
    async fromCapabilities(input) {
      return outreachCandidates(
        { ...input, surface: 'proactive' },
        capabilityPorts(input.userId),
      );
    },
    async unsurfacedReflection(assistantId) {
      const owner = await db.outreach.ownerOf(assistantId);
      if (owner === null) return null;
      const reflection = await db.reflections.unsurfaced({ userId: owner.userId, assistantId });
      return reflection === null ? null : { id: reflection.id, body: reflection.body };
    },
    async unansweredStreak(assistantId) {
      const owner = await db.outreach.ownerOf(assistantId);
      if (owner === null) return 0;
      return db.outreach.unansweredStreak({ userId: owner.userId, assistantId });
    },
    async daysSinceLastReachOut(assistantId, now) {
      const owner = await db.outreach.ownerOf(assistantId);
      if (owner === null) return Number.MAX_SAFE_INTEGER;
      return db.outreach.daysSinceLastReachOut({ userId: owner.userId, assistantId }, now);
    },
    async schedule({ assistantId, userId, candidate }) {
      const row = await db.outreach.schedule(
        { userId, assistantId },
        { kind: candidate.kind, source: candidate.source, scheduledFor: candidate.scheduledFor, dedupeKey: candidate.dedupeKey },
      );
      return row !== null;
    },
  };
}

export function reflectPorts(deps: JobDeps): ReflectPorts {
  return {
    async dueForReflection(_kind, localDay, limit) {
      return db.outreach.assistantsActiveOn(localDay, limit);
    },
    async alreadyReflected(assistantId, kind: ReflectionKind, localDay) {
      const owner = await db.outreach.ownerOf(assistantId);
      if (owner === null) return true;
      return db.reflections.existsFor({ userId: owner.userId, assistantId }, kind, localDay);
    },
    async reflect(input) {
      const user = await db.accounts.getUser({ userId: input.userId });
      if (user === null) return null;
      const sink = collectingSink();
      // Her voice, so the voice path — `dream` and `diary` are surfaces on it.
      const result = await runTurn(
        {
          userId: input.userId, assistantId: input.assistantId, conversationId: input.conversationId,
          surface: input.kind, plan: user.plan, timeZone: user.timeZone,
          language: language(user.languageStyle), model: DEFAULT_MODEL, now: deps.now(),
          userMessage: null, clientId: null, replacingMessageId: null,
        },
        {
          prompt: promptPorts(input.userId, deps.embedder),
          capabilities: capabilityPorts(input.userId),
          turn: turnPorts(input.userId),
          provider: deps.provider,
          absorb: async () => ({ kept: 0, queued: 0, refused: 0 }),
        },
        sink,
      );
      return result.status === 'done' ? result.text : null;
    },
    async store(assistantId, input) {
      const owner = await db.outreach.ownerOf(assistantId);
      if (owner === null) return false;
      const stored = await db.reflections.record({ userId: owner.userId, assistantId }, input);
      return stored !== null;
    },
  };
}
