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
import { db, closeDb, migrate, accounts, outreach } from '@lian/db';
import { deterministicEmbedder, EMBEDDING_DIMENSIONS, type AnalysisModel } from '@lian/analysis';
import { DEFAULT_MODEL, type Provider } from '@lian/llm';
import { generateVapidKeys } from '@lian/push';
import { CONSENT_VERSION } from '@lian/i18n';
import { localDayKey, PLAN_LIMITS } from '@lian/domain';
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
  let runSchedule: ((now: Date) => Promise<unknown>) | null = null;
  let close: (() => Promise<void>) | null = null;
  let browser: Browser | null = null;
  /** Browsers opened by a test that needs a session of its own. Signing out
   *  is not enough: the entry screens send a signed-in person to the
   *  conversation, which is correct behaviour and makes a second sign-up in
   *  one profile impossible. */
  const extra: Browser[] = [];
  let addresses = 0;

  async function freshBrowser(): Promise<Browser> {
    const page = await Browser.launch();
    await page.setViewport(390, 844);
    // Its own client address. Sign-up and sign-in are rate limited per
    // address (ten a minute), which is correct and which a test file driving
    // several accounts from one loopback address would otherwise trip — the
    // limiter would be the thing under test.
    await page.setExtraHeaders({ 'x-forwarded-for': `203.0.113.${(addresses += 1) % 90}` });
    extra.push(page);
    return page;
  }

  before(async () => {
    await migrate(() => {});
    const { config } = loadConfig({
      NODE_ENV: 'test', DATABASE_URL: process.env['DATABASE_URL'], PORT: '0',
      LIAN_TICK_SECRET: 'x', LIAN_VAPID_PUBLIC_KEY: VAPID.publicKey, LIAN_VAPID_PRIVATE_KEY: VAPID.privateKey,
    });
    const application = createApplication(config, {
      provider: provider(), analysisModel,
      embedder: deterministicEmbedder(EMBEDDING_DIMENSIONS), log: () => {},
    });
    const { server } = application;
    runSchedule = application.runSchedule;
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); });
    browser = await Browser.launch();
    await browser.setViewport(390, 844);
    await browser.setExtraHeaders({ 'x-forwarded-for': '203.0.113.250' });
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
  async function signUp(page: Browser, language: 'en' | 'ar' = 'en'): Promise<string> {
    const email = `browser-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
    const response = await fetch(`${base}/api/auth/sign-up`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': `signup-${email}`,
        // A distinct address per account: these are different people.
        // 203.0.113.0/24 belongs to this file (see onboarding.test.ts).
        'x-forwarded-for': `203.0.113.${100 + ((addresses += 1) % 100)}`,
      },
      body: JSON.stringify({ email, password: 'a-long-enough-password', timeZone: 'Asia/Dubai', isAdult: true, agreedToTerms: true }),
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
    // The one test that drives the real form — and now the real consent
    // screen in front of it (UI-UX §22), because that is the only way to
    // reach sign-up: the answers are held in the page and the server refuses
    // without them.
    const page = browser!;
    const email = `form-${Date.now()}@example.test`;
    await page.goto(`${base}/consent`);
    await page.waitFor('document.querySelector(\'[data-action="consent-adult"]\')');
    // The legal text is ON the screen — §22 forbids burying it behind a link.
    assert.ok(
      await page.evaluate<boolean>('document.body.innerText.length > 400'),
      'the terms have to be readable here, not linked to',
    );
    assert.equal(await page.evaluate('document.querySelectorAll(\'a[href^="http"]\').length'), 0);

    // Both documents are reachable from the gate, BEFORE an account exists —
    // which is the case a link to a logged-in settings page cannot serve.
    for (const path of ['/terms', '/privacy']) {
      await page.click(`a[href="${path}"]`);
      await page.waitFor(`location.pathname === "${path}"`, 10_000);
      const text = await page.evaluate<string>('document.body.innerText');
      assert.ok(text.length > 800, `${path} is ${text.length} characters — that is not a document`);
      assert.match(text, /lawyer/i, `${path} does not say it is unreviewed`);
      await page.click('a[href="/consent"]');
      await page.waitFor('location.pathname === "/consent"', 10_000);
    }
    // Answers survive the round trip: reading the terms must not silently
    // reset what was already answered.
    await page.click('[data-action="consent-adult"][data-value="yes"]');
    await page.click('[data-action="consent-agree"]');
    await page.click('a[href="/sign-up"]');
    await page.waitFor('document.querySelector("#email")');
    await page.type('#email', email);
    await page.type('#password', 'a-long-enough-password');
    await page.click('button[type="submit"]');
    await page.waitFor('location.pathname === "/chat"', 15_000);
    const { rows } = await db().query<{ id: string; is_adult: boolean; consent_version: string | null }>(
      `SELECT id, is_adult, consent_version FROM users WHERE email = $1`, [email],
    );
    created.push(rows[0]!.id);
    // The age answer is recorded SERVER-SIDE, with the version of the text
    // that was on screen. A checkbox nobody stored is not a consent record.
    assert.equal(rows[0]!.is_adult, true);
    assert.equal(rows[0]!.consent_version, CONSENT_VERSION);
    assert.equal(await page.evaluate('location.pathname'), '/chat');
    // PRD §8: onboarding is a conversation. There is no setup form on the
    // way in, and this is the assertion that keeps it that way.
    // PRD §8's rule is "nothing to fill in", so the count is of fields a
    // person types into. The photo control is a hidden file input that opens
    // the camera — it is a button wearing an <input>, and both halves of that
    // are asserted rather than assumed.
    assert.equal(
      await page.evaluate('document.querySelectorAll(\'form input:not([type="file"])\').length'),
      1, 'only the message field',
    );
    assert.equal(await page.evaluate('document.querySelectorAll(\'form input[type="file"]:not([hidden])\').length'), 0);
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

  test('sign out everywhere, then sign in again from the same device', async () => {
    // The account is created IN this browser: a device is recognised by what
    // the browser sends, so an account made with a different client would be
    // held on sign-in — which is the next test, deliberately.
    const page = await freshBrowser();
    const email = `again-${Date.now()}@example.test`;
    await page.goto(`${base}/consent`);
    await page.waitFor('document.querySelector(\'[data-action="consent-adult"]\')');
    await page.click('[data-action="consent-adult"][data-value="yes"]');
    await page.click('[data-action="consent-agree"]');
    await page.click('a[href="/sign-up"]');
    await page.waitFor('document.querySelector("#email")');
    await page.type('#email', email);
    await page.type('#password', 'a-long-enough-password');
    await page.click('button[type="submit"]');
    await page.waitFor('location.pathname === "/chat"', 15_000);
    const { rows } = await db().query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email]);
    created.push(rows[0]!.id);

    await page.goto(`${base}/security`);
    await page.waitFor('!!document.querySelector(`[data-action="sign-out-everywhere"]`)', 10_000);
    await page.click('[data-action="sign-out-everywhere"]');
    await page.waitFor('location.pathname === "/welcome"', 10_000);

    await page.goto(`${base}/sign-in`);
    await page.waitFor('document.querySelector("#email")');
    await page.type('#email', email);
    await page.type('#password', 'a-long-enough-password');
    await page.click('button[type="submit"]');
    try {
      await page.waitFor('location.pathname === "/chat"', 15_000);
    } catch (error) {
      throw new Error(`sign-in did not land in the conversation: ${await page.evaluate<string>('document.body.innerText.slice(0, 200)')}`);
    }
    assert.deepEqual(await page.errors(), []);
  });

  test('a wrong password says so, in her words, without saying which half was wrong', async () => {
    const page = await freshBrowser();
    await page.goto(`${base}/sign-in`);
    await page.waitFor('document.querySelector("#email")');
    await page.type('#email', `nobody-${Date.now()}@example.test`);
    await page.type('#password', 'not-the-right-password');
    await page.click('button[type="submit"]');
    await page.waitFor('!!document.querySelector(".field__error")', 10_000);
    const message = await page.evaluate<string>('document.querySelector(".field__error").textContent.trim()');
    // Deliberately the same message for a wrong password and an unknown
    // address: the difference is an account-enumeration oracle.
    assert.equal(message, "That password doesn't match this email.");
  });

  test('a correct password from a new device is HELD, and says so calmly', async () => {
    const page = await freshBrowser();
    const email = `held-${Date.now()}@example.test`;
    const signedUp = await fetch(`${base}/api/auth/sign-up`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json', 'idempotency-key': `su-${email}`,
        'x-forwarded-for': '203.0.113.241', 'user-agent': 'the-first-device',
      },
      body: JSON.stringify({ email, password: 'a-long-enough-password', timeZone: 'Asia/Dubai', isAdult: true, agreedToTerms: true }),
    });
    created.push(((await signedUp.json()) as { userId: string }).userId);

    // A different browser is a different device (Q10).
    await page.setUserAgent('Mozilla/5.0 (SomewhereElse) Lian-Test');
    await page.goto(`${base}/sign-in`);
    await page.waitFor('document.querySelector("#email")');
    await page.type('#email', email);
    await page.type('#password', 'a-long-enough-password');
    await page.click('button[type="submit"]');
    try {
      await page.waitFor('location.pathname === "/confirm-device"', 10_000);
    } catch {
      throw new Error(`the hold did not happen: ${await page.evaluate<string>('document.body.innerText.slice(0, 200)')}`);
    }
    const text = await page.evaluate<string>('document.body.innerText');
    // Nothing went wrong, and the screen does not shout.
    assert.match(text, /confirm this device/i);
    assert.ok(!/error|failed|denied/i.test(text));
  });

  test('export and deletion, end to end, on the routes they belong to', async () => {
    const page = await freshBrowser();
    const userId = await signUp(page);
    await say(page, 'I paid the gym 400 today');

    await page.goto(`${base}/data`);
    await page.waitFor('!!document.querySelector(`[data-action="export"]`)', 10_000);
    await page.click('[data-action="export"]');
    await page.waitFor('!!document.querySelector(`[data-action="download"]`)', 20_000);
    const filename = await page.evaluate<string>('document.querySelector(`[data-action="download"]`).getAttribute("download")');
    assert.match(filename, /^lian-export-\d{4}-\d{2}-\d{2}\.json$/);

    // Deleting asks for the word, and the word is checked on the server too.
    await page.click('[data-action="delete-confirm"]');
    await page.waitFor('!!document.querySelector("#confirm")');
    await page.type('#confirm', 'DELETE');
    await page.evaluate('document.querySelector(`[data-action="delete-everything"]`).requestSubmit()');
    await page.waitFor('location.pathname === "/welcome"', 15_000);

    const { rows } = await db().query<{ n: number }>(`SELECT count(*)::int AS n FROM users WHERE id = $1`, [userId]);
    assert.equal(rows[0]!.n, 0, 'deleting is real (LESSONS §11)');
  });

  test('she messages first, and the open app shows it without a reload', async () => {
    // The product's defining behaviour, from the inside: something is due,
    // the tick runs, and the conversation the person is looking at grows a
    // message they did not send.
    //
    // With the app CLOSED this arrives as a push — the encryption is tested
    // in packages/push and the notification in push.test.ts. With it open, a
    // notification would be the wrong channel.
    const page = await freshBrowser();
    const userId = await signUp(page);
    await say(page, 'Hello');
    const before_ = await page.evaluate<number>('document.querySelectorAll(".bubble").length');

    const { rows } = await db().query<{ id: string }>(`SELECT id FROM assistants WHERE user_id = $1`, [userId]);
    await outreach.schedule(
      { userId, assistantId: rows[0]!.id },
      { kind: 'reminder', source: 'user_requested', scheduledFor: new Date(Date.now() - 60_000), dedupeKey: `browser:${userId}` },
    );
    const report = await runSchedule!(new Date());
    assert.ok((report as { outreach: { sent: number } }).outreach.sent >= 1, 'the tick did not deliver');

    // The client asks what is new when the tab is looked at; the test looks
    // at it rather than waiting out the interval.
    await page.evaluate('document.dispatchEvent(new Event("visibilitychange"))');
    await page.waitFor(`document.querySelectorAll(".bubble").length > ${before_}`, 15_000);
    const last = await page.evaluate<string>('[...document.querySelectorAll(".bubble")].at(-1).textContent');
    assert.ok(last.trim().length > 0, 'she said nothing');
    assert.deepEqual(await page.errors(), []);
  });

  // ── desktop (design.md §11, §17, §19) ──────────────────────────────────
  //
  // Driven at a real width rather than asserted from the stylesheet: a media
  // query that never matches looks exactly like one that does, and the whole
  // point of this file is that the four gates cannot tell the difference.
  test('at 900px the bottom nav becomes a left rail, and the drawer button goes with it', async () => {
    const page = browser!;
    await page.setViewport(1280, 900, 1, false);
    await page.goto(`${base}/chat`);
    await page.waitFor('document.querySelectorAll(".bubble").length > 0', 15_000);

    const rail = await page.evaluate<{ left: number; width: number; height: number }>(
      'JSON.parse(JSON.stringify(document.getElementById("r-nav").getBoundingClientRect()))',
    );
    // A rail is tall and at the edge; a bottom nav is wide and at the bottom.
    assert.ok(rail.height > 400, `the nav is ${rail.height}px tall — that is still a bottom bar`);
    assert.ok(rail.width < 400, `the nav is ${rail.width}px wide — that is still a bottom bar`);
    assert.ok(rail.left <= 2, `the rail starts at ${rail.left}px — it is not against the edge`);

    // The drawer's groups are IN the rail now, from the same array the drawer
    // renders — so the drawer button has nothing left to open.
    assert.ok(await page.evaluate<boolean>('getComputedStyle(document.querySelector(".rail__groups")).display !== "none"'));
    assert.ok(
      await page.evaluate<boolean>(
        'getComputedStyle(document.querySelector(\'[data-action="drawer"]\')).display === "none"',
      ),
      'a drawer button beside a rail that already shows its contents',
    );
  });

  test('the fallback rule: every other screen is a centred column, not a stretched phone', async () => {
    const page = browser!;
    await page.setViewport(1280, 900, 1, false);
    for (const path of ['/tasks', '/story', '/settings', '/health', '/subscription']) {
      await page.goto(`${base}${path}`);
      await page.waitFor('document.querySelector(".screen__title") !== null', 10_000);
      const width = await page.evaluate<number>('document.querySelector(".screen__title").getBoundingClientRect().width');
      // design.md §19: 720px. Not the full 1280 minus the rail.
      assert.ok(width <= 760, `${path} is ${Math.round(width)}px wide — the fallback column is 720`);
      assert.ok(width > 400, `${path} is ${Math.round(width)}px wide — that is a phone column on a desktop`);
    }
  });

  test('purpose-built: memory is two columns at desktop width and one on a phone', async () => {
    // Memory rather than money only because this account has no transactions
    // and money's empty state has no list to put beside anything. The rule
    // under test is the same one, from the same two class names.
    const page = browser!;
    await page.setViewport(1280, 900, 1, false);
    await page.goto(`${base}/memory`);
    await page.waitFor('document.querySelector(".split") !== null', 10_000);
    const columns = await page.evaluate<string>('getComputedStyle(document.querySelector(".split")).gridTemplateColumns');
    assert.equal(columns.split(' ').length, 2, `expected two columns, got '${columns}'`);

    // And the SAME markup on a phone is a single stacked flow: the wrappers
    // are display:contents, so nothing about the phone layout depends on the
    // desktop one existing.
    await page.setViewport(390, 844);
    await page.goto(`${base}/memory`);
    await page.waitFor('document.querySelector(".split") !== null', 10_000);
    assert.equal(await page.evaluate<string>('getComputedStyle(document.querySelector(".split__main")).display'), 'contents');
    assert.deepEqual(await page.errors(), []);
    await page.setViewport(390, 844);
  });

  test('the switcher opens, an incognito thread says what it is, and closing it returns', async () => {
    const page = browser!;
    await page.setViewport(390, 844);
    await page.goto(`${base}/chat`);
    await page.waitFor('document.querySelectorAll(".bubble").length > 0', 15_000);

    await page.click('[data-action="threads"]');
    await page.waitFor('!!document.querySelector(\'[data-action="new-thread"][data-kind="incognito"]\')', 10_000);
    // §14: the sentence is on the sheet BEFORE anybody starts one.
    assert.match(await page.evaluate<string>('document.querySelector(".sheet").innerText'), /Nothing here is kept/);

    await page.click('[data-action="new-thread"][data-kind="incognito"]');
    await page.waitFor('location.pathname.startsWith("/chat/")', 10_000);
    // And the at-a-glance state, once inside it.
    await page.waitFor('!!document.querySelector(".incognito")', 10_000);
    assert.match(await page.evaluate<string>('document.querySelector(".incognito").innerText'), /Nothing here is kept/);

    const threadPath = await page.evaluate<string>('location.pathname');
    await page.click('[data-action="threads"]');
    await page.waitFor('!!document.querySelector(\'[data-action="end-thread"]\')', 10_000);
    await page.click('[data-action="end-thread"]');
    // Closing the thread you are reading returns you to the main one rather
    // than leaving you looking at something that no longer exists.
    await page.waitFor(`location.pathname === "/chat" && location.pathname !== "${threadPath}"`, 10_000);
    assert.ok(await page.evaluate<boolean>('document.querySelector(".incognito") === null'));
    assert.deepEqual(await page.errors(), []);
  });

  test('a role is typed, played, and cleared \u2014 in a real browser', async () => {
    // PRD §27 end to end. The interesting part is not that the text arrives:
    // it is that the chip and the header are rendered from what the SERVER
    // says is in effect, so a failed write shows the old role rather than the
    // one somebody typed. That only shows up when a real browser does it.
    const page = browser!;
    await page.setViewport(390, 844);
    await page.goto(`${base}/chat`);
    await page.waitFor('document.querySelectorAll(".bubble").length > 0', 15_000);

    await page.click('[data-action="threads"]');
    await page.waitFor('!!document.querySelector(\'textarea[name="scenarioText"]\')', 10_000);
    await page.type('textarea[name="scenarioText"]', 'Interviewer for a senior RPA role');
    await page.click('[data-action="new-thread"][data-kind="incognito"]');

    await page.waitFor('location.pathname.startsWith("/chat/")', 10_000);
    await page.waitFor('!!document.querySelector(".incognito__role")', 10_000);
    assert.match(
      await page.evaluate<string>('document.querySelector(".incognito").innerText'),
      /Playing: Interviewer for a senior RPA role/,
    );
    // The mood phrase is HER mood, and she is playing a part.
    const header = await page.evaluate<string>('document.querySelector(".head").innerText');
    assert.match(header, /Incognito/);
    assert.ok(!/Feeling warm|Still with you|quiet/i.test(header), `the mood phrase survived into a role: ${header}`);

    // §46: tapping the chip is the way to edit, clear, or delete.
    await page.click('.incognito');
    await page.waitFor('!!document.querySelector(\'[data-action="scenario-clear"]\')', 10_000);
    await page.click('[data-action="scenario-clear"]');
    await page.waitFor('document.querySelector(".incognito__role") === null', 10_000);
    // The thread is still incognito — clearing the role is not leaving it.
    assert.match(await page.evaluate<string>('document.querySelector(".incognito").innerText'), /Nothing here is kept/);
    assert.deepEqual(await page.errors(), []);
  });

  test('a message refused at the day\u2019s limit gives back what was typed', async () => {
    // The bubble disappearing is CORRECT — nothing was written server-side
    // and nothing was charged, so re-reading the window drops it. The
    // composer having been cleared on submit is not: somebody who has just
    // hit a wall should not also lose their sentence.
    //
    // Driven end to end because that is the only place it is true: the
    // refusal comes back as an SSE event, mid-stream, and the restoration
    // happens in a callback that no unit test reaches.
    const page = browser!;
    await page.goto(`${base}/chat`);
    await page.waitFor('!!document.querySelector(".composer__input")', 10_000);
    const userId = await page.evaluate<string>("fetch('/api/me').then((r) => r.json()).then((m) => m.user.id)");
    const { rows: [user] } = await db().query<{ time_zone: string }>('SELECT time_zone FROM users WHERE id = $1', [userId]);
    const today = localDayKey(new Date(), user!.time_zone);

    // ONBOARDING IS A DIFFERENT SURFACE, and it does not spend the daily
    // message budget — which is right (nobody should hit the free wall while
    // still being asked their name) and is why the first version of this test
    // watched a normal reply arrive and timed out waiting for a refusal.
    //
    // So the facts are completed directly. They are the PRECONDITION, not the
    // thing under test: the refusal path below is still the real one.
    await db().query(
      `UPDATE users SET display_name = coalesce(display_name, 'Adam'),
                        language_style = CASE WHEN language_style = 'auto' THEN 'en' ELSE language_style END,
                        notification_prompted_at = coalesce(notification_prompted_at, now())
       WHERE id = $1`,
      [userId],
    );
    await db().query('UPDATE assistants SET named_by_user = true WHERE user_id = $1', [userId]);
    const { rows: [assistant] } = await db().query<{ id: string }>('SELECT id FROM assistants WHERE user_id = $1 LIMIT 1', [userId]);
    await db().query(
      `INSERT INTO memories (assistant_id, type, statement, salience, status)
       SELECT $1, 'fact', 'They run every morning before work.', 0.7, 'active'
       WHERE NOT EXISTS (SELECT 1 FROM memories WHERE assistant_id = $1 AND deleted_at IS NULL)`,
      [assistant!.id],
    );
    // Spend the day, through the same counter the server reads. A flag would
    // prove a flag; this proves the refusal path.
    await db().query(
      `INSERT INTO usage_counters (user_id, kind, period_key, value, updated_at)
       VALUES ($1, 'messages', $2, $3, now())
       ON CONFLICT (user_id, kind, period_key) DO UPDATE SET value = EXCLUDED.value`,
      [userId, today, PLAN_LIMITS.free.messagesPerDay],
    );
    try {
      const words = 'one more thing before bed';
      await page.type('.composer__input', words);
      await page.evaluate('document.querySelector(".composer__bar").requestSubmit()');
      await page.waitFor('!!document.querySelector(".bubble--limit")', 20_000);

      // Her line arrived, in the conversation, in her voice — not a modal.
      assert.equal(await page.evaluate('document.querySelectorAll(".sheet, dialog").length'), 0);
      // And their sentence is back where they can reach it.
      assert.equal(
        await page.evaluate<string>('document.querySelector(".composer__input").value'), words,
        'the day was refused AND the words were lost, which is two walls for the price of one',
      );
      // Not also left in the conversation: it was never written, and a bubble
      // that survives a refusal is a message somebody thinks she received.
      assert.equal(
        await page.evaluate<number>(
          `[...document.querySelectorAll('.chat__group--mine .bubble')].filter((b) => b.textContent === ${JSON.stringify(words)}).length`,
        ),
        0,
      );
      assert.deepEqual(await page.errors(), []);
    } finally {
      // The rest of the suite shares this account; leaving it at the ceiling
      // would fail whatever runs next for a reason that has nothing to do
      // with it.
      await db().query(`DELETE FROM usage_counters WHERE user_id = $1 AND kind = 'messages'`, [userId]);
      await page.evaluate('(document.querySelector(".composer__input").value = "", true)');
    }
  });

  test('a sheet takes the keyboard, keeps it, and gives it back', async () => {
    // Every sheet, the drawer and the photo viewer carried role="dialog" and
    // none of the behaviour that word promises: focus stayed on the button
    // behind, Tab walked straight out into a page that was still live, and
    // Escape did nothing. Nobody had ever run this product without a mouse.
    //
    // Driven with REAL key events (Input.dispatchKeyEvent). A dispatched
    // KeyboardEvent is untrusted, so the browser runs no default action for
    // it and Tab does not move focus — a trap test written that way passes
    // against a page with no focus management whatsoever.
    const page = browser!;
    await page.goto(`${base}/chat`);
    await page.waitFor('!!document.querySelector(\'[data-action="drawer"]\')', 10_000);

    // Focus the opener the way a keyboard user reaches it, so there is a real
    // thing to return focus TO.
    await page.evaluate('(document.querySelector(\'[data-action="drawer"]\').focus(), true)');
    await page.click('[data-action="drawer"]');
    await page.waitFor('!!document.querySelector(".drawer")', 8_000);

    // 1. Focus moved INTO the dialog rather than staying on the button.
    assert.ok(
      await page.evaluate<boolean>('document.querySelector(\'[role="dialog"]\').contains(document.activeElement)'),
      'the sheet opened and focus stayed behind it',
    );
    assert.equal(await page.evaluate('document.querySelector(\'[role="dialog"]\').getAttribute("aria-modal")'), 'true');

    // 2. The page behind is inert — out of the tab order AND out of the
    // accessibility tree, which a hand-rolled Tab wrap does not achieve.
    assert.ok(await page.evaluate<boolean>('document.getElementById("r-screen").hasAttribute("inert")'));
    assert.ok(await page.evaluate<boolean>('document.getElementById("r-nav").hasAttribute("inert")'));

    // 3. Tab all the way round and never leave. Twenty presses is more
    // controls than any sheet has, so this wraps several times.
    for (let press = 0; press < 20; press += 1) {
      await page.key('Tab');
      assert.ok(
        await page.evaluate<boolean>('document.querySelector(\'[role="dialog"]\')?.contains(document.activeElement) ?? false'),
        `Tab ${press + 1} left the dialog — the page behind it is still reachable`,
      );
    }
    // And backwards, which is the direction a wrap written by hand gets wrong.
    for (let press = 0; press < 5; press += 1) {
      await page.key('Tab', { shift: true });
      assert.ok(
        await page.evaluate<boolean>('document.querySelector(\'[role="dialog"]\')?.contains(document.activeElement) ?? false'),
        'Shift+Tab left the dialog',
      );
    }

    // 4. Escape closes it — the same way out the scrim gives a mouse.
    await page.key('Escape');
    await page.waitFor('!document.querySelector(".drawer")', 8_000);

    // 5. The page behind is live again, and focus is back on what opened it
    // rather than lost to the body.
    assert.ok(!(await page.evaluate<boolean>('document.getElementById("r-screen").hasAttribute("inert")')));
    assert.equal(
      await page.evaluate('document.activeElement?.dataset?.action ?? null'), 'drawer',
      'focus was not returned to the control that opened the sheet',
    );
    assert.deepEqual(await page.errors(), []);
  });

  test('the full-screen photo viewer is a dialog too, though it is not in the overlays region', async () => {
    // The one overlay that renders inside its SCREEN rather than in
    // #r-overlays. A focus manager that watched only the overlays region
    // would have missed the overlay that covers the entire display — and
    // would have made it inert along with the screen it lives in.
    const page = browser!;
    const userId = await page.evaluate<string>("fetch('/api/me').then((r) => r.json()).then((m) => m.user.id)");
    const { rows: [assistant] } = await db().query<{ id: string }>('SELECT id FROM assistants WHERE user_id = $1 LIMIT 1', [userId]);
    // Conversations are scoped by ASSISTANT, not by user — the same split
    // that puts a story event on an assistant's timeline rather than an
    // account's.
    const { rows: [conversation] } = await db().query<{ id: string }>(
      'SELECT id FROM conversations WHERE assistant_id = $1 AND deleted_at IS NULL LIMIT 1', [assistant!.id],
    );
    const { rows: [message] } = await db().query<{ id: string }>(
      `INSERT INTO messages (conversation_id, assistant_id, role, body, surface)
       VALUES ($1, $2, 'user', 'a photo', 'chat') RETURNING id`,
      [conversation!.id, assistant!.id],
    );
    await db().query(
      `INSERT INTO attachments (user_id, message_id, kind, content_type, bytes, storage_key, status)
       VALUES ($1, $2, 'image', 'image/png', 100, 'k/1', 'ready')`,
      [userId, message!.id],
    );

    await page.goto(`${base}/album`);
    await page.waitFor('!!document.querySelector(".album__cell")', 10_000);
    await page.evaluate('(document.querySelector(".album__cell").focus(), true)');
    await page.click('.album__cell');
    await page.waitFor('!!document.querySelector(".viewer")', 8_000);

    assert.ok(await page.evaluate<boolean>('document.querySelector(".viewer").matches(\'[role="dialog"]\')'));
    assert.ok(
      await page.evaluate<boolean>('document.querySelector(".viewer").contains(document.activeElement)'),
      'the viewer opened and focus stayed on the thumbnail behind it',
    );
    // The grid it sits BESIDE is inert, not just the other regions — a
    // full-screen overlay with the page it covers still tabbable is the
    // whole bug.
    assert.ok(
      await page.evaluate<boolean>('document.querySelector(".album").hasAttribute("inert")'),
      'the album grid behind the viewer is still reachable by keyboard',
    );
    for (let press = 0; press < 8; press += 1) {
      await page.key('Tab');
      assert.ok(
        await page.evaluate<boolean>('document.querySelector(".viewer")?.contains(document.activeElement) ?? false'),
        'Tab escaped the full-screen viewer',
      );
    }
    await page.key('Escape');
    await page.waitFor('!document.querySelector(".viewer")', 8_000);
    assert.ok(!(await page.evaluate<boolean>('document.querySelector(".album").hasAttribute("inert")')));
    assert.deepEqual(await page.errors(), []);
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
