// The composition root.
//
// This is the ONE place the ports declared by prompt, capabilities and auth
// are wired to the repositories in @lian/db.  Everything above it is
// testable with fakes; everything below it is SQL.
import * as db from '@lian/db';
import type { PromptPorts } from '@lian/prompt';
import type { CapabilityPorts } from '@lian/capabilities';
import { contributions } from '@lian/capabilities';
import { limitsFor, messageBudget, nextStage, stageKey, type Plan } from '@lian/domain';
import { toVectorLiteral, type Embedder } from '@lian/analysis';
import type { AssistantScope, UserScope } from '@lian/db';

/** Prose for each stage.  LESSONS §6: the client is told which stage, never
 *  how far through it — the day count never crosses the network. */
const STAGE_PROSE: Record<string, string> = {
  getting_acquainted: 'You are still getting acquainted. Ask rather than assume, and do not act like you know them yet.',
  finding_a_rhythm: 'You are finding a rhythm together. You know a few things about their week.',
  shape_of_your_week: 'You know the shape of their week, and you can refer to it without explaining yourself.',
  noticing_without_asking: 'You notice patterns without needing them explained again, and you can say what you notice.',
  long_familiarity: 'You have known each other a long time. You can be brief and still be understood.',
};

// Every factory takes the userId of the request it serves.  An AssistantScope
// built with a placeholder user would compile and would quietly make an
// assistant id sufficient to read a row — the access path LESSONS §11 says
// must be a deliberate decision.  There is no placeholder here.
export function promptPorts(userId: string, embedder: Embedder | null = null): PromptPorts {
  const scopeFor = (assistantId: string): AssistantScope => ({ userId, assistantId });
  return {
    async loadAssistant(assistantId, userId) {
      const assistant = await db.accounts.getAssistant({ userId, assistantId });
      return assistant === null ? null : {
        id: assistant.id, name: assistant.name, gender: assistant.gender,
        languageStyle: assistant.languageStyle, personality: assistant.personality as unknown as Record<string, string>,
      };
    },
    async loadUser(userId) {
      const user = await db.accounts.getUser({ userId });
      return user === null ? null : {
        id: user.id, timeZone: user.timeZone, languageStyle: user.languageStyle, plan: user.plan,
      };
    },
    async loadRelationship(assistantId) {
      const row = await db.relationship.get(scopeFor(assistantId));
      if (row === null) return null;
      return { stage: row.stage, stageProse: STAGE_PROSE[stageKey(row.stage)]! };
    },
    async loadMood(assistantId) {
      const state = await db.accounts.getState(scopeFor(assistantId));
      return state === null ? null : state.mood;
    },
    async loadConversation(assistantId, conversationId) {
      const conversation = await db.conversations.getConversation(scopeFor(assistantId), conversationId);
      return conversation === null ? null : {
        id: conversation.id, kind: conversation.kind, retention: conversation.retention, scenarioText: conversation.scenarioText,
      };
    },
    async loadEarlier(assistantId, conversationId) {
      const summary = await db.summaries.get(scopeFor(assistantId), conversationId);
      return summary === null ? null : { summary: summary.summary, messageCount: summary.messageCount };
    },
    async loadCanon(assistantId) {
      const rows = await db.canon.all(scopeFor(assistantId));
      return rows.map((row) => ({ statement: row.statement }));
    },
    async loadMemories(assistantId, query, limit) {
      // Semantic retrieval when there is something to retrieve against, and a
      // salience ordering when there is not (her own turn, a briefing).  A
      // failed embedding degrades to the same fallback rather than losing the
      // turn — she should be less precise, never silent.
      let embedding: string | null = null;
      if (query !== null && query.trim() !== '' && embedder !== null) {
        try {
          const [vector] = await embedder.embed([query]);
          if (vector !== undefined) embedding = toVectorLiteral(vector);
        } catch {
          embedding = null;
        }
      }
      const rows = await db.memories.retrieve(scopeFor(assistantId), embedding, limit);
      return rows.map((row) => ({
        type: row.type, statement: row.statement,
        when: row.createdAt.toISOString().slice(0, 10),
      }));
    },
    async loadProfile(forUserId) {
      const rows = await db.profile.list({ userId: forUserId });
      return rows.map((row) => ({ section: row.section, body: row.body }));
    },
    async contributeCapabilities({ userId: forUserId, assistantId, surface, localDay }) {
      const user = await db.accounts.getUser({ userId: forUserId });
      if (user === null) return [];
      return contributions(
        {
          userId: forUserId, assistantId, surface, localDay, timeZone: user.timeZone,
          plan: user.plan, language: user.languageStyle.startsWith('ar') ? 'ar' : 'en',
        },
        capabilityPorts(),
      );
    },
    async messagesRemaining(forUserId, localDay) {
      const user = await db.accounts.getUser({ userId: forUserId });
      if (user === null) return 0;
      const used = await db.usage.current({ userId: forUserId }, 'messages', localDay);
      return messageBudget(user.plan as Plan, used).remaining;
    },
  };
}

export function capabilityPorts(): CapabilityPorts {
  return {
    tasks: {
      async create(userId, input) {
        const task = await db.life.createTask({ userId }, {
          kind: input.kind, title: input.title, dueOn: input.dueOn, recurrence: input.recurrence,
          originMessageId: input.originMessageId, originAssistantId: input.originAssistantId,
        });
        return { id: task.id, kind: task.kind, title: task.title, dueOn: task.dueOn, completedAt: task.completedAt, originMessageId: task.originMessageId };
      },
      async dueOn(userId, day) {
        return (await db.life.dueOn({ userId }, day)).map((t) => ({
          id: t.id, kind: t.kind, title: t.title, dueOn: t.dueOn, completedAt: t.completedAt, originMessageId: t.originMessageId,
        }));
      },
      async completionsOn(userId, day) { return db.life.completionsOn({ userId }, day); },
      async all(userId) {
        return (await db.life.allTasks({ userId })).map((t) => ({
          id: t.id, kind: t.kind, title: t.title, dueOn: t.dueOn, completedAt: t.completedAt, originMessageId: t.originMessageId,
        }));
      },
      async purge(userId) { await db.life.purgeTasks({ userId }); },
    },
    money: {
      async create(userId, input) { return db.life.createTransaction({ userId }, input); },
      async monthSummary(userId, month) { return db.life.monthSummary({ userId }, month); },
      async all(userId) { return db.life.allTransactions({ userId }); },
      async purge(userId) { await db.life.purgeTransactions({ userId }); },
    },
  };
}

export function turnPorts(userId: string): import('./turn.ts').TurnPorts['turn'] {
  const scopeFor = (assistantId: string): AssistantScope => ({ userId, assistantId });
  return {
    async appendMessage(input) {
      const message = await db.conversations.appendMessage(scopeFor(input.assistantId), {
        conversationId: input.conversationId, role: input.role, body: input.body,
        tags: input.tags, surface: input.surface, clientId: input.clientId,
      });
      return { id: message.id };
    },
    async history(assistantId, conversationId, limit) {
      const rows = await db.conversations.recentWindow(scopeFor(assistantId), conversationId, limit);
      return rows.map((row) => ({ role: row.role, content: row.body }));
    },
    async claimCapture(input) {
      const claimed = await db.captures.claim({ userId: input.userId }, {
        messageId: input.messageId, tagIndex: input.tagIndex, capability: input.capability,
        entityTable: input.entityTable, entityId: input.entityId,
      });
      return claimed !== null;
    },
    async voidCaptures(forUserId, messageId) {
      return (await db.captures.voidForMessage({ userId: forUserId }, messageId)).map((c) => ({ entityTable: c.entityTable, entityId: c.entityId }));
    },
    async reserve(forUserId, kind, periodKey, ceiling, by) {
      return (await db.usage.reserve({ userId: forUserId }, kind, periodKey, ceiling, by)).granted;
    },
    async hasHeadroom(forUserId, kind, periodKey, ceiling) {
      return (await db.usage.current({ userId: forUserId }, kind, periodKey)) < ceiling;
    },
    async charge(forUserId, kind, periodKey, micros) {
      await db.usage.increment({ userId: forUserId }, kind, periodKey, micros);
    },
    async markOutreachAnswered(assistantId) {
      await db.outreach.markAnswered(scopeFor(assistantId), new Date());
    },
    async creditQualifyingDay(assistantId, localDay) {
      const scope = scopeFor(assistantId);
      const current = await db.relationship.get(scope);
      await db.relationship.creditQualifyingDay(scope, localDay, (days) => nextStage(current?.stage ?? 1, days));
    },
    async userMessagesOnDay(assistantId, localDay) {
      const start = new Date(`${localDay}T00:00:00Z`);
      const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
      return db.conversations.userMessagesOnDay(scopeFor(assistantId), start, end);
    },
    async recordEvent(input) {
      await db.events.record({ name: input.name, userId: input.userId, assistantId: input.assistantId, dayKey: input.dayKey });
    },
  };
}

export { limitsFor };
export type { UserScope, AssistantScope };
