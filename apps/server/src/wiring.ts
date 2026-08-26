// The application composition root.
//
// @lian/http declares what it needs and knows nothing else; @lian/runtime and
// @lian/jobs already own their own wiring to the repositories.  This file is
// the last joint: it turns a Config plus a handful of injectable pieces into
// the route table the server serves.
//
// Everything injectable is injectable for a reason a test needs: a provider
// that does not call an API, a clock that does not move, a fetcher that
// records the push it was given.  Nothing here branches on NODE_ENV.
import * as db from '@lian/db';
import {
  signUp as authSignUp, signIn as authSignIn, resolveDeviceConfirmation,
  type AuthPorts, type DeviceInfo,
} from '@lian/auth';
import {
  runTurn, promptPorts, capabilityPorts, turnPorts, absorbPort, ownershipPorts,
  summaryPorts, moodPorts, maybeRollSummary, refreshMood, exportEverything,
  deleteEverything, serializeArchive, relationshipView, type TurnSink,
} from '@lian/runtime';
import { DEFAULT_MODEL, type Provider } from '@lian/llm';
import { verifyTick } from '@lian/jobs';
import { transcribeVoiceNote } from '@lian/voice';
import { localDayKey, localHour, limitsFor, messageBudget, nextStep } from '@lian/domain';
import { moodPhrase, t } from '@lian/i18n';
import { describeCaptures, LANGUAGE_STYLES } from '@lian/capabilities';
import { resolveTheme, timeBand } from '@lian/design';

import type { Embedder, AnalysisModel } from '@lian/analysis';
import {
  authRoutes, chatRoutes, correctionRoutes, platformRoutes,
  type MiddlewarePorts, type AuthRoutePorts, type ChatRoutePorts,
  type CorrectionPorts, type PlatformPorts, type ReadPorts, type Route,
  readRoutes,
} from '@lian/http';
import type { Config } from './config.ts';

export type Deps = {
  readonly config: Config;
  readonly provider: Provider;
  readonly analysisModel: AnalysisModel;
  readonly embedder: Embedder | null;
  readonly now: () => Date;
  /** Delivers the device-confirmation link.  Null means no transport is
   *  configured: the sign-in stays held, which is the safe direction. */
  readonly sendEmail: ((input: { to: string; subject: string; body: string }) => Promise<void>) | null;
  /** Runs the schedule.  Injected so a test can drive /api/tick without
   *  running a model. */
  readonly runTick: (now: Date) => Promise<unknown>;
  readonly log: (line: string) => void;
  /** Null when no speech key is configured: voice reports that plainly
   *  rather than failing as if something went wrong. */
  readonly speech: { transcribe(input: { audio: Uint8Array; contentType: string; languageHint: string | null }): Promise<{ text: string; language: string | null }> } | null;
};

const dayKeyFor = (timeZone: string, now: Date): string => localDayKey(now, timeZone);
const languageOf = (style: string): 'en' | 'ar' => (style.startsWith('ar') ? 'ar' : 'en');

/** The user's assistant.  One per account today; the schema allows more, so
 *  this is the single place that decides which one a request means. */
async function assistantOf(userId: string): Promise<{ id: string; name: string; gender: 'female' | 'male' } | null> {
  const [assistant] = await db.accounts.listAssistants({ userId });
  return assistant === undefined ? null : { id: assistant.id, name: assistant.name, gender: assistant.gender };
}

// ── the three things every route needs ────────────────────────────────────

export function middlewarePorts(deps: Deps): MiddlewarePorts {
  return {
    async sessionByToken(tokenHash, now) {
      const session = await db.auth.sessionByToken(tokenHash, now);
      return session === null ? null : { userId: session.userId, sessionId: session.id, deviceId: session.deviceId };
    },
    async takeToken(bucketKey, windowSeconds, limit, now) {
      const verdict = await db.limits.takeToken(bucketKey, windowSeconds, limit, now);
      return { allowed: verdict.allowed, resetAt: verdict.resetAt };
    },
    claimIdempotency: (input) => db.limits.claimIdempotency(input),
    completeIdempotency: (key, status, body) => db.limits.completeIdempotency(key, status, body),
  };
}

// ── auth ──────────────────────────────────────────────────────────────────

function authPorts(deps: Deps): AuthPorts {
  return {
    async findUserByEmail(email) {
      const user = await db.accounts.findUserByEmail(email);
      return user === null ? null : { id: user.id, email: user.email, passwordHash: user.passwordHash, timeZone: user.timeZone };
    },
    async createUser(input) {
      const user = await db.accounts.createUser(input);
      return { id: user.id, email: user.email, passwordHash: input.passwordHash, timeZone: user.timeZone };
    },
    findDevice: (userId, fingerprint) => db.auth.findDevice({ userId }, fingerprint),
    upsertDevice: (userId, input) => db.auth.upsertDevice({ userId }, input),
    trustDevice: (userId, deviceId) => db.auth.trustDevice({ userId }, deviceId),
    async createSession(userId, input) {
      return db.auth.createSession({ userId }, input);
    },
    revokeAllSessions: (userId) => db.auth.revokeAllSessions({ userId }),
    async recordAttempt(input) {
      return db.auth.recordAttempt({
        userId: input.userId ?? null, email: input.email, fingerprint: input.fingerprint,
        locationLabel: input.locationLabel, userAgent: input.userAgent, outcome: input.outcome,
      });
    },
    createConfirmation: (userId, input) => db.auth.createConfirmation({ userId }, input),
    claimConfirmation: (tokenHash, decision, now) => db.auth.claimConfirmation(tokenHash, decision, now),

    async sendDeviceConfirmation(input) {
      const link = `${deps.config.publicUrl}/confirm-device?token=${encodeURIComponent(input.token)}`;
      if (deps.sendEmail !== null) {
        await deps.sendEmail({
          to: input.email,
          subject: 'Was this you?',
          body: `Someone signed in to your account${input.locationLabel === null ? '' : ` from ${input.locationLabel}`}.\n\nIf it was you: ${link}\nIf it was not, ignore this and your password should change.`,
        });
        return;
      }
      // No transport configured.  The hold STANDS — no session was created —
      // and she raises it in chat instead (UI-UX §16), which is the path the
      // specs actually describe.  The token is not logged: a link in a log
      // file is a credential in a log file.
      deps.log(`device confirmation for ${input.userId} could not be emailed: no transport configured. The sign-in remains held.`);
      if (deps.config.logConfirmationLinks) deps.log(`[development] confirmation link: ${link}`);
    },

    async raiseSecurityEvent(input) {
      const assistant = await assistantOf(input.userId);
      if (assistant === null) return;
      await db.outreach.schedule(
        { userId: input.userId, assistantId: assistant.id },
        {
          kind: 'security', source: 'assistant_initiated', scheduledFor: deps.now(),
          // One question per confirmation, however many times a stranger
          // retries the password.
          dedupeKey: `security:${input.confirmationId}`,
        },
      );
    },

    async recordEvent(input) {
      const user = await db.accounts.getUser({ userId: input.userId });
      await db.events.record({
        name: input.name, userId: input.userId,
        dayKey: dayKeyFor(user?.timeZone ?? 'UTC', deps.now()),
      });
    },
  };
}

export function authRoutePorts(deps: Deps): AuthRoutePorts {
  const ports = authPorts(deps);
  return {
    ...middlewarePorts(deps),
    now: deps.now,
    async signUp(input) {
      const created = await authSignUp(input as { email: string; password: string; timeZone: string; device: DeviceInfo }, ports, deps.now());
      // An account is not usable until she exists and there is somewhere to
      // talk: onboarding is a conversation, so it needs one.  Both are made
      // here rather than lazily on the first message, so every later route
      // can assume them.
      const assistant = await db.accounts.createAssistant({ userId: created.userId }, { name: 'Lian', gender: 'female' });
      await db.conversations.createConversation(
        { userId: created.userId, assistantId: assistant.id },
        { kind: 'main' },
      );
      return created;
    },
    signIn: (input) => authSignIn(input as { email: string; password: string; device: DeviceInfo }, ports, deps.now()),
    resolveConfirmation: (input) => resolveDeviceConfirmation(input, ports, deps.now()),
    revokeAllSessions: (userId) => ports.revokeAllSessions(userId),
  };
}

// ── chat ──────────────────────────────────────────────────────────────────

export function chatRoutePorts(deps: Deps): ChatRoutePorts {
  return {
    ...middlewarePorts(deps),
    now: deps.now,

    async conversationBelongsTo(userId, conversationId) {
      const assistant = await assistantOf(userId);
      if (assistant === null) return false;
      const conversation = await db.conversations.getConversation({ userId, assistantId: assistant.id }, conversationId);
      return conversation !== null;
    },

    async runChatTurn(input) {
      const user = await db.accounts.getUser({ userId: input.userId });
      const assistant = await assistantOf(input.userId);
      if (user === null || assistant === null) return { status: 'no_assistant' };

      // Onboarding is a SURFACE, not a screen (PRD §8) — the same route, the
      // same turn function, one different value. It is chosen from the facts
      // rather than from a flag on the account, so someone who answers two
      // questions in one sentence moves two steps.
      const facts = await db.accounts.onboardingFacts({ userId: input.userId, assistantId: assistant.id });
      const surface = nextStep(facts) === 'done' ? 'chat' : 'onboarding';

      const sink: TurnSink = {
        text: (delta) => input.onText(delta),
        capture: (summary) => input.onCapture(summary),
        captureFailed: (reason) => input.onCaptureFailed(reason),
        memoryQueueFull: () => input.onMemoryQueueFull(),
      };

      const result = await runTurn(
        {
          userId: input.userId, assistantId: assistant.id, conversationId: input.conversationId,
          surface, plan: user.plan, timeZone: user.timeZone,
          language: languageOf(user.languageStyle), assistantGender: assistant.gender,
          model: DEFAULT_MODEL, now: deps.now(),
          userMessage: input.message, clientId: input.clientId, replacingMessageId: null,
        },
        {
          prompt: promptPorts(input.userId, deps.embedder),
          capabilities: capabilityPorts(input.userId),
          turn: turnPorts(input.userId),
          provider: deps.provider,
          absorb: absorbPort(input.userId, { model: deps.analysisModel, embedder: deps.embedder }),
        },
        sink,
      );

      if (result.status !== 'done') {
        return { status: result.status, ...('line' in result ? { line: result.line } : {}) };
      }

      // After the answer, never before it: the text has already streamed to
      // the client by now, so the two follow-ups below cost the person
      // nothing they can perceive, and awaiting them means a shutdown cannot
      // lose them.
      await maybeRollSummary(
        { assistantId: assistant.id, conversationId: input.conversationId, windowSize: db.conversations.WINDOW_SIZE },
        { model: deps.analysisModel, ports: summaryPorts(input.userId) },
      ).catch((error: unknown) => { deps.log(`summary roll failed: ${String(error)}`); });
      await refreshMood(
        { assistantId: assistant.id, language: languageOf(user.languageStyle), now: deps.now() },
        moodPorts(input.userId),
      ).catch((error: unknown) => { deps.log(`mood refresh failed: ${String(error)}`); });

      return { status: 'done', messageId: result.messageId };
    },
  };
}

// ── corrections ───────────────────────────────────────────────────────────

export function correctionPorts(deps: Deps): CorrectionPorts {
  return {
    ...middlewarePorts(deps),
    now: deps.now,

    async correct({ userId, kind, id, patch }) {
      if (kind === 'memories') {
        const assistant = await assistantOf(userId);
        if (assistant === null) return { ok: false, reason: 'I cannot find that' };
        const result = await db.corrections.correctMemory({ userId, assistantId: assistant.id }, id, patch);
        if (result.ok) await recordCorrection(deps, userId, 'memory_edited');
        return result;
      }
      const result = await db.corrections.correctForUser({ userId }, kind, id, patch);
      if (result.ok) await recordCorrection(deps, userId, 'capture_corrected');
      return result;
    },

    async remove({ userId, kind, id }) {
      if (kind === 'memories') {
        const assistant = await assistantOf(userId);
        if (assistant === null) return false;
        const removed = await db.memories.forget({ userId, assistantId: assistant.id }, id);
        if (removed) await recordCorrection(deps, userId, 'memory_deleted');
        return removed;
      }
      const removed = await db.corrections.removeForUser({ userId }, kind, id);
      if (removed) await recordCorrection(deps, userId, 'capture_corrected');
      return removed;
    },
  };
}

async function recordCorrection(deps: Deps, userId: string, name: 'capture_corrected' | 'memory_edited' | 'memory_deleted'): Promise<void> {
  const user = await db.accounts.getUser({ userId });
  await db.events.record({ name, userId, dayKey: dayKeyFor(user?.timeZone ?? 'UTC', deps.now()) });
}

// ── platform ──────────────────────────────────────────────────────────────

export function platformPorts(deps: Deps): PlatformPorts {
  return {
    ...middlewarePorts(deps),
    now: deps.now,

    async saveSubscription(input) {
      const saved = await db.push.save(
        { userId: input.userId },
        { endpoint: input.endpoint, p256dh: input.p256dh, auth: input.auth, deviceId: input.deviceId },
      );
      // PRD §8: the permission is asked after the first remembered moment,
      // and onboarding cannot move on until it has been asked.  Recording it
      // HERE — where the answer actually arrives — is what stops her asking
      // again on the next turn.
      await db.accounts.markNotificationPrompted({ userId: input.userId });
      const user = await db.accounts.getUser({ userId: input.userId });
      await db.events.record({
        name: 'notification_permission_granted', userId: input.userId,
        dayKey: dayKeyFor(user?.timeZone ?? 'UTC', deps.now()),
      });
      return { id: saved.id };
    },

    async removeSubscription(input) {
      const active = await db.push.active({ userId: input.userId });
      const match = active.find((row) => row.endpoint === input.endpoint);
      if (match === undefined) return false;
      await db.push.revoke({ userId: input.userId }, match.id);
      return true;
    },

    async markNotificationAsked(input) {
      // Declined, dismissed, or the browser refused to ask.  She must not ask
      // twice (PRD §8), so "asked" is recorded whatever the answer was — and
      // only the granted case records the funnel event above.
      await db.accounts.markNotificationPrompted({ userId: input.userId });
    },

    vapidPublicKey: () => deps.config.vapid?.publicKey ?? null,

    verifyTick(input) {
      if (deps.config.tickSecret === null) return { ok: false, reason: 'this deployment has no tick secret configured' };
      return verifyTick({ secret: deps.config.tickSecret, ...input });
    },
    runTick: (now) => deps.runTick(now),

    async exportEverything(userId) {
      const user = await db.accounts.getUser({ userId });
      const localDay = dayKeyFor(user?.timeZone ?? 'UTC', deps.now());
      const archive = await exportEverything(
        { userId, localDay, now: deps.now() },
        { ...ownershipPorts(), capabilities: capabilityPorts(userId) },
      );
      return { archive: JSON.parse(serializeArchive(archive)) as unknown, filename: `lian-export-${localDay}.json` };
    },

    async deleteEverything(userId) {
      const user = await db.accounts.getUser({ userId });
      return deleteEverything(
        { userId, localDay: dayKeyFor(user?.timeZone ?? 'UTC', deps.now()) },
        { ...ownershipPorts(), capabilities: capabilityPorts(userId) },
      );
    },
  };
}

/** The route table this deployment serves. */
export function routesFor(deps: Deps): Route[] {
  return [
    ...authRoutes(authRoutePorts(deps), { secureCookies: deps.config.secureCookies }),
    ...readRoutes(readPorts(deps)),
    ...chatRoutes(chatRoutePorts(deps)),
    ...platformRoutes(platformPorts(deps)),
    // Last: its pattern is `/api/:kind/:id`, which would otherwise shadow a
    // named route added later.  Order is the only thing keeping that true, so
    // it is stated rather than assumed.
    ...correctionRoutes(correctionPorts(deps)),
  ];
}

// ── reads (the screens) ───────────────────────────────────────────────────

/**
 * One snapshot, resolved server-side.
 *
 * The client is given the theme rather than asked to compute it (LESSONS §7:
 * one decision point), her mood as a PHRASE rather than a score (UI-UX §3
 * forbids the score), and the relationship as a name rather than a day count
 * (LESSONS §6: the day count never crosses the network).
 */
export function readPorts(deps: Deps): ReadPorts {
  return {
    ...middlewarePorts(deps),
    now: deps.now,

    async snapshot(userId) {
      const user = await db.accounts.getUser({ userId });
      const assistant = await assistantOf(userId);
      if (user === null || assistant === null) return null;
      const scope = { userId, assistantId: assistant.id };
      const language = languageOf(user.languageStyle);
      const localDay = dayKeyFor(user.timeZone, deps.now());
      const hour = localHour(deps.now(), user.timeZone);

      const state = await db.accounts.getState(scope);
      const mood = state?.mood ?? 'neutral';
      const relationship = await db.relationship.get(scope);
      const facts = await db.accounts.onboardingFacts(scope);
      const step = nextStep(facts);
      const conversation = await mainConversation(scope);
      const used = await db.usage.current({ userId }, 'messages', localDay);
      const limits = limitsFor(user.plan);
      const view = relationshipView(relationship?.stage ?? 1, language, assistant.gender);
      const current = view.stages.find((stage) => stage.current);

      return {
        user: {
          id: user.id, name: user.displayName, timeZone: user.timeZone,
          languageStyle: user.languageStyle, language, plan: user.plan,
          themePreference: user.themePreference,
        },
        assistant: {
          id: assistant.id, name: assistant.name, gender: assistant.gender, mood,
          moodPhrase: moodPhrase(
            conversation?.kind === 'incognito' ? 'incognito' : mood,
            timeBand(hour), language, assistant.gender,
          ),
        },
        theme: resolveTheme({ localHour: hour, mood, preference: user.themePreference }),
        direction: language === 'ar' ? 'rtl' : 'ltr',
        localHour: hour,
        conversation: conversation === null ? null : { id: conversation.id },
        onboarding: step === 'done' ? null : { step },
        relationship: { stageName: current?.name ?? '', prose: view.now },
        limits: {
          messagesRemaining: messageBudget(user.plan, used).remaining,
          memoriesKept: await db.memories.countActive(scope),
          memoriesPending: await db.memories.countPending(scope),
          memoryCapacity: limits.activeMemoriesPerAssistant,
          capacityLine: t('memory.capacity_line', language, assistant.gender),
        },
      };
    },

    async messages({ userId, conversationId, before, since }) {
      const user = await db.accounts.getUser({ userId });
      const assistant = await assistantOf(userId);
      if (user === null || assistant === null) return null;
      const scope = { userId, assistantId: assistant.id };
      const conversation = await db.conversations.getConversation(scope, conversationId);
      if (conversation === null) return null;

      const window = since !== null
        ? await db.conversations.since(scope, conversationId, { createdAt: new Date(since.at), id: since.id })
        : before === null
          ? await db.conversations.recentWindow(scope, conversationId)
          : await db.conversations.olderThan(scope, conversationId, { createdAt: new Date(before.at), id: before.id });

      const ids = window.map((message) => message.id);
      const reactions = await db.conversations.reactionsFor({ userId }, ids);
      const quoted = await db.conversations.quotedLines(
        scope,
        window.map((message) => message.replyToId).filter((id): id is string => id !== null),
      );

      // Captures, described by the capability that made them (consumer 6),
      // in the language being read now.
      const captures = new Map<string, { capability: string; entityId: string }[]>();
      for (const message of window) {
        const rows = (await db.captures.forMessage({ userId }, message.id)).filter((row) => row.voidedAt === null);
        if (rows.length > 0) captures.set(message.id, rows.map((row) => ({ capability: row.capability, entityId: row.entityId })));
      }
      const described = await describeCaptures(
        [...captures.values()].flat(),
        {
          userId, assistantId: assistant.id, surface: 'chat',
          localDay: dayKeyFor(user.timeZone, deps.now()), timeZone: user.timeZone,
          plan: user.plan, language: languageOf(user.languageStyle),
        },
        capabilityPorts(userId),
      );

      const messages = [];
      for (const message of window) {
        const derived = message.role === 'user' ? await db.memories.derivedFrom(scope, message.id) : [];
        messages.push({
          id: message.id, role: message.role, body: message.body,
          at: message.createdAt.toISOString(), surface: message.surface,
          captures: (captures.get(message.id) ?? [])
            .map((capture) => described[capture.entityId])
            .filter((summary): summary is NonNullable<typeof summary> => summary !== undefined)
            .map((summary) => ({ capability: summary.capability, icon: summary.icon, line: summary.line, correctionRoute: summary.correctionRoute })),
          reaction: reactions[message.id] ?? null,
          replyTo: message.replyToId === null ? null : quoted[message.replyToId] ?? null,
          memoriesDerived: derived.length,
        });
      }

      // Whether there is more above decides whether the quiet top affordance
      // is drawn at all (UI-UX §38 — no spinner takeover). A catch-up read is
      // never the top of the window, so it does not ask.
      const oldest = window[0];
      const hasOlder = since !== null || oldest === undefined
        ? false
        : (await db.conversations.olderThan(scope, conversationId, { createdAt: oldest.createdAt, id: oldest.id }, 1)).length > 0;

      return { messages, hasOlder };
    },

    async memories({ userId, query }) {
      const assistant = await assistantOf(userId);
      const user = await db.accounts.getUser({ userId });
      if (assistant === null || user === null) return [];
      const scope = { userId, assistantId: assistant.id };
      const language = languageOf(user.languageStyle);
      const rows = [
        ...(await db.memories.list(scope, 'active')).map((row) => ({ row, status: 'active' as const })),
        // PRD §35: the free plan's queue is a visible, honest state — what
        // she noticed and has not been able to keep. Never a silent drop.
        ...(await db.memories.list(scope, 'pending')).map((row) => ({ row, status: 'pending' as const })),
      ];
      const needle = query?.toLowerCase() ?? null;
      return rows
        .filter(({ row }) => needle === null || row.statement.toLowerCase().includes(needle))
        .map(({ row, status }) => ({
          id: row.id, type: row.type, typeLabel: t(`memory.type_${row.type}` as 'memory.type_fact', language, assistant.gender),
          statement: row.statement, status,
          createdAt: row.createdAt.toISOString(),
          sourceMessageId: row.sourceMessageId,
          sourceRemovedKept: row.sourceRemovedKept,
        }));
    },

    async tasks(userId) {
      const localDay = dayKeyFor((await db.accounts.getUser({ userId }))?.timeZone ?? 'UTC', deps.now());
      const done = new Set(await db.life.completionsOn({ userId }, localDay));
      const tasks = (await db.life.allTasks({ userId })).map((task) => ({
        id: task.id, kind: task.kind, title: task.title, dueOn: task.dueOn,
        done: task.completedAt !== null || done.has(task.id),
      }));
      const notes = (await db.life.allNotes({ userId })).map((note) => ({
        id: note.id, title: note.title, body: note.body, createdAt: note.createdAt.toISOString(),
      }));
      return { tasks, notes };
    },

    async money({ userId, month }) {
      const user = await db.accounts.getUser({ userId });
      const localDay = dayKeyFor(user?.timeZone ?? 'UTC', deps.now());
      const period = month ?? localDay.slice(0, 7);
      const summary = await db.life.monthSummary({ userId }, period);
      const all = await db.life.allTransactions({ userId });
      const recent = all
        .filter((transaction) => transaction.occurredOn.startsWith(period))
        .slice(0, 12)
        .map((transaction) => ({
          id: transaction.id,
          line: transaction.category ?? transaction.note ?? '',
          amountMinor: transaction.amountMinor,
          direction: transaction.direction,
          occurredOn: transaction.occurredOn,
          // UI-UX §22 distinguishes what she read from a receipt from what
          // they told her — provenance, on a money row.
          fromReceipt: transaction.originMessageId === null,
        }));
      return {
        month: period, inMinor: summary.inMinor, outMinor: summary.outMinor, leftMinor: summary.leftMinor,
        currency: all[0]?.currency ?? 'AED',
        categories: summary.topCategories, recent,
      };
    },

    async story(userId) {
      const user = await db.accounts.getUser({ userId });
      const assistant = await assistantOf(userId);
      if (user === null || assistant === null) return { now: '', footer: '', stages: [] };
      const relationship = await db.relationship.get({ userId, assistantId: assistant.id });
      const view = relationshipView(relationship?.stage ?? 1, languageOf(user.languageStyle), assistant.gender);
      // LESSONS §6: which stage, never how far through it. There is no day
      // count in this response and there must never be one.
      return { now: view.now, footer: view.footer, stages: [...view.stages] };
    },

    async security({ userId, deviceId }) {
      const devices = (await db.auth.listDevices({ userId })).map((device) => ({
        id: device.id,
        label: deviceLabel(device.userAgent),
        lastSeen: device.lastSeenAt?.toISOString() ?? null,
        current: device.id === deviceId,
      }));
      const attempts = (await db.auth.recentAttempts({ userId }, 10)).map((attempt) => ({
        outcome: attempt.outcome, at: attempt.createdAt.toISOString(), location: attempt.locationLabel,
      }));
      return { devices, attempts };
    },

    async updateSettings({ userId, patch }) {
      // A whitelist, like corrections: a settings body arrives from a client,
      // and the alternative to naming the fields is letting it name columns.
      const themePreference = patch['themePreference'];
      if (typeof themePreference === 'string') {
        if (!['auto', 'always-light', 'always-dark'].includes(themePreference)) {
          return { ok: false, reason: 'that is not one of the appearance settings' };
        }
        await db.accounts.setThemePreference({ userId }, themePreference as 'auto');
      }
      const languageStyle = patch['languageStyle'];
      if (typeof languageStyle === 'string') {
        if (!LANGUAGE_STYLES.includes(languageStyle as 'auto')) return { ok: false, reason: 'that is not one of the languages offered' };
        await db.accounts.setLanguage({ userId }, languageStyle);
      }
      const assistantName = patch['assistantName'];
      if (typeof assistantName === 'string' && assistantName.trim() !== '') {
        const assistant = await assistantOf(userId);
        if (assistant !== null) await db.accounts.setAssistantName({ userId, assistantId: assistant.id }, assistantName.trim(), true);
      }
      return { ok: true };
    },

    async transcribe({ userId, audio, contentType, durationSeconds }) {
      if (deps.speech === null) return { status: 'unconfigured' as const };
      const user = await db.accounts.getUser({ userId });
      if (user === null) return { status: 'failed' as const, reason: 'no account' };
      const localDay = dayKeyFor(user.timeZone, deps.now());
      const result = await transcribeVoiceNote(
        {
          userId, audio: Buffer.from(audio, 'base64'), contentType,
          durationSeconds, month: localDay.slice(0, 7),
          secondsCeiling: limitsFor(user.plan).sttSecondsPerMonth,
          languageHint: languageOf(user.languageStyle),
        },
        {
          speech: deps.speech,
          usage: {
            async reserveSeconds(forUserId, month, ceiling, seconds) {
              return (await db.usage.reserve({ userId: forUserId }, 'stt_seconds', month, ceiling, seconds)).granted;
            },
          },
        },
      );
      return result.status === 'transcribed' ? { status: 'transcribed' as const, text: result.text } : result;
    },

    async revokeDevice({ userId, deviceId }) {
      await db.auth.revokeDevice({ userId }, deviceId);
      return true;
    },

    async react({ userId, messageId, kind }) {
      return db.conversations.react({ userId }, messageId, kind as db.conversations.Reaction | null);
    },

    async deleteMessage({ userId, messageId, keepDerived }) {
      const assistant = await assistantOf(userId);
      if (assistant === null) return { deleted: false, memoriesRemoved: 0 };
      const scope = { userId, assistantId: assistant.id };
      // Q11 / LESSONS §11: what she derived from it goes too, unless they
      // said to keep it — and then it is marked as kept by them, so the
      // Memory screen can say so rather than showing a memory with no source.
      const outcome = await db.memories.deleteSourceMessage(scope, messageId, { keepDerived });
      const deleted = await db.conversations.softDeleteMessage(scope, messageId);
      return { deleted, memoriesRemoved: outcome.derivedRemoved };
    },
  };
}

/**
 * A device, as a person would name it.
 *
 * The reference screen says "iPhone · this device", not a user-agent string.
 * This is deliberately shallow: the platform and the browser, and nothing
 * that pretends to more precision than a UA string can carry.
 */
function deviceLabel(userAgent: string | null): string {
  if (userAgent === null || userAgent.trim() === '') return 'Unknown device';
  const platform =
    /iPhone/i.test(userAgent) ? 'iPhone'
    : /iPad/i.test(userAgent) ? 'iPad'
    : /Android/i.test(userAgent) ? 'Android'
    : /Mac OS X|Macintosh/i.test(userAgent) ? 'Mac'
    : /Windows/i.test(userAgent) ? 'Windows'
    : /Linux/i.test(userAgent) ? 'Linux'
    : 'Device';
  const browser =
    /Edg\//i.test(userAgent) ? 'Edge'
    : /OPR\//i.test(userAgent) ? 'Opera'
    : /Chrome\//i.test(userAgent) ? 'Chrome'
    : /Firefox\//i.test(userAgent) ? 'Firefox'
    : /Safari\//i.test(userAgent) ? 'Safari'
    : null;
  return browser === null ? platform : `${platform} · ${browser}`;
}

/** The 'main' conversation — the one the app opens into. */
async function mainConversation(scope: { userId: string; assistantId: string }) {
  const conversations = await db.conversations.listSearchable(scope);
  return conversations.find((conversation) => conversation.kind === 'main') ?? null;
}
