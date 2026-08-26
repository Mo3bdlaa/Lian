// Life data — tasks, notes, money, health.  USER-scoped (Q2).
import type { Sql } from '../client.ts';
import { db } from '../client.ts';
import type { UserScope } from '../scope.ts';

// ── tasks ─────────────────────────────────────────────────────────────────
export type TaskKind = 'task' | 'habit';
export type Task = {
  id: string; kind: TaskKind; title: string; dueOn: string | null;
  recurrence: unknown | null; completedAt: Date | null; originMessageId: string | null;
};
type TaskRow = {
  id: string; kind: TaskKind; title: string; due_on: string | null;
  recurrence: unknown | null; completed_at: Date | null; origin_message_id: string | null;
};
const TASK_COLUMNS = 'id, kind, title, due_on, recurrence, completed_at, origin_message_id';
const toTask = (r: TaskRow): Task => ({
  id: r.id, kind: r.kind, title: r.title, dueOn: r.due_on, recurrence: r.recurrence,
  completedAt: r.completed_at, originMessageId: r.origin_message_id,
});

export async function createTask(
  scope: UserScope,
  input: { kind?: TaskKind; title: string; dueOn?: string | null; recurrence?: unknown; originMessageId?: string | null; originAssistantId?: string | null },
  sql: Sql = db(),
): Promise<Task> {
  const { rows } = await sql.query<TaskRow>(
    `INSERT INTO tasks (user_id, kind, title, due_on, recurrence, origin_message_id, origin_assistant_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${TASK_COLUMNS}`,
    [scope.userId, input.kind ?? 'task', input.title, input.dueOn ?? null,
     input.recurrence === undefined ? null : JSON.stringify(input.recurrence),
     input.originMessageId ?? null, input.originAssistantId ?? null],
  );
  return toTask(rows[0]!);
}

export async function dueOn(scope: UserScope, day: string, sql: Sql = db()): Promise<Task[]> {
  const { rows } = await sql.query<TaskRow>(
    `SELECT ${TASK_COLUMNS} FROM tasks
     WHERE user_id = $1 AND deleted_at IS NULL AND completed_at IS NULL
       AND (due_on = $2::date OR (kind = 'habit' AND recurrence IS NOT NULL))
     ORDER BY due_on NULLS LAST, created_at`,
    [scope.userId, day],
  );
  return rows.map(toTask);
}

/** Day-specific completion (PRD §6.4).  Completing a habit today says nothing
 *  about tomorrow, and there is no streak anywhere to imply otherwise. */
export async function completeOnDay(scope: UserScope, taskId: string, day: string, sql: Sql = db()): Promise<boolean> {
  const { rowCount } = await sql.query(
    `INSERT INTO task_completions (task_id, user_id, day)
     SELECT id, user_id, $3::date FROM tasks WHERE id = $2 AND user_id = $1 AND deleted_at IS NULL
     ON CONFLICT DO NOTHING`,
    [scope.userId, taskId, day],
  );
  return (rowCount ?? 0) > 0;
}

export async function completionsOn(scope: UserScope, day: string, sql: Sql = db()): Promise<string[]> {
  const { rows } = await sql.query<{ task_id: string }>(
    `SELECT task_id FROM task_completions WHERE user_id = $1 AND day = $2::date`,
    [scope.userId, day],
  );
  return rows.map((r) => r.task_id);
}

export async function deleteTask(scope: UserScope, taskId: string, sql: Sql = db()): Promise<boolean> {
  const { rowCount } = await sql.query(
    `UPDATE tasks SET deleted_at = now() WHERE user_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [scope.userId, taskId],
  );
  return (rowCount ?? 0) > 0;
}

export async function allTasks(scope: UserScope, sql: Sql = db()): Promise<Task[]> {
  const { rows } = await sql.query<TaskRow>(
    `SELECT ${TASK_COLUMNS} FROM tasks WHERE user_id = $1 AND deleted_at IS NULL ORDER BY created_at`,
    [scope.userId],
  );
  return rows.map(toTask);
}

export async function purgeTasks(scope: UserScope, sql: Sql = db()): Promise<void> {
  await sql.query(`DELETE FROM tasks WHERE user_id = $1`, [scope.userId]);
}

// ── money ─────────────────────────────────────────────────────────────────
export type Direction = 'in' | 'out';
export type Transaction = {
  id: string; direction: Direction; amountMinor: number; currency: string;
  category: string | null; occurredOn: string; note: string | null; originMessageId: string | null;
};
type TxRow = {
  id: string; direction: Direction; amount_minor: number; currency: string;
  category: string | null; occurred_on: string; note: string | null; origin_message_id: string | null;
};
const TX_COLUMNS = 'id, direction, amount_minor, currency, category, occurred_on, note, origin_message_id';
const toTx = (r: TxRow): Transaction => ({
  id: r.id, direction: r.direction, amountMinor: r.amount_minor, currency: r.currency,
  category: r.category, occurredOn: r.occurred_on, note: r.note, originMessageId: r.origin_message_id,
});

export async function createTransaction(
  scope: UserScope,
  input: { direction: Direction; amountMinor: number; currency: string; category?: string | null; occurredOn: string; note?: string | null; originMessageId?: string | null; originAssistantId?: string | null },
  sql: Sql = db(),
): Promise<Transaction> {
  const { rows } = await sql.query<TxRow>(
    `INSERT INTO transactions (user_id, direction, amount_minor, currency, category, occurred_on, note, origin_message_id, origin_assistant_id)
     VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8, $9) RETURNING ${TX_COLUMNS}`,
    [scope.userId, input.direction, input.amountMinor, input.currency, input.category ?? null,
     input.occurredOn, input.note ?? null, input.originMessageId ?? null, input.originAssistantId ?? null],
  );
  return toTx(rows[0]!);
}

/** Money in, money out, what is left.  No budget, no bars, no charts. */
export async function monthSummary(
  scope: UserScope,
  month: string,
  sql: Sql = db(),
): Promise<{ inMinor: number; outMinor: number; leftMinor: number; topCategories: { category: string; totalMinor: number }[] }> {
  const { rows } = await sql.query<{ direction: Direction; total: number }>(
    `SELECT direction, sum(amount_minor)::bigint AS total FROM transactions
     WHERE user_id = $1 AND deleted_at IS NULL AND to_char(occurred_on, 'YYYY-MM') = $2
     GROUP BY direction`,
    [scope.userId, month],
  );
  const inMinor = rows.find((r) => r.direction === 'in')?.total ?? 0;
  const outMinor = rows.find((r) => r.direction === 'out')?.total ?? 0;
  const { rows: categories } = await sql.query<{ category: string; total: number }>(
    `SELECT coalesce(category, 'other') AS category, sum(amount_minor)::bigint AS total FROM transactions
     WHERE user_id = $1 AND deleted_at IS NULL AND direction = 'out' AND to_char(occurred_on, 'YYYY-MM') = $2
     GROUP BY 1 ORDER BY 2 DESC LIMIT 4`,
    [scope.userId, month],
  );
  return {
    inMinor, outMinor, leftMinor: inMinor - outMinor,
    topCategories: categories.map((c) => ({ category: c.category, totalMinor: c.total })),
  };
}

export async function deleteTransaction(scope: UserScope, id: string, sql: Sql = db()): Promise<boolean> {
  const { rowCount } = await sql.query(
    `UPDATE transactions SET deleted_at = now() WHERE user_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [scope.userId, id],
  );
  return (rowCount ?? 0) > 0;
}

export async function allTransactions(scope: UserScope, sql: Sql = db()): Promise<Transaction[]> {
  const { rows } = await sql.query<TxRow>(
    `SELECT ${TX_COLUMNS} FROM transactions WHERE user_id = $1 AND deleted_at IS NULL ORDER BY occurred_on DESC`,
    [scope.userId],
  );
  return rows.map(toTx);
}

export async function purgeTransactions(scope: UserScope, sql: Sql = db()): Promise<void> {
  await sql.query(`DELETE FROM transactions WHERE user_id = $1`, [scope.userId]);
}

// ── notes ─────────────────────────────────────────────────────────────────
export type Note = {
  id: string; title: string | null; body: string; topic: string | null;
  originMessageId: string | null; createdAt: Date;
};
type NoteRow = { id: string; title: string | null; body: string; topic: string | null; origin_message_id: string | null; created_at: Date };
const NOTE_COLUMNS = 'id, title, body, topic, origin_message_id, created_at';
const toNote = (r: NoteRow): Note => ({
  id: r.id, title: r.title, body: r.body, topic: r.topic, originMessageId: r.origin_message_id, createdAt: r.created_at,
});

export async function createNote(
  scope: UserScope,
  input: { title?: string | null; body: string; topic?: string | null; originMessageId?: string | null; originAssistantId?: string | null },
  sql: Sql = db(),
): Promise<Note> {
  const { rows } = await sql.query<NoteRow>(
    `INSERT INTO notes (user_id, title, body, topic, origin_message_id, origin_assistant_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${NOTE_COLUMNS}`,
    [scope.userId, input.title ?? null, input.body, input.topic ?? null, input.originMessageId ?? null, input.originAssistantId ?? null],
  );
  return toNote(rows[0]!);
}

export async function recentNotes(scope: UserScope, limit: number, sql: Sql = db()): Promise<Note[]> {
  const { rows } = await sql.query<NoteRow>(
    `SELECT ${NOTE_COLUMNS} FROM notes WHERE user_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT $2`,
    [scope.userId, limit],
  );
  return rows.map(toNote);
}

export async function allNotes(scope: UserScope, sql: Sql = db()): Promise<Note[]> {
  const { rows } = await sql.query<NoteRow>(
    `SELECT ${NOTE_COLUMNS} FROM notes WHERE user_id = $1 AND deleted_at IS NULL ORDER BY created_at`,
    [scope.userId],
  );
  return rows.map(toNote);
}

export async function purgeNotes(scope: UserScope, sql: Sql = db()): Promise<void> {
  await sql.query(`DELETE FROM notes WHERE user_id = $1`, [scope.userId]);
}

// ── health ────────────────────────────────────────────────────────────────
// PRD §6.6: conversational context, not a tracker.  There is nothing here to
// compute a score from, by design — no calories, no macros, no grades.
export type HealthKind = 'meal' | 'workout' | 'medication';
export type HealthEntry = {
  id: string; kind: HealthKind; description: string; occurredAt: Date;
  durationMinutes: number | null; originMessageId: string | null;
};
type HealthRow = {
  id: string; kind: HealthKind; description: string; occurred_at: Date;
  duration_minutes: number | null; origin_message_id: string | null;
};
const HEALTH_COLUMNS = 'id, kind, description, occurred_at, duration_minutes, origin_message_id';
const toHealth = (r: HealthRow): HealthEntry => ({
  id: r.id, kind: r.kind, description: r.description, occurredAt: r.occurred_at,
  durationMinutes: r.duration_minutes, originMessageId: r.origin_message_id,
});

export async function createHealthEntry(
  scope: UserScope,
  input: { kind: HealthKind; description: string; occurredAt: Date; durationMinutes?: number | null; originMessageId?: string | null; originAssistantId?: string | null },
  sql: Sql = db(),
): Promise<HealthEntry> {
  const { rows } = await sql.query<HealthRow>(
    `INSERT INTO health_entries (user_id, kind, description, occurred_at, duration_minutes, origin_message_id, origin_assistant_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${HEALTH_COLUMNS}`,
    [scope.userId, input.kind, input.description, input.occurredAt, input.durationMinutes ?? null,
     input.originMessageId ?? null, input.originAssistantId ?? null],
  );
  return toHealth(rows[0]!);
}

/** The week view (UI-UX §26.2): meals, workouts and medication together. */
export async function healthWeek(scope: UserScope, from: Date, to: Date, sql: Sql = db()): Promise<HealthEntry[]> {
  const { rows } = await sql.query<HealthRow>(
    `SELECT ${HEALTH_COLUMNS} FROM health_entries
     WHERE user_id = $1 AND deleted_at IS NULL AND occurred_at >= $2 AND occurred_at < $3
     ORDER BY occurred_at`,
    [scope.userId, from, to],
  );
  return rows.map(toHealth);
}

export async function allHealth(scope: UserScope, sql: Sql = db()): Promise<HealthEntry[]> {
  const { rows } = await sql.query<HealthRow>(
    `SELECT ${HEALTH_COLUMNS} FROM health_entries WHERE user_id = $1 AND deleted_at IS NULL ORDER BY occurred_at`,
    [scope.userId],
  );
  return rows.map(toHealth);
}

export async function purgeHealth(scope: UserScope, sql: Sql = db()): Promise<void> {
  await sql.query(`DELETE FROM health_entries WHERE user_id = $1`, [scope.userId]);
}

// ── attachments ───────────────────────────────────────────────────────────
/** What object storage still holds for a user.  Counted for the deletion
 *  report so an unwired storage backend is visible rather than looking like
 *  a clean sweep. */
export async function attachmentCount(scope: UserScope, sql: Sql = db()): Promise<number> {
  const { rows } = await sql.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM attachments WHERE user_id = $1`,
    [scope.userId],
  );
  return rows[0]?.n ?? 0;
}
