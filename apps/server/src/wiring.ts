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
  requestPasswordReset, completePasswordReset,
  sendEmailVerification, confirmEmail,
  type AuthPorts, type RecoveryPorts, type VerificationPorts, type DeviceInfo,
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
import { moodPhrase, t, CONSENT_VERSION, type CopyKey } from '@lian/i18n';
import { describeCaptures, observe, LANGUAGE_STYLES } from '@lian/capabilities';
import { resolveTheme, timeBand } from '@lian/design';

import { readReceipt, describeReading, type Embedder, type AnalysisModel } from '@lian/analysis';
import {
  authRoutes, chatRoutes, correctionRoutes, platformRoutes,
  type MiddlewarePorts, type AuthRoutePorts, type ChatRoutePorts,
  type CorrectionPorts, type PlatformPorts, type ReadPorts, type Route,
  readRoutes, attachmentRoutes, type AttachmentPorts, type HealthView,
  billingRoutes, type BillingPorts,
} from '@lian/http';
import {
  attachmentKey, voiceKey, kindOf, ACCEPTED, MAX_ATTACHMENT_BYTES,
  UPLOAD_URL_SECONDS, DOWNLOAD_URL_SECONDS, type ObjectStore,
} from '@lian/storage';
import { VISION_MODEL } from './analysis.ts';
import { verifyWebhook, parseSubscription, isHandled, type StripeClient } from '@lian/billing';
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
  /** Null when Stripe is not configured: checkout answers 503 and every
   *  account stays free, which is the safe direction. */
  readonly stripe: StripeClient | null;
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

/**
 * One of the three emails, in the reader's language.
 *
 * Composed HERE and nowhere else, from the catalogue, because until this run
 * the device-confirmation body was the only user-facing text in the product
 * hardcoded in English in a composition root — invisible to the copy tests,
 * invisible to the Arabic gate, and the first thing a stranger who reads
 * Arabic would have received.
 *
 * `{link}` is the only substitution. Nothing else is interpolated, so no name
 * anybody chose can reach an inbox: an email that echoes attacker-chosen text
 * is a phishing template with our From address on it.
 */
async function emailFor(
  deps: Deps,
  userId: string,
  kind: 'verify' | 'reset' | 'device',
  link: string,
): Promise<{ to: string; subject: string; body: string }> {
  const user = await db.accounts.getUser({ userId });
  const language = languageOf(user?.languageStyle ?? 'en', user?.signupLanguage);
  const assistant = await assistantOf(userId);
  const gender = assistant?.gender ?? 'female';
  return {
    to: user?.email ?? '',
    subject: t(`email.${kind}_subject` as 'email.reset_subject', language, gender),
    body: t(`email.${kind}_body` as 'email.reset_body', language, gender).replace('{link}', link),
  };
}
/**
 * Which language to RENDER in.
 *
 * `auto` means "match the user", and before they have said anything there is
 * nothing to match — so it falls back to what the app was signed up in
 * (migration 0017), and only then to English.
 *
 * Without the fallback, an Arabic speaker got her authored opening in Arabic
 * inside an English, left-to-right app: the most incoherent screen in the
 * product, on the first one they see. It was invisible until she spoke first,
 * because before that everything was English together.
 */
const languageOf = (style: string, signupLanguage?: string | null): 'en' | 'ar' => {
  if (style.startsWith('ar')) return 'ar';
  if (style === 'auto' && signupLanguage === 'ar') return 'ar';
  return 'en';
};

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

function authPorts(deps: Deps): AuthPorts & RecoveryPorts & VerificationPorts {
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
        await deps.sendEmail(await emailFor(deps, input.userId, 'device', link));
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
          // retries the password. A reset has no confirmation id, so it is
          // keyed by the minute instead: two resets a month apart are two
          // things worth mentioning, two in the same minute are one.
          dedupeKey: input.confirmationId === ''
            ? `security:${input.kind}:${deps.now().toISOString().slice(0, 16)}`
            : `security:${input.confirmationId}`,
        },
      );
    },

    // ── recovery (UI-UX §21) ────────────────────────────────────────────
    async createPasswordReset(userId, input) {
      return db.auth.createPasswordReset({ userId }, input);
    },
    async claimPasswordReset(tokenHash, now) {
      return db.auth.claimPasswordReset(tokenHash, now);
    },
    async setPasswordHash(userId, passwordHash) {
      await db.auth.setPasswordHash({ userId }, passwordHash);
    },
    async createEmailVerification(userId, input) {
      return db.auth.createEmailVerification({ userId }, input);
    },
    async claimEmailVerification(tokenHash, now) {
      return db.auth.claimEmailVerification(tokenHash, now);
    },
    async sendEmailVerification(input) {
      const link = `${deps.config.publicUrl}/confirm-email?token=${encodeURIComponent(input.token)}`;
      if (deps.sendEmail === null) {
        deps.log(`email confirmation for ${input.userId} could not be sent: no transport configured.`);
        if (deps.config.logConfirmationLinks) deps.log(`[development] confirmation link: ${link}`);
        return false;
      }
      await deps.sendEmail(await emailFor(deps, input.userId, 'verify', link));
      return true;
    },

    async sendPasswordReset(input) {
      const link = `${deps.config.publicUrl}/reset-password?token=${encodeURIComponent(input.token)}`;
      if (deps.sendEmail !== null) {
        await deps.sendEmail(await emailFor(deps, input.userId, 'reset', link));
        return;
      }
      // No transport. The reset was still CREATED — the row exists and the
      // token is valid — so a deployment that later gains a transport does
      // not lose the request. What is missing is the delivery, and the token
      // is not logged: a link in a log file is a credential in a log file.
      deps.log(`password reset for ${input.userId} could not be emailed: no transport configured.`);
      if (deps.config.logConfirmationLinks) deps.log(`[development] reset link: ${link}`);
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
          ...(input as { email: string; password: string; timeZone: string; device: DeviceInfo; consent: { isAdult: boolean; agreed: boolean }; language: 'en' | 'ar' }),
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
      // The first milestone, written the moment there is a relationship to
      // have one. Everything else on the timeline is derived on a schedule;
      // this one has an exact date that will never be recoverable again.
      // A KEY, so it reads in whatever language they end up choosing.
      await db.story.record(
        { userId: created.userId, assistantId: assistant.id },
        { type: 'milestone', titleKey: 'story.began', occurredAt: deps.now(), dedupeKey: 'began' },
      );

      const conversation = await db.conversations.createConversation(
        { userId: created.userId, assistantId: assistant.id },
        { kind: 'main' },
      );

      // SHE SPEAKS FIRST (PRD §8). Authored, not generated — see
      // greeting.first in the catalogue for why a model call here would be
      // the wrong instrument. Written as a real assistant message on the main
      // conversation, so it is in the history, is what the window shows, and
      // is what her next turn is answering.
      //
      // `input.language` is what the client RENDERED the consent and sign-up
      // screens in. It is used for this sentence and nothing else: it does
      // NOT set language_style, which stays 'auto', so onboarding still asks
      // which language they want. A browser's guess is not somebody's choice.
      await db.conversations.appendMessage(
        { userId: created.userId, assistantId: assistant.id },
        {
          conversationId: conversation.id, role: 'assistant',
          body: t('greeting.first', input.language === 'ar' ? 'ar' : 'en', assistant.gender),
          tags: [], surface: 'onboarding',
        },
      );
      return created;
    },
    signIn: (input) => authSignIn(input as { email: string; password: string; device: DeviceInfo }, ports, deps.now()),
    resolveConfirmation: (input) => resolveDeviceConfirmation(input, ports, deps.now()),
    revokeAllSessions: (userId) => ports.revokeAllSessions(userId),
    async requestReset(input) {
      const result = await requestPasswordReset(input, ports, deps.now());
      // Whether this deployment has a transport at all. Not about the
      // account, so it gives nothing away.
      return { ...result, canEmail: deps.sendEmail !== null };
    },
    completeReset: (input) => completePasswordReset(input, ports, deps.now()),
    async sendVerification(userId) {
      const user = await db.accounts.getUser({ userId });
      if (user === null) return { sent: false };
      // Already confirmed: nothing to send, and saying "on its way" would be
      // a lie somebody waits on.
      if (user.emailVerifiedAt !== null) return { sent: false };
      return sendEmailVerification({ userId, email: user.email }, ports, deps.now());
    },
    confirmEmail: (token) => confirmEmail({ token }, ports, deps.now()),
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
    // PRD §10: voice is paid-only, checked HERE, the way speakForTurn checks
    // it on the way out — before a provider call, and with its own sentence.
    //
    // Until the reservation bug in usage.reserve was fixed this was enforced
    // entirely by an STT ceiling of zero, and the answer a free user got was
    // `error.voice_not_understood` — "I couldn't make out that recording."
    // That is not what happened. It tells somebody the product is broken when
    // the truth is that the feature is on the other plan, and no test could
    // catch it because both paths returned the same shape.
    if (!limitsFor(input.plan).voice) {
      return { status: 'failed', line: t('error.voice_not_on_plan', input.language, input.gender) };
    }
    if (deps.speech === null) return { status: 'failed', line: t('error.voice_not_understood', input.language, input.gender) };
    const transcribed = await transcribeVoiceNote(
      {
        userId: input.userId, audio: object.bytes, contentType: object.contentType,
        // The recorder's number, floored by what the bytes prove — see
        // secondsToCharge. Never the reported number alone.
        durationSeconds: secondsToCharge(object.bytes.byteLength, attachment.durationSeconds),
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
      // Three different things, and they were one sentence. A paid user out
      // of minutes for the month is not somebody whose recording was noise.
      return {
        status: 'failed',
        line: t(
          transcribed.status === 'ceiling_reached' ? 'error.voice_ceiling' : 'error.voice_not_understood',
          input.language, input.gender,
        ),
      };
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
 * what a browser's MediaRecorder produces for speech by default. Turns a byte
 * count into the seconds the STT meter charges for, when there is nothing
 * better. A denser codec is over-charged, which is the safe direction for a
 * ceiling and the wrong one for a bill — which is what DECISIONS §29 asked to
 * fix, and what `secondsToCharge` below now does.
 */
const STORY_PAGE = 50;

const AUDIO_BYTES_PER_SECOND = 4_000;

/**
 * ASSUMPTION: 16 kB per second — 128 kbit/s — is the most a browser's
 * MediaRecorder plausibly spends on a second of mono speech. It is well above
 * the ~32 kbit/s it actually uses; being generous here is the point.
 *
 * This is the DENSEST plausible encoding, so `bytes / this` is the SHORTEST a
 * recording of that size can honestly be. Note the direction: more bytes per
 * second means the same file holds LESS time, so the densest rate gives the
 * smallest duration — which is exactly the floor a reported number has to
 * clear. (The first version of this had the two rates the wrong way round and
 * charged a truthful minute as two; the test below is what said so.)
 */
const MAX_AUDIO_BYTES_PER_SECOND = 16_000;

/**
 * What the STT meter charges for one voice note.
 *
 * DECISIONS §29, resolved. The recorder has always known the real duration —
 * the client computes it to decide whether the recording was long enough to
 * send, and then threw it away — but a duration reported by a client is a
 * number somebody can choose, and a client claiming one second for a
 * five-minute note would have five minutes transcribed and be billed for one.
 *
 * So it is neither trusted nor ignored: the charge is the LARGER of what the
 * recorder said and the floor the bytes themselves prove. An honest recording
 * is charged what it actually was, which is the accuracy §29 wanted. A
 * dishonest one cannot be charged less than its bytes could possibly hold.
 * With no reported duration at all — an older row, or a client that does not
 * send one — it falls back to the estimate, which is where it started.
 */
export function secondsToCharge(byteLength: number, reported: number | null): number {
  const estimated = Math.ceil(byteLength / AUDIO_BYTES_PER_SECOND);
  if (reported === null || !Number.isFinite(reported) || reported < 0) return estimated;
  return Math.max(Math.ceil(reported), Math.ceil(byteLength / MAX_AUDIO_BYTES_PER_SECOND));
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

      const language = languageOf(user.languageStyle, user.signupLanguage);

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
        { assistantId: assistant.id, language: languageOf(user.languageStyle, user.signupLanguage), now: deps.now() },
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
    ...billingRoutes(billingPorts(deps)),
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
      const language = languageOf(user.languageStyle, user.signupLanguage);
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
          // A boolean, not the timestamp: the screen needs to know whether to
          // ask, and WHEN somebody confirmed is nobody's business but the
          // security screen's.
          emailVerified: user.emailVerifiedAt !== null,
        },
        assistant: {
          id: assistant.id, name: assistant.name, gender: assistant.gender, mood,
          // Onboarding first: her real mood is a reading of a history that
          // does not exist yet, and 'Still with you' above somebody's very
          // first message claims a continuity that has not happened.
          //
          // (The incognito branch below is kept for the shape, but the MAIN
          // conversation is never incognito — suppression for a thread being
          // READ happens in the client, which is the only place that knows
          // which thread that is.)
          moodPhrase: moodPhrase(
            step !== 'done' ? 'new' : conversation?.kind === 'incognito' ? 'incognito' : mood,
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
          messagesState: messageBudget(user.plan, used).state,
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
          plan: user.plan, language: languageOf(user.languageStyle, user.signupLanguage),
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
      const language = languageOf(user.languageStyle, user.signupLanguage);
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
      const language = languageOf(user.languageStyle, user.signupLanguage);
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
      const language = languageOf(user.languageStyle, user.signupLanguage);
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
        // "Carried over" is a date that has passed, not a judgement about it
        // — AND a task that never had one.
        //
        // An undated task used to appear in no block at all: `today` wants
        // dueOn === localDay, this wanted dueOn !== null, and `habits` wants a
        // recurrence. It was also invisible to outreach, whose query is
        // `due_on = $2::date`. So "remind me to call the bank" → "I'll remind
        // you" → a row that nothing would ever raise again, on any day,
        // forever. She kept a promise she had no mechanism to keep, and the
        // Tasks screen said "No date", which reads as whenever rather than
        // never.
        //
        // Surfaced here rather than added to outreach on purpose: this is a
        // screen somebody opens, and a dateless task that generated a push
        // every morning until it was done would be the nagging LESSONS §4 is
        // about. It comes up when she lists what is on; it does not chase.
        carriedOver: open
          .filter((task) => task.kind === 'task' && (task.dueOn === null || task.dueOn < localDay))
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

    /** The switcher (UI-UX §14). Incognito is listed — the person is in one
     *  and has to be able to leave it — unlike in search, where a listed
     *  thread would be a kept thread. */
    async conversations(userId) {
      const assistant = await assistantOf(userId);
      if (assistant === null) return [];
      const scope = { userId, assistantId: assistant.id };
      const current = await mainConversation(scope);
      return (await db.conversations.listAll(scope)).map((row) => ({
        id: row.conversation.id,
        kind: row.conversation.kind,
        title: row.conversation.title,
        retention: row.conversation.retention,
        scenarioText: row.conversation.scenarioText,
        lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
        messages: row.messages,
        current: row.conversation.id === current?.id,
      }));
    },

    async startConversation({ userId, kind, title, scenarioText }) {
      const assistant = await assistantOf(userId);
      if (assistant === null) return { ok: false, reason: 'I cannot find that' };
      // A second MAIN thread is not a thing: main is where she lives, and two
      // of them is a person wondering which one she is reading.
      if (kind !== 'side' && kind !== 'incognito') {
        return { ok: false, reason: 'a conversation is either a side one or an incognito one' };
      }
      const conversation = await db.conversations.createConversation(
        { userId, assistantId: assistant.id },
        // `retention` is derived from `kind` inside the repository, so a
        // caller cannot ask for a memory-writing incognito (Q15).
        { kind, title, ...(kind === 'incognito' && scenarioText !== null ? { scenarioText } : {}) },
      );
      return { ok: true, id: conversation.id };
    },

    /** PRD §27.  The repository's WHERE clause is what refuses a non-incognito
     *  thread, so this cannot answer ok for a thread that has no role field. */
    async setScenario({ userId, conversationId, scenarioText }) {
      const assistant = await assistantOf(userId);
      if (assistant === null) return { ok: false };
      return {
        ok: await db.conversations.setScenario(
          { userId, assistantId: assistant.id }, conversationId, scenarioText,
        ),
      };
    },

    async endConversation({ userId, conversationId }) {
      const assistant = await assistantOf(userId);
      if (assistant === null) return { ok: false };
      const scope = { userId, assistantId: assistant.id };
      const conversation = await db.conversations.getConversation(scope, conversationId);
      if (conversation === null) return { ok: false };
      if (conversation.kind === 'incognito') {
        // Q12: really deleted, rows and all — and its attachments with it,
        // because a photograph from an incognito thread outliving the thread
        // is the promise broken in the most visible way possible.
        const attachments = await db.attachments.forConversation({ userId }, conversationId);
        const keys = attachments.map((row) => row.storageKey).filter((key) => key !== '');
        if (deps.store !== null && keys.length > 0) await deps.store.remove(keys);
        await db.attachments.deleteRows({ userId }, attachments.map((row) => row.id));
        return { ok: await db.conversations.hardDeleteConversation(scope, conversationId) };
      }
      // A side conversation is CLOSED, not deleted: its messages are the
      // provenance of memories she kept, and a memory whose source vanished
      // cannot show where it came from (Q11).
      return { ok: await db.conversations.closeConversation(scope, conversationId) };
    },

    async settings(userId) {
      const user = await db.accounts.getUser({ userId });
      const assistants = await db.accounts.listAssistants({ userId });
      const current = assistants[0];
      const quiet = await db.outreach.quietHoursFor(userId);
      return {
        user: { name: user?.displayName ?? null },
        assistant: {
          name: current?.name ?? '', gender: current?.gender ?? 'female',
          personality: current?.personality ?? {},
        },
        quietHours: quiet,
        assistants: assistants.map((row, index) => ({
          id: row.id, name: row.name, gender: row.gender, current: index === 0,
        })),
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
      const language = languageOf(user.languageStyle, user.signupLanguage);
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
          // THE COLUMN, at last. This was `originMessageId === null` — which
          // is not what "came from a receipt" means and is backwards, since a
          // real receipt capture HAS an origin message. Every chat-captured
          // row was captioned "from a receipt" and every photographed one was
          // not, for as long as the screen existed (LESSONS §20: a caption is
          // a claim about state, and that one was false on every row).
          fromReceipt: transaction.receiptId !== null,
        }));
      return {
        month: period, inMinor: summary.inMinor, outMinor: summary.outMinor, leftMinor: summary.leftMinor,
        currency: all[0]?.currency ?? 'AED',
        categories: summary.topCategories, recent,
      };
    },

    /** A page, ordered, with the cursor separate from the rows (LESSONS §16).
     *  Fifty is more milestones than a five-stage relationship can produce,
     *  so today it is a bound rather than a page — and it is written as a
     *  page so that stops being true safely. */
    async story(userId) {
      const user = await db.accounts.getUser({ userId });
      const assistant = await assistantOf(userId);
      if (user === null || assistant === null) return { now: '', footer: '', stages: [], timeline: [] };
      const scope = { userId, assistantId: assistant.id };
      const relationship = await db.relationship.get(scope);
      const language = languageOf(user.languageStyle, user.signupLanguage);
      const view = relationshipView(relationship?.stage ?? 1, language, assistant.gender);
      // LESSONS §6: which stage, never how far through it. There is no day
      // count in this response and there must never be one.
      return {
        now: view.now, footer: view.footer, stages: [...view.stages],
        // Resolved HERE, in the language being read. A derived milestone
        // holds copy keys; anything a person authored holds their own words
        // and is passed through untouched (migration 0016).
        timeline: (await db.story.timeline(scope, { limit: STORY_PAGE })).map((event) => ({
          id: event.id,
          type: event.type,
          title: event.derived ? t(event.title as CopyKey, language, assistant.gender) : event.title,
          body: event.body === null ? null
            : event.derived ? t(event.body as CopyKey, language, assistant.gender) : event.body,
          at: event.occurredAt.toISOString(),
        })),
      };
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
      const userName = patch['userName'];
      if (typeof userName === 'string' && userName.trim() !== '') {
        await db.accounts.setUserName({ userId }, userName.trim().slice(0, NAME_LIMIT));
      }
      const assistantGender = patch['assistantGender'];
      if (assistantGender === 'female' || assistantGender === 'male') {
        const assistant = await assistantOf(userId);
        if (assistant !== null) await db.accounts.setAssistantGender({ userId, assistantId: assistant.id }, assistantGender);
      }

      // Q13: five dials, five NAMED stops each. A number would be exactly
      // what the product promises not to be, so an unknown stop is refused
      // rather than clamped into one.
      const personality = patch['personality'];
      if (typeof personality === 'object' && personality !== null) {
        const assistant = await assistantOf(userId);
        if (assistant === null) return { ok: false, reason: 'I cannot find that' };
        const current = await db.accounts.getAssistant({ userId, assistantId: assistant.id });
        if (current === null) return { ok: false, reason: 'I cannot find that' };
        const next = { ...current.personality };
        for (const [dial, stop] of Object.entries(personality as Record<string, unknown>)) {
          if (!PERSONALITY_DIALS.includes(dial as 'warmth')) return { ok: false, reason: 'that is not one of the dials' };
          if (!PERSONALITY_STOPS.includes(stop as 'mid')) return { ok: false, reason: 'that is not one of the settings' };
          next[dial as 'warmth'] = stop as 'mid';
        }
        await db.accounts.setPersonality({ userId, assistantId: assistant.id }, next);
      }

      const quietHours = patch['quietHours'];
      if (typeof quietHours === 'object' && quietHours !== null) {
        const input = quietHours as Record<string, unknown>;
        const hour = (value: unknown, fallback: number): number =>
          typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 23 ? value : fallback;
        const existing = await db.outreach.quietHoursFor(userId);
        const days = Array.isArray(input['days'])
          ? (input['days'] as unknown[]).filter((day): day is number => typeof day === 'number' && Number.isInteger(day) && day >= 1 && day <= 7)
          : existing.days;
        await db.outreach.setQuietHours({ userId }, {
          enabled: typeof input['enabled'] === 'boolean' ? input['enabled'] : existing.enabled,
          startHour: hour(input['startHour'], existing.startHour),
          endHour: hour(input['endHour'], existing.endHour),
          days,
          // Deliberately NOT settable to false from here yet: quiet hours are
          // about her chatting, and somebody signing in to your account at
          // 3am is the one thing worth waking you for. When there is a screen
          // that makes that trade explicit, this is where it goes.
          allowSecurity: true,
        });
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
      // Whether a device was ACTUALLY revoked. Returning true regardless told
      // people on the security screen that a device had been signed out when
      // nothing had happened.
      return db.auth.revokeDevice({ userId }, deviceId);
    },

    async react({ userId, messageId, kind }) {
      const assistant = await assistantOf(userId);
      if (assistant === null) return { ok: false, reaction: null };
      // Scoped by ASSISTANT: the message id came from a URL, and carrying a
      // user_id on the row it writes is not the same as checking the message
      // belongs to them (LESSONS §17).
      return db.conversations.react(
        { userId, assistantId: assistant.id }, messageId, kind as db.conversations.Reaction | null,
      );
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

    async beginUpload({ userId, kind, contentType, conversationId, durationSeconds }) {
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
        // Only audio has a duration, and only audio is metered by one.
        { kind: attachmentKind, contentType, persist, conversationId,
          durationSeconds: attachmentKind === 'audio' ? durationSeconds : null },
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

// ── billing (UI-UX §18) ───────────────────────────────────────────────────

export function billingPorts(deps: Deps): BillingPorts {
  /**
   * Apply what Stripe said about one subscription.
   *
   * Shared by the webhook and by anything else that reads a subscription
   * back: whichever way the news arrives, the plan is decided in one place
   * from one rule, so a webhook and a manual re-read cannot disagree.
   */
  const applySubscription = async (userId: string, payload: Record<string, unknown>): Promise<boolean> => {
    const state = parseSubscription(payload);
    if (state === null) return false;
    await db.billing.apply(
      { userId },
      {
        customerId: state.customerId, subscriptionId: state.subscriptionId,
        status: state.status, active: state.active,
        currentPeriodEnd: state.currentPeriodEnd, cancelAtPeriodEnd: state.cancelAtPeriodEnd,
      },
    );
    return true;
  };

  return {
    ...middlewarePorts(deps),
    now: deps.now,

    async subscription(userId) {
      const user = await db.accounts.getUser({ userId });
      const row = await db.billing.get({ userId });
      return {
        plan: user?.plan ?? 'free',
        status: row?.status ?? null,
        renewsOn: row?.currentPeriodEnd?.toISOString() ?? null,
        cancelAtPeriodEnd: row?.cancelAtPeriodEnd ?? false,
        // A portal session needs a customer. Most people do not have one, and
        // offering "manage" to them would open a page about nothing.
        manageable: row !== null && deps.stripe !== null,
      };
    },

    async startCheckout(userId) {
      if (deps.stripe === null) return { unavailable: true as const };
      const user = await db.accounts.getUser({ userId });
      if (user === null) return { unavailable: true as const };
      const existing = await db.billing.get({ userId });
      const session = await deps.stripe.createCheckout({
        userId, email: user.email, customerId: existing?.stripeCustomerId ?? null,
      });
      return { url: session.url };
    },

    async openPortal(userId) {
      if (deps.stripe === null) return { unavailable: true as const };
      const existing = await db.billing.get({ userId });
      if (existing === null) return { noCustomer: true as const };
      return deps.stripe.createPortal({ customerId: existing.stripeCustomerId });
    },

    async handleWebhook({ body, signature }) {
      if (deps.config.stripe === null) return { handled: false, reason: 'billing is not configured here' };
      const verified = verifyWebhook({
        body, header: signature, secret: deps.config.stripe.webhookSecret, now: deps.now(),
      });
      if (!verified.ok) return { handled: false, reason: verified.reason };
      const { event } = verified;

      // Everything Stripe sends is acknowledged; only four types act.
      if (!isHandled(event.type)) return { handled: true };

      // Which user this concerns, in the order the answer is most reliable:
      // the metadata we put on the subscription, then the customer we already
      // linked. An event about a customer nobody here has is not an error —
      // it is somebody else's account on the same Stripe account.
      const metadata = event.object['metadata'] as { user_id?: unknown } | undefined;
      const fromMetadata = typeof metadata?.user_id === 'string' ? metadata.user_id : null;
      const rawCustomer = event.object['customer'];
      const customerId = typeof rawCustomer === 'string' ? rawCustomer : null;
      const userId = fromMetadata
        ?? (customerId === null ? null : (await db.billing.userForCustomer(customerId))?.userId ?? null);
      if (userId === null) return { handled: true };

      // Stripe delivers at least once and retries on any non-2xx, so the same
      // event arrives again as a matter of course. The event id is the
      // idempotency key, and a repeat is acknowledged rather than re-applied.
      const first = await db.billing.claimEvent({ eventId: event.id, userId, type: event.type });
      if (!first) return { handled: true };

      if (event.type === 'checkout.session.completed') {
        // A completed checkout carries the customer and the subscription as
        // IDS, not as objects. The subscription is read back rather than
        // inferred: what the person is actually subscribed to is Stripe's
        // answer, not ours.
        if (customerId !== null) await db.billing.linkCustomer({ userId }, customerId);
        const subscriptionId = event.object['subscription'];
        if (typeof subscriptionId !== 'string' || deps.stripe === null) return { handled: true };
        const state = await deps.stripe.getSubscription(subscriptionId);
        if (state === null) return { handled: true };
        await db.billing.apply({ userId }, {
          customerId: state.customerId, subscriptionId: state.subscriptionId,
          status: state.status, active: state.active,
          currentPeriodEnd: state.currentPeriodEnd, cancelAtPeriodEnd: state.cancelAtPeriodEnd,
        });
        return { handled: true };
      }

      // created / updated / deleted all carry the subscription object itself.
      // 'deleted' included: its status is 'canceled', which is not active, so
      // the same code path downgrades without a special case.
      await applySubscription(userId, event.object);
      return { handled: true };
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

/** Q13's five dials and their five stops. Named here so a patch that invents
 *  a sixth is refused rather than stored. */
const PERSONALITY_DIALS = ['warmth', 'playfulness', 'proactivity', 'directness', 'encouragement'] as const;
const PERSONALITY_STOPS = ['least', 'low', 'mid', 'high', 'most'] as const;

/** A display name is a label, not an essay. */
const NAME_LIMIT = 60;

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
