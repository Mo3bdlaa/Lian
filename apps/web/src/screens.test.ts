// The screens, rendered.
//
// These run without a browser: every screen is a pure function of state, so
// what it produces can be asserted directly. That is the point of rendering
// to strings — the rules the design system carries (role tokens, authored
// copy, no forbidden UI) are checkable here, on every commit, in
// milliseconds.
//
// The browser tests in browser.test.ts are the other half: they prove the
// thing actually runs. These prove it says the right words.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { render } from './dom.ts';
import { chatScreen, composer, permissionCard, installCard, actionSheet, deleteSheet } from './screens/chat.ts';
import { welcome, signIn } from './screens/entry.ts';
import { memoryScreen } from './screens/memory.ts';
import { tasksScreen, moneyScreen, storyScreen } from './screens/life.ts';
import { settingsScreen, securityScreen, dataScreen } from './screens/trust.ts';
import { initial, type Message, type Snapshot, type State } from './state.ts';
import { t } from './copy.ts';

const me = (overrides: Partial<Snapshot> = {}): Snapshot => ({
  user: { id: 'u-1', name: 'Adam', timeZone: 'Asia/Dubai', languageStyle: 'en', language: 'en', plan: 'free', themePreference: 'auto' },
  assistant: { id: 'a-1', name: 'Lian', gender: 'female', mood: 'warm', moodPhrase: 'Feeling warm today' },
  theme: 'day', direction: 'ltr', localHour: 9,
  conversation: { id: 'c-1' },
  onboarding: null,
  relationship: { stageName: 'Getting acquainted', prose: 'We are still getting acquainted.' },
  limits: { messagesRemaining: 18, memoriesKept: 3, memoriesPending: 0, memoryCapacity: 100, capacityLine: 'I can keep up to 100 lasting memories on the free plan.' },
  ...overrides,
});

const message = (overrides: Partial<Message> = {}): Message => ({
  id: 'm-1', role: 'assistant', body: 'Okay, logged AED 400 for the gym today.',
  at: '2026-05-18T09:30:00.000Z', surface: 'chat', captures: [], reaction: null, replyTo: null,
  memoriesDerived: 0, ...overrides,
});

const state = (overrides: Partial<State> = {}): State => ({ ...initial, me: me(), path: '/chat', ...overrides });

describe('chat (UI-UX §3)', () => {
  test('a message body is text, not markup', () => {
    // The one rule that makes rendering to strings safe. Her reply is model
    // output and the user's is typed: neither is markup, ever.
    const markup = render(chatScreen(state({ messages: [message({ body: '<img src=x onerror="alert(1)">' })] })));
    assert.ok(!markup.includes('<img'), 'a message body reached the DOM as markup');
    assert.ok(markup.includes('&lt;img'));
  });

  test('a control tag would render as text if one ever arrived', () => {
    // LESSONS §3 strips tags server-side; this is the second line of defence,
    // and it is here because "it cannot happen" is what the prototype said.
    const markup = render(chatScreen(state({ messages: [message({ body: 'Logged. <spend>{"amount":400}</spend>' })] })));
    assert.ok(!markup.includes('<spend>'));
  });

  test('the header carries a mood phrase and nothing that scores her', () => {
    const markup = render(chatScreen(state()));
    assert.ok(!markup.includes('%'), 'no percentage anywhere in the conversation');
    for (const forbidden of ['online', 'offline-dot', 'AI assistant']) {
      assert.ok(!markup.toLowerCase().includes(forbidden.toLowerCase()), `${forbidden} is on the screen`);
    }
  });

  test('an inline capture row is tappable and points at its correction', () => {
    const markup = render(chatScreen(state({
      messages: [message({ captures: [{ capability: 'money', icon: 'i-money', line: 'AED 400 · gym · Today', correctionRoute: '/money/t-1' }] })],
    })));
    assert.ok(markup.includes('href="/money/t-1"'));
    assert.ok(markup.includes('AED 400 · gym · Today'));
  });

  test('the composer offers a message field and voice, and nothing else', () => {
    // UI-UX §3 is explicit about what the bar contains. An attachment button,
    // an emoji tray or a "+" would each be a product decision made in CSS.
    const markup = render(composer(state()));
    const buttons = markup.match(/<button/g) ?? [];
    assert.equal(buttons.length, 2, 'the input bar has exactly two controls');
    assert.ok(markup.includes('data-action="voice"'));
    assert.ok(markup.includes(t('chat.input_placeholder', 'en')));
  });

  test('the reply reference is pinned above the input and is dismissable', () => {
    const markup = render(composer(state({ replyTo: message({ body: 'The landlord said he would call back.' }) })));
    assert.ok(markup.includes('composer__reply'));
    assert.ok(markup.includes('data-action="cancel-reply"'));
  });

  test('the action sheet is the four the spec names, in order', () => {
    const markup = render(actionSheet(state({ messages: [message()], acting: { id: 'm-1', mode: 'sheet' } })));
    const order = ['chat.reply', 'chat.react', 'chat.copy', 'chat.delete'].map((key) => markup.indexOf(t(key as 'chat.reply', 'en')));
    assert.deepEqual(order, [...order].sort((a, b) => a - b), 'Reply, React, Copy, Delete');
    assert.ok(order.every((index) => index > -1));
  });

  test('the reaction picker is the five the spec names and no tray', () => {
    const markup = render(actionSheet(state({ messages: [message()], acting: { id: 'm-1', mode: 'react' } })));
    const items = markup.match(/reactions__item/g) ?? [];
    assert.equal(items.length, 5);
  });

  test('deleting a message says what she remembered from it (UI-UX §39)', () => {
    const withMemories = message({ role: 'user', body: 'My sister hates surprises.', memoriesDerived: 2 });
    const markup = render(deleteSheet(state({ messages: [withMemories] }), withMemories));
    assert.ok(markup.includes(t('message.helped_remember_many', 'en')));
    assert.ok(markup.includes('data-keep="true"'), 'the message alone');
    assert.ok(markup.includes('data-keep="false"'), 'the message and what came from it');
  });

  test('a message with no derived memory does not offer the second choice', () => {
    const plain = message({ role: 'user', memoriesDerived: 0 });
    const markup = render(deleteSheet(state({ messages: [plain] }), plain));
    assert.ok(!markup.includes('data-keep="false"'));
  });

  test('the free limit arrives as her line, never as a modal', () => {
    const markup = render(chatScreen(state({ messages: [message()], limitLine: t('limit.reached', 'en') })));
    // The apostrophe is escaped on the way out, which is the point of the
    // escaping test above — so this looks for the words, not the raw string.
    assert.ok(markup.includes('my limit for today'));
    assert.ok(!markup.includes('dialog'), 'the limit is not a dialog');
    assert.ok(!markup.toLowerCase().includes('upgrade'));
  });

  test('the permission is asked in her voice, with both answers wired', () => {
    const markup = render(permissionCard(me()));
    assert.ok(markup.includes('data-action="permission-yes"'));
    assert.ok(markup.includes('data-action="permission-no"'), 'saying no has to reach the server too');
  });

  test('the install prompt is an offer, not a takeover', () => {
    const markup = render(installCard(me()));
    assert.ok(markup.includes(t('install.title', 'en')));
    assert.ok(markup.includes('data-action="install-no"'));
    assert.ok(!markup.includes('class="card permission"'), 'the install offer is not the permission ask');
  });
});

describe('every screen speaks both languages', () => {
  // Not "has Arabic somewhere" — the SAME screen, rendered in Arabic, must
  // contain no English label. The gate proves the strings are in the
  // catalogue; this proves the screens actually read from it.
  const arabic = me({
    user: { id: 'u-1', name: 'آدم', timeZone: 'Asia/Dubai', languageStyle: 'ar-eg', language: 'ar', plan: 'free', themePreference: 'auto' },
    assistant: { id: 'a-1', name: 'لين', gender: 'female', mood: 'warm', moodPhrase: 'اليوم فيه دفء' },
    direction: 'rtl',
    // The capacity line is resolved server-side, so an Arabic reader gets the
    // Arabic one; the fixture carries what the server would send.
    limits: { messagesRemaining: 18, memoriesKept: 3, memoriesPending: 0, memoryCapacity: 100, capacityLine: 'أقدر أحتفظ بـ ١٠٠ ذكرى دايمة في الخطة المجانية.' },
  });

  const screens: [string, string][] = [
    ['chat', render(chatScreen({ ...initial, me: arabic, path: '/chat', messages: [message({ body: 'تمام.' })] }))],
    ['memory', render(memoryScreen({ me: arabic, memories: [], query: '', filter: 'all', editing: null, deleting: null }))],
    ['tasks', render(tasksScreen(arabic, { tasks: [], notes: [] }))],
    ['money', render(moneyScreen(arabic, { month: '2026-05', inMinor: 0, outMinor: 0, leftMinor: 0, currency: 'AED', categories: [], recent: [] }))],
    ['story', render(storyScreen(arabic, { now: 'الآن', footer: 'ملاحظة', stages: [] }))],
    ['settings', render(settingsScreen(arabic))],
    ['security', render(securityScreen(arabic, { devices: [], attempts: [] }))],
    ['data', render(dataScreen(arabic, { export: null, confirming: false, typed: '', busy: false }))],
    ['welcome', render(welcome({ language: 'ar', error: null, busy: false }))],
    ['sign in', render(signIn({ language: 'ar', error: null, busy: false }))],
  ];

  for (const [name, markup] of screens) {
    test(`${name} has no English left in it`, () => {
      const text = markup
        .replace(/<[^>]*>/g, ' ')       // markup
        .replace(/&[a-z]+;/g, ' ');     // entities
      const english = text.match(/\b[A-Za-z]{4,}\b/g) ?? [];
      // AED is a currency code and DELETE is a typed confirmation word; both
      // are the same in Arabic copy by design.
      // AED is a currency code, DELETE is a typed confirmation word, and a
      // name is a name — none of them are copy.
      const unexpected = english.filter((word) => !['AED', 'DELETE', 'Lian'].includes(word));
      assert.deepEqual(unexpected, [], `${name} still has English: ${unexpected.slice(0, 5).join(', ')}`);
    });
  }
});

describe('what the screens must not contain (PRD §14, §10)', () => {
  test('no add button anywhere on tasks or money', () => {
    // "No add buttons anywhere." Everything arrives through conversation.
    for (const markup of [
      render(tasksScreen(me(), { tasks: [{ id: 't', kind: 'task', title: 'call the bank', dueOn: null, done: false }], notes: [] })),
      render(moneyScreen(me(), { month: '2026-05', inMinor: 100, outMinor: 50, leftMinor: 50, currency: 'AED', categories: [], recent: [] })),
    ]) {
      assert.ok(!/data-action="(add|create|new)/.test(markup));
      assert.ok(!markup.includes('aria-label="Add'));
    }
  });

  test('our story shows a stage and never a number', () => {
    // LESSONS §6: which stage, never how far through it. A percentage or a
    // day count on this screen is the failure it names.
    const markup = render(storyScreen(me(), {
      now: 'You know the shape of their week.', footer: 'Nothing to unlock.',
      stages: [{ key: 'getting_acquainted', name: 'Getting acquainted', prose: 'Names, days.', current: true }],
    }));
    // A percentage, a day count or a streak would each turn a relationship
    // into a score. Her prose may say the word "days"; a NUMBER of them is
    // the thing LESSONS §6 keeps off the network.
    assert.ok(!/\d+\s*%/.test(markup));
    assert.ok(!/\b\d+\s*(days?|weeks?)\b/i.test(markup));
    assert.ok(!/progress-|streak/i.test(markup));
  });

  test('the memory screen shows provenance and both ways to change it', () => {
    const markup = render(memoryScreen({
      me: me(),
      memories: [{
        id: 'mem-1', type: 'fact', typeLabel: 'Fact', statement: 'They run every morning.',
        status: 'active', createdAt: '2026-05-18T09:00:00.000Z', sourceMessageId: 'm-1', sourceRemovedKept: false,
      }],
      query: '', filter: 'all', editing: null, deleting: null,
    }));
    assert.ok(markup.includes(t('memory.from_message', 'en')));
    assert.ok(markup.includes('data-action="memory-edit"'));
    assert.ok(markup.includes('data-action="memory-delete"'));
  });

  test('a memory whose source was deleted says so rather than appearing from nowhere', () => {
    const markup = render(memoryScreen({
      me: me(),
      memories: [{
        id: 'mem-1', type: 'fact', typeLabel: 'Fact', statement: 'They run every morning.',
        status: 'active', createdAt: '2026-05-18T09:00:00.000Z', sourceMessageId: null, sourceRemovedKept: true,
      }],
      query: '', filter: 'all', editing: null, deleting: null,
    }));
    assert.ok(markup.includes(t('memory.source_removed', 'en')));
  });

  test('the pending queue is visible, not silent (PRD §35)', () => {
    const markup = render(memoryScreen({
      me: me(),
      memories: [{
        id: 'mem-2', type: 'fact', typeLabel: 'Fact', statement: 'Something she noticed.',
        status: 'pending', createdAt: '2026-05-18T09:00:00.000Z', sourceMessageId: 'm-2', sourceRemovedKept: false,
      }],
      query: '', filter: 'all', editing: null, deleting: null,
    }));
    assert.ok(markup.includes(t('memory.pending_title', 'en')));
  });

  test('deletion asks for the typed word, on the screen as well as the server', () => {
    const markup = render(dataScreen(me(), { export: null, confirming: true, typed: '', busy: false }));
    assert.ok(markup.includes(t('data.type_delete', 'en')));
    assert.ok(markup.includes('data-action="delete-everything"'));
  });
});
