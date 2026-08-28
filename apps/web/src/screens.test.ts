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
import { welcome, signIn, consent, legalScreen } from './screens/entry.ts';
import { memoryScreen } from './screens/memory.ts';
import { tasksScreen, moneyScreen, storyScreen } from './screens/life.ts';
import { settingsScreen, securityScreen, dataScreen } from './screens/trust.ts';
import { healthScreen, albumScreen, type Health, type Album } from './screens/album.ts';
import { dialsScreen, quietHoursScreen, languageScreen, LANGUAGE_STYLES, DIALS, STOPS, type Settings } from './screens/her.ts';
import { threadSheet, incognitoChip, scenarioSheet, type Thread } from './screens/threads.ts';
import { head } from './components/head.ts';
import { MAX_SCENARIO_LENGTH } from '@lian/domain';
import { initial, type Message, type Snapshot, type State } from './state.ts';
import { t, CONSENT_VERSION, TERMS, PRIVACY, type LegalDocument } from './copy.ts';

const me = (overrides: Partial<Snapshot> = {}): Snapshot => ({
  user: { id: 'u-1', name: 'Adam', timeZone: 'Asia/Dubai', languageStyle: 'en', language: 'en', plan: 'free', themePreference: 'auto', emailVerified: true },
  assistant: { id: 'a-1', name: 'Lian', gender: 'female', mood: 'warm', moodPhrase: 'Feeling warm today' },
  theme: 'day', direction: 'ltr', localHour: 9,
  conversation: { id: 'c-1' },
  onboarding: null,
  relationship: { stageName: 'Getting acquainted', prose: 'We are still getting acquainted.' },
  limits: { messagesRemaining: 18, messagesState: 'ok', memoriesKept: 3, memoriesPending: 0, memoryCapacity: 100, capacityLine: 'I can keep up to 100 lasting memories on the free plan.' },
  ...overrides,
});

const thread = (overrides: Partial<Thread> = {}): Thread => ({
  id: 'c-2', kind: 'incognito', title: null, retention: 'ephemeral', scenarioText: null,
  lastMessageAt: null, messages: 0, current: true, ...overrides,
});

const message = (overrides: Partial<Message> = {}): Message => ({
  id: 'm-1', role: 'assistant', body: 'Okay, logged AED 400 for the gym today.',
  at: '2026-05-18T09:30:00.000Z', surface: 'chat', captures: [], reaction: null, replyTo: null,
  memoriesDerived: 0, attachments: [], ...overrides,
});

/** dom.ts escapes text, so a raw catalogue string never matches the markup.
 *  The two entities that actually occur here are the apostrophe and the
 *  ampersand. */
const unescape_ = (markup: string): string => markup.replace(/&#39;/g, "'").replace(/&amp;/g, '&');

const state = (overrides: Partial<State> = {}): State => ({ ...initial, me: me(), path: '/chat', ...overrides });

describe('chat (UI-UX §3)', () => {
  test('a message body is text, not markup', () => {
    // The one rule that makes rendering to strings safe. Her reply is model
    // output and the user's is typed: neither is markup, ever.
    const markup = render(chatScreen(state({ messages: [message({ body: '<img src=x onerror="alert(1)">' })] })));
    assert.ok(!markup.includes('<img'), 'a message body reached the DOM as markup');
    assert.ok(markup.includes('&lt;img'));
  });

  test('the approaching-limit line appears in that state and in no other', () => {
    // UI-UX §19 asks for a "small conversational line" near the end of a free
    // day. `limit.approaching` had been authored in both languages since the
    // first run and NO SCREEN READ IT — the string existed, the number that
    // would have triggered it travelled in every snapshot, and nothing put
    // the two together. That is §20 again: five of six parts.
    const withState = (messagesState: 'ok' | 'approaching' | 'reached', over: Partial<State> = {}) =>
      render(chatScreen(state({
        me: me({ limits: { ...me().limits, messagesState } }),
        messages: [message()], ...over,
      })));
    const line = t('limit.approaching', 'en').replace(/'/g, '&#39;');

    assert.ok(withState('approaching').includes(line), 'the free day was running out and she said nothing');
    assert.ok(!withState('ok').includes(line), 'a warning about the end of the day, eighteen messages from it');
    assert.ok(!withState('reached').includes(line), 'warned about a limit that had already arrived');
    // Once she has actually said the limit line, the warning about it would
    // be on screen beside the thing it warned about.
    assert.ok(
      !withState('approaching', { limitLine: t('limit.reached', 'en') }).includes(line),
      'the warning and the limit it warned about were shown together',
    );
  });

  test('a device row\u2019s icon and its words answer the same question', () => {
    // "Mac · Chrome" rendered with a phone beside it, because the icon was
    // chosen by `current` rather than by the device. The screen exists to let
    // somebody decide "was that me?" and it was giving two answers at once.
    // Found by looking at a screenshot, once the seed stopped writing a fake
    // user agent that made every row say "Device".
    const rows = [
      { id: 'd-1', label: 'Mac · Chrome', kind: 'computer' as const, lastSeen: null, place: null, current: true },
      { id: 'd-2', label: 'iPhone · Safari', kind: 'phone' as const, lastSeen: '2026-08-26T09:00:00Z', place: null, current: false },
    ];
    const markup = render(securityScreen(me(), { devices: rows, attempts: [] }));
    const iconOf = (label: string): string => {
      const at = markup.indexOf(label);
      assert.notEqual(at, -1, `${label} is not on the screen`);
      // The icon is rendered just before the label, inside the same row.
      const before = markup.slice(Math.max(0, at - 400), at);
      return /i-(device|laptop)/.exec(before.split('<use').pop() ?? before)?.[0]
        ?? /i-(device|laptop)/g.exec(before)?.[0] ?? '(none)';
    };
    assert.equal(iconOf('iPhone · Safari'), 'i-device', 'a phone was drawn as a computer');
    assert.equal(iconOf('Mac · Chrome'), 'i-laptop', 'a Mac was drawn as a phone — the icon is tracking `current`, not the device');
  });

  test('a location is beside the device and the time, hedged, or absent', () => {
    // UI-UX §17. Three rules, and each is a way the screen could stop being
    // read: a city stated confidently is wrong often enough (mobile carriers,
    // VPNs, Private Relay) to produce the false alarm the screen exists to
    // prevent; a location REPLACING the device and the time removes the two
    // things that actually answer "was that you?"; and "Unknown" fills the
    // space an answer would take with a restatement of the question.
    const view = {
      devices: [
        { id: 'd-1', label: 'Mac · Chrome', kind: 'computer' as const, lastSeen: '2026-08-26T09:00:00Z', place: { kind: 'near' as const, name: 'Dubai' }, current: false },
        { id: 'd-2', label: 'iPhone · Safari', kind: 'phone' as const, lastSeen: '2026-08-25T09:00:00Z', place: { kind: 'country' as const, name: 'Germany' }, current: false },
        { id: 'd-3', label: 'Windows · Firefox', kind: 'computer' as const, lastSeen: '2026-08-24T09:00:00Z', place: null, current: false },
      ],
      attempts: [{ outcome: 'success', at: '2026-08-26T09:30:00Z', place: { kind: 'near' as const, name: 'Dubai' } }],
    };
    const markup = unescape_(render(securityScreen(me(), view)));

    assert.match(markup, /Near Dubai/, 'a city has to be hedged');
    assert.doesNotMatch(markup, /(^|[^r] )Dubai(?! )/, 'a bare city name reads as certainty the database does not have');
    assert.match(markup, /In Germany/, 'low confidence degrades to the country');
    assert.doesNotMatch(markup, /Unknown/i, 'an unresolvable address must show NOTHING, not "Unknown"');

    // Beside, never instead: every row still carries its device and its date.
    for (const label of ['Mac · Chrome', 'iPhone · Safari', 'Windows · Firefox']) {
      assert.ok(markup.includes(label), `${label} lost its device label`);
    }
    assert.match(markup, /26 August[\s\S]*Near Dubai|Near Dubai[\s\S]*26 August/, 'the date and the place are on the same row');
    // The row with no place is a normal row, not a shorter or emptier one.
    const noPlace = markup.slice(markup.indexOf('Windows · Firefox'));
    assert.match(noPlace, /24 August/, 'a device with no location lost its date too');
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
      messages: [message({ captures: [{ capability: 'money', icon: 'i-money', line: 'AED\u00a0400.00 · gym · Today', correctionRoute: '/money/t-1' }] })],
    })));
    assert.ok(markup.includes('href="/money/t-1"'));
    assert.ok(markup.includes('AED\u00a0400.00 · gym · Today'));
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
    user: { id: 'u-1', name: 'آدم', timeZone: 'Asia/Dubai', languageStyle: 'ar-eg', language: 'ar', plan: 'free', themePreference: 'auto', emailVerified: true },
    assistant: { id: 'a-1', name: 'لين', gender: 'female', mood: 'warm', moodPhrase: 'اليوم فيه دفء' },
    direction: 'rtl',
    // The capacity line is resolved server-side, so an Arabic reader gets the
    // Arabic one; the fixture carries what the server would send.
    limits: { messagesRemaining: 18, messagesState: 'ok', memoriesKept: 3, memoriesPending: 0, memoryCapacity: 100, capacityLine: 'أقدر أحتفظ بـ ١٠٠ ذكرى دايمة في الخطة المجانية.' },
    // The stage prose is resolved server-side too — relationshipView() picks
    // the language — and the desktop contextual panel renders it. The fixture
    // carries what the server would send, or this test would be asserting
    // that the fixture is in English.
    relationship: { stageName: 'التعارف', prose: 'لسه بنتعرف على بعض.' },
  });

  const screens: [string, string][] = [
    ['chat', render(chatScreen({ ...initial, me: arabic, path: '/chat', messages: [message({ body: 'تمام.' })] }))],
    ['memory', render(memoryScreen({ me: arabic, memories: [], query: '', filter: 'all', editing: null, deleting: null }))],
    ['tasks', render(tasksScreen(arabic, { tasks: [], notes: [] }))],
    ['money', render(moneyScreen(arabic, { month: '2026-05', inMinor: 0, outMinor: 0, leftMinor: 0, currency: 'AED', observation: null, categories: [], recent: [] }))],
    ['story', render(storyScreen(arabic, { now: 'الآن', footer: 'ملاحظة', stages: [], timeline: [] }))],
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
      render(moneyScreen(me(), { month: '2026-05', inMinor: 100, outMinor: 50, leftMinor: 50, currency: 'AED', observation: null, categories: [], recent: [] })),
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
      timeline: [],
    }));
    // A percentage, a day count or a streak would each turn a relationship
    // into a score. Her prose may say the word "days"; a NUMBER of them is
    // the thing LESSONS §6 keeps off the network.
    assert.ok(!/\d+\s*%/.test(markup));
    assert.ok(!/\b\d+\s*(days?|weeks?)\b/i.test(markup));
    assert.ok(!/progress-|streak/i.test(markup));
  });

  test('our story shows the stage they are in, and not the ones they are not', () => {
    // UI-UX §8: "Show current state as prose, not progression." All five
    // stages were rendered as a list of cards, which is a five-rung ladder
    // with three rungs locked — on the screen whose own copy says "There is
    // nothing to unlock and nothing to lose".
    const markup = render(storyScreen(me(), {
      now: 'We are finding a rhythm.', footer: 'Nothing to unlock.',
      stages: [
        { key: 'getting_acquainted', name: 'Getting acquainted', prose: 'Names, days.', current: false },
        { key: 'finding_a_rhythm', name: 'Finding a rhythm', prose: 'We are finding a rhythm.', current: true },
        { key: 'noticing_without_asking', name: 'Noticing without asking', prose: 'I notice patterns now.', current: false },
      ],
      timeline: [],
    }));
    assert.ok(markup.includes('Finding a rhythm'));
    assert.ok(!markup.includes('Noticing without asking'), 'a stage they have not reached was shown as a rung ahead of them');
    assert.ok(!markup.includes('Getting acquainted'), 'a stage they have left was shown as a rung behind them');
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

// ── health and album (UI-UX §26, §27) ──────────────────────────────────────
describe('health is context, not a tracker', () => {
  const week = (overrides: Partial<Health> = {}): Health => ({
    from: '2026-05-18', observation: null, days: [], habits: [], ...overrides,
  });

  test('nothing logged is an invitation, not an empty chart', () => {
    const markup = render(healthScreen(me(), week()));
    assert.ok(markup.includes(t('health.empty', 'en')));
    assert.ok(!markup.includes('chart'));
  });

  test('§26.2 the banned vocabulary has nowhere to appear', () => {
    // The strong version of this rule is structural: the view type has no
    // field a number could arrive in. This asserts the rendered surface as
    // well, because the type could grow one.
    const markup = render(healthScreen(me(), week({
      observation: 'You have been moving in the mornings this week.',
      days: [{ day: '2026-05-18', label: '2026-05-18', entries: [
        { id: 'h-1', kind: 'workout', line: '30 min · strength training', icon: 'i-workout' },
      ] }],
      habits: [{ id: 't-1', title: 'the gym', doneThisWeek: 3 }],
    })));
    for (const banned of ['calorie', 'Calorie', 'kcal', 'macro', 'Macro', 'score', 'Score', 'streak', 'Streak', 'grade', 'Grade']) {
      assert.ok(!markup.includes(banned), `${banned} appeared on the health screen`);
    }
  });

  test('an observation is rendered as her sentence when there is one, and not invented when there is not', () => {
    const day = { day: '2026-05-18', label: '2026-05-18', entries: [{ id: 'h-1', kind: 'meal', line: 'salmon', icon: 'i-meal' }] };
    const noticed = render(healthScreen(me(), week({ observation: 'You have been eating at home more this week.', days: [day] })));
    assert.ok(noticed.includes('eating at home more'));
    const quiet = render(healthScreen(me(), week({ days: [day] })));
    assert.ok(quiet.includes(t('health.not_a_tracker', 'en')));
  });

  test('an entry is tappable, because every capture is correctable (UI-UX §4)', () => {
    const markup = render(healthScreen(me(), week({
      days: [{ day: '2026-05-18', label: '2026-05-18', entries: [{ id: 'h-1', kind: 'meal', line: 'salmon', icon: 'i-meal' }] }],
    })));
    assert.ok(markup.includes('data-action="open-health"'));
    assert.ok(markup.includes('data-id="h-1"'));
  });
});

describe('the album (UI-UX §27)', () => {
  const item = (overrides: Partial<Album['items'][number]> = {}) => ({
    id: 'att-1', at: '2026-05-18T09:00:00.000Z', source: 'user' as const,
    conversationId: 'c-1', messageId: 'm-1', ...overrides,
  });

  test('there is no upload control anywhere on it (§27.2)', () => {
    const markup = render(albumScreen(me(), { items: [item()], hasOlder: false }, null));
    assert.ok(!markup.includes('type="file"'));
    assert.ok(!markup.includes('data-action="photo"'));
  });

  test('a picture is fetched through the API, never from a durable URL', () => {
    // /api/attachments/:id redirects to a signed URL that expires in minutes.
    // A page source with a bucket link in it would outlive the session.
    const markup = render(albumScreen(me(), { items: [item()], hasOlder: false }, null));
    assert.ok(markup.includes('/api/attachments/att-1'));
    assert.ok(!markup.includes('https://'), 'no storage URL should reach the markup');
  });

  test('the viewer says where it came from, and offers no social actions (§27.4)', () => {
    const markup = render(albumScreen(me(), { items: [item()], hasOlder: false }, 'att-1'));
    assert.ok(markup.includes(t('album.from_you', 'en')));
    assert.ok(markup.includes(t('album.open_in_chat', 'en')));
    for (const social of ['Like', 'like', 'Comment', 'comment', 'Share', 'share']) {
      assert.ok(!markup.includes(social), `${social} appeared in the viewer`);
    }
  });

  test('a photo she sent is attributed to HER NAME, not to the word Lian', () => {
    // She can be renamed, so a hardcoded name would be wrong for anyone who
    // did. The name comes from the snapshot.
    const renamed = me();
    const markup = render(albumScreen(
      { ...renamed, assistant: { ...renamed.assistant, name: 'Noor' } },
      { items: [item({ source: 'assistant' })], hasOlder: false },
      'att-1',
    ));
    assert.ok(markup.includes('Noor sent this'));
  });

  test('older is offered only when there is older', () => {
    const one = render(albumScreen(me(), { items: [item()], hasOlder: false }, null));
    assert.ok(!one.includes('data-action="album-older"'));
    const more = render(albumScreen(me(), { items: [item()], hasOlder: true }, null));
    assert.ok(more.includes('data-action="album-older"'));
  });
});

// ── her dials (Q13) ────────────────────────────────────────────────────────
describe('personality is five named stops, never a number', () => {
  const settings = (personality: Record<string, string> = {}): Settings => ({
    user: { name: 'Adam' },
    assistant: { name: 'Lian', gender: 'female', personality },
    quietHours: { enabled: false, startHour: 22, endHour: 8, days: [], allowSecurity: true },
    assistants: [{ id: 'a-1', name: 'Lian', gender: 'female', current: true }],
  });

  test('there is no slider, no percentage and no score anywhere on it', () => {
    // Q13's rule, and LESSONS §6's: a slider is a number wearing a costume,
    // and a number is what this product promises not to show about how
    // somebody is with you.
    const markup = render(dialsScreen(me(), settings({ warmth: 'high' })));
    assert.ok(!markup.includes('type="range"'));
    assert.ok(!markup.includes('%'));
    for (const banned of ['score', 'Score', 'level', 'Level', 'rating', 'Rating']) {
      assert.ok(!markup.includes(banned), `${banned} appeared on the dials screen`);
    }
    assert.ok(!/\bdata-stop="[0-9]/.test(markup), 'a stop is a word, not a number');
  });

  test('every dial offers exactly five stops, and the current one is marked', () => {
    const markup = render(dialsScreen(me(), settings({ warmth: 'high' })));
    for (const dial of DIALS) {
      const offered = [...markup.matchAll(new RegExp(`data-key="${dial}" data-stop="([a-z]+)"`, 'g'))].map((m) => m[1]);
      assert.deepEqual(offered, [...STOPS], `${dial} must offer all five stops`);
    }
    assert.match(markup, /chip--on"\s*\n?\s*data-action="set-dial" data-key="warmth" data-stop="high"/);
  });

  test('a dial with nothing stored shows the middle rather than nothing', () => {
    const markup = render(dialsScreen(me(), settings()));
    assert.ok(markup.includes('data-key="warmth" data-stop="mid"'));
    assert.match(markup, /chip--on"\s*\n?\s*data-action="set-dial" data-key="warmth" data-stop="mid"/);
  });
});

describe('quiet hours', () => {
  const settings = (quiet: Partial<Settings['quietHours']> = {}): Settings => ({
    user: { name: null },
    assistant: { name: 'Lian', gender: 'female', personality: {} },
    quietHours: { enabled: false, startHour: 22, endHour: 8, days: [], allowSecurity: true, ...quiet },
    assistants: [{ id: 'a-1', name: 'Lian', gender: 'female', current: true }],
  });

  test('the hours only appear once quiet hours are on', () => {
    assert.ok(!render(quietHoursScreen(me(), settings())).includes('data-action="set-quiet-start"'));
    assert.ok(render(quietHoursScreen(me(), settings({ enabled: true }))).includes('data-action="set-quiet-start"'));
  });

  test('it says plainly that a security message still reaches you', () => {
    // Quiet hours are about her chatting. Somebody signing in to your account
    // at 3am is the one thing worth waking you for, and the screen should not
    // let anyone believe otherwise.
    const markup = render(quietHoursScreen(me(), settings({ enabled: true })));
    assert.ok(markup.includes(t('quiet.security_always', 'en')));
  });
});

// ── the legal screens (UI-UX §22) ──────────────────────────────────────────
describe('terms and privacy are in the app, and say they are unreviewed', () => {
  const state = (document: LegalDocument) => ({ language: 'en' as const, error: null, busy: false, document, back: '/consent' });

  test('the whole document is on the screen — nothing is behind a link', () => {
    // §22's rule. A link to a website is burying it with extra steps, and it
    // does not work at all on the consent gate, where there is no account yet.
    const markup = render(legalScreen(state(TERMS)));
    for (const section of TERMS.sections) {
      assert.ok(markup.includes(t(section.heading, 'en')), `${section.heading} is missing`);
      assert.ok(markup.includes(t(section.body, 'en').slice(0, 40)), `${section.body} is missing`);
    }
    assert.ok(!markup.includes('http://') && !markup.includes('https://'), 'a legal page must not send anyone off-site');
  });

  test('both documents carry the unreviewed banner while LEGAL_REVIEWED is false', () => {
    for (const document of [TERMS, PRIVACY]) {
      const markup = render(legalScreen(state(document)));
      assert.ok(markup.includes(t('legal.unreviewed_title', 'en')), `${document.id} does not say it is unreviewed`);
    }
  });

  test('the consent gate carries it too, because that is where somebody agrees', () => {
    const markup = render(consent({ language: 'en', error: null, busy: false, adult: null, agreed: false }));
    assert.ok(markup.includes(t('legal.unreviewed_title', 'en')));
    assert.ok(markup.includes('href="/terms"'));
    assert.ok(markup.includes('href="/privacy"'));
  });

  test('the version is on the page, so an agreement can be dated by looking', () => {
    assert.ok(render(legalScreen(state(PRIVACY))).includes(CONSENT_VERSION));
  });

  test('an under-18 answer is a plain no with nothing else on the screen', () => {
    const markup = render(consent({ language: 'en', error: null, busy: false, adult: false, agreed: false }));
    // The copy has an apostrophe and render() escapes it, so the assertion
    // is on a distinctive fragment rather than the whole authored string.
    assert.ok(markup.includes('Nothing has been created and nothing was kept'));
    assert.ok(!markup.includes('data-action="consent-agree"'), 'there is nothing left to agree to');
    assert.ok(!markup.includes('href="/sign-up"'), 'and no way onward');
  });
});

describe('the incognito role (PRD §27, UI-UX §46)', () => {
  test('the mood phrase is suppressed, and the label takes its place', () => {
    const plain = render(head(me()));
    assert.ok(plain.includes('Feeling warm today'), 'the ordinary header still carries her mood');

    const hidden = render(head(me(), { incognito: true }));
    // Her mood is real and comes from the real conversation. Printing it
    // above a thread where she is playing an interviewer attributes a feeling
    // to a part she is acting.
    assert.ok(!hidden.includes('Feeling warm today'), 'her mood was shown over a role she is playing');
    assert.ok(hidden.includes(t('mood.incognito', 'en')));
  });

  test('the chip shows the role in the person\u2019s own words, and is the way in', () => {
    const without = render(incognitoChip(me(), null));
    assert.ok(without.includes(t('threads.incognito_note', 'en')), 'the promise is on it whether or not there is a role');
    assert.ok(!without.includes('Playing'), 'no role, no role line');

    const withRole = render(incognitoChip(me(), 'Interviewer for a senior RPA role'));
    assert.ok(withRole.includes('Playing: Interviewer for a senior RPA role'));
    // §46 hangs edit, clear and delete off tapping it, and there is nowhere
    // else in the conversation they could hang from.
    assert.ok(withRole.includes('data-action="scenario"'));
  });

  test('a role is text on the chip, not markup', () => {
    // It is free text somebody typed, and it renders inside the conversation.
    const markup = render(incognitoChip(me(), '<img src=x onerror="alert(1)">'));
    assert.ok(!markup.includes('<img'), 'a role reached the DOM as markup');
    assert.ok(markup.includes('&lt;img'));
  });

  test('the sheet offers §46\u2019s three, and only offers clearing when there is one', () => {
    const empty = render(scenarioSheet(me(), thread()));
    assert.ok(empty.includes('data-action="scenario-save"'));
    assert.ok(empty.includes('data-action="end-thread"'));
    assert.ok(!empty.includes('data-action="scenario-clear"'), 'nothing to clear when no role is set');

    const set = render(scenarioSheet(me(), thread({ scenarioText: 'Be a skeptical customer.' })));
    assert.ok(set.includes('data-action="scenario-clear"'));
    // Prefilled from the SERVER's copy: someone who edits, fails and reopens
    // the sheet sees the role she is still playing, not the one they tried.
    assert.ok(set.includes('Be a skeptical customer.'));
  });

  test('both boxes stop at the length the prompt actually renders', () => {
    // The server refuses anything longer (hardening.test.ts). This is the
    // half that means nobody types it in the first place, and it must be the
    // SAME number — a client cap of its own would drift.
    for (const markup of [render(scenarioSheet(me(), thread())), render(threadSheet(me(), [], null))]) {
      assert.ok(markup.includes(`maxlength="${MAX_SCENARIO_LENGTH}"`));
    }
  });

  test('the role box is on the start sheet, where the first message can still use it', () => {
    const markup = render(threadSheet(me(), [], null));
    assert.ok(markup.includes('name="scenarioText"'));
    assert.ok(markup.includes(t('scenario.ask', 'en')));
    // Optional, and it says so — §46 calls it optional and a required-looking
    // field in front of an incognito thread is a reason not to start one.
    assert.ok(markup.includes(t('scenario.optional', 'en')));
  });
});

describe('what using it found', () => {
  test('language & style offers §47\u2019s eight, by name', () => {
    const markup = render(languageScreen(me()));
    assert.equal(LANGUAGE_STYLES.length, 8);
    for (const style of LANGUAGE_STYLES) assert.ok(markup.includes(t(`language.${style}` as never, 'en')), style);
    // The raw codes are the DATA, never the label — `ar-eg` on a screen is
    // what this replaced.
    assert.ok(!/>\s*ar-eg\s*</.test(markup), 'a language code was shown as a label');
    assert.ok(markup.includes(t('language.sample', 'en')), '§47\u2019s sample line: what a choice sounds like, not its name');
  });

  test('the money headline is not a negative "what\u2019s left" before any income', () => {
    // A first month: she has been told about one payment and no income, so
    // in-minus-out is −400 and "What's left" was the biggest thing on screen.
    const first = render(moneyScreen(me(), {
      month: '2026-08', inMinor: 0, outMinor: 40_000, leftMinor: -40_000, currency: 'AED', observation: null,
      categories: [{ category: 'gym', totalMinor: 40_000 }],
      recent: [{ id: 't-1', line: 'gym', amountMinor: 40_000, direction: 'out', occurredOn: '2026-08-27', fromReceipt: false }],
    }));
    // The HEADLINE, not the page: the comment above that code says why it is
    // shaped this way and quotes the old label, and a substring match over
    // the whole render would read the explanation as the bug.
    // The label as it is RENDERED — dom.ts escapes text, so "What's left"
    // reaches the page as "What&#39;s left" and a raw catalogue string never
    // matches it.
    const headline = (markup: string): string => {
      const slice = markup.slice(markup.indexOf('money__headline'), markup.indexOf('money__flow'));
      return slice.replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    };
    assert.ok(headline(first).includes(t('money.spent', 'en')));
    assert.ok(!headline(first).includes(t('money.left', 'en')), 'a first month was headlined with a figure that cannot be true yet');
    // Both figures are still there underneath — §7 asks for all three.
    assert.ok(first.includes(t('money.in', 'en')) && first.includes(t('money.out', 'en')));

    // Once something has come in, "What's left" means something and returns.
    const later = render(moneyScreen(me(), {
      month: '2026-08', inMinor: 900_000, outMinor: 40_000, leftMinor: 860_000, currency: 'AED', observation: null,
      categories: [], recent: [],
    }));
    assert.ok(headline(later).includes(t('money.left', 'en')));
  });

  test('money is shown with the currency\u2019s own precision', () => {
    // AED 127.50 rendered as "AED 127.5" — on the Money screen, in the
    // headline, with a trailing single decimal that reads as a typo. Every
    // test asserted "AED 400", which is the one amount where two decimals and
    // zero decimals agree, so nothing was ever red.
    const markup = render(moneyScreen(me(), {
      month: '2026-08', inMinor: 1_800_000, outMinor: 12_750, leftMinor: 1_787_250, currency: 'AED', observation: null,
      categories: [{ category: 'coffee', totalMinor: 12_750 }],
      recent: [{ id: 't-1', line: 'coffee', amountMinor: 12_750, direction: 'out', occurredOn: '2026-08-25', fromReceipt: false }],
    }));
    assert.ok(markup.includes('127.50'), `a half-dirham lost its second decimal: ${markup.match(/AED[^<]*/)?.[0]}`);
    assert.ok(!/127\.5[^0]/.test(markup));
  });

  test('a transaction row says where it came from, and the column decides', () => {
    // `fromReceipt` was `originMessageId === null` — backwards, since a real
    // receipt capture HAS an origin message. Five seeded rows, none of them
    // photographed, every one captioned "from a receipt". A caption is a
    // claim about state (LESSONS §20), and that one was false on every row.
    // `transactions.receipt_id` is written now, so the caption follows it.
    const row = (fromReceipt: boolean) => render(moneyScreen(me(), {
      month: '2026-08', inMinor: 0, outMinor: 40_000, leftMinor: -40_000, currency: 'AED', observation: null,
      categories: [],
      recent: [{ id: 't-1', line: 'gym', amountMinor: 40_000, direction: 'out', occurredOn: '2026-08-25', fromReceipt }],
    }));

    const photographed = row(true);
    assert.ok(photographed.includes(t('money.from_receipt', 'en')));
    assert.ok(!photographed.includes(t('money.from_chat', 'en')));

    const told = row(false);
    assert.ok(told.includes(t('money.from_chat', 'en')));
    assert.ok(!told.includes(t('money.from_receipt', 'en')), 'a row she was told about claimed a photograph');
  });

  test('the first conversation does not claim a continuity that has not happened', () => {
    // 'Still with you' above somebody's very first message. The string is
    // correct, authored, in both languages, and wrong for that moment — the
    // exact class of thing no copy test catches, because nothing about it
    // looks wrong until you read it in place.
    assert.ok(!t('mood.new.day', 'en').toLowerCase().includes('still'));
    assert.notEqual(t('mood.new.day', 'en'), t('mood.neutral.day', 'en'));
    assert.notEqual(t('mood.new.day', 'ar'), t('mood.neutral.day', 'ar'));
  });
});
