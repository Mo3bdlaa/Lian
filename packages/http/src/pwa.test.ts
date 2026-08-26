// The permission flow, run rather than read.
//
// PUSH_CLIENT is a string of browser code, which is the easiest kind of code
// to be wrong about and never notice. So it is executed here against fake
// browser objects: what matters is not that it compiles but that BOTH answers
// reach the server — a refusal that is never recorded means she asks again
// every turn, into a dialogue the browser will not show twice.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { PUSH_CLIENT, staticFiles, manifestJson, SERVICE_WORKER } from './pwa.ts';

/** Not a colour on purpose: these files carry whatever the composition root
 *  reads out of the token file, and a hex literal here would be a second
 *  place a colour is written down. */
const SENTINEL = 'sentinel-not-a-colour';

type Call = { path: string; body: unknown };

function browser(options: {
  permission: 'granted' | 'denied' | 'default';
  supported?: boolean;
  keyStatus?: number;
}) {
  const calls: Call[] = [];
  const supported = options.supported ?? true;

  const context: Record<string, unknown> = {
    atob: (value: string) => Buffer.from(value, 'base64').toString('binary'),
    Uint8Array,
    JSON,
    Promise,
    async fetch(path: string, init?: { body?: string }) {
      if (path === '/api/push/key') {
        return {
          ok: (options.keyStatus ?? 200) === 200,
          json: async () => ({ publicKey: Buffer.alloc(65, 4).toString('base64url') }),
        };
      }
      calls.push({ path, body: init?.body === undefined ? null : JSON.parse(init.body) });
      return { ok: true, json: async () => ({}) };
    },
    navigator: supported
      ? {
          serviceWorker: {
            ready: Promise.resolve({
              pushManager: {
                subscribe: async () => ({
                  toJSON: () => ({ endpoint: 'https://push.example/xyz', keys: { p256dh: 'p', auth: 'a' } }),
                }),
              },
            }),
          },
        }
      : {},
    Notification: { requestPermission: async () => options.permission },
  };
  context['window'] = supported ? { PushManager: {}, Notification: context['Notification'] } : {};
  runInNewContext(PUSH_CLIENT, context);
  return { calls, push: (context['window'] as { lianPush: { enable(key: string): Promise<string> } }).lianPush };
}

describe('asking for the notification permission', () => {
  test('granted subscribes with the endpoint the browser gave', async () => {
    const fake = browser({ permission: 'granted' });
    assert.equal(await fake.push.enable('k-1'), 'granted');
    assert.deepEqual(fake.calls, [{
      path: '/api/push/subscribe',
      body: { endpoint: 'https://push.example/xyz', keys: { p256dh: 'p', auth: 'a' } },
    }]);
  });

  test('DENIED is reported too, or she asks again forever', async () => {
    const fake = browser({ permission: 'denied' });
    assert.equal(await fake.push.enable('k-2'), 'denied');
    assert.deepEqual(fake.calls, [{ path: '/api/push/prompted', body: { outcome: 'denied' } }]);
  });

  test('a dismissed prompt counts as asked', async () => {
    // The browser answers 'default' when someone closes the dialogue. It will
    // not show it again unprompted, so onboarding has to move on.
    const fake = browser({ permission: 'default' });
    assert.equal(await fake.push.enable('k-3'), 'dismissed');
    assert.deepEqual(fake.calls, [{ path: '/api/push/prompted', body: { outcome: 'dismissed' } }]);
  });

  test('a browser that cannot do push says so instead of asking', async () => {
    const fake = browser({ permission: 'granted', supported: false });
    assert.equal(await fake.push.enable('k-4'), 'unsupported');
    assert.deepEqual(fake.calls, [{ path: '/api/push/prompted', body: { outcome: 'unsupported' } }]);
  });

  test('a deployment with no keys does NOT burn the one ask', async () => {
    // Nothing was asked: recording it would leave the person permanently
    // un-asked once the keys are configured.
    const fake = browser({ permission: 'granted', keyStatus: 503 });
    assert.equal(await fake.push.enable('k-5'), 'unconfigured');
    assert.deepEqual(fake.calls, []);
  });
});

describe('the PWA files', () => {
  test('the shell loads the permission helper and the worker', () => {
    const files = staticFiles(SENTINEL);
    assert.match(files['/']!.body, /src="\/push\.js"/);
    assert.match(files['/']!.body, /serviceWorker\.register\('\/sw\.js'\)/);
    assert.ok(files['/push.js'] !== undefined);
  });

  test('the theme colour comes from outside this file', () => {
    // The token file is the only place a colour is written down; this proves
    // the manifest carries whatever it is given rather than a literal.
    assert.match(manifestJson(SENTINEL), new RegExp(`"theme_color":"${SENTINEL}"`));
    assert.match(staticFiles(SENTINEL)['/']!.body, new RegExp(`content="${SENTINEL}"`));
  });

  test('the worker waits for the notification it draws', () => {
    // Without waitUntil the worker can be killed before the notification is
    // drawn and the push is silently lost — the failure this product is
    // named for.
    assert.match(SERVICE_WORKER, /event\.waitUntil\(/);
    assert.match(SERVICE_WORKER, /showNotification/);
  });
});
