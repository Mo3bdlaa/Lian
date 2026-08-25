import type { CapabilityPorts, TaskRecord, TransactionRecord } from './ports.ts';

export function fakePorts(): CapabilityPorts & { taskRows: TaskRecord[]; txRows: TransactionRecord[] } {
  const taskRows: TaskRecord[] = [];
  const txRows: TransactionRecord[] = [];
  const completions = new Map<string, Set<string>>();
  let n = 0;
  return {
    taskRows, txRows,
    tasks: {
      async create(_userId, input) {
        const row: TaskRecord = { id: `t${++n}`, kind: input.kind, title: input.title, dueOn: input.dueOn, completedAt: null, originMessageId: input.originMessageId };
        taskRows.push(row);
        return row;
      },
      async dueOn(_userId, day) { return taskRows.filter((t) => t.dueOn === day || t.kind === 'habit'); },
      async completionsOn(_userId, day) { return [...(completions.get(day) ?? [])]; },
      async all() { return taskRows; },
      async purge() { taskRows.length = 0; },
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
