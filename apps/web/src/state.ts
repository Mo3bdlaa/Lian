// What the app knows.
//
// One object, replaced rather than mutated, with subscribers. Small enough
// that a framework would be the larger thing.
import type { Language } from './format.ts';

export type Snapshot = {
  user: { id: string; name: string | null; timeZone: string; languageStyle: string; language: Language; plan: 'free' | 'paid'; themePreference: string };
  assistant: { id: string; name: string; gender: 'female' | 'male'; mood: string; moodPhrase: string };
  theme: string;
  direction: 'ltr' | 'rtl';
  localHour: number;
  conversation: { id: string } | null;
  onboarding: { step: string } | null;
  relationship: { stageName: string; prose: string };
  limits: { messagesRemaining: number; memoriesKept: number; memoriesPending: number; memoryCapacity: number; capacityLine: string };
};

export type Capture = { capability: string; icon: string; line: string; correctionRoute: string };

export type Message = {
  id: string;
  role: 'user' | 'assistant';
  body: string;
  at: string;
  surface: string | null;
  captures: Capture[];
  reaction: string | null;
  replyTo: { id: string; role: string; body: string } | null;
  memoriesDerived: number;
  /** What came with it. The bytes are fetched from /api/attachments/:id,
   *  which redirects to a URL that expires — there is no durable link. */
  attachments: { id: string; kind: string; contentType: string }[];
  /** Client-only, while a turn is in flight. */
  pending?: 'sending' | 'streaming' | 'failed' | undefined;
};

export type State = {
  readonly me: Snapshot | null;
  readonly path: string;
  readonly messages: Message[];
  readonly hasOlder: boolean;
  /** The message being replied to (UI-UX §35), pinned above the input. */
  readonly replyTo: Message | null;
  /** The message whose action sheet or reaction picker is open. */
  readonly acting: { id: string; mode: 'sheet' | 'react' } | null;
  readonly drawerOpen: boolean;
  readonly offline: boolean;
  /** Her line when the day's messages are used up (PRD §11) — a message in
   *  the conversation, never a modal. */
  readonly limitLine: string | null;
  readonly screen: unknown;
  readonly busy: boolean;
  readonly error: string | null;
};

export const initial: State = {
  me: null, path: '/', messages: [], hasOlder: false, replyTo: null, acting: null,
  drawerOpen: false, offline: false, limitLine: null, screen: null, busy: false, error: null,
};

let state: State = initial;
const listeners = new Set<(state: State) => void>();

export const current = (): State => state;

export function set(patch: Partial<State>): State {
  state = { ...state, ...patch };
  for (const listener of listeners) listener(state);
  return state;
}

export function subscribe(listener: (state: State) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Tests run many scenarios in one process; the store is module state. */
export function reset(): void {
  state = initial;
  listeners.clear();
}
