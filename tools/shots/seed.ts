// A believable account, for the screenshots.
//
// Direct SQL rather than the capture path on purpose. Driving a real
// conversation would need a model that says the right things in the right
// order, which is a fake with opinions — and then the screenshots would be
// pictures of the fake. What is wanted here is the SCREENS, populated the way
// somebody's account looks after a fortnight, so the rows are written and the
// real screens render them.
//
// Everything is dated relative to a fixed "today" so the shots are
// reproducible: re-running produces the same pictures, and a diff in
// docs/shots is a real change to the product rather than a clock moving.
import { db } from '@lian/db';
import { t } from '@lian/i18n';
import { localDayKey } from '@lian/domain';

/** The one copy of it is the catalogue's; this just picks the language. */
const greeting = (language: 'en' | 'ar'): string => t('greeting.first', language, 'female');

/** The day every screenshot is taken on. Wednesday, so "carried over" from
 *  Monday and Tuesday is a normal thing to show rather than a weekend edge. */
export const TODAY = '2026-08-26';
const at = (day: string, hour = 9, minute = 0): string => `${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+04:00`;
const daysAgo = (n: number): string => new Date(Date.parse(`${TODAY}T12:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

export type Seeded = {
  userId: string;
  assistantId: string;
  conversationId: string;
  sessionToken: string;
  email: string;
};

export type Fullness = 'full' | 'empty' | 'onboarding';

/**
 * `onboarding` is an account that has just signed up and answered nothing.
 *
 * It exists because the coverage matrix has an "Onboarding conversation" row
 * and nothing could photograph it: every seeded account set `onboarded_at`,
 * so the product's first five minutes — the part FIRST-IMPRESSIONS says is
 * the best thing about it — had no picture. The step is DERIVED from what is
 * known (packages/domain/src/onboarding.ts), so leaving the facts unset is
 * the whole of it; there is no flag to fake.
 */

/**
 * @param fullness `empty` is a brand-new account — no memories, no money, no
 *   tasks. The empty states are a third of the coverage matrix's key states
 *   and they are the ones nobody looks at, so they get the same treatment.
 */
export async function seed(fullness: Fullness, options: {
  language?: 'en' | 'ar-eg';
  plan?: 'free' | 'paid';
  /** Drives the palette: see resolveTheme. */
  themePreference?: 'auto' | 'always-light' | 'always-dark';
  mood?: 'warm' | 'quiet' | 'neutral';
  /** Relationship stage 1–5. Anything above 1 has to be EARNED in the real
   *  product; here it is set, because the screen is what is being shown. */
  stage?: number;
  /**
   * Messages already spent today, for the free plan's end-of-day states.
   *
   * A real row in usage_counters, not a flag: the counter is what the server
   * reads (LESSONS §12 — the limit is a row, not process memory), and the
   * screen derives 'approaching' from it exactly as it would for somebody who
   * had actually sent fifteen messages.
   *
   * NOT keyed on TODAY. The period key is the user's local day by the REAL
   * clock, because that is what the running server will look up; a counter
   * filed under the fixed screenshot date would be a row nothing reads, and
   * the picture would show 'ok' while claiming to show the limit.
   */
  messagesUsedToday?: number;
} = {}): Promise<Seeded> {
  const sql = db();
  const email = `shots-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.test`;
  const language = options.language ?? 'en';
  const arabic = language === 'ar-eg';

  const { rows: [user] } = await sql.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, time_zone, display_name, language_style, plan,
                        theme_preference, is_adult, consented_at, consent_version, onboarded_at,
                        notification_prompted_at, email_verified_at, signup_language)
     VALUES ($1, 'x', 'Asia/Dubai', $2, $3, $4, $5, true, now(), 'shots', $7, $7, $6, $8)
     RETURNING id`,
    [
      email,
      // No name yet: the first thing she asks for is what to call them.
      fullness === 'onboarding' ? null : arabic ? 'رانيا' : 'Rania',
      // 'auto' is what a new account has — the language question comes later.
      fullness === 'onboarding' ? 'auto' : language,
      options.plan ?? 'free',
      options.themePreference ?? 'auto',
      fullness === 'full' ? new Date() : null,
      // $7 — onboarded_at AND notification_prompted_at. Both unset is what
      // being mid-onboarding IS: the step is derived from the facts, so there
      // is no flag to fake (packages/domain/src/onboarding.ts).
      fullness === 'onboarding' ? null : new Date(),
      // $8 — what the sign-up screens were rendered in. It is what makes an
      // onboarding account (language_style still 'auto') render in the
      // language its opening is written in.
      arabic ? 'ar' : 'en',
    ],
  );
  const userId = user!.id;

  const { rows: [assistant] } = await sql.query<{ id: string }>(
    `INSERT INTO assistants (user_id, name, gender, language_style, named_by_user)
     VALUES ($1, $2, 'female', $3, $4) RETURNING id`,
    // `named_by_user` false: she has a working name and has not been given
    // one, which is the state the last onboarding question is about.
    [userId, arabic ? 'ليان' : 'Lian', fullness === 'onboarding' ? 'auto' : language,
     fullness !== 'onboarding'],
  );
  const assistantId = assistant!.id;

  await sql.query(
    `INSERT INTO assistant_state (assistant_id, mood) VALUES ($1, $2)
     ON CONFLICT (assistant_id) DO UPDATE SET mood = EXCLUDED.mood`,
    [assistantId, options.mood ?? 'warm'],
  );

  // The relationship row exists from the first day; the STAGE is what varies.
  await sql.query(
    `INSERT INTO relationship (assistant_id, stage, qualifying_days, first_at)
     VALUES ($1, $2, $3, now() - interval '21 days')
     ON CONFLICT (assistant_id) DO UPDATE SET stage = EXCLUDED.stage`,
    [assistantId, options.stage ?? (fullness === 'full' ? 2 : 1), fullness === 'full' ? 14 : 0],
  );

  const { rows: [conversation] } = await sql.query<{ id: string }>(
    `INSERT INTO conversations (assistant_id, kind, retention) VALUES ($1, 'main', 'persist') RETURNING id`,
    [assistantId],
  );
  const conversationId = conversation!.id;

  // A session, so the browser can be signed in by setting one cookie — and a
  // device and two sign-in attempts, because the Security screen is one of
  // the screens being photographed.
  const token = `shots-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const { createHash } = await import('node:crypto');
  const hash = createHash('sha256').update(token).digest('base64url');
  const { rows: [device] } = await sql.query<{ id: string }>(
    `INSERT INTO devices (user_id, fingerprint, label, user_agent, location_label, trusted_at)
     VALUES ($1, $2, 'Chrome on macOS', 'Mozilla/5.0', 'Dubai', now()) RETURNING id`,
    [userId, `fp-${Date.now()}`],
  );
  await sql.query(
    `INSERT INTO sessions (user_id, device_id, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + interval '30 days')`,
    [userId, device!.id, hash],
  );
  if (fullness === 'full') {
    await sql.query(
      `INSERT INTO devices (user_id, fingerprint, label, user_agent, location_label, last_seen_at)
       VALUES ($1, $2, 'Safari on iPhone', 'Mozilla/5.0 (iPhone)', 'Dubai', now() - interval '2 days')`,
      [userId, `fp2-${Date.now()}`],
    );
    await sql.query(
      `INSERT INTO sign_in_attempts (user_id, email_attempted, outcome, location_label, created_at)
       VALUES ($1, $2, 'success', 'Dubai', now() - interval '1 hour'),
              ($1, $2, 'held_new_device', 'Amsterdam', now() - interval '2 days'),
              ($1, $2, 'bad_password', 'Amsterdam', now() - interval '2 days')`,
      [userId, email],
    );
  }

  // Her authored opening (PRD §8), written by the real sign-up route in the
  // product. The seed writes rows directly, so it has to write this one too —
  // otherwise the ONBOARDING shot shows an empty conversation and the picture
  // is of a product that no longer exists. The sentence itself comes from the
  // catalogue, so there is still one copy of it; only the row is duplicated.
  await sql.query(
    `INSERT INTO messages (conversation_id, assistant_id, role, body, surface, created_at)
     VALUES ($1, $2, 'assistant', $3, 'onboarding', $4)`,
    [conversationId, assistantId, greeting(arabic ? 'ar' : 'en'), at(daysAgo(fullness === 'full' ? 21 : 0), 20)],
  );

  if (options.messagesUsedToday !== undefined) {
    await sql.query(
      `INSERT INTO usage_counters (user_id, kind, period_key, value, updated_at)
       VALUES ($1, 'messages', $2, $3, now())`,
      [userId, localDayKey(new Date(), 'Asia/Dubai'), options.messagesUsedToday],
    );
  }

  if (fullness !== 'full') return { userId, assistantId, conversationId, sessionToken: token, email };

  // ── the conversation ──────────────────────────────────────────────────
  // Four days of it, with the capture chips that make chat look like chat.
  // Written as pairs so every one of her lines answers something.
  const exchanges: { day: string; hour: number; user: string; her: string; tags?: unknown[]; captured?: 'tasks' | 'money' }[] = arabic ? [
    { day: daysAgo(3), hour: 8, user: 'صباح الخير، اليوم مزحوم', her: 'صباح النور. تحبي نمشيه خطوة خطوة؟' },
    { day: daysAgo(3), hour: 8, user: 'فكريني أكلم البنك', her: 'هفكرك.', captured: 'tasks' },
    { day: daysAgo(2), hour: 19, user: 'دفعت ٤٠٠ للجيم النهاردة', her: 'تمام، سجلت ٤٠٠ درهم للجيم.', captured: 'money' },
    { day: daysAgo(1), hour: 21, user: 'الشغل تقيل الفترة دي', her: 'واضح إنه ماخد منك كتير. حصل حاجة معينة ولا التراكم؟' },
    { day: TODAY, hour: 8, user: 'صباح الخير', her: 'صباح النور. عندك مكالمة البنك من التلات، وامبارح كان يوم طويل.' },
  ] : [
    { day: daysAgo(3), hour: 8, user: 'Morning — today is going to be a lot', her: "Morning. Want to walk through it one thing at a time?" },
    { day: daysAgo(3), hour: 8, user: 'remind me to call the bank', her: "I'll remind you.", captured: 'tasks' },
    { day: daysAgo(2), hour: 19, user: 'paid 400 for the gym today', her: 'Okay, logged AED 400 for the gym.', captured: 'money' },
    { day: daysAgo(1), hour: 21, user: 'work has been heavy this stretch', her: "That's been taking a lot out of you. Is it one thing, or the accumulation?" },
    { day: TODAY, hour: 8, user: 'morning', her: "Morning. The bank call is still open from Tuesday, and yesterday sounded long." },
  ];

  let firstUserMessageId: string | null = null;
  /** Her messages that captured something, so the CHIPS can be attached once
   *  the rows they point at exist. The chip is not rendered from the message's
   *  tags — it is rendered from a `captures` row joined to the real entity and
   *  described by the capability, so a chip in a screenshot is a chip that
   *  points at something. Faking it in `tags` produced chatless chat shots. */
  const captured: { messageId: string; capability: string }[] = [];
  for (const exchange of exchanges) {
    const { rows: [userMessage] } = await sql.query<{ id: string }>(
      `INSERT INTO messages (conversation_id, assistant_id, role, body, surface, created_at)
       VALUES ($1, $2, 'user', $3, 'chat', $4) RETURNING id`,
      [conversationId, assistantId, exchange.user, at(exchange.day, exchange.hour)],
    );
    firstUserMessageId ??= userMessage!.id;
    const { rows: [herMessage] } = await sql.query<{ id: string }>(
      `INSERT INTO messages (conversation_id, assistant_id, role, body, tags, surface, created_at)
       VALUES ($1, $2, 'assistant', $3, $4, 'chat', $5) RETURNING id`,
      [conversationId, assistantId, exchange.her, JSON.stringify(exchange.tags ?? []), at(exchange.day, exchange.hour, 1)],
    );
    if (exchange.captured !== undefined) captured.push({ messageId: herMessage!.id, capability: exchange.captured });
  }

  // ── memory ────────────────────────────────────────────────────────────
  // Including one PENDING, because the free plan's queue is a key state and
  // the screen renders it differently.
  const memories: [string, string, number, string][] = arabic ? [
    ['fact', 'بتجري كل يوم الصبح قبل الشغل.', 0.7, 'active'],
    ['person', 'أختها دانة ساكنة في القاهرة.', 0.8, 'active'],
    ['preference', 'بتفضل الكلام المباشر من غير لف.', 0.6, 'active'],
    ['topic', 'بتفكر تغيّر شغلها الفترة دي.', 0.9, 'active'],
    ['emotional_state', 'الفترة الأخيرة الشغل مرهقها.', 0.5, 'pending'],
  ] : [
    ['fact', 'They run every morning before work.', 0.7, 'active'],
    ['person', 'Their sister Dana lives in Cairo.', 0.8, 'active'],
    ['preference', 'They would rather be told directly than eased into it.', 0.6, 'active'],
    ['topic', 'They are weighing up a change of job this year.', 0.9, 'active'],
    ['emotional_state', 'Work has been wearing on them this stretch.', 0.5, 'pending'],
  ];
  for (const [type, statement, salience, status] of memories) {
    await sql.query(
      `INSERT INTO memories (assistant_id, type, statement, salience, status, source_message_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, now() - interval '3 days')`,
      [assistantId, type, statement, salience, status, firstUserMessageId],
    );
  }

  // ── tasks and notes ───────────────────────────────────────────────────
  const { rows: taskRows } = await sql.query<{ id: string }>(
    `INSERT INTO tasks (user_id, kind, title, due_on, origin_assistant_id) VALUES
       ($1, 'task', $2, $3, $4),
       ($1, 'task', $5, $6, $4),
       ($1, 'task', $7, NULL, $4)
     RETURNING id`,
    [userId,
     arabic ? 'مكالمة البنك' : 'Call the bank', daysAgo(1),
     assistantId,
     arabic ? 'تجديد الإقامة' : 'Renew the visa', TODAY,
     arabic ? 'أسأل عن الشقة' : 'Ask about the flat'],
  );
  await sql.query(
    `INSERT INTO tasks (user_id, kind, title, recurrence, origin_assistant_id)
     VALUES ($1, 'habit', $2, '{"freq":"daily","days":[]}'::jsonb, $3)`,
    [userId, arabic ? 'الجري الصبح' : 'Morning run', assistantId],
  );
  await sql.query(
    `INSERT INTO notes (user_id, title, body, origin_assistant_id) VALUES ($1, $2, $3, $4)`,
    [userId, arabic ? 'اللي المدير قاله' : 'What the manager said',
     arabic ? 'قال إن المراجعة هتكون في نص الشهر الجاي.' : 'He said the review would land mid next month.',
     assistantId],
  );

  // ── money ─────────────────────────────────────────────────────────────
  // Income FIRST, so "What's left" is a true sentence — the screen falls back
  // to "Spent this month" without it, which is its own shot.
  const { rows: transactionRows } = await sql.query<{ id: string }>(
    `INSERT INTO transactions (user_id, direction, amount_minor, currency, category, occurred_on, origin_assistant_id) VALUES
       ($1, 'in',  1800000, 'AED', $2, $3, $4),
       ($1, 'out',   40000, 'AED', $5, $6, $4),
       ($1, 'out',  650000, 'AED', $7, $8, $4),
       ($1, 'out',   12750, 'AED', $9, $10, $4),
       ($1, 'out',   28400, 'AED', $11, $12, $4)
     RETURNING id`,
    [userId,
     arabic ? 'راتب' : 'salary', daysAgo(12), assistantId,
     arabic ? 'جيم' : 'gym', daysAgo(2),
     arabic ? 'إيجار' : 'rent', daysAgo(11),
     arabic ? 'قهوة' : 'coffee', daysAgo(1),
     arabic ? 'سوبرماركت' : 'groceries', daysAgo(4)],
  );

  // ── health ────────────────────────────────────────────────────────────
  await sql.query(
    `INSERT INTO health_entries (user_id, kind, description, occurred_at, duration_minutes, origin_assistant_id) VALUES
       ($1, 'workout', $2, $3, 35, $4),
       ($1, 'meal',    $5, $6, NULL, $4),
       ($1, 'workout', $7, $8, 40, $4)`,
    [userId,
     arabic ? 'جري' : 'Run', at(daysAgo(1), 7), assistantId,
     arabic ? 'فطار خفيف' : 'Light breakfast', at(daysAgo(1), 8),
     arabic ? 'جري' : 'Run', at(daysAgo(3), 7)],
  );

  // One transaction linked to a photograph, so the Money screen shows BOTH
  // captions — "from a receipt" and "you told me" — rather than five rows
  // that all claim the same provenance, which is what it did when the flag
  // was a proxy for something else.
  const { rows: [receipt] } = await sql.query<{ id: string }>(
    `INSERT INTO attachments (user_id, kind, content_type, storage_key, status, persist, ready_at, bytes)
     VALUES ($1, 'receipt', 'image/jpeg', $2, 'ready', true, now(), 204800) RETURNING id`,
    [userId, `shots/receipt-${Date.now()}`],
  );
  await sql.query(`UPDATE transactions SET receipt_id = $2 WHERE id = $1`, [transactionRows[3]!.id, receipt!.id]);

  // ── the timeline (UI-UX §8) ───────────────────────────────────────────
  // Keys, not sentences: the screen resolves them in the language it is being
  // read in, so the Arabic shot is a real Arabic timeline rather than the
  // English one with an Arabic frame around it.
  await sql.query(
    `INSERT INTO story_events (assistant_id, type, title, body, occurred_at, dedupe_key) VALUES
       ($1, 'milestone', 'story.began', NULL, $2, 'began'),
       ($1, 'milestone', 'stage.finding_a_rhythm.name', 'stage.finding_a_rhythm.prose', $3, 'stage:2')`,
    [assistantId, at(daysAgo(21), 20), at(daysAgo(6), 9)],
  );

  // ── the chips ─────────────────────────────────────────────────────────
  // A capture row joins one of HER messages to the entity it produced. The
  // client renders the chip from this, described by the capability that owns
  // it — so a chip in a screenshot is a chip that opens something.
  //
  // The transaction chosen is the GYM one, which is the second `out` row, so
  // the chip and the conversation agree with each other.
  const entityFor: Record<string, { table: string; id: string }> = {
    tasks: { table: 'tasks', id: taskRows[0]!.id },
    money: { table: 'transactions', id: transactionRows[1]!.id },
  };
  for (const [index, capture] of captured.entries()) {
    const entity = entityFor[capture.capability]!;
    await sql.query(
      `INSERT INTO captures (message_id, tag_index, capability, entity_table, entity_id, user_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [capture.messageId, index, capture.capability, entity.table, entity.id, userId],
    );
  }

  return { userId, assistantId, conversationId, sessionToken: token, email };
}
