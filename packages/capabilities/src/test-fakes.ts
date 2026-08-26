import type { CapabilityPorts, TaskRecord, TransactionRecord, NoteRecord, HealthRecord } from './ports.ts';

export function fakePorts(): CapabilityPorts & {
  taskRows: TaskRecord[]; txRows: TransactionRecord[]; noteRows: NoteRecord[];
  healthRows: HealthRecord[]; identityRows: Record<string, unknown>;
} {
  const taskRows: TaskRecord[] = [];
  const txRows: TransactionRecord[] = [];
  const noteRows: NoteRecord[] = [];
  const healthRows: HealthRecord[] = [];
  const completions = new Map<string, Set<string>>();
  let n = 0;
  const identityRows: Record<string, unknown> = {};
  return {
    taskRows, txRows, noteRows, healthRows, identityRows,
    tasks: {
      async create(_userId, input) {
        const row: TaskRecord = { id: `t${++n}`, kind: input.kind, title: input.title, dueOn: input.dueOn, recurrence: input.recurrence, completedAt: null, originMessageId: input.originMessageId };
        taskRows.push(row);
        return row;
      },
      async dueOn(_userId, day) { return taskRows.filter((t) => t.dueOn === day || t.kind === 'habit'); },
      async completionsOn(_userId, day) { return [...(completions.get(day) ?? [])]; },
      async all() { return taskRows; },
      async purge() { taskRows.length = 0; },
    },
    identity: {
      async setUserName(userId, name) { identityRows[`user:${userId}:name`] = name; },
      async setLanguage(userId, style) { identityRows[`user:${userId}:language`] = style; },
      async setAssistantName(assistantId, name, chosenByThem) {
        identityRows[`assistant:${assistantId}:name`] = name;
        identityRows[`assistant:${assistantId}:chosenByThem`] = chosenByThem;
      },
      async exportFor() { return [identityRows]; },
    },
    notes: {
      async create(_userId, input) {
        const row: NoteRecord = { id: `n${++n}`, title: input.title, body: input.body, topic: input.topic, createdAt: new Date(2026, 4, 18) };
        noteRows.push(row);
        return row;
      },
      async recent(_userId, limit) { return noteRows.slice(-limit).reverse(); },
      async all() { return noteRows; },
      async purge() { noteRows.length = 0; },
    },
    health: {
      async create(_userId, input) {
        const row: HealthRecord = {
          id: `h${++n}`, kind: input.kind, description: input.description,
          occurredAt: input.occurredAt, durationMinutes: input.durationMinutes,
        };
        healthRows.push(row);
        return row;
      },
      async week(_userId, from, to) { return healthRows.filter((e) => e.occurredAt >= from && e.occurredAt < to); },
      async all() { return healthRows; },
      async purge() { healthRows.length = 0; },
    },
    money: {
      async create(_userId, input) {
        const row: TransactionRecord = {
          id: `x${++n}`, direction: input.direction, amountMinor: input.amountMinor, currency: input.currency,
          category: input.category, occurredOn: input.occurredOn, note: input.note, originMessageId: input.originMessageId,
        };
        txRows.push(row);
        return row;
      },
      async monthSummary(_userId, month) {
        const rows = txRows.filter((t) => t.occurredOn.startsWith(month));
        const inMinor = rows.filter((r) => r.direction === 'in').reduce((s, r) => s + r.amountMinor, 0);
        const outMinor = rows.filter((r) => r.direction === 'out').reduce((s, r) => s + r.amountMinor, 0);
        return { inMinor, outMinor, leftMinor: inMinor - outMinor, topCategories: [] };
      },
      async all() { return txRows; },
      async purge() { txRows.length = 0; },
    },
  };
}
