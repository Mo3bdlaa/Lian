// Users and assistants.
import type { Sql } from '../client.ts';
import { db } from '../client.ts';
import type { AssistantScope, UserScope } from '../scope.ts';

export type Plan = 'free' | 'paid';
export type AssistantGender = 'female' | 'male';

export type User = {
  id: string; email: string; timeZone: string; languageStyle: string; plan: Plan;
  themePreference: 'auto' | 'always-light' | 'always-dark'; isAdult: boolean; consentedAt: Date | null;
};
type UserRow = {
  id: string; email: string; time_zone: string; language_style: string; plan: Plan;
  theme_preference: 'auto' | 'always-light' | 'always-dark'; is_adult: boolean; consented_at: Date | null;
};
const USER_COLUMNS = 'id, email, time_zone, language_style, plan, theme_preference, is_adult, consented_at';
const toUser = (r: UserRow): User => ({
  id: r.id, email: r.email, timeZone: r.time_zone, languageStyle: r.language_style, plan: r.plan,
  themePreference: r.theme_preference, isAdult: r.is_adult, consentedAt: r.consented_at,
});

export async function createUser(
  input: { email: string; passwordHash: string; timeZone: string },
  sql: Sql = db(),
): Promise<User> {
  const { rows } = await sql.query<UserRow>(
    `INSERT INTO users (email, password_hash, time_zone) VALUES ($1, $2, $3) RETURNING ${USER_COLUMNS}`,
    [input.email, input.passwordHash, input.timeZone],
  );
  return toUser(rows[0]!);
}

export async function findUserByEmail(email: string, sql: Sql = db()): Promise<(User & { passwordHash: string }) | null> {
  const { rows } = await sql.query<UserRow & { password_hash: string }>(
    `SELECT ${USER_COLUMNS}, password_hash FROM users WHERE email = $1 AND deleted_at IS NULL`,
    [email],
  );
  return rows[0] === undefined ? null : { ...toUser(rows[0]), passwordHash: rows[0].password_hash };
}

export async function getUser(scope: UserScope, sql: Sql = db()): Promise<User | null> {
  const { rows } = await sql.query<UserRow>(
    `SELECT ${USER_COLUMNS} FROM users WHERE id = $1 AND deleted_at IS NULL`,
    [scope.userId],
  );
  return rows[0] === undefined ? null : toUser(rows[0]);
}

/** Q13: five dials, five named stops each.  Stored as stop names — never a
 *  number, because a number is exactly what the product promises not to be. */
export type PersonalityStop = 'least' | 'low' | 'mid' | 'high' | 'most';
export type Personality = {
  warmth: PersonalityStop; playfulness: PersonalityStop; proactivity: PersonalityStop;
  directness: PersonalityStop; encouragement: PersonalityStop;
};
export const DEFAULT_PERSONALITY: Personality = {
  warmth: 'mid', playfulness: 'mid', proactivity: 'mid', directness: 'mid', encouragement: 'mid',
};

export type Assistant = {
  id: string; userId: string; name: string; gender: AssistantGender;
  appearanceTheme: 'rose' | 'lilac'; voiceId: string | null; languageStyle: string; personality: Personality;
};
type AssistantRow = {
  id: string; user_id: string; name: string; gender: AssistantGender;
  appearance_theme: 'rose' | 'lilac'; voice_id: string | null; language_style: string; personality: Personality;
};
const ASSISTANT_COLUMNS = 'id, user_id, name, gender, appearance_theme, voice_id, language_style, personality';
const toAssistant = (r: AssistantRow): Assistant => ({
  id: r.id, userId: r.user_id, name: r.name, gender: r.gender, appearanceTheme: r.appearance_theme,
  voiceId: r.voice_id, languageStyle: r.language_style,
  personality: { ...DEFAULT_PERSONALITY, ...r.personality },
});

export async function createAssistant(
  scope: UserScope,
  input: { name: string; gender: AssistantGender; appearanceTheme?: 'rose' | 'lilac'; languageStyle?: string; personality?: Personality },
  sql: Sql = db(),
): Promise<Assistant> {
  const { rows } = await sql.query<AssistantRow>(
    `INSERT INTO assistants (user_id, name, gender, appearance_theme, language_style, personality)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${ASSISTANT_COLUMNS}`,
    [scope.userId, input.name, input.gender, input.appearanceTheme ?? 'rose', input.languageStyle ?? 'auto',
     JSON.stringify(input.personality ?? DEFAULT_PERSONALITY)],
  );
  const assistant = toAssistant(rows[0]!);
  await sql.query(`INSERT INTO assistant_state (assistant_id) VALUES ($1)`, [assistant.id]);
  await sql.query(`INSERT INTO relationship (assistant_id) VALUES ($1)`, [assistant.id]);
  return assistant;
}

/** Scoped by user as well as id: an assistant id alone is never enough. */
export async function getAssistant(scope: AssistantScope, sql: Sql = db()): Promise<Assistant | null> {
  const { rows } = await sql.query<AssistantRow>(
    `SELECT ${ASSISTANT_COLUMNS} FROM assistants WHERE id = $2 AND user_id = $1 AND archived_at IS NULL`,
    [scope.userId, scope.assistantId],
  );
  return rows[0] === undefined ? null : toAssistant(rows[0]);
}

export async function listAssistants(scope: UserScope, sql: Sql = db()): Promise<Assistant[]> {
  const { rows } = await sql.query<AssistantRow>(
    `SELECT ${ASSISTANT_COLUMNS} FROM assistants WHERE user_id = $1 AND archived_at IS NULL ORDER BY created_at ASC`,
    [scope.userId],
  );
  return rows.map(toAssistant);
}

export type AssistantState = { mood: 'warm' | 'quiet' | 'neutral'; updatedAt: Date };

export async function getState(scope: AssistantScope, sql: Sql = db()): Promise<AssistantState | null> {
  const { rows } = await sql.query<{ mood: 'warm' | 'quiet' | 'neutral'; updated_at: Date }>(
    `SELECT mood, updated_at FROM assistant_state WHERE assistant_id = $1`,
    [scope.assistantId],
  );
  return rows[0] === undefined ? null : { mood: rows[0].mood, updatedAt: rows[0].updated_at };
}

// ── onboarding (PRD §8) ───────────────────────────────────────────────────
export async function setUserName(scope: UserScope, name: string, sql: Sql = db()): Promise<void> {
  await sql.query(`UPDATE users SET display_name = $2 WHERE id = $1`, [scope.userId, name]);
}

export async function setLanguage(scope: UserScope, style: string, sql: Sql = db()): Promise<void> {
  await sql.query(`UPDATE users SET language_style = $2 WHERE id = $1`, [scope.userId, style]);
}

export async function setAssistantName(
  scope: AssistantScope,
  name: string,
  chosenByThem: boolean,
  sql: Sql = db(),
): Promise<void> {
  await sql.query(
    `UPDATE assistants SET name = $3, named_by_user = $4 WHERE user_id = $1 AND id = $2`,
    [scope.userId, scope.assistantId, name, chosenByThem],
  );
}

export async function markNotificationPrompted(scope: UserScope, sql: Sql = db()): Promise<void> {
  await sql.query(
    `UPDATE users SET notification_prompted_at = coalesce(notification_prompted_at, now()) WHERE id = $1`,
    [scope.userId],
  );
}

export async function markOnboarded(scope: UserScope, sql: Sql = db()): Promise<void> {
  await sql.query(`UPDATE users SET onboarded_at = coalesce(onboarded_at, now()) WHERE id = $1`, [scope.userId]);
}

/** The four facts PRD §8 has to establish, read as state rather than as a
 *  step counter — someone who answers two at once is not asked twice. */
export async function onboardingFacts(scope: AssistantScope, sql: Sql = db()): Promise<{
  userName: string | null; languageChosen: boolean; firstMemory: boolean;
  assistantNamed: boolean; notificationPrompted: boolean;
}> {
  const { rows } = await sql.query<{
    display_name: string | null; language_style: string; notification_prompted_at: Date | null;
  }>(
    `SELECT display_name, language_style, notification_prompted_at FROM users WHERE id = $1`,
    [scope.userId],
  );
  const user = rows[0];
  const { rows: assistantRows } = await sql.query<{ named_by_user: boolean }>(
    `SELECT named_by_user FROM assistants WHERE user_id = $1 AND id = $2`,
    [scope.userId, scope.assistantId],
  );
  const { rows: memoryRows } = await sql.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM memories WHERE assistant_id = $1 AND deleted_at IS NULL`,
    [scope.assistantId],
  );
  return {
    userName: user?.display_name ?? null,
    languageChosen: (user?.language_style ?? 'auto') !== 'auto',
    firstMemory: (memoryRows[0]?.n ?? 0) > 0,
    assistantNamed: assistantRows[0]?.named_by_user ?? false,
    notificationPrompted: (user?.notification_prompted_at ?? null) !== null,
  };
}

export async function setMood(scope: AssistantScope, mood: 'warm' | 'quiet' | 'neutral', signals: unknown, sql: Sql = db()): Promise<void> {
  await sql.query(
    `UPDATE assistant_state SET mood = $2, mood_signals = $3, updated_at = now() WHERE assistant_id = $1`,
    [scope.assistantId, mood, JSON.stringify(signals ?? {})],
  );
}
