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
  summaryPorts, moodPorts, maybeRollSummary, refreshMood, exportEverything, speakForTurn,
  deleteEverything, serializeArchive, relationshipView, type TurnSink,
} from '@lian/runtime';
import { DEFAULT_MODEL, turnCostMicros, type Provider } from '@lian/llm';
import { verifyTick } from '@lian/jobs';
import { transcribeVoiceNote, hashText, type SpeechProvider } from '@lian/voice';
import { localDayKey, localHour, atLocalHour, limitsFor, messageBudget, nextStep, DEFAULT_CURRENCY } from '@lian/domain';
import { moodPhrase, t, CONSENT_VERSION } from '@lian/i18n';
import { describeCaptures, observe, LANGUAGE_STYLES } from '@lian/capabilities';
import { resolveTheme, timeBand } from '@lian/design';

import { readReceipt, describeReading, type Embedder, type AnalysisModel } from '@lian/analysis';
import {
  authRoutes, chatRoutes, correctionRoutes, platformRoutes,
  type MiddlewarePorts, type AuthRoutePorts, type ChatRoutePorts,
  type CorrectionPorts, type PlatformPorts, type ReadPorts, type Route,
  readRoutes, attachmentRoutes, type AttachmentPorts, type HealthView,
} from '@lian/http';
import {
  attachmentKey, voiceKey, kindOf, ACCEPTED, MAX_ATTACHMENT_BYTES,
  UPLOAD_URL_SECONDS, DOWNLOAD_URL_SECONDS, type ObjectStore,
} from '@lian/storage';
import { VISION_MODEL } from './analysis.ts';
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
  /** Null when no bucket is configured: an upload reports that plainly
   *  rather than failing halfway through. */
  readonly store: ObjectStore | null;
  /** Null when no speech key is configured: voice reports that plainly
   *  rather than failing as if something went wrong. Both directions come
   *  from one provider — a voice note in, her sentence out. */
  readonly speech: SpeechProvider | null;
};

const dayKeyFor = (timeZone: string, now: Date): string => localDayKey(now, timeZone);

/**
 * Which voice speaks.
 *
 * ASSUMPTION: the default speech provider's named voices, chosen for register
 * rather than for accent — 'shimmer' and 'onyx' are the warmest of the set.
 * Neither is an Egyptian-Arabic voice; the provider does not publish one, and
 * HANDOFF records that as the reason to swap to Azure Speech if dialect
 * quality turns out to be the binding constraint (see providers/speech.ts).
 */
const VOICE_ID: Record<'female' | 'male', string> = { female: 'shimmer', male: 'onyx' };
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
      // The version travels with the copy (packages/i18n), which is where
      // the text they agreed to lives — @lian/http may not read it, so the
      // route sends the answers and this stamps which text they answered.
      const created = await authSignUp(
        {
          ...(input as { email: string; password: string; timeZone: string; device: DeviceInfo; consent: { isAdult: boolean; agreed: boolean } }),
          consent: { ...input.consent, version: CONSENT_VERSION },
        },
        ports,
        deps.now(),
      );
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

// ── attachments arriving with a message ───────────────────────────────────

/**
 * What an attachment becomes before the turn runs.
 *
 * Two things happen here and NEITHER of them is "show her the file":
 *
 *   a picture  is read by @lian/analysis into five validated fields, and she
 *              is given one line composed from them
 *   a voice note is transcribed, and THE TRANSCRIPT IS THE MESSAGE BODY
 *              (Q14) — memory, search and the summary all read bodies, so a
 *              voice note stored as audio alone is a message the product
 *              cannot think about
 *
 * Both paths are non-voice (LESSONS §1a): an image and an audio file are text
 * somebody else controls, and neither reaches the channel she speaks in.
 */
type PreparedAttachment =
  | { readonly status: 'ready'; readonly attachment: { id: string; kind: 'photo' | 'receipt' | 'voice'; reading: string | null }; readonly body: string | null }
  /** Nothing was written and no budget was spent; the caller says so. */
  | { readonly status: 'failed'; readonly line: string };

/**
 * ASSUMPTION, and it costs money: every image sent in a conversation is read
 * as a possible receipt, rather than asking the person to declare which of
 * their photographs is one. A form is what this product does not do (PRD §2),
 * and the money capability exists to capture a spend from a photo. The cost is
 * one vision call per image message; album photos do not come through this
 * route, so they are not read.
 */
async function prepareAttachment(
  deps: Deps,
  input: {
    userId: string; attachmentId: string; typed: string;
    language: 'en' | 'ar'; gender: 'female' | 'male'; localDay: string; plan: 'free' | 'paid';
  },
): Promise<PreparedAttachment> {
  const attachment = await db.attachments.get({ userId: input.userId }, input.attachmentId);
  // An id that is not theirs, or bytes that never arrived. Not an error worth
  // a scary line — the message still goes, without it.
  if (attachment === null || attachment.status !== 'ready' || deps.store === null) {
    return { status: 'failed', line: t('error.attachment_failed', input.language, input.gender) };
  }

  const object = await deps.store.get(attachment.storageKey);
  if (object === null) return { status: 'failed', line: t('error.attachment_failed', input.language, input.gender) };

  if (attachment.kind === 'audio') {
    if (deps.speech === null) return { status: 'failed', line: t('error.voice_not_understood', input.language, input.gender) };
    const transcribed = await transcribeVoiceNote(
      {
        userId: input.userId, audio: object.bytes, contentType: object.contentType,
        // Duration is not known server-side without decoding the container,
        // so the SIZE ceiling is what bounds this (policy.MAX_ATTACHMENT_BYTES
        // for audio, sized against five minutes of Opus). Passing 0 here
        // would silently skip the length check, so the bytes-per-second
        // assumption is made explicit instead.
        durationSeconds: Math.ceil(object.bytes.byteLength / AUDIO_BYTES_PER_SECOND),
        month: input.localDay.slice(0, 7),
        secondsCeiling: limitsFor(input.plan).sttSecondsPerMonth,
        languageHint: input.language,
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
    if (transcribed.status !== 'transcribed') {
      return { status: 'failed', line: t('error.voice_not_understood', input.language, input.gender) };
    }
    return {
      status: 'ready',
      attachment: { id: attachment.id, kind: 'voice', reading: null },
      // The transcript IS the body. What they typed, if anything, stays in
      // front of it rather than being replaced.
      body: input.typed === '' ? transcribed.text : `${input.typed}\n${transcribed.text}`,
    };
  }

  const receipt = await readReceipt(
    {
      image: { contentType: object.contentType, base64: Buffer.from(object.bytes).toString('base64') },
      today: input.localDay,
      fallbackCurrency: DEFAULT_CURRENCY,
    },
    deps.analysisModel,
  );

  // LESSONS §12: a paid model call with no per-user ceiling is how these
  // products die, and looking at a picture is the most expensive call in the
  // product. It is charged against the same monthly meter the turn is, so a
  // hundred photographs cannot go around the limit that a hundred messages
  // cannot go around.
  const spent = turnCostMicros(VISION_MODEL, { ...receipt.usage, cacheWriteTokens: 0, cacheReadTokens: 0 });
  if (spent > 0) {
    await db.usage.increment({ userId: input.userId }, 'model_cost_micros', input.localDay.slice(0, 7), spent);
  }

  const isReceipt = receipt.ok;
  return {
    status: 'ready',
    attachment: {
      id: attachment.id,
      kind: isReceipt ? 'receipt' : 'photo',
      reading: receipt.ok ? describeReading(receipt.reading) : null,
    },
    body: input.typed === '' ? t(isReceipt ? 'attachment.receipt_only' : 'attachment.photo_only', input.language, input.gender) : input.typed,
  };
}

/**
 * ASSUMPTION: 4 kB per second of audio — Opus at roughly 32 kbit/s, which is
 * what a browser's MediaRecorder produces for speech by default. Used only to
 * turn a byte count into the seconds the STT meter charges for; a denser
 * codec is charged more than it should be, which is the safe direction for a
 * ceiling and the wrong one for a bill, so a real duration from the client
 * should replace it when the recorder reports one.
 */
const AUDIO_BYTES_PER_SECOND = 4_000;

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

      const language = languageOf(user.languageStyle);

      // Before the turn, and before any budget is reserved: reading a picture
      // or a recording is where an attachment message can fail, and failing
      // here costs the person nothing.
      let attachment: { id: string; kind: 'photo' | 'receipt' | 'voice'; reading: string | null } | null = null;
      let body = input.message;
      if (input.attachmentId !== null) {
        const prepared = await prepareAttachment(deps, {
          userId: input.userId, attachmentId: input.attachmentId,
          typed: input.message ?? '', language, gender: assistant.gender,
          localDay: dayKeyFor(user.timeZone, deps.now()), plan: user.plan,
        });
        if (prepared.status === 'failed') return { status: 'attachment_failed', line: prepared.line };
        attachment = prepared.attachment;
        body = prepared.body;
      }

      const result = await runTurn(
        {
          userId: input.userId, assistantId: assistant.id, conversationId: input.conversationId,
          surface, plan: user.plan, timeZone: user.timeZone,
          language, assistantGender: assistant.gender,
          model: DEFAULT_MODEL, now: deps.now(),
          userMessage: body, clientId: input.clientId, replacingMessageId: null,
          attachment,
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
        { ...ownershipPorts(deps.store), capabilities: capabilityPorts(userId) },
      );
      return { archive: JSON.parse(serializeArchive(archive)) as unknown, filename: `lian-export-${localDay}.json` };
    },

    async deleteEverything(userId) {
      const user = await db.accounts.getUser({ userId });
      return deleteEverything(
        { userId, localDay: dayKeyFor(user?.timeZone ?? 'UTC', deps.now()) },
        { ...ownershipPorts(deps.store), capabilities: capabilityPorts(userId) },
      );
    },
  };
}

/** The route table this deployment serves. */
export function routesFor(deps: Deps): Route[] {
  return [
    ...authRoutes(authRoutePorts(deps), { secureCookies: deps.config.secureCookies }),
    ...readRoutes(readPorts(deps)),
    ...attachmentRoutes(attachmentPorts(deps)),
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
      const attached = new Map<string, { id: string; kind: string; contentType: string }[]>();
      for (const row of await db.attachments.forMessages({ userId }, ids)) {
        const list = attached.get(row.messageId!) ?? [];
        list.push({ id: row.id, kind: row.kind, contentType: row.contentType });
        attached.set(row.messageId!, list);
      }
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
          attachments: attached.get(message.id) ?? [],
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

    /**
     * The health week (UI-UX §26.2).
     *
     * The observation is `observe()` from the health capability — the same
     * arithmetic she uses when she brings it up herself, so the screen and
     * her sentence can never disagree about what the week looked like.
     */
    async health(userId) {
      const user = await db.accounts.getUser({ userId });
      const assistant = await assistantOf(userId);
      if (user === null || assistant === null) return { from: '', observation: null, days: [], habits: [] };
      const language = languageOf(user.languageStyle);
      const localDay = dayKeyFor(user.timeZone, deps.now());
      const from = startOfWeekDay(localDay);
      const fromDate = new Date(`${from}T00:00:00Z`);
      const toDate = new Date(fromDate.getTime() + 7 * 24 * 60 * 60 * 1000);

      const entries = await db.life.healthWeek({ userId }, fromDate, toDate);
      const described = await describeCaptures(
        entries.map((entry) => ({ capability: 'health', entityId: entry.id })),
        {
          userId, assistantId: assistant.id, surface: 'chat', localDay,
          timeZone: user.timeZone, plan: user.plan, language,
        },
        capabilityPorts(userId),
      );

      const days: HealthView['days'] = [];
      for (let index = 0; index < 7; index += 1) {
        const day = new Date(fromDate.getTime() + index * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const onDay = entries
          .filter((entry) => entry.occurredAt.toISOString().slice(0, 10) === day)
          .map((entry) => {
            const summary = described[entry.id];
            return {
              id: entry.id, kind: entry.kind,
              line: summary?.line ?? entry.description,
              icon: summary?.icon ?? 'i-health',
            };
          });
        if (onDay.length > 0) days.push({ day, label: day, entries: onDay });
      }

      // Habits belong to the week too (§26.2). A count of the days it
      // happened — never a streak, which is the pressure §26.2 bans.
      const tasks = await db.life.allTasks({ userId });
      const completions = new Set<string>();
      for (let index = 0; index < 7; index += 1) {
        const day = new Date(fromDate.getTime() + index * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        for (const id of await db.life.completionsOn({ userId }, day)) completions.add(`${id}:${day}`);
      }
      const habits = tasks
        .filter((task) => task.kind === 'habit')
        .map((habit) => ({
          id: habit.id, title: habit.title,
          doneThisWeek: [...completions].filter((key) => key.startsWith(`${habit.id}:`)).length,
        }));

      return { from, observation: observe(entries, language), days, habits };
    },

    /**
     * The album (UI-UX §27.1).
     *
     * There is no upload form and no album store: an item IS a picture that
     * arrived in a conversation. Incognito photographs never appear — their
     * rows carry persist=false, which is the same flag retention reads.
     */
    async album({ userId, before }) {
      const assistant = await assistantOf(userId);
      if (assistant === null) return { items: [], hasOlder: false };
      const scope = { userId, assistantId: assistant.id };
      const page = await db.attachments.album(scope, {
        limit: ALBUM_PAGE + 1,
        before: before === null ? null : new Date(before),
      });
      const items = page.slice(0, ALBUM_PAGE).map((row) => ({
        id: row.id, at: row.at.toISOString(),
        source: row.role === 'user' ? ('user' as const) : ('assistant' as const),
        conversationId: row.conversationId, messageId: row.messageId,
      }));
      return { items, hasOlder: page.length > ALBUM_PAGE };
    },

    /**
     * Search (UI-UX §11).
     *
     * Two scopes in one answer, because they are two different questions and
     * the screen shows them apart: what was SAID (messages, grouped by
     * conversation) and what she REMEMBERS (memories, which have their own
     * type filters). Incognito is in neither — the repository excludes it.
     */
    async search({ userId, query }) {
      const assistant = await assistantOf(userId);
      const user = await db.accounts.getUser({ userId });
      if (assistant === null || user === null) return { query, conversations: [], memories: [] };
      const scope = { userId, assistantId: assistant.id };
      const language = languageOf(user.languageStyle);
      const needle = query.trim();
      if (needle.length < 2) return { query, conversations: [], memories: [] };

      const hits = await db.conversations.search(scope, { query: needle, limit: SEARCH_LIMIT });
      const grouped = new Map<string, { id: string; title: string | null; hits: { messageId: string; role: 'user' | 'assistant'; snippet: string; at: string }[] }>();
      for (const hit of hits) {
        const group = grouped.get(hit.conversationId)
          ?? { id: hit.conversationId, title: hit.conversationTitle, hits: [] };
        group.hits.push({ messageId: hit.messageId, role: hit.role, snippet: snippetOf(hit.body, needle), at: hit.createdAt.toISOString() });
        grouped.set(hit.conversationId, group);
      }

      const memories = (await db.memories.list(scope, 'active'))
        .filter((row) => row.statement.toLowerCase().includes(needle.toLowerCase()))
        .slice(0, SEARCH_LIMIT)
        .map((row) => ({ id: row.id, statement: row.statement, typeLabel: t(`memory.type_${row.type}` as 'memory.type_fact', language, assistant.gender) }));

      return { query, conversations: [...grouped.values()], memories };
    },

    /**
     * The briefing screen (UI-UX §10).
     *
     * `line` is the message SHE actually sent this morning, read back — not a
     * second composition of the same facts. Two things saying the same thing
     * in her voice is exactly the shape LESSONS §1 is about, and the screen
     * having no line is more honest than the screen inventing one.
     */
    async briefing(userId) {
      const user = await db.accounts.getUser({ userId });
      const assistant = await assistantOf(userId);
      const empty = { day: '', line: null, today: [], carriedOver: [], habits: [], pattern: null, money: null };
      if (user === null || assistant === null) return empty;
      const scope = { userId, assistantId: assistant.id };
      const language = languageOf(user.languageStyle);
      const localDay = dayKeyFor(user.timeZone, deps.now());

      const tasks = await db.life.allTasks({ userId });
      const doneToday = new Set(await db.life.completionsOn({ userId }, localDay));
      const open = tasks.filter((task) => task.completedAt === null);

      // The local day as instants: midnight to midnight WHERE THEY ARE. The
      // same wall-clock day is a different twenty-four hours in Dubai than in
      // London, and this table stores instants.
      const line = await db.conversations.briefingOn(scope, {
        from: atLocalHour(localDay, 0, user.timeZone),
        to: atLocalHour(nextDay(localDay), 0, user.timeZone),
      });
      const entries = await db.life.healthWeek(
        { userId },
        new Date(`${startOfWeekDay(localDay)}T00:00:00Z`),
        new Date(`${localDay}T23:59:59Z`),
      );
      const summary = await db.life.monthSummary({ userId }, localDay.slice(0, 7));

      return {
        day: localDay,
        line,
        today: open
          .filter((task) => task.kind === 'task' && task.dueOn === localDay)
          .map((task) => ({ id: task.id, title: task.title, done: doneToday.has(task.id) })),
        // "Carried over" is a date that has passed, not a judgement about it.
        carriedOver: open
          .filter((task) => task.kind === 'task' && task.dueOn !== null && task.dueOn < localDay)
          .map((task) => ({ id: task.id, title: task.title, dueOn: task.dueOn })),
        habits: open
          .filter((task) => task.kind === 'habit')
          .map((habit) => ({ id: habit.id, title: habit.title, doneToday: doneToday.has(habit.id) })),
        pattern: observe(entries, language),
        // §10: money only if something stands out. Nothing spent is not a
        // thing that stands out, and neither is an ordinary month.
        money: summary.outMinor === 0 ? null : { outMinor: summary.outMinor, currency: DEFAULT_CURRENCY },
      };
    },

    async profile(userId) {
      return { sections: (await db.profile.list({ userId })).map((row) => ({ section: row.section, body: row.body })) };
    },

    async saveProfile({ userId, section, body }) {
      if (section !== 'about' && section !== 'should_know' && section !== 'notes') {
        return { ok: false, reason: 'I do not have a section by that name' };
      }
      if (body.length > PROFILE_LIMIT) return { ok: false, reason: 'that is longer than I can keep here' };
      await db.profile.upsert({ userId }, section, body.trim());
      return { ok: true };
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

    /**
     * Her sentence, spoken — on demand, never ahead of time.
     *
     * On demand because pre-generating every reply is the version that runs a
     * TTS bill up on messages nobody plays, and because LESSONS §8's own
     * story is a pre-generation path that looked fixed and was not. There is
     * one write point (packages/voice/src/speak.ts) and it decides whether
     * anything is cached from the conversation's retention, not from a flag
     * a caller passes.
     */
    async speakMessage({ userId, messageId }) {
      if (deps.speech === null) return { status: 'unconfigured' as const };
      if (deps.store === null) return { status: 'unconfigured' as const };
      const speech = deps.speech;
      const store = deps.store;

      const user = await db.accounts.getUser({ userId });
      const assistant = await assistantOf(userId);
      if (user === null || assistant === null) return { status: 'failed' as const, reason: 'no account' };
      const scope = { userId, assistantId: assistant.id };

      const message = await db.conversations.getMessage(scope, messageId);
      // Only ever her own words: asking the product to read the user's
      // message back to them is a different feature, and this is not it.
      if (message === null || message.role !== 'assistant' || message.body.trim() === '') {
        return { status: 'failed' as const, reason: 'nothing to say' };
      }
      const conversation = await db.conversations.getConversation(scope, message.conversationId);
      if (conversation === null) return { status: 'failed' as const, reason: 'nothing to say' };

      const voiceId = VOICE_ID[assistant.gender];
      const localDay = dayKeyFor(user.timeZone, deps.now());
      const spoken = await speakForTurn(
        {
          userId, text: message.body, voiceId, plan: user.plan,
          month: localDay.slice(0, 7),
          // From the conversation row, never from the request.
          retention: conversation.kind === 'incognito' ? 'ephemeral' : 'persist',
        },
        {
          cache: db.voice,
          usage: {
            async reserveCharacters(forUserId, month, ceiling, characters) {
              return (await db.usage.reserve({ userId: forUserId }, 'tts_chars', month, ceiling, characters)).granted;
            },
          },
          synthesiser: {
            async synthesise({ text, voiceId: voice }) {
              const audio = await speech.synthesise({ text, voiceId: voice });
              const key = voiceKey({
                textHash: hashText(text), voiceId: voice,
                extension: EXTENSIONS[audio.contentType] ?? 'mp3',
              });
              await store.put({ key, bytes: audio.audio, contentType: audio.contentType });
              return { storageKey: key, bytes: audio.audio.byteLength };
            },
          },
        },
      );

      if (spoken.status !== 'ready') return spoken;
      return {
        status: 'ready' as const,
        url: await store.presignGet({ key: spoken.storageKey, expiresIn: DOWNLOAD_URL_SECONDS, contentType: 'audio/mpeg' }),
        cached: spoken.cached,
      };
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

// ── attachments (LESSONS §11, §12) ────────────────────────────────────────

/** How long a pending upload may sit before the tick sweeps it. */
export const UPLOAD_WINDOW_MINUTES = 30;

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif',
  'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/aac': 'aac',
};

export function attachmentPorts(deps: Deps): AttachmentPorts {
  return {
    ...middlewarePorts(deps),
    now: deps.now,

    async beginUpload({ userId, kind, contentType, conversationId }) {
      if (deps.store === null) return { status: 'no_storage' as const };
      const attachmentKind = kindOf(kind);
      if (attachmentKind === null || !ACCEPTED[attachmentKind].includes(contentType)) {
        return { status: 'unsupported_type' as const };
      }
      const user = await db.accounts.getUser({ userId });
      if (user === null) return { status: 'no_storage' as const };

      // The ceiling is checked before a URL is signed: an upload URL is a
      // capability, and handing one out to somebody who is already full only
      // moves the refusal somewhere less useful.
      const ceiling = limitsFor(user.plan).storageBytes;
      const held = await db.usage.current({ userId }, 'storage_bytes', STORAGE_PERIOD);
      if (held + MAX_ATTACHMENT_BYTES[attachmentKind] > ceiling) {
        return { status: 'ceiling_reached' as const, heldBytes: held, ceiling };
      }

      // Incognito writes nothing that outlives it (Q12), so its attachments
      // are marked as not persisting and go when the conversation does.
      const conversation = conversationId === null ? null : await conversationFor(userId, conversationId);
      const persist = conversation === null || conversation.retention === 'persist';

      const attachment = await db.attachments.reserve(
        { userId },
        { kind: attachmentKind, contentType, persist, conversationId },
      );
      const key = attachmentKey({
        userId, kind: attachmentKind, attachmentId: attachment.id,
        extension: EXTENSIONS[contentType] ?? 'bin',
      });
      await db.attachments.setKey({ userId }, attachment.id, key);
      const signed = await deps.store.presignPut({ key, contentType, expiresIn: UPLOAD_URL_SECONDS });
      return {
        status: 'ready' as const,
        id: attachment.id, url: signed.url, method: signed.method,
        headers: signed.headers, expiresIn: UPLOAD_URL_SECONDS,
      };
    },

    async completeUpload({ userId, attachmentId }) {
      if (deps.store === null) return { status: 'missing' as const };
      const attachment = await db.attachments.get({ userId }, attachmentId);
      if (attachment === null || attachment.storageKey === '') return { status: 'missing' as const };
      // What the STORE says, not what the client claims: a ceiling checked
      // against a number the uploader supplies is not a ceiling.
      const object = await deps.store.head(attachment.storageKey);
      if (object === null) return { status: 'missing' as const };

      const limit = MAX_ATTACHMENT_BYTES[attachment.kind];
      if (object.bytes > limit) {
        await deps.store.remove([attachment.storageKey]);
        await db.attachments.remove({ userId }, attachmentId);
        return { status: 'too_large' as const, bytes: object.bytes, limit };
      }

      const user = await db.accounts.getUser({ userId });
      const ceiling = limitsFor(user?.plan ?? 'free').storageBytes;
      const granted = await db.usage.reserve({ userId }, 'storage_bytes', STORAGE_PERIOD, ceiling, object.bytes);
      if (!granted.granted) {
        await deps.store.remove([attachment.storageKey]);
        await db.attachments.remove({ userId }, attachmentId);
        return { status: 'ceiling_reached' as const };
      }

      const ready = await db.attachments.markReady({ userId }, attachmentId, object.bytes);
      return ready === null
        ? { status: 'missing' as const }
        : { status: 'ready' as const, id: ready.id, bytes: object.bytes, kind: ready.kind };
    },

    async attachmentUrl({ userId, attachmentId }) {
      if (deps.store === null) return null;
      const attachment = await db.attachments.get({ userId }, attachmentId);
      if (attachment === null || attachment.status !== 'ready') return null;
      return {
        url: await deps.store.presignGet({
          key: attachment.storageKey, expiresIn: DOWNLOAD_URL_SECONDS, contentType: attachment.contentType,
        }),
        contentType: attachment.contentType,
      };
    },

    async removeAttachment({ userId, attachmentId }) {
      const removed = await db.attachments.remove({ userId }, attachmentId);
      if (removed === null) return false;
      // The bytes, then the meter: a ceiling that only ever goes up is a
      // ceiling everybody eventually hits.
      if (deps.store !== null && removed.storageKey !== '') await deps.store.remove([removed.storageKey]);
      if (removed.bytes > 0) await db.usage.increment({ userId }, 'storage_bytes', STORAGE_PERIOD, -removed.bytes);
      return true;
    },
  };
}

/**
 * Storage is not metered by month.
 *
 * Everything else in usage_counters resets — messages daily, model spend
 * monthly. Bytes held do not: they accumulate until something is deleted, so
 * they live under one fixed key and the counter moves in both directions.
 */
export const STORAGE_PERIOD = 'held';

/** One screen of album, before it asks for more. */
const ALBUM_PAGE = 60;

/** Results per scope. A search that returns everything is a list, not a
 *  search — and the screen shows them grouped, so the cap is per answer. */
const SEARCH_LIMIT = 40;

/** How much of a profile section is kept. It renders into her system prompt,
 *  so it is bounded there as well; this is the bound at the door. */
const PROFILE_LIMIT = 2_000;

/** Enough of the line around the match to recognise it, and no more —
 *  a whole message in a result list is the list disappearing. */
function snippetOf(body: string, needle: string): string {
  const at = body.toLowerCase().indexOf(needle.toLowerCase());
  if (at === -1) return body.slice(0, SNIPPET_LENGTH);
  const from = Math.max(0, at - SNIPPET_CONTEXT);
  const to = Math.min(body.length, at + needle.length + SNIPPET_CONTEXT);
  return `${from > 0 ? '…' : ''}${body.slice(from, to)}${to < body.length ? '…' : ''}`;
}
const SNIPPET_LENGTH = 120;
const SNIPPET_CONTEXT = 48;

/** The local day after this one. */
function nextDay(localDay: string): string {
  return new Date(Date.parse(`${localDay}T00:00:00Z`) + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** The Monday of a local day's ISO week. The health capability computes the
 *  same boundary; both are here rather than one guessing at the other. */
function startOfWeekDay(localDay: string): string {
  const day = new Date(`${localDay}T00:00:00Z`);
  const isoWeekday = ((day.getUTCDay() + 6) % 7) + 1;
  return new Date(day.getTime() - (isoWeekday - 1) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function conversationFor(userId: string, conversationId: string) {
  const assistant = await assistantOf(userId);
  if (assistant === null) return null;
  return db.conversations.getConversation({ userId, assistantId: assistant.id }, conversationId);
}
