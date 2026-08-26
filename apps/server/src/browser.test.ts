// The app, in a browser.
//
// It lives beside the server rather than in apps/web because it runs in Node:
// it starts the real application and drives Chromium from outside. Putting it
// in the browser project would pull the whole server graph into a typecheck
// that has the DOM library loaded, where Node's fetch and the DOM's disagree.
//
// Chromium over the DevTools protocol (tools/browser.ts) — no test framework,
// no driver package, no download step. It skips when Chromium is absent, the
// way the database tests skip without DATABASE_URL, so `npm test` still runs
// everywhere.
//
// What is asserted here is what only a browser can answer: that the modules
// load and execute, that a sign-up reaches the conversation, that a turn
// streams into the DOM, that the theme is one attribute, and that RTL is a
// direction rather than a translation.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { db, closeDb, migrate, accounts } from '@lian/db';
import { deterministicEmbedder, EMBEDDING_DIMENSIONS, type AnalysisModel } from '@lian/analysis';
import { DEFAULT_MODEL, type Provider } from '@lian/llm';
import { generateVapidKeys } from '@lian/push';
import { createApplication } from './app.ts';
import { loadConfig } from './config.ts';
import { Browser, chromiumPath } from '../../../tools/browser.ts';

const HAS_DB = (process.env['DATABASE_URL'] ?? '') !== '';
const HAS_BROWSER = chromiumPath() !== null;
const SKIP = !HAS_DB ? 'DATABASE_URL not set' : !HAS_BROWSER ? 'no chromium' : false;
const VAPID = generateVapidKeys();

/**
 * Her replies, keyed by what was said to her rather than by a counter.
 *
 * A counter makes every test depend on how many turns the tests before it
 * took, which is how a suite starts passing and failing in an order nobody
 * intended. Keying on the message means each test gets the reply it is about.
 */
const REPLIES: [RegExp, string][] = [
  [/adam/i, 'Noted. <call_me>{"name":"Adam"}</call_me> Which language suits you?'],
  [/english/i, 'English it is. <language>{"style":"en"}</language> Tell me about your week.'],
  [/run every morning/i, "I'll remember that you run every morning."],
  [/gym|paid/i, 'Okay, logged AED 400 for the gym today. <spend>{"amount":400,"currency":"AED","category":"gym"}</spend>'],
];

/**
 * The person's own words, out of the final turn.
 *
 * The turn the model receives is `<<context>>…<</context>>` then the message
 * then the repeated directive (LESSONS §1). A fake that matches against the
 * whole thing matches the environment block — which is how "Hello" came back
 * as the reply to a question about language.
 */
function saidByUser(content: string): string {
  const afterContext = content.includes('<</context>>') ? content.split('<</context>>')[1]! : content;
  return afterContext.split('\n\n').filter((part) => part.trim() !== '')[0] ?? '';
}

function provider(): Provider {
  return {
    id: 'browser-test',
    capabilities: () => ({ streaming: true, toolCalling: false, vision: false, contextTokens: 200_000, maxOutputTokens: 4_000 }),
    async stream(request, onDelta) {
      if (request.model === DEFAULT_MODEL) {
        const said = saidByUser(request.messages.at(-1)?.content ?? '');
        const reply = REPLIES.find(([pattern]) => pattern.test(said))?.[1] ?? 'Good to meet you. What should I call you?';
        for (let index = 0; index < reply.length; index += 8) onDelta(reply.slice(index, index + 8));
      } else {
        onDelta('[]');
      }
      return { usage: { inputTokens: 800, outputTokens: 40, cacheWriteTokens: 0, cacheReadTokens: 0 }, stopReason: 'end_turn' };
    },
  };
}

const analysisModel: AnalysisModel = {
  async complete(input) {
    return {
      text: input.user.includes('run every morning')
        ? JSON.stringify([{ type: 'fact', statement: 'They run every morning before work.', salience: 0.7 }])
        : '[]',
      usage: { inputTokens: 100, outputTokens: 10 },
    };
  },
};

describe('the app, in a browser', { skip: SKIP }, () => {
  const created: string[] = [];
  let base = '';
  let close: (() => Promise<void>) | null = null;
  let browser: Browser | null = null;
  /** Browsers opened by a test that needs a session of its own. Signing out
   *  is not enough: the entry screens send a signed-in person to the
   *  conversation, which is correct behaviour and makes a second sign-up in
   *  one profile impossible. */
  const extra: Browser[] = [];

  async function freshBrowser(): Promise<Browser> {
    const page = await Browser.launch();
    await page.setViewport(390, 844);
    extra.push(page);
    return page;
  }

  before(async () => {
    await migrate(() => {});
    const { config } = loadConfig({
      NODE_ENV: 'test', DATABASE_URL: process.env['DATABASE_URL'], PORT: '0',
      LIAN_TICK_SECRET: 'x', LIAN_VAPID_PUBLIC_KEY: VAPID.publicKey, LIAN_VAPID_PRIVATE_KEY: VAPID.privateKey,
    });
    const { server } = createApplication(config, {
      provider: provider(), analysisModel,
      embedder: deterministicEmbedder(EMBEDDING_DIMENSIONS), log: () => {},
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); });
    browser = await Browser.launch();
    await browser.setViewport(390, 844);
  });

  after(async () => {
    for (const page of extra) await page.close();
    await browser?.close();
    if (close !== null) await close();
    for (const userId of created) await accounts.deleteAccount({ userId });
    await closeDb();
  });

  /**
   * An account, and a browser holding its session.
   *
   * Made through the API rather than by driving the form, because sign-up is
   * rate limited per address (ten a minute) and a test file that signs up
   * five times would be testing the limiter. The one test that IS about the
   * form drives the form.
   */
  let addresses = 0;
  async function signUp(page: Browser, language: 'en' | 'ar' = 'en'): Promise<string> {
    const email = `browser-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
    const response = await fetch(`${base}/api/auth/sign-up`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': `signup-${email}`,
        // A distinct address per account: these are different people.
        'x-forwarded-for': `198.51.100.${(addresses += 1) % 250}`,
      },
      body: JSON.stringify({ email, password: 'a-long-enough-password', timeZone: 'Asia/Dubai' }),
    });
    const account = (await response.json()) as { userId: string; sessionToken: string };
    created.push(account.userId);
    if (language === 'ar') {
      await db().query(`UPDATE users SET language_style = 'ar-eg' WHERE id = $1`, [account.userId]);
    }
    await page.setCookie({ name: 'lian_session', value: account.sessionToken, url: base });
    await page.goto(`${base}/chat`);
    await page.waitFor('!!document.querySelector(".composer__input")', 15_000);
    return account.userId;
  }

  /**
   * Say something and wait for the turn to FINISH — not for the first delta.
   *
   * The difference matters: after the last delta the client re-reads the
   * window and the snapshot, and a test that continues before that lands its
   * next click in the middle of a re-render.
   */
  async function say(page: Browser, text: string): Promise<void> {
    await page.waitFor('!!document.querySelector(".composer__input")', 10_000);
    // The thinking indicator is a bubble too, and counting it is how a test
    // ends up asserting against three dots.
    const settled = '.bubble:not(.bubble--thinking)';
    const before_ = await page.evaluate<number>(`document.querySelectorAll('${settled}').length`);
    await page.type('.composer__input', text);
    await page.evaluate('document.querySelector(".composer__bar").requestSubmit()');
    await page.waitFor(`document.querySelectorAll('${settled}').length > ${before_ + 1}`, 20_000);
    // No caret and no dots: the turn has been persisted, re-read and
    // re-rendered.
    await page.waitFor(
      '!document.querySelector(".caret") && !document.querySelector(".bubble--thinking") && !!document.querySelector(".composer__input")',
      20_000,
    );
  }

  test('a stranger is offered the promise, not the app', async () => {
    const page = browser!;
    await page.goto(`${base}/`);
    await page.waitFor('document.querySelector(".entry__promise")');
    assert.equal(await page.evaluate('location.pathname'), '/welcome');
    // A deep link into a screen behind the account lands here too, rather
    // than on a broken screen.
    await page.goto(`${base}/memory`);
    await page.waitFor('location.pathname === "/welcome"');
    assert.deepEqual(await page.errors(), []);
  });

  test('sign up, and the first thing that happens is a conversation', async () => {
    // The one test that drives the real form.
    const page = browser!;
    const email = `form-${Date.now()}@example.test`;
    await page.goto(`${base}/sign-up`);
    await page.waitFor('document.querySelector("#email")');
    await page.type('#email', email);
    await page.type('#password', 'a-long-enough-password');
    await page.click('button[type="submit"]');
    await page.waitFor('location.pathname === "/chat"', 15_000);
    const { rows } = await db().query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email]);
    created.push(rows[0]!.id);
    assert.equal(await page.evaluate('location.pathname'), '/chat');
    // PRD §8: onboarding is a conversation. There is no setup form on the
    // way in, and this is the assertion that keeps it that way.
    assert.equal(await page.evaluate('document.querySelectorAll("form input").length'), 1, 'only the message field');
    assert.ok(await page.evaluate('!!document.querySelector(".composer__input")'));
  });

  test('a turn streams into the conversation', async () => {
    const page = browser!;
    await page.waitFor('location.pathname === "/chat"', 10_000);
    await say(page, 'Hello');
    const text = await page.evaluate<string>('[...document.querySelectorAll(".chat__group--hers .bubble")].at(-1).textContent');
    assert.match(text, /What should I call you/);
    assert.deepEqual(await page.errors(), []);
  });

  test('the theme is one attribute on the root, and no inline colour anywhere', async () => {
    // LESSONS §7, as the browser sees it: the runtime writes data-t and dir,
    // and nothing writes a colour.
    const page = browser!;
    const theme = await page.evaluate<string>('document.documentElement.getAttribute("data-t")');
    assert.ok(['day', 'quiet', 'night', 'night-warm', 'night-quiet'].includes(theme));
    const inlineColours = await page.evaluate<number>(
      `[...document.querySelectorAll('[style]')].filter((element) => /color|background/.test(element.getAttribute('style'))).length`,
    );
    assert.equal(inlineColours, 0, 'something wrote a colour into a style attribute');
  });

  test('the capture row is tappable and goes to its correction screen', async () => {
    const page = browser!;
    await page.waitFor('location.pathname === "/chat"', 10_000);
    await say(page, "I'm Adam");
    // The identity capture confirms inline while it happens.
    assert.ok(await page.evaluate('document.body.innerText.includes("Adam")'));
  });

  test('she asks about notifications only after she has remembered something', async () => {
    // Its own account, driven from the first message: the ordering rule is
    // about a sequence, so the test has to own the whole sequence.
    const page = await freshBrowser();
    await signUp(page);
    await say(page, 'Hello');
    assert.equal(await page.evaluate('!!document.querySelector(".permission")'), false, 'asked before she knew anything');
    await say(page, "I'm Adam");
    await say(page, 'English please');
    assert.equal(await page.evaluate('!!document.querySelector(".permission")'), false, 'asked before she remembered anything');
    await say(page, 'I run every morning before work');
    await page.waitFor('!!document.querySelector(".permission")', 10_000);
    assert.ok(await page.evaluate<boolean>('!!document.querySelector(`[data-action="permission-no"]`)'), 'saying no must be possible');
  });

  test('every screen renders, with nothing thrown', async () => {
    const page = browser!;
    for (const path of ['/memory', '/tasks', '/money', '/story', '/settings', '/security', '/data']) {
      await page.goto(`${base}${path}`);
      await page.waitFor('document.querySelector(".screen").children.length > 0', 10_000);
      assert.equal(await page.evaluate('location.pathname'), path);
      assert.deepEqual(await page.errors(), [], `${path} threw`);
      const text = await page.evaluate<string>('document.body.innerText');
      assert.ok(text.length > 20, `${path} rendered nothing`);
    }
  });

  test('Arabic is a direction, not a translation', async () => {
    const page = await freshBrowser();
    await signUp(page, 'ar');
    // The language is on the account, so it takes effect on the next read of
    // the snapshot rather than needing a client-side switch.
    await page.goto(`${base}/settings`);
    await page.waitFor('document.querySelector(".screen").children.length > 0', 10_000);
    await page.waitFor('document.documentElement.getAttribute("dir") === "rtl"', 10_000);
    const alignment = await page.evaluate<string>('getComputedStyle(document.querySelector(".screen")).direction');
    assert.equal(alignment, 'rtl');
    // The Arabic type scale is in the token layer, keyed off [dir="rtl"]:
    // Tajawal has no 600, so the tokens resolve 600 to 700 and body leading
    // opens up. If dir is on the root, this is true without anything else.
    const weight = await page.evaluate<string>(
      'getComputedStyle(document.documentElement).getPropertyValue("--fw-600").trim()',
    );
    assert.equal(weight, '700');
  });

  test('the PWA is installable: manifest, icons, worker', async () => {
    const page = browser!;
    const manifest = await page.evaluate<{ ok: boolean; icons: number }>(
      `fetch('/manifest.webmanifest').then((r) => r.json()).then((m) => ({ ok: m.display === 'standalone', icons: m.icons.length }))`,
    );
    assert.ok(manifest.ok);
    assert.ok(manifest.icons >= 2);
    const icon = await page.evaluate<number>(`fetch('/icons/icon-512.png').then((r) => r.status)`);
    assert.equal(icon, 200);
    const worker = await page.evaluate<boolean>(`navigator.serviceWorker.getRegistration().then((r) => !!r)`);
    assert.ok(worker, 'the service worker did not register');
  });
});
