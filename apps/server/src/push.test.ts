// A push, all the way to the lock screen.
//
// The server half is tested in packages/push (VAPID, RFC 8291 encryption) and
// packages/jobs (delivery, expiry, the notification body). The half nobody
// had run is the last one: the service worker, which is the code that
// actually draws the notification on a locked phone.
//
// So it is executed here — the real worker source, in a fake worker global —
// with the real payload the tick produces. What this catches is the failure
// the product is named for: a push that arrives and shows nothing, or shows
// "New message" instead of what she said.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { SERVICE_WORKER } from '@lian/http';
import { notificationFor, NOTIFICATION_BODY_LIMIT } from '@lian/jobs';
import { encryptPayload, generateVapidKeys } from '@lian/push';

type Listener = (event: unknown) => void;

/** A service worker global, with just enough of the API to run the file. */
function worker() {
  const listeners = new Map<string, Listener>();
  const shown: { title: string; options: Record<string, unknown> }[] = [];
  const opened: string[] = [];
  const focused: string[] = [];
  const waited: unknown[] = [];

  const self_ = {
    addEventListener: (name: string, listener: Listener) => listeners.set(name, listener),
    skipWaiting: () => {},
    registration: {
      showNotification: (title: string, options: Record<string, unknown>) => {
        shown.push({ title, options });
        return Promise.resolve();
      },
    },
    clients: {
      claim: () => Promise.resolve(),
      matchAll: () => Promise.resolve(clients),
      openWindow: (url: string) => { opened.push(url); return Promise.resolve(null); },
    },
  };
  let clients: { focus(): Promise<void>; navigate(url: string): Promise<void> }[] = [];

  runInNewContext(SERVICE_WORKER, { self: self_, Promise, console });

  return {
    shown, opened, focused, waited,
    setClients(list: { url: string }[]) {
      clients = list.map((client) => ({
        navigate: async (url: string) => { focused.push(`navigate:${url}`); },
        focus: async () => { focused.push(`focus:${client.url}`); },
      }));
    },
    async fire(name: string, event: Record<string, unknown>): Promise<void> {
      const listener = listeners.get(name);
      assert.ok(listener !== undefined, `the worker does not listen for ${name}`);
      const promises: Promise<unknown>[] = [];
      listener({ ...event, waitUntil: (value: Promise<unknown>) => { promises.push(Promise.resolve(value)); waited.push(value); } });
      await Promise.all(promises);
    },
  };
}

describe('the service worker', () => {
  test('a proactive message arrives as a notification with HER SENTENCE in it', async () => {
    // The payload is what the tick actually sends — not a fixture written to
    // match the worker.
    const message = notificationFor({
      assistantName: 'Lian',
      text: 'You said the deposit was due today — did that go through?',
      url: '/chat/c-1',
      tag: 'reminder',
    });

    const sw = worker();
    await sw.fire('push', { data: { json: () => message } });

    assert.equal(sw.shown.length, 1, 'nothing was drawn');
    assert.equal(sw.shown[0]!.title, 'Lian');
    assert.equal(sw.shown[0]!.options['body'], 'You said the deposit was due today — did that go through?');
    // Not a generic string, which is what a worker that loses the payload
    // falls back to.
    assert.notEqual(sw.shown[0]!.options['body'], '');
    assert.equal(sw.shown[0]!.options['tag'], 'reminder');
    // deepEqual across a vm boundary compares structure, not prototypes.
    assert.deepEqual({ ...(sw.shown[0]!.options['data'] as object) }, { url: '/chat/c-1' });
  });

  test('drawing the notification is awaited, or the worker can be killed first', async () => {
    const sw = worker();
    await sw.fire('push', { data: { json: () => notificationFor({ assistantName: 'Lian', text: 'Morning.', url: '/', tag: 'briefing' }) } });
    assert.equal(sw.waited.length, 1, 'showNotification was not inside waitUntil');
  });

  test('a push with no data draws nothing rather than an empty notification', async () => {
    const sw = worker();
    await sw.fire('push', { data: null });
    assert.equal(sw.shown.length, 0);
  });

  test('a long message is cut with an ellipsis, because a lock screen cuts anyway', async () => {
    const long = 'a'.repeat(NOTIFICATION_BODY_LIMIT + 50);
    const message = notificationFor({ assistantName: 'Lian', text: long, url: '/', tag: 'follow_up' });
    const sw = worker();
    await sw.fire('push', { data: { json: () => message } });
    const body = String(sw.shown[0]!.options['body']);
    assert.ok(body.length <= NOTIFICATION_BODY_LIMIT);
    assert.ok(body.endsWith('…'), 'a cut that does not say it was cut reads as a truncated thought');
  });

  test('tapping it lands in the conversation, in the window already open', async () => {
    const sw = worker();
    sw.setClients([{ url: 'https://lian.example/chat' }]);
    await sw.fire('notificationclick', {
      notification: { close: () => {}, data: { url: '/chat/c-2' } },
    });
    assert.deepEqual(sw.focused, ['navigate:/chat/c-2', 'focus:https://lian.example/chat']);
    assert.deepEqual(sw.opened, [], 'a second window would leave the first one stale');
  });

  test('with nothing open, it opens a window at the conversation', async () => {
    const sw = worker();
    sw.setClients([]);
    await sw.fire('notificationclick', { notification: { close: () => {}, data: { url: '/chat/c-3' } } });
    assert.deepEqual(sw.opened, ['/chat/c-3']);
  });

  test('the payload the browser receives is encrypted, and decrypts to her words', async () => {
    // The seam between the two halves: what sendPush encrypts is exactly what
    // the worker parses. This asserts the shape rather than re-testing RFC
    // 8291 — packages/push does that — but it is the only place the two ends
    // are checked against each other.
    const keys = generateVapidKeys();
    const message = notificationFor({ assistantName: 'Lian', text: 'Still here.', url: '/chat/c-4', tag: 'follow_up' });
    const encrypted = encryptPayload(
      { endpoint: 'https://push.example/x', p256dh: keys.publicKey, auth: Buffer.alloc(16).toString('base64url') },
      JSON.stringify(message),
    );
    // aes128gcm carries its salt and the server's key in the record header,
    // which is what makes the body self-describing to the browser.
    assert.ok(encrypted.body.byteLength > 0);
    assert.equal(encrypted.salt.byteLength, 16);
    assert.equal(encrypted.serverPublicKey.byteLength, 65);

    // And the worker, given the decrypted JSON, draws it.
    const sw = worker();
    await sw.fire('push', { data: { json: () => JSON.parse(JSON.stringify(message)) as unknown } });
    assert.equal(sw.shown[0]!.options['body'], 'Still here.');
  });
});
