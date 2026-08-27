// Photograph the product.
//
//   npm run shots
//
// The browser tests already drive real Chromium; this drives the same browser
// to look rather than to assert. Reading HTML is not looking at a product, and
// a coverage matrix that says ✅ is a claim — two of its rows were wrong for
// seven runs, and the way that was found was by using the thing.
//
// Every shot is a real screen, rendered by the real server, from real rows.
// Nothing here mocks a screen or hand-writes markup: if a picture is wrong,
// the product is wrong.
//
// WHERE A SHOT CANNOT BE TAKEN it is recorded as a gap in INDEX.md with the
// reason, never skipped. A set of pictures that looks complete is worse than
// one with holes in it, because the holes are the information.
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { Browser, chromiumPath } from '../browser.ts';
import { loadConfig } from '../../apps/server/src/config.ts';
import { createApplication } from '../../apps/server/src/app.ts';
import { deterministicEmbedder, EMBEDDING_DIMENSIONS, type AnalysisModel } from '@lian/analysis';
import { DEFAULT_MODEL, type Provider } from '@lian/llm';
import { generateVapidKeys } from '@lian/push';
import { migrate, closeDb } from '@lian/db';
import { seed, type Fullness, TODAY } from './seed.ts';
import type { AddressInfo } from 'node:net';

const OUT = new URL('../../docs/shots/', import.meta.url).pathname;

// ── what a shot is ─────────────────────────────────────────────────────────

type Shot = {
  /** File name without the extension. Scannable, in that order: what, then
   *  which state, then which theme, then which direction. */
  name: string;
  /** The coverage-matrix row it belongs to, so INDEX.md can be in matrix
   *  order rather than in the order somebody happened to write these. */
  area: string;
  path: string;
  fullness?: Fullness;
  language?: 'en' | 'ar-eg';
  themePreference?: 'auto' | 'always-light' | 'always-dark';
  mood?: 'warm' | 'quiet' | 'neutral';
  plan?: 'free' | 'paid';
  stage?: number;
  /** Messages already spent today, for the free plan's end-of-day states.
   *  A real usage_counters row — see seed.ts for why it is not a flag. */
  messagesUsedToday?: number;
  /** Desktop shots. Everything else is a phone. */
  width?: number;
  height?: number;
  /** Clicked in order once the screen has loaded — for sheets and dialogs. */
  click?: string[];
  /** Waited for after the clicks, so a sheet is photographed open rather than
   *  halfway through its transition. */
  waitFor?: string;
  /** Run in the page before the shot: the last resort, for states that have
   *  no route and no button. */
  script?: string;
  note?: string;
};

/** A gap: a matrix row that CANNOT be photographed, and why. */
type Gap = { area: string; name: string; why: string };

const GAPS: Gap[] = [
  {
    area: 'Album', name: 'album-full',
    why: 'NOT CAPTURED. The album renders photographs, and a photograph has to be uploaded '
      + 'through the three-step signed-upload path with real bytes in a store. Seeding one '
      + 'means seeding object storage, which is a different job from seeding rows. The EMPTY '
      + 'state is captured; the grid is not.',
  },
  {
    area: 'Notifications & permissions', name: 'notification-lock-screen',
    why: 'CANNOT BE CAPTURED HERE. A lock-screen notification is drawn by the operating '
      + 'system, not by this product — and no real web push has ever been received (HANDOFF §2). '
      + 'The in-app pre-prompt IS captured.',
  },
  {
    area: 'PWA install', name: 'pwa-native-install',
    why: 'CANNOT BE CAPTURED HERE. The install dialog is the browser\'s own, drawn outside the '
      + 'page, and headless Chromium never fires `beforeinstallprompt`. The in-app pre-prompt '
      + 'card IS captured, by dispatching that event in the page.',
  },
  {
    area: 'Chat', name: 'chat-voice',
    why: 'NOT CAPTURED. The recorder needs a microphone permission and a MediaRecorder; '
      + 'headless Chromium has neither. The composer\'s mic BUTTON is in every chat shot.',
  },
];

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

const SHOTS: Shot[] = [
  // ── Chat ────────────────────────────────────────────────────────────────
  { name: 'chat-day-ltr', area: 'Chat', path: '/chat', themePreference: 'always-light', mood: 'warm' },
  { name: 'chat-quiet-ltr', area: 'Chat', path: '/chat', themePreference: 'always-light', mood: 'quiet' },
  { name: 'chat-night-ltr', area: 'Chat', path: '/chat', themePreference: 'always-dark', mood: 'neutral' },
  { name: 'chat-night-warm-ltr', area: 'Chat', path: '/chat', themePreference: 'always-dark', mood: 'warm' },
  { name: 'chat-day-rtl', area: 'Chat', path: '/chat', language: 'ar-eg', themePreference: 'always-light', mood: 'warm' },
  { name: 'chat-night-rtl', area: 'Chat', path: '/chat', language: 'ar-eg', themePreference: 'always-dark', mood: 'neutral' },
  { name: 'chat-empty-ltr', area: 'Chat', path: '/chat', fullness: 'empty', themePreference: 'always-light' },
  { name: 'chat-empty-rtl', area: 'Chat', path: '/chat', fullness: 'empty', language: 'ar-eg', themePreference: 'always-light' },
  {
    name: 'chat-message-actions-ltr', area: 'Chat', path: '/chat', themePreference: 'always-light',
    script: "document.querySelector('.bubble--hers').closest('.chat__group').querySelector('[data-action=\"message-actions\"], .bubble--hers').dispatchEvent(new Event('contextmenu', { bubbles: true }))",
    note: 'the action sheet on one of her messages',
  },
  {
    name: 'chat-desktop-day-ltr', area: 'Chat', path: '/chat', themePreference: 'always-light',
    ...DESKTOP, note: 'the purpose-built wide layout and the left rail',
  },
  {
    name: 'chat-desktop-night-rtl', area: 'Chat', path: '/chat', language: 'ar-eg',
    themePreference: 'always-dark', mood: 'neutral', ...DESKTOP, note: 'the rail mirrored',
  },

  // ── Tasks & notes ───────────────────────────────────────────────────────
  { name: 'tasks-day-ltr', area: 'Tasks & notes', path: '/tasks', themePreference: 'always-light' },
  { name: 'tasks-night-ltr', area: 'Tasks & notes', path: '/tasks', themePreference: 'always-dark', mood: 'neutral' },
  { name: 'tasks-day-rtl', area: 'Tasks & notes', path: '/tasks', language: 'ar-eg', themePreference: 'always-light' },
  { name: 'tasks-empty-ltr', area: 'Tasks & notes', path: '/tasks', fullness: 'empty', themePreference: 'always-light' },
  {
    name: 'tasks-correction-ltr', area: 'Tasks & notes', path: '/tasks', themePreference: 'always-light',
    click: ['[data-action="open-task"]'], waitFor: '!!document.querySelector(".sheet")',
    note: 'the correction sheet — the only form in the product, and it cannot create',
  },
  { name: 'tasks-desktop-day-ltr', area: 'Tasks & notes', path: '/tasks', themePreference: 'always-light', ...DESKTOP },

  // ── Money ───────────────────────────────────────────────────────────────
  { name: 'money-day-ltr', area: 'Money', path: '/money', themePreference: 'always-light' },
  { name: 'money-night-ltr', area: 'Money', path: '/money', themePreference: 'always-dark', mood: 'neutral' },
  { name: 'money-day-rtl', area: 'Money', path: '/money', language: 'ar-eg', themePreference: 'always-light' },
  { name: 'money-empty-ltr', area: 'Money', path: '/money', fullness: 'empty', themePreference: 'always-light' },
  {
    name: 'money-correction-ltr', area: 'Money', path: '/money', themePreference: 'always-light',
    click: ['[data-action="open-money"]'], waitFor: '!!document.querySelector(".sheet")',
  },
  { name: 'money-desktop-day-ltr', area: 'Money', path: '/money', themePreference: 'always-light', ...DESKTOP },

  // ── Memory ──────────────────────────────────────────────────────────────
  { name: 'memory-day-ltr', area: 'Memory', path: '/memory', themePreference: 'always-light' },
  { name: 'memory-night-ltr', area: 'Memory', path: '/memory', themePreference: 'always-dark', mood: 'neutral' },
  { name: 'memory-day-rtl', area: 'Memory', path: '/memory', language: 'ar-eg', themePreference: 'always-light' },
  { name: 'memory-empty-ltr', area: 'Memory', path: '/memory', fullness: 'empty', themePreference: 'always-light' },
  { name: 'memory-empty-ar', area: 'Memory', path: '/memory', fullness: 'empty', language: 'ar-eg', themePreference: 'always-light' },
  {
    name: 'memory-delete-ltr', area: 'Memory', path: '/memory', themePreference: 'always-light',
    click: ['[data-action="memory-delete"]'], waitFor: '!!document.querySelector(".sheet")',
    note: 'deletion is real, and the sheet says what happens to what she built on it',
  },
  { name: 'memory-desktop-day-ltr', area: 'Memory', path: '/memory', themePreference: 'always-light', ...DESKTOP },

  // ── Our story ───────────────────────────────────────────────────────────
  { name: 'story-day-ltr', area: 'Our story', path: '/story', themePreference: 'always-light', stage: 2 },
  { name: 'story-day-rtl', area: 'Our story', path: '/story', language: 'ar-eg', themePreference: 'always-light', stage: 2 },
  { name: 'story-new-ltr', area: 'Our story', path: '/story', fullness: 'empty', themePreference: 'always-light', stage: 1 },
  { name: 'story-late-ltr', area: 'Our story', path: '/story', themePreference: 'always-light', stage: 4, note: 'a stage further in' },
  {
    name: 'story-moments-ltr', area: 'Our story', path: '/story', themePreference: 'always-light', stage: 2,
    click: ['[data-action="story-filter"][data-value="moment"]'],
    note: '§8\'s filter, on moments — hers, with the quiet remove that a derived milestone does not get',
  },
  {
    name: 'story-jokes-rtl', area: 'Our story', path: '/story', language: 'ar-eg',
    themePreference: 'always-light', stage: 2,
    click: ['[data-action="story-filter"][data-value="inside_joke"]'],
  },

  // ── Health ──────────────────────────────────────────────────────────────
  { name: 'health-day-ltr', area: 'Health', path: '/health', themePreference: 'always-light' },
  { name: 'health-day-rtl', area: 'Health', path: '/health', language: 'ar-eg', themePreference: 'always-light' },
  { name: 'health-empty-ltr', area: 'Health', path: '/health', fullness: 'empty', themePreference: 'always-light' },

  // ── Album ───────────────────────────────────────────────────────────────
  { name: 'album-empty-ltr', area: 'Album', path: '/album', fullness: 'empty', themePreference: 'always-light' },
  { name: 'album-empty-rtl', area: 'Album', path: '/album', fullness: 'empty', language: 'ar-eg', themePreference: 'always-light' },

  // ── Assistants ──────────────────────────────────────────────────────────
  { name: 'assistants-day-ltr', area: 'Assistants', path: '/assistants', themePreference: 'always-light' },
  { name: 'assistants-day-rtl', area: 'Assistants', path: '/assistants', language: 'ar-eg', themePreference: 'always-light' },
  { name: 'identity-day-ltr', area: 'Assistants', path: '/settings/identity', themePreference: 'always-light' },
  { name: 'identity-day-rtl', area: 'Assistants', path: '/settings/identity', language: 'ar-eg', themePreference: 'always-light' },

  // ── Settings ────────────────────────────────────────────────────────────
  { name: 'settings-day-ltr', area: 'Settings', path: '/settings', themePreference: 'always-light' },
  { name: 'settings-night-ltr', area: 'Settings', path: '/settings', themePreference: 'always-dark', mood: 'neutral' },
  { name: 'settings-day-rtl', area: 'Settings', path: '/settings', language: 'ar-eg', themePreference: 'always-light' },
  { name: 'personality-day-ltr', area: 'Settings', path: '/settings/personality', themePreference: 'always-light' },
  { name: 'personality-day-rtl', area: 'Settings', path: '/settings/personality', language: 'ar-eg', themePreference: 'always-light' },
  { name: 'quiet-hours-day-ltr', area: 'Settings', path: '/settings/quiet-hours', themePreference: 'always-light' },
  { name: 'language-day-ltr', area: 'Settings', path: '/settings/language', themePreference: 'always-light', note: 'built this run — the route used to render the conversation' },
  { name: 'language-day-rtl', area: 'Settings', path: '/settings/language', language: 'ar-eg', themePreference: 'always-light' },

  // ── Security ────────────────────────────────────────────────────────────
  { name: 'security-day-ltr', area: 'Security', path: '/security', themePreference: 'always-light' },
  { name: 'security-night-ltr', area: 'Security', path: '/security', themePreference: 'always-dark', mood: 'neutral' },
  { name: 'security-day-rtl', area: 'Security', path: '/security', language: 'ar-eg', themePreference: 'always-light' },

  // ── Data ────────────────────────────────────────────────────────────────
  { name: 'data-day-ltr', area: 'Data', path: '/data', themePreference: 'always-light' },
  { name: 'data-day-rtl', area: 'Data', path: '/data', language: 'ar-eg', themePreference: 'always-light' },
  {
    name: 'data-delete-confirm-ltr', area: 'Data', path: '/data', themePreference: 'always-light',
    click: ['[data-action="delete-confirm"]'], waitFor: '!!document.querySelector("input[name=\\"confirm\\"], .data__confirm, form")',
    note: 'the one destructive confirmation in the product',
  },

  // ── Account ─────────────────────────────────────────────────────────────
  { name: 'welcome-day-ltr', area: 'Account', path: '/welcome', themePreference: 'always-light' },
  { name: 'welcome-day-rtl', area: 'Account', path: '/welcome', language: 'ar-eg', themePreference: 'always-light' },
  { name: 'sign-in-day-ltr', area: 'Account', path: '/sign-in', themePreference: 'always-light' },
  { name: 'sign-up-day-ltr', area: 'Account', path: '/sign-up', themePreference: 'always-light' },
  { name: 'sign-up-day-rtl', area: 'Account', path: '/sign-up', language: 'ar-eg', themePreference: 'always-light' },
  { name: 'forgot-day-ltr', area: 'Account recovery', path: '/forgot', themePreference: 'always-light' },
  { name: 'forgot-day-rtl', area: 'Account recovery', path: '/forgot', language: 'ar-eg', themePreference: 'always-light' },
  { name: 'reset-password-day-ltr', area: 'Account recovery', path: '/reset-password?token=example', themePreference: 'always-light' },
  { name: 'confirm-email-day-ltr', area: 'Account recovery', path: '/confirm-email?token=example', themePreference: 'always-light' },
  { name: 'confirm-device-day-ltr', area: 'Account recovery', path: '/confirm-device', themePreference: 'always-light' },

  // ── Consent ─────────────────────────────────────────────────────────────
  { name: 'consent-day-ltr', area: 'Consent', path: '/consent', themePreference: 'always-light' },
  { name: 'consent-day-rtl', area: 'Consent', path: '/consent', language: 'ar-eg', themePreference: 'always-light' },
  { name: 'terms-day-ltr', area: 'Consent', path: '/terms', themePreference: 'always-light', note: 'note the unreviewed-legal-text banner' },
  { name: 'privacy-day-ltr', area: 'Consent', path: '/privacy', themePreference: 'always-light' },
  { name: 'privacy-desktop-day-ltr', area: 'Consent', path: '/privacy', themePreference: 'always-light', ...DESKTOP, note: 'the 800px long-form column' },

  // ── Subscription ────────────────────────────────────────────────────────
  { name: 'subscription-free-ltr', area: 'Subscription', path: '/subscription', themePreference: 'always-light' },
  { name: 'subscription-free-rtl', area: 'Subscription', path: '/subscription', language: 'ar-eg', themePreference: 'always-light' },
  { name: 'subscription-paid-ltr', area: 'Subscription', path: '/subscription', plan: 'paid', themePreference: 'always-light', note: 'manage and cancel' },

  // ── Notifications & permissions ─────────────────────────────────────────
  {
    name: 'permission-pre-prompt-ltr', area: 'Notifications & permissions', path: '/chat',
    fullness: 'empty', themePreference: 'always-light',
    note: 'asked AFTER she has remembered something, never before',
  },

  // ── PWA install ─────────────────────────────────────────────────────────
  {
    name: 'install-pre-prompt-ltr', area: 'PWA install', path: '/chat', themePreference: 'always-light',
    script: "window.dispatchEvent(Object.assign(new Event('beforeinstallprompt'), { prompt: () => {} }))",
    waitFor: '!!document.querySelector(".card--install, [data-action=\\"install-yes\\"]")',
    note: 'offered in her voice, not fired at you on load (UI-UX §41)',
  },

  // ── Splash / 404 / outage ───────────────────────────────────────────────
  { name: 'not-found-day-ltr', area: 'Splash / 404 / outage', path: '/no-such-page', themePreference: 'always-light' },
  { name: 'not-found-day-rtl', area: 'Splash / 404 / outage', path: '/no-such-page', language: 'ar-eg', themePreference: 'always-light' },
  { name: 'outage-day-ltr', area: 'Splash / 404 / outage', path: '/outage', themePreference: 'always-light' },

  // ── Onboarding conversation ─────────────────────────────────────────────
  // The matrix has this row and NOTHING COULD PHOTOGRAPH IT until now: every
  // seeded account had onboarded_at set, so the product's first five minutes
  // had no picture. Her first message is scripted by the provider here, the
  // way it is scripted in tools/preview.ts — the WORDS are a stand-in, the
  // screen is real.
  {
    name: 'onboarding-greet-ltr', area: 'Onboarding conversation', path: '/chat',
    fullness: 'onboarding', themePreference: 'always-light',
    note: 'no header mood yet, no captures, no nav destination but the conversation',
  },
  {
    name: 'onboarding-greet-rtl', area: 'Onboarding conversation', path: '/chat',
    fullness: 'onboarding', language: 'ar-eg', themePreference: 'always-light',
  },
  {
    name: 'onboarding-permission-ltr', area: 'Onboarding conversation', path: '/chat',
    fullness: 'onboarding', themePreference: 'always-light',
    note: 'the permission card — asked AFTER she has remembered something (PRD §18)',
  },

  // ── Morning briefing ────────────────────────────────────────────────────
  { name: 'briefing-day-ltr', area: 'Morning briefing', path: '/briefing', themePreference: 'always-light' },
  { name: 'briefing-day-rtl', area: 'Morning briefing', path: '/briefing', language: 'ar-eg', themePreference: 'always-light' },
  {
    name: 'briefing-new-ltr', area: 'Morning briefing', path: '/briefing', fullness: 'empty',
    themePreference: 'always-light',
    note: 'day one: a money figure and four empty lists — FIRST-IMPRESSIONS §3',
  },

  // ── Search ──────────────────────────────────────────────────────────────
  { name: 'search-empty-ltr', area: 'Search', path: '/search', themePreference: 'always-light' },
  { name: 'search-empty-rtl', area: 'Search', path: '/search', language: 'ar-eg', themePreference: 'always-light' },

  // ── User profile ────────────────────────────────────────────────────────
  { name: 'profile-day-ltr', area: 'User profile', path: '/profile', themePreference: 'always-light' },
  { name: 'profile-day-rtl', area: 'User profile', path: '/profile', language: 'ar-eg', themePreference: 'always-light' },

  // ── Conversation types ──────────────────────────────────────────────────
  {
    name: 'threads-sheet-ltr', area: 'Conversation types', path: '/chat', themePreference: 'always-light',
    click: ['[data-action="threads"]'], waitFor: '!!document.querySelector(".sheet")',
    note: 'main, side and incognito — with the incognito promise stated BEFORE you start one',
  },
  {
    name: 'threads-sheet-rtl', area: 'Conversation types', path: '/chat', language: 'ar-eg',
    themePreference: 'always-light', click: ['[data-action="threads"]'], waitFor: '!!document.querySelector(".sheet")',
  },

  // ── Free limit ──────────────────────────────────────────────────────────
  //
  // Both states come from a real usage_counters row, and the free plan's day
  // is 20 messages (PLAN_LIMITS): 16 spent leaves 4, which is inside the
  // threshold of 5, and 20 spent leaves none.
  {
    name: 'limit-approaching-ltr', area: 'Free limit', path: '/chat', themePreference: 'always-light',
    messagesUsedToday: 16,
    note: 'four left: a small line in the conversation, not a counter and not a banner (UI-UX §19)',
  },
  {
    name: 'limit-approaching-rtl', area: 'Free limit', path: '/chat', language: 'ar-eg',
    themePreference: 'always-light', messagesUsedToday: 16,
  },
  {
    // The REACHED state is not a snapshot field — it is what she SAYS when a
    // message is refused, so the only honest way to photograph it is to send
    // one and be refused. The composer is filled and submitted for real; the
    // server turns it down before any model call.
    name: 'limit-reached-ltr', area: 'Free limit', path: '/chat', themePreference: 'always-light',
    messagesUsedToday: 20,
    script: "(document.querySelector('.composer__input').value = 'one more thing', "
      + "document.querySelector('.composer__input').dispatchEvent(new Event('input', {bubbles: true})), "
      + "document.querySelector('form.composer__bar').requestSubmit(), true)",
    waitFor: '!!document.querySelector(".bubble--limit")',
    note: 'the day is spent — her line, in the conversation, in her voice (PRD §11)',
  },

  // ── Navigation drawer / rail ────────────────────────────────────────────
  {
    name: 'drawer-day-ltr', area: 'Navigation drawer / rail', path: '/chat', themePreference: 'always-light',
    click: ['[data-action="drawer"]'], waitFor: '!!document.querySelector(".drawer")',
  },
  {
    name: 'drawer-day-rtl', area: 'Navigation drawer / rail', path: '/chat', language: 'ar-eg',
    themePreference: 'always-light', click: ['[data-action="drawer"]'], waitFor: '!!document.querySelector(".drawer")',
  },
  {
    name: 'rail-desktop-day-ltr', area: 'Navigation drawer / rail', path: '/memory',
    themePreference: 'always-light', ...DESKTOP, note: 'the bottom nav, restyled — one DOM, one stylesheet',
  },
];

// ── the app, with a model that costs nothing ───────────────────────────────

const REPLIES = ["Morning. The bank call is still open from Tuesday, and yesterday sounded long."];
const provider: Provider = {
  id: 'shots',
  capabilities: () => ({ streaming: true, toolCalling: false, vision: false, contextTokens: 200_000, maxOutputTokens: 4_000 }),
  async stream(request, onDelta) {
    if (request.model === DEFAULT_MODEL) onDelta(REPLIES[0]!);
    else onDelta('[]');
    return { usage: { inputTokens: 900, outputTokens: 60, cacheWriteTokens: 0, cacheReadTokens: 0 }, stopReason: 'end_turn' };
  },
};
const analysisModel: AnalysisModel = {
  async complete() { return { text: '[]', usage: { inputTokens: 10, outputTokens: 1 } }; },
};

// ── run ────────────────────────────────────────────────────────────────────

if ((process.env['DATABASE_URL'] ?? '') === '') {
  console.error('DATABASE_URL is not set — the shots need a database to seed.');
  process.exit(1);
}
if (chromiumPath() === null) {
  console.error('no Chromium — set PLAYWRIGHT_BROWSERS_PATH, or run where the browser tests run.');
  process.exit(1);
}

await migrate(() => {});

const vapid = generateVapidKeys();
const { config } = loadConfig({
  ...process.env,
  NODE_ENV: 'development',
  PORT: '0',
  LIAN_TICK_SECRET: 'shots',
  LIAN_VAPID_PUBLIC_KEY: vapid.publicKey,
  LIAN_VAPID_PRIVATE_KEY: vapid.privateKey,
});
const { server } = createApplication(config, {
  provider, analysisModel,
  embedder: deterministicEmbedder(EMBEDDING_DIMENSIONS),
  log: () => {},
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

// A fresh directory, so a shot that stops being taken disappears rather than
// lingering as a picture of a screen that no longer exists.
if (existsSync(OUT)) rmSync(OUT, { recursive: true });
mkdirSync(OUT, { recursive: true });

// The Browser IS the page — it opens one and drives it, which is all a
// screenshot run needs.
const page = await Browser.launch();

/** One account per (fullness, language, theme, mood, plan, stage), reused. */
const accounts = new Map<string, Awaited<ReturnType<typeof seed>>>();
async function accountFor(shot: Shot) {
  const key = [shot.fullness ?? 'full', shot.language ?? 'en', shot.themePreference ?? 'auto',
    shot.mood ?? 'warm', shot.plan ?? 'free', shot.stage ?? 0, shot.messagesUsedToday ?? -1].join('|');
  const existing = accounts.get(key);
  if (existing !== undefined) return existing;
  const made = await seed(shot.fullness ?? 'full', {
    ...(shot.language === undefined ? {} : { language: shot.language }),
    ...(shot.themePreference === undefined ? {} : { themePreference: shot.themePreference }),
    ...(shot.mood === undefined ? {} : { mood: shot.mood }),
    ...(shot.plan === undefined ? {} : { plan: shot.plan }),
    ...(shot.stage === undefined ? {} : { stage: shot.stage }),
    ...(shot.messagesUsedToday === undefined ? {} : { messagesUsedToday: shot.messagesUsedToday }),
  });
  accounts.set(key, made);
  return made;
}

/** Screens rendered before an account exists — signed OUT is the point. */
const SIGNED_OUT = new Set(['/welcome', '/sign-in', '/sign-up', '/consent', '/forgot', '/confirm-device']);

const taken: Shot[] = [];
const failed: { shot: Shot; why: string }[] = [];

for (const shot of SHOTS) {
  const width = shot.width ?? PHONE.width;
  const height = shot.height ?? PHONE.height;
  try {
    await page.setViewport(width, height, 2, width < 900);

    const signedOut = SIGNED_OUT.has(shot.path.split('?')[0]!);
    if (signedOut) {
      await page.setCookie({ name: 'lian_session', value: '', url: base });
    } else {
      const account = await accountFor(shot);
      await page.setCookie({ name: 'lian_session', value: account.sessionToken, url: base });
    }

    await page.goto(`${base}${shot.path}`);
    // The shell paints before /api/me answers, so waiting for the body is not
    // waiting for the screen. `#r-screen` is the region the client builds once
    // it has an account; before there is one, the entry screens render
    // straight into `#app`. Either counts as "there is something to look at",
    // and waiting for the wrong one is how the first version of this hung on
    // every shot with an empty log.
    await page.waitFor(
      '(document.querySelector("#r-screen")?.children.length ?? 0) > 0'
      + ' || (document.querySelector("#app")?.children.length ?? 0) > 0',
      15_000,
    );
    // One frame for the fonts and the theme attribute to settle. A shot taken
    // mid-paint is a picture of a bug that is not there.
    await page.evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');

    // Headless Chromium meets the install criteria, so `beforeinstallprompt`
    // genuinely fires and the install card genuinely appears — on every chat
    // shot, in front of the conversation being photographed. It is dismissed
    // the way a person dismisses it, with the button, EXCEPT on the shot that
    // is about it. Not hidden with CSS: a shot of a screen with something
    // hidden is a picture of a screen that does not exist.
    if (shot.area !== 'PWA install') {
      // ONE EXPRESSION. Runtime.evaluate takes an expression, not statements,
      // so `a?.click(); true` is a SyntaxError — which arrives as every shot
      // failing at once rather than as a message about a semicolon.
      await page.evaluate('(document.querySelector(\'[data-action="install-no"]\')?.click(), true)');
    }
    if (shot.script !== undefined) await page.evaluate(shot.script);
    for (const selector of shot.click ?? []) {
      await page.waitFor(`!!document.querySelector(${JSON.stringify(selector)})`, 8_000);
      await page.click(selector);
    }
    if (shot.waitFor !== undefined) await page.waitFor(shot.waitFor, 8_000);
    if (shot.script !== undefined || (shot.click ?? []).length > 0) {
      await page.evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
    }

    writeFileSync(`${OUT}${shot.name}.png`, await page.screenshot());
    taken.push(shot);
    process.stdout.write(`  ${shot.name}\n`);
  } catch (error) {
    // A shot that cannot be taken is RECORDED, not swallowed: the index says
    // which screen would not render and what it said.
    failed.push({ shot, why: (error as Error).message });
    process.stdout.write(`  ${shot.name} — FAILED: ${(error as Error).message}\n`);
  }
}

await page.close();
await new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); });
await closeDb();

// ── the index ──────────────────────────────────────────────────────────────
// In coverage-matrix order, because the question it answers is "what exists
// and what is missing", and that is the document that has been wrong twice.

const MATRIX_ORDER = [
  'Chat', 'Tasks & notes', 'Money', 'Memory', 'Our story', 'Health', 'Album', 'Assistants',
  'Settings', 'Security', 'Data', 'Account', 'Consent', 'Subscription',
  'Notifications & permissions', 'PWA install', 'Splash / 404 / outage', 'Onboarding conversation',
  'Morning briefing', 'Search', 'User profile', 'Free limit', 'Conversation types',
  'Account recovery', 'Navigation drawer / rail',
];

const lines: string[] = [
  '# Lian — the product, photographed',
  '',
  `Generated by \`npm run shots\`. ${taken.length} shots, ${GAPS.length + failed.length} gaps.`,
  '',
  'Real screens, rendered by the real server from real rows — nothing here is a',
  'mock or hand-written markup. If a picture is wrong, the product is wrong.',
  '',
  `Every shot is dated **${TODAY}** and seeded deterministically, so re-running`,
  'produces the same pictures and a diff in this directory is a change to the',
  'product rather than a clock moving.',
  '',
  '**Gaps are listed, never skipped.** A set of pictures that looks complete is',
  'worse than one with holes in it, because the holes are the information —',
  'three of the rows below are features that do not exist.',
  '',
  '| naming | meaning |',
  '|---|---|',
  '| `-day` / `-quiet` / `-night` / `-night-warm` | the palette (time × mood, PRD §28) |',
  '| `-ltr` / `-rtl` / `-ar` | direction, and the Arabic build |',
  '| `-empty` / `-new` | the state before anything has been said |',
  '| `-desktop` | 1280px; everything else is a 390px phone |',
  '',
];

for (const area of MATRIX_ORDER) {
  const shots = taken.filter((shot) => shot.area === area);
  const gaps = GAPS.filter((gap) => gap.area === area);
  const broke = failed.filter((entry) => entry.shot.area === area);
  if (shots.length === 0 && gaps.length === 0 && broke.length === 0) {
    lines.push(`## ${area}`, '', '**Nothing captured, and no gap recorded** — this row of the coverage matrix',
      'has no shot and no reason for not having one, which is itself the finding.', '');
    continue;
  }
  lines.push(`## ${area}`, '');
  if (shots.length > 0) {
    lines.push('| | shot | |', '|---|---|---|');
    for (const shot of shots) {
      lines.push(`| <img src="${shot.name}.png" width="200"> | \`${shot.name}.png\`<br>\`${shot.path}\` | ${shot.note ?? ''} |`);
    }
    lines.push('');
  }
  for (const gap of [...gaps]) lines.push(`> **Gap — ${gap.name}.** ${gap.why}`, '');
  for (const entry of broke) {
    lines.push(`> **Would not render — ${entry.shot.name}** (\`${entry.shot.path}\`). ${entry.why}`, '');
  }
}

writeFileSync(`${OUT}INDEX.md`, `${lines.join('\n')}\n`);
console.log(`\n${taken.length} shots, ${failed.length} failed, ${GAPS.length} known gaps → docs/shots/INDEX.md`);
if (failed.length > 0) process.exitCode = 1;
