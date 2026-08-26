// Corrections.
//
// UI-UX §4: every capture is tappable and correctable.  This is the write
// side of that tap, and it is deliberately narrow — a correction changes the
// fields a person can see on the card, and nothing else.
//
// The whitelist is the point.  A PATCH body arrives from a client, and the
// alternative to a per-kind field table is building SQL from keys someone
// else chose.  Fields not in the table are refused by name rather than
// ignored, because a correction that silently does nothing is worse than one
// that fails.
import type { Sql } from '../client.ts';
import { db } from '../client.ts';
import type { AssistantScope, UserScope } from '../scope.ts';

export type CorrectionKind = 'tasks' | 'transactions' | 'notes' | 'health' | 'memories';
export type CorrectionResult = { readonly ok: boolean; readonly reason?: string };

type Coerce = (value: unknown) => unknown;

const text: Coerce = (value) => {
  if (typeof value !== 'string' || value.trim() === '') throw new Error('must be text');
  if (value.length > 4_000) throw new Error('is too long');
  return value.trim();
};
const nullableText: Coerce = (value) => (value === null ? null : text(value));
const date: Coerce = (value) => {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('must be a date like 2026-05-18');
  return value;
};
const timestamp: Coerce = (value) => {
  if (typeof value !== 'string') throw new Error('must be a time');
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error('must be a time');
  return parsed;
};
const positiveInt: Coerce = (value) => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) throw new Error('must be a whole number above zero');
  return value;
};
const nullablePositiveInt: Coerce = (value) => (value === null ? null : positiveInt(value));
const oneOf = (allowed: readonly string[]): Coerce => (value) => {
  if (typeof value !== 'string' || !allowed.includes(value)) throw new Error(`must be one of ${allowed.join(', ')}`);
  return value;
};

type FieldTable = Readonly<Record<string, { column: string; coerce: Coerce }>>;

const FIELDS: Readonly<Record<CorrectionKind, FieldTable>> = {
  tasks: {
    title: { column: 'title', coerce: text },
    dueOn: { column: 'due_on', coerce: date },
  },
  transactions: {
    // The one everybody needs: she heard four hundred and it was forty.
    amountMinor: { column: 'amount_minor', coerce: positiveInt },
    direction: { column: 'direction', coerce: oneOf(['in', 'out']) },
    category: { column: 'category', coerce: nullableText },
    occurredOn: { column: 'occurred_on', coerce: date },
    note: { column: 'note', coerce: nullableText },
  },
  notes: {
    title: { column: 'title', coerce: nullableText },
    body: { column: 'body', coerce: text },
    topic: { column: 'topic', coerce: nullableText },
  },
  health: {
    kind: { column: 'kind', coerce: oneOf(['meal', 'workout', 'medication']) },
    description: { column: 'description', coerce: text },
    occurredAt: { column: 'occurred_at', coerce: timestamp },
    durationMinutes: { column: 'duration_minutes', coerce: nullablePositiveInt },
  },
  memories: {
    // Her sentence about you, in your words instead of hers.  Nothing else on
    // a memory is a person's to set — salience is hers, and status is the
    // plan's.
    statement: { column: 'statement', coerce: text },
  },
};

const TABLE: Readonly<Record<CorrectionKind, string>> = {
  tasks: 'tasks', transactions: 'transactions', notes: 'notes',
  health: 'health_entries', memories: 'memories',
};

/** Which id a row is found by.  Memories belong to an assistant; the rest
 *  belong to the person directly. */
export function scopeOf(kind: CorrectionKind): 'user' | 'assistant' {
  return kind === 'memories' ? 'assistant' : 'user';
}

function assignments(kind: CorrectionKind, patch: Record<string, unknown>): { sql: string[]; values: unknown[] } | { reason: string } {
  const fields = FIELDS[kind];
  const sql: string[] = [];
  const values: unknown[] = [];
  for (const [name, value] of Object.entries(patch)) {
    const field = fields[name];
    if (field === undefined) return { reason: `${name} is not something you can change here` };
    try {
      values.push(field.coerce(value));
    } catch (error) {
      return { reason: `${name} ${(error as Error).message}` };
    }
    // $1 and $2 are the scope and the id; assignments start at $3.
    sql.push(`${field.column} = $${values.length + 2}`);
  }
  if (sql.length === 0) return { reason: 'there was nothing to change' };
  return { sql, values };
}

export async function correctForUser(
  scope: UserScope, kind: Exclude<CorrectionKind, 'memories'>, id: string,
  patch: Record<string, unknown>, sql: Sql = db(),
): Promise<CorrectionResult> {
  const built = assignments(kind, patch);
  if ('reason' in built) return { ok: false, reason: built.reason };
  const { rowCount } = await sql.query(
    `UPDATE ${TABLE[kind]} SET ${built.sql.join(', ')}
     WHERE user_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [scope.userId, id, ...built.values],
  );
  return (rowCount ?? 0) > 0 ? { ok: true } : { ok: false, reason: 'I cannot find that' };
}

export async function correctMemory(
  scope: AssistantScope, id: string, patch: Record<string, unknown>, sql: Sql = db(),
): Promise<CorrectionResult> {
  const built = assignments('memories', patch);
  if ('reason' in built) return { ok: false, reason: built.reason };
  const { rowCount } = await sql.query(
    `UPDATE memories SET ${built.sql.join(', ')}, updated_at = now()
     WHERE assistant_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [scope.assistantId, id, ...built.values],
  );
  return (rowCount ?? 0) > 0 ? { ok: true } : { ok: false, reason: 'I cannot find that' };
}

/** Soft delete, so a capture that was wrong stops existing for the person
 *  without stranding the capture row that points at it. */
export async function removeForUser(
  scope: UserScope, kind: Exclude<CorrectionKind, 'memories'>, id: string, sql: Sql = db(),
): Promise<boolean> {
  const { rowCount } = await sql.query(
    `UPDATE ${TABLE[kind]} SET deleted_at = now()
     WHERE user_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [scope.userId, id],
  );
  return (rowCount ?? 0) > 0;
}
