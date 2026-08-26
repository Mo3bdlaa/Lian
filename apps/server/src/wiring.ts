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
  deleteEverything, serializeArchive, type TurnSink,
} from '@lian/runtime';
import { DEFAULT_MODEL, type Provider } from '@lian/llm';
import { verifyTick } from '@lian/jobs';
import { localDayKey } from '@lian/domain';

import type { Embedder, AnalysisModel } from '@lian/analysis';
import {
  authRoutes, chatRoutes, correctionRoutes, platformRoutes,
  type MiddlewarePorts, type AuthRoutePorts, type ChatRoutePorts,
  type CorrectionPorts, type PlatformPorts, type Route,
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

      const sink: TurnSink = {
        text: (delta) => input.onText(delta),
        capture: (summary) => input.onCapture(summary),
        captureFailed: (reason) => input.onCaptureFailed(reason),
        memoryQueueFull: () => input.onMemoryQueueFull(),
      };

      const result = await runTurn(
        {
          userId: input.userId, assistantId: assistant.id, conversationId: input.conversationId,
          surface: 'chat', plan: user.plan, timeZone: user.timeZone,
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
    ...chatRoutes(chatRoutePorts(deps)),
    ...platformRoutes(platformPorts(deps)),
    // Last: its pattern is `/api/:kind/:id`, which would otherwise shadow a
    // named route added later.  Order is the only thing keeping that true, so
    // it is stated rather than assumed.
    ...correctionRoutes(correctionPorts(deps)),
  ];
}
