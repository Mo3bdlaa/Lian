// Scope.
//
// Q2 decision, as two types: life data belongs to the user, memory and
// identity belong to the assistant.  Repositories take a scope object rather
// than a bare id so that "which assistant is this?" is never a parameter a
// caller can forget, and tools/gates/db-scoping.ts fails the build on a query
// against a scoped table that does not filter on its scope column.
//
// LESSONS §11: "access paths that read one user's data from another context
// are a deliberate decision with legal weight."  There is no unscoped read of
// a scoped table in this package, and adding one is a build failure rather
// than a review comment.
export type UserScope = { readonly userId: string };

export type AssistantScope = UserScope & { readonly assistantId: string };

/** Tables keyed to a single user. */
export const USER_SCOPED_TABLES = [
  // an assistant row belongs to a user; the assistant scope starts below it
  'assistants',
  'attachments', 'profile_notes', 'tasks', 'task_completions', 'notes', 'transactions',
  'health_entries', 'captures', 'push_subscriptions', 'quiet_hours', 'devices', 'sessions',
  'device_confirmations', 'usage_counters',
] as const;

/** Tables keyed to a single assistant. */
export const ASSISTANT_SCOPED_TABLES = [
  'assistant_state', 'relationship', 'conversations', 'messages',
  'memories', 'canon', 'story_events', 'conversation_summaries', 'reflections',
] as const;

/** Tables with no scope column, by decision rather than omission. */
export const UNSCOPED_TABLES = [
  'users',              // the scope root itself
  'schema_migrations',  // infrastructure
  'api_key_pool',       // process-wide provider state, no user in it
  'tts_cache',          // keyed by content hash; holds no user reference
  'events',             // user_id is nullable: pre-signup events are real events
  'outreach',           // carries BOTH user_id and assistant_id; see repositories/outreach.ts
  'sign_in_attempts',   // an attempt on an unknown email has no user yet
] as const;
