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
import { dialsScreen, quietHoursScreen, DIALS, STOPS, type Settings } from './screens/her.ts';
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
  limits: { messagesRemaining: 18, memoriesKept: 3, memoriesPending: 0, memoryCapacity: 100, capacityLine: 'I can keep up to 100 lasting memories on the free plan.' },
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
    user: { id: 'u-1', name: 'آدم', timeZone: 'Asia/Dubai', languageStyle: 'ar-eg', language: 'ar', plan: 'free', themePreference: 'auto', emailVerified: true },
    assistant: { id: 'a-1', name: 'لين', gender: 'female', mood: 'warm', moodPhrase: 'اليوم فيه دفء' },
    direction: 'rtl',
    // The capacity line is resolved server-side, so an Arabic reader gets the
    // Arabic one; the fixture carries what the server would send.
    limits: { messagesRemaining: 18, memoriesKept: 3, memoriesPending: 0, memoryCapacity: 100, capacityLine: 'أقدر أحتفظ بـ ١٠٠ ذكرى دايمة في الخطة المجانية.' },
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
