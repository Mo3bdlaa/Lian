// What the capabilities need from storage.
//
// Declared here rather than imported from @lian/db: a capability must be
// unit-testable without a database, and the boundary gate keeps the graph
// acyclic.  @lian/runtime adapts the repositories to these in one place.
export type TaskRecord = {
  id: string; kind: 'task' | 'habit'; title: string; dueOn: string | null;
  completedAt: Date | null; originMessageId: string | null;
};

export type TransactionRecord = {
  id: string; direction: 'in' | 'out'; amountMinor: number; currency: string;
  category: string | null; occurredOn: string; note: string | null; originMessageId: string | null;
};

export type NoteRecord = { id: string; title: string | null; body: string; topic: string | null; createdAt: Date };
export type HealthRecord = {
  id: string; kind: 'meal' | 'workout' | 'medication'; description: string;
  occurredAt: Date; durationMinutes: number | null;
};

export type CapabilityPorts = {
  tasks: {
    create(userId: string, input: { kind: 'task' | 'habit'; title: string; dueOn: string | null; recurrence: unknown; originMessageId: string; originAssistantId: string }): Promise<TaskRecord>;
    dueOn(userId: string, day: string): Promise<TaskRecord[]>;
    completionsOn(userId: string, day: string): Promise<string[]>;
    all(userId: string): Promise<TaskRecord[]>;
    purge(userId: string): Promise<void>;
  };
  notes: {
    create(userId: string, input: { title: string | null; body: string; topic: string | null; originMessageId: string; originAssistantId: string }): Promise<NoteRecord>;
    recent(userId: string, limit: number): Promise<NoteRecord[]>;
    all(userId: string): Promise<NoteRecord[]>;
    purge(userId: string): Promise<void>;
  };
  health: {
    create(userId: string, input: { kind: 'meal' | 'workout' | 'medication'; description: string; occurredAt: Date; durationMinutes: number | null; originMessageId: string; originAssistantId: string }): Promise<HealthRecord>;
    week(userId: string, from: Date, to: Date): Promise<HealthRecord[]>;
    all(userId: string): Promise<HealthRecord[]>;
    purge(userId: string): Promise<void>;
  };
  money: {
    create(userId: string, input: { direction: 'in' | 'out'; amountMinor: number; currency: string; category: string | null; occurredOn: string; note: string | null; originMessageId: string; originAssistantId: string }): Promise<TransactionRecord>;
    monthSummary(userId: string, month: string): Promise<{ inMinor: number; outMinor: number; leftMinor: number; topCategories: { category: string; totalMinor: number }[] }>;
    all(userId: string): Promise<TransactionRecord[]>;
    purge(userId: string): Promise<void>;
  };
};
