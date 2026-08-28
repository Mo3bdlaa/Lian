// USE THE PRODUCT.
//
//   npm run session
//
// Not a test. A test asserts something it already believes; this signs up as
// somebody who has never seen the thing, talks to her through a whole day
// with the ticker running every hour, and writes down what happened —
// verbatim, in order, with the prompt she was given at each turn.
//
// A DAY, not a fortnight, and the reason is the clock note below: the rows
// are stamped by the database, so a session that travels to next week writes
// history the scheduler cannot see. One real day exercises everything that
// matters — the 05:00 proposal, delivery, the briefing window, quiet hours,
// and the daily limit — and it exercises it for real.
//
// It exists because the most valuable findings in this project came from
// USING it rather than building it, and every one of them was invisible to a
// suite that was green at the time: the day-one silence, the caption that was
// false on every row, the free tier's line that nothing rendered.
//
// WHAT IT CAN AND CANNOT JUDGE, stated up front because the answer shapes the
// whole document it feeds:
//
//   CAN — the sequence. What appears when, what is empty, what a stranger is
//   asked and in what order, whether a correction lands, whether a reminder
//   fires, what hitting the free wall is like. All of that is the product's
//   own machinery and none of it depends on the model.
//
//   CAN — the AUTHORED words. Every string in the catalogue is the product's,
//   not a model's: the opening, the empty states, the limit lines, the
//   labels. Judging those is judging the product.
//
//   CAN — the PROMPT. What she is actually told, at each turn, in full. That
//   is the product's instruction to the model and it can be read as a critic
//   without ever calling one.
//
//   CANNOT — her voice. The replies below are written by me, so reading them
//   back is reading my own writing. Every observation about how she SOUNDS is
//   unjudgeable until a real key runs this, and FIRST-IMPRESSIONS says so
//   next to each one rather than at the bottom.
import { writeFileSync, mkdirSync } from 'node:fs';
import { loadConfig } from '../apps/server/src/config.ts';
import { createApplication } from '../apps/server/src/app.ts';
import { deterministicEmbedder, EMBEDDING_DIMENSIONS, type AnalysisModel } from '@lian/analysis';
import { DEFAULT_MODEL, type Provider } from '@lian/llm';
import { generateVapidKeys } from '@lian/push';
import { migrate, closeDb, db } from '@lian/db';
import type { AddressInfo } from 'node:net';

const OUT = new URL('../docs/', import.meta.url).pathname;

// ── the clock, which is the hard-won part of this file ─────────────────────
//
// The clock starts on TODAY'S REAL UTC DATE, at midnight, and only the hour
// ever moves. That looks arbitrary and it is the difference between this
// tool proving something and this tool lying.
//
// `createApplication` takes an injectable `now`, so the first version of this
// set the clock to a tidy Monday in September and walked forward a fortnight.
// It reported that a reminder never fired, on the day it was due, with the
// schedule run every hour — which is LESSONS §21 happening again, and is the
// most alarming thing this project could find.
//
// It was not true. THE DATABASE'S CLOCK IS NOT INJECTABLE. `messages.
// created_at` defaults to Postgres's own `now()`, so every row this session
// wrote was stamped with the real wall-clock date while the application
// believed it was September. `assistantsActiveOn` joins on
// `messages.created_at`, found nothing on the imaginary day, and proposed
// outreach for nobody — `proposed.assistants: 0`, every tick, for a fortnight.
//
// So the rule: the injected clock may move the HOUR (which decides quiet
// hours, the briefing window, and the 05:00 proposal) but never the DATE
// (which is what the rows are keyed on). Days do not pass here. What passes
// is a day.
//
// The general form is worth more than the fix: an injectable clock that
// stops at the database boundary can only test what happens ABOVE that
// boundary, and nothing that joins on a stored timestamp. That is most of
// the scheduler.
const REAL_TODAY = new Date().toISOString().slice(0, 10);
let clock = new Date(`${REAL_TODAY}T00:00:00Z`);
const now = (): Date => clock;
const advance = (hours: number): void => { clock = new Date(clock.getTime() + hours * 3_600_000); };

/**
 * Move time forward the way the TICKER does: an hour at a time, running the
 * schedule at each one.
 *
 * The first version of this jumped straight to the hour I wanted to look at
 * and ran the schedule once when it arrived — and reported that a reminder
 * never fired, on the day it was due, with the tick run twice. That was
 * wrong, and it was wrong in the most expensive direction: it looked exactly
 * like LESSONS §21 happening again.
 *
 * `SCHEDULE_HOURS.propose` is 5. Outreach is proposed at five in the morning,
 * local, and nowhere else. My jumps landed on 07:00, 09:00 and 10:00 and
 * skipped the one hour that matters, every single day. The real ticker runs
 * every five minutes and cannot miss it.
 *
 * Which is the finding, and it is about the harness rather than the product:
 * a simulation that samples time does not exercise anything that waits for a
 * particular hour, and the product is full of things that do.
 */
async function hoursPass(count: number): Promise<void> {
  for (let hour = 0; hour < count; hour += 1) {
    advance(1);
    const report = await app.runSchedule(clock) as {
      proposed?: { assistants: number; scheduled: number; heldBack: number; duplicate: number };
      outreach?: { sent?: number; considered?: number };
    };
    // The scheduler's OWN numbers. Guessing why nothing was proposed cost me
    // two wrong conclusions; the runner already counts what it held back.
    if (process.env['SESSION_DEBUG'] === '1' && localNow().includes('05:00')) {
      say(`    [DEBUG ${localNow()}] ${JSON.stringify(report)}`);
    }
    const p = report.proposed;
    if (p !== undefined && (p.scheduled > 0 || p.heldBack > 0)) {
      say(`    [tick ${localNow()}] proposed ${p.scheduled}, held back ${p.heldBack}, duplicate ${p.duplicate}`);
    }
    const sent = report.outreach?.sent ?? 0;
    if (sent > 0) say(`    [tick ${localNow()}] delivered ${sent}`);
  }
}

// ── the transcript ─────────────────────────────────────────────────────────

const log: string[] = [];
const say = (line: string): void => { log.push(line); console.log(line); };
/** Where the clock actually IS, in her time zone. Printed on every heading
 *  because a session that reasons about "day 3" from hour arithmetic gets it
 *  wrong silently — mine said "07:00 Tuesday" when it was 22:00 Monday, and
 *  the conclusion drawn from that was a reminder failure that had not
 *  happened. */
const localNow = (): string => new Intl.DateTimeFormat('en-GB', {
  weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  hourCycle: 'h23', timeZone: 'Asia/Dubai',
}).format(clock);
const heading = (line: string): void => {
  say('');
  say(`── ${line} ${'─'.repeat(Math.max(0, 62 - line.length))}`);
  say(`   (it is ${localNow()} where she is)`);
};

// ── her replies ────────────────────────────────────────────────────────────
//
// Keyed on what was said to her, never on a counter: a counter makes every
// exchange depend on how many came before it. Written to be PLAUSIBLE rather
// than good — the point is to exercise the machinery around them, and a reply
// polished until it is the best thing on the screen would flatter the product
// in the one dimension this run cannot honestly measure.
const REPLIES: [RegExp, string][] = [
  [/^\s*rania\b|call me rania/i, "Rania. Good to meet you.\n<call_me>{\"name\":\"Rania\"}</call_me>\nWhich language sits easier for you — English, or Arabic?"],
  [/english/i, "English it is.\n<language>{\"style\":\"en\"}</language>\nSo tell me something about how your weeks actually go."],
  [/design studio|work at|my job/i, "A studio. That explains the hours.\nWhat is the part of it you would change if you could?"],
  [/deadlines|clients|late/i, "Late nights on other people's deadlines. I will remember that.\nAnd what should I be called? You can pick."],
  [/noor/i, "Noor, then.\n<my_name>{\"name\":\"Noor\"}</my_name>\nI like it. Say what you need and I will keep up."],

  // Due TODAY, because a reminder for a date the rows cannot reach is a
  // reminder nothing can observe — see the note on the clock above.
  [/remind me to call the bank/i, `I'll remind you.\n<todo>{"title":"call the bank","due":"${REAL_TODAY}"}</todo>`],
  [/paid 400 for the gym|gym.*400/i, "Logged.\n<spend>{\"amount\":400,\"currency\":\"AED\",\"category\":\"gym\"}</spend>\nThat is the membership for the month?"],
  [/rent/i, "Noted.\n<spend>{\"amount\":6500,\"currency\":\"AED\",\"category\":\"rent\"}</spend>"],
  [/ran this morning|went for a run/i, "Before the studio, then.\n<health>{\"kind\":\"workout\",\"description\":\"morning run\",\"minutes\":35}</health>"],
  [/exhausted|so tired|drained/i, "That is three late nights this week. Is it one project, or all of them at once?"],
  [/finished it|handed it in|it's done/i, "You said three weeks ago that this one was going to eat you. It did, and you finished it.\n<moment>{\"title\":\"the project she thought would eat her\",\"note\":\"Three weeks of late nights, handed in on time.\"}</moment>"],
  [/thank you|thanks/i, "You did the work. I just kept the list."],
];

const provider: Provider = {
  id: 'session',
  capabilities: () => ({ streaming: true, toolCalling: false, vision: false, contextTokens: 200_000, maxOutputTokens: 4_000 }),
  async stream(request, onDelta) {
    const content = request.messages.at(-1)?.content ?? '';
    if (request.model !== DEFAULT_MODEL) { onDelta('[]'); return usage(); }
    // The turn is <<context>>…<</context>> then the message then the repeated
    // directive (LESSONS §1). Matching the whole thing matches the
    // environment block, which is how "Hello" once came back as an answer
    // about language.
    const after = content.includes('<</context>>') ? content.split('<</context>>')[1]! : content;
    const said = after.split('\n\n').filter((part) => part.trim() !== '')[0] ?? '';
    // The SYSTEM prompt is what the product actually tells her, and reading it
    // is half of what this run is for.
    // `system` is an array of cache-zoned segments (LESSONS §1a: the zones
    // are a trust boundary as well as a caching decision), so reading it back
    // means joining them — and the boundaries between them are worth seeing.
    const segments = (request.system ?? []) as unknown as readonly { text?: string }[];
    prompts.push({
      at: clock.toISOString(), said,
      system: Array.isArray(segments)
        ? segments.map((segment) => segment.text ?? String(segment)).join('\n')
        : String(segments),
    });
    const reply = REPLIES.find(([pattern]) => pattern.test(said))?.[1]
      ?? 'Go on.';
    for (let index = 0; index < reply.length; index += 12) onDelta(reply.slice(index, index + 12));
    return usage();
  },
};
const usage = () => ({ usage: { inputTokens: 2_400, outputTokens: 90, cacheWriteTokens: 0, cacheReadTokens: 0 }, stopReason: 'end_turn' as const });
const prompts: { at: string; said: string; system: string }[] = [];

/** Extraction. Deliberately literal — it takes what was said and files it,
 *  the way a competent model would, so the memory screen has real rows. */
const analysisModel: AnalysisModel = {
  async complete(input) {
    const found: { type: string; statement: string; salience: number }[] = [];
    const text = input.user;
    if (/design studio/i.test(text)) found.push({ type: 'fact', statement: 'They work at a design studio.', salience: 0.8 });
    if (/deadlines|late nights/i.test(text)) found.push({ type: 'fact', statement: 'Their late nights come from other people’s deadlines.', salience: 0.7 });
    if (/ran this morning|went for a run/i.test(text)) found.push({ type: 'preference', statement: 'They run in the morning, before work.', salience: 0.6 });
    if (/hate|can't stand/i.test(text)) found.push({ type: 'preference', statement: 'They dislike being asked how they are twice in a row.', salience: 0.5 });
    return { text: JSON.stringify(found), usage: { inputTokens: 200, outputTokens: 30 } };
  },
};

// ── boot ───────────────────────────────────────────────────────────────────

if ((process.env['DATABASE_URL'] ?? '') === '') {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}
await migrate(() => {});
const vapid = generateVapidKeys();
const { config } = loadConfig({
  ...process.env, NODE_ENV: 'development', PORT: '0', LIAN_TICK_SECRET: 'session',
  LIAN_VAPID_PUBLIC_KEY: vapid.publicKey, LIAN_VAPID_PRIVATE_KEY: vapid.privateKey,
});
const app = createApplication(config, {
  provider, analysisModel, embedder: deterministicEmbedder(EMBEDDING_DIMENSIONS), log: () => {}, now,
});
await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;

// ── the person ─────────────────────────────────────────────────────────────

let cookie = '';
async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(cookie === '' ? {} : { cookie }),
      // Every write route is idempotent (LESSONS §12), and the key is the
      // caller's. A session that reused one would silently replay.
      'idempotency-key': `s-${Math.random().toString(36).slice(2)}-${Date.now()}`,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie !== null) cookie = setCookie.split(';')[0]!;
  const text = await response.text();
  let json: unknown = text;
  try { json = JSON.parse(text); } catch { /* a redirect or an empty body */ }
  return { status: response.status, json: json as any };
}

/** One turn, through the streaming route the client uses. Returns her words
 *  with the control tags already stripped — which is what a person sees. */
async function turn(text: string): Promise<{ hers: string; captures: string[]; limit: string | null }> {
  const response = await fetch(`${base}/api/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, 'idempotency-key': `t-${Math.random().toString(36).slice(2)}-${Date.now()}` },
    body: JSON.stringify({ message: text, clientId: `c-${Math.random().toString(36).slice(2)}` }),
  });
  const body = await response.text();
  let hers = '';
  const captures: string[] = [];
  let limit: string | null = null;
  for (const block of body.split('\n\n')) {
    const event = /^event: (.+)$/m.exec(block)?.[1];
    const data = /^data: (.+)$/m.exec(block)?.[1];
    if (event === undefined || data === undefined) continue;
    const parsed = JSON.parse(data) as Record<string, unknown>;
    if (event === 'text') hers += String(parsed['delta'] ?? '');
    if (event === 'capture') captures.push(String(parsed['line'] ?? ''));
    if (event === 'limit') limit = String(parsed['line'] ?? '');
  }
  say(`  me    ${text}`);
  for (const line of hers.trim().split('\n')) say(`  her   ${line}`);
  for (const capture of captures) say(`        [ ${capture} ]`);
  if (limit !== null) say(`        [ REFUSED — ${limit} ]`);
  return { hers, captures, limit };
}

let conversationId = '';

// ── DAY 1 ──────────────────────────────────────────────────────────────────

heading('MIDNIGHT — a stranger signs up.');

const email = `session-${Date.now()}@example.test`;
const signUp = await call('POST', '/api/auth/sign-up', {
  email, password: 'a-long-enough-password', timeZone: 'Asia/Dubai',
  isAdult: true, agreedToTerms: true, language: 'en',
});
say(`  sign-up → ${signUp.status}`);

const me1 = (await call('GET', '/api/me')).json;
conversationId = me1.conversation.id;
say(`  screen  ${me1.onboarding === null ? 'chat' : `onboarding, step "${me1.onboarding.step}"`}`);
say(`  mood    ${me1.assistant.moodPhrase}`);
say(`  stage   ${me1.relationship.stageName} — "${me1.relationship.prose}"`);
say(`  name    she is called "${me1.assistant.name}"; I am ${me1.user.name ?? '(nobody yet)'}`);

const opening = (await call('GET', `/api/conversations/${conversationId}/messages`)).json;
say('');
say('  WHAT IS ON SCREEN BEFORE I HAVE TYPED ANYTHING:');
for (const message of opening.messages ?? []) say(`  her   ${message.body}`);

say('');
await turn('Rania');
await turn('English');
await turn('I work at a design studio, mostly late');
await turn('the deadlines are never mine, they are clients');
await turn('Noor');

const me2 = (await call('GET', '/api/me')).json;
say('');
say(`  after five exchanges: ${me2.onboarding === null ? 'onboarding is DONE' : `still onboarding, step "${me2.onboarding.step}"`}`);
if (me2.onboarding !== null && me2.onboarding.step === 'ask_notification_permission') {
  say('');
  say('  >> She is waiting on the notification permission, which only the BROWSER can answer.');
  say('  >> Answering it the way somebody who taps "Not now" does:');
  const answered = await call('POST', '/api/push/prompted', { outcome: 'dismissed' });
  say(`     POST /api/push/prompted {dismissed} → ${answered.status}`);
  const me2b = (await call('GET', '/api/me')).json;
  say(`     now: ${me2b.onboarding === null ? 'onboarding is DONE' : `still "${me2b.onboarding.step}"`}`);
}
say(`  she is now called "${me2.assistant.name}"; I am ${me2.user.name}`);
say(`  memories kept ${me2.limits.memoriesKept}, pending ${me2.limits.memoriesPending}`);
say(`  messages left today ${me2.limits.messagesRemaining} (${me2.limits.messagesState})`);

heading('AN HOUR LATER — the things a person actually says');
await turn('remind me to call the bank');
await turn('I paid 400 for the gym today');
await turn('rent went out, 6500');

const tasks1 = (await call('GET', '/api/tasks')).json;
say('');
say(`  TASKS: ${(tasks1.tasks ?? []).map((task: any) => `${task.title} (due ${task.dueOn ?? 'no date'})`).join(' · ') || '(none)'}`);
const money1 = (await call('GET', '/api/money')).json;
say(`  MONEY: in ${money1.inMinor / 100}, out ${money1.outMinor / 100}, left ${money1.leftMinor / 100}`);
say(`  her observation: ${money1.observation ?? '(none — not enough to notice)'}`);

// ── THE NIGHT ──────────────────────────────────────────────────────────────

heading('THE TICKER RUNS, every hour, as it would every five minutes');
await hoursPass(1); // 02:00 UTC — 06:00 in Dubai, past the proposal hour
// There is no `status` column, and that is a design decision worth seeing:
// an outreach's state is the set of timestamps it has (sent, delivered,
// opened, answered, cancelled), so "what happened to it" is a fact about
// when rather than a word somebody has to keep in step.
const outreach1 = await db().query<{ kind: string; source: string; scheduled_for: Date; sent_at: Date | null; cancelled_at: Date | null }>(
  `SELECT kind, source, scheduled_for, sent_at, cancelled_at FROM outreach ORDER BY scheduled_for`,
);
say(`  outreach rows: ${outreach1.rows.length}`);
for (const row of outreach1.rows) {
  const state = row.cancelled_at !== null ? 'cancelled' : row.sent_at !== null ? 'sent' : 'waiting';
  say(`    ${row.kind.padEnd(10)} ${row.source.padEnd(18)} ${state.padEnd(10)} for ${row.scheduled_for.toISOString()}`);
}

// ── DAY 2 ──────────────────────────────────────────────────────────────────

heading('PAST 05:00 — the hour outreach is proposed');
await hoursPass(2);
const briefing = (await call('GET', '/api/briefing')).json;
say(`  BRIEFING: "${briefing.line ?? '(no line)'}"`);
say(`    today       ${(briefing.today ?? []).map((item: any) => item.title).join(' · ') || '(nothing)'}`);
say(`    carried     ${(briefing.carriedOver ?? []).map((item: any) => item.title).join(' · ') || '(nothing)'}`);
say(`    money       ${briefing.money === null || briefing.money === undefined ? '(nothing)' : JSON.stringify(briefing.money)}`);

const messagesNow = (await call('GET', `/api/conversations/${conversationId}/messages`)).json;
const hers = (messagesNow.messages ?? []).filter((m: any) => m.role === 'assistant');
say(`  did she reach out on her own? ${hers.some((m: any) => m.surface === 'scheduled') ? 'YES' : 'no'}`);

await turn('I ran this morning before the studio');
await turn('I am exhausted');

// ── DAY 3: THE DAY THE REMINDER IS FOR ─────────────────────────────────────
//
// The whole of LESSONS §21 is one sentence — "I'll remind you" — and whether
// it is true. Day 2 had nothing due, so nothing happening was correct. This
// is the day it was promised for.

heading('LATER THE SAME DAY — is "I\'ll remind you" true?');
await hoursPass(2);
const dueDay = await db().query<{ kind: string; source: string; scheduled_for: Date; sent_at: Date | null }>(
  `SELECT kind, source, scheduled_for, sent_at FROM outreach ORDER BY scheduled_for`,
);
say(`  outreach rows now: ${dueDay.rows.length}`);
for (const row of dueDay.rows) {
  say(`    ${row.kind.padEnd(10)} ${row.source.padEnd(18)} ${row.sent_at === null ? 'waiting' : 'SENT'} for ${row.scheduled_for.toISOString()}`);
}
await hoursPass(3);
const afterMorning = await db().query<{ kind: string; sent_at: Date | null; message_id: string | null }>(
  `SELECT kind, sent_at, message_id FROM outreach ORDER BY scheduled_for`,
);
for (const row of afterMorning.rows) {
  say(`    after the 10:00 tick: ${row.kind} ${row.sent_at === null ? 'still waiting' : `SENT, message ${row.message_id === null ? 'none' : 'written'}`}`);
}
// Straight at the row, so "the briefing is empty" cannot be confused with
// "the task is not there".
const taskRow = await db().query<{ id: string; due_on: string; completed_at: Date | null }>(
  // Tasks are scoped by USER, not by assistant — unlike memories, canon and
  // the story timeline. A person's list of things to do belongs to them and
  // follows them to a second assistant; what she remembers about them does
  // not. That split is deliberate and it is easy to get backwards.
  `SELECT id, due_on::text AS due_on, completed_at FROM tasks WHERE user_id = $1`,
  [(await call('GET', '/api/me')).json.user.id],
);
say(`  the task row: ${taskRow.rows.map((r) => `due ${r.due_on}, ${r.completed_at === null ? 'open' : 'done'}`).join(' · ') || '(NO TASK AT ALL)'}`);
say(`  today, in her zone: ${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(clock)}`);
const briefing3 = (await call('GET', '/api/briefing')).json;
say(`  the whole briefing: ${JSON.stringify(briefing3)}`);
const rawTasks = (await call('GET', '/api/tasks')).json;
say(`  /api/tasks says: ${JSON.stringify((rawTasks.tasks ?? []).map((t: any) => ({ title: t.title, dueOn: t.dueOn })))}`);
say(`  BRIEFING on the day: "${briefing3.line ?? '(no line)'}"`);
say(`    today       ${(briefing3.today ?? []).map((item: any) => item.title).join(' · ') || '(nothing)'}`);
say(`    carried     ${(briefing3.carriedOver ?? []).map((item: any) => item.title).join(' · ') || '(nothing)'}`);
const day3Messages = (await call('GET', `/api/conversations/${conversationId}/messages`)).json;
const reached = (day3Messages.messages ?? []).filter((m: any) => m.surface === 'scheduled');
say(`  did she say anything unprompted? ${reached.length === 0 ? 'NO' : `yes — "${reached[reached.length - 1].body}"`}`);

// ── CORRECTING SOMETHING ───────────────────────────────────────────────────

heading('CORRECTING SOMETHING SHE GOT WRONG');
const money2 = (await call('GET', '/api/money')).json;
const gym = (money2.recent ?? []).find((row: any) => row.line === 'gym');
say(`  the row as she filed it: ${gym?.line} ${gym?.amountMinor / 100} on ${gym?.occurredOn}, from a receipt: ${gym?.fromReceipt}`);
// `/api/transactions/:id`, not `/api/money/:id`. The chip's correctionRoute
// is `/money/<id>` — a CLIENT route, the screen — and the API is keyed on the
// table. Both are right and they do not match, which cost me a 404 and a
// minute of thinking the correction path was broken.
const corrected = await call('PATCH', `/api/transactions/${gym.id}`, { amountMinor: 35_000 });
say(`  correcting 400 → 350 ... ${corrected.status}`);
const money3 = (await call('GET', '/api/money')).json;
const gym2 = (money3.recent ?? []).find((row: any) => row.id === gym.id);
say(`  now: ${gym2?.line} ${gym2?.amountMinor / 100}`);
say(`  does the conversation still say 400? — the chip re-derives, so:`);
const afterCorrection = (await call('GET', `/api/conversations/${conversationId}/messages`)).json;
for (const message of afterCorrection.messages ?? []) {
  for (const capture of message.captures ?? []) {
    if (capture.line.includes('gym')) say(`    the chip in the conversation now reads: ${capture.line}`);
  }
}

// ── DELETING A MEMORY ──────────────────────────────────────────────────────

heading('DELETING A MEMORY');
const memories = (await call('GET', '/api/memories')).json;
say(`  she is holding ${(memories.memories ?? []).length}:`);
for (const memory of memories.memories ?? []) say(`    [${memory.type}] ${memory.statement}`);
const doomed = (memories.memories ?? [])[0];
if (doomed !== undefined) {
  const gone = await call('DELETE', `/api/memories/${doomed.id}`);
  say(`  deleting "${doomed.statement}" ... ${gone.status}`);
  const left = (await call('GET', '/api/memories')).json;
  say(`  she now holds ${(left.memories ?? []).length}`);
}

// ── THE FREE WALL ──────────────────────────────────────────────────────────

heading('TALKING UNTIL THE FREE TIER RUNS OUT');
let wall: string | null = null;
let spoken = 0;
for (let attempt = 0; attempt < 25 && wall === null; attempt += 1) {
  const state = (await call('GET', '/api/me')).json;
  if (state.limits.messagesState === 'approaching' && spoken > 0) {
    say(`  [ the screen is now showing: "We've only got a few messages left today." ]`);
  }
  const result = await turn(`something on my mind, number ${attempt + 1}`);
  spoken += 1;
  wall = result.limit;
}
say('');
say(`  she took ${spoken} messages before refusing.`);
const atWall = (await call('GET', '/api/me')).json;
say(`  the snapshot now says: ${atWall.limits.messagesRemaining} left, state "${atWall.limits.messagesState}"`);

// ── A FORTNIGHT ────────────────────────────────────────────────────────────

heading('THE REST OF THE DAY — ticking on, with nothing said');
await hoursPass(14);
const me3 = (await call('GET', '/api/me')).json;
say(`  stage after two weeks: ${me3.relationship.stageName} — "${me3.relationship.prose}"`);
say(`  mood: ${me3.assistant.moodPhrase}`);
const story = (await call('GET', '/api/story')).json;
say(`  the story so far:`);
for (const event of story.timeline ?? []) say(`    ${event.at.slice(0, 10)}  [${event.type}] ${event.title}`);
const outreach2 = await db().query<{ kind: string; sent_at: Date | null }>(`SELECT kind, sent_at FROM outreach`);
say(`  outreach after 12 more days: ${outreach2.rows.length} row(s) — ${outreach2.rows.map((r) => `${r.kind}:${r.sent_at === null ? 'waiting' : 'sent'}`).join(' · ')}`);

// ── WHAT SHE WAS TOLD ──────────────────────────────────────────────────────

heading('WHAT SHE WAS ACTUALLY TOLD — the prompt, at the fourth turn');
const sample = prompts[3] ?? prompts[0];
if (sample !== undefined) {
  say(`  (the turn where I said: "${sample.said.slice(0, 60)}")`);
  say('');
  for (const line of sample.system.split('\n')) say(`  | ${line}`);
}

heading('AND AT A TURN A FORTNIGHT IN');
const late = prompts[prompts.length - 1];
if (late !== undefined) {
  say(`  (the turn where I said: "${late.said.slice(0, 60)}")`);
  say('');
  for (const line of late.system.split('\n')) say(`  | ${line}`);
}

// ── done ───────────────────────────────────────────────────────────────────

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}session-transcript.txt`, `${log.join('\n')}\n`);
say('');
say(`transcript → docs/session-transcript.txt   (${log.length} lines, ${prompts.length} turns)`);

app.server.close();
await closeDb();
