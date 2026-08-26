// Fakes for the assembly path.  The whole point of loading through ports is
// that the golden snapshots cost nothing to run — no database, no clock.
import type { PromptPorts } from './ports.ts';
import type { AssistantContext, UserContext, RelationshipContext, ConversationContext } from './context.ts';

export const FIXED_NOW = new Date('2026-05-18T06:30:00.000Z');

export const ASSISTANT: AssistantContext = {
  id: 'a-1', name: 'Lian', gender: 'female', languageStyle: 'auto',
  personality: { warmth: 'high', playfulness: 'mid', proactivity: 'high', directness: 'mid', encouragement: 'low' },
};

export const USER: UserContext = { id: 'u-1', timeZone: 'Asia/Dubai', languageStyle: 'en', plan: 'free' };

export const RELATIONSHIP: RelationshipContext = {
  stage: 3,
  stageProse: 'You know each other well enough now that you can notice patterns without needing things explained again.',
};

export const MAIN_CONVERSATION: ConversationContext = { id: 'c-1', kind: 'main', retention: 'persist', scenarioText: null };

export const INCOGNITO_CONVERSATION: ConversationContext = {
  id: 'c-2', kind: 'incognito', retention: 'ephemeral',
  scenarioText: 'Act as an interviewer for a senior RPA role.',
};

export type FakeOverrides = Partial<PromptPorts>;

export function fakePorts(overrides: FakeOverrides = {}): PromptPorts {
  const base: PromptPorts = {
    loadAssistant: async () => ASSISTANT,
    loadUser: async () => USER,
    loadRelationship: async () => RELATIONSHIP,
    loadMood: async () => 'warm',
    loadConversation: async (_a, id) => (id === 'c-2' ? INCOGNITO_CONVERSATION : MAIN_CONVERSATION),
    loadEarlier: async () => null,
    loadOnboarding: async () => null,
    loadCanon: async () => [
      { statement: 'You do not drink coffee — you said tea, and only in the morning.' },
      { statement: 'You told them you find late nights easier for thinking.' },
    ],
    loadMemories: async () => [
      { type: 'topic', statement: 'The Thursday presentation has been making them tense.', when: 'May 14' },
      { type: 'person', statement: 'Their sister is called Dana; they call her on Sundays.', when: 'April 2' },
    ],
    loadProfile: async () => [{ section: 'about', body: 'I work in operations and I am tired of tools.' }],
    contributeCapabilities: async () => [
      {
        id: 'tasks', ability: 'Keep track of what they said they would do, and remind them.',
        state: '2 things are due today.',
        tags: [{ name: '<todo>', usage: '{"title":"return the book","due":"2026-05-19"} — something they said they will do' }],
      },
      {
        id: 'money', ability: 'Note what they spend when they mention it, or from a receipt photo.',
        state: null,
        tags: [{ name: '<spend>', usage: '{"amount":400,"currency":"AED","category":"gym"} — an amount they told you about' }],
      },
    ],
    messagesRemaining: async () => 22,
  };
  return { ...base, ...overrides };
}
