// Delivery, end to end: a proactive turn's text, decrypted from the push body.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv, createECDH, hkdfSync, randomBytes } from 'node:crypto';
import { deliver, notificationFor, NOTIFICATION_BODY_LIMIT, type DeliverPorts } from './deliver.ts';
import { generateVapidKeys, type Fetcher } from '@lian/push';

function subscriber(id: string, endpoint = `https://push.example.test/send/${id}`) {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return {
    id, privateKey: ecdh.getPrivateKey(), publicKey: ecdh.getPublicKey(),
    row: { id, endpoint, p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') },
  };
}

function decrypt(body: Buffer, sub: ReturnType<typeof subscriber>): string {
  const salt = body.subarray(0, 16);
  const serverPublicKey = body.subarray(21, 21 + body[20]!);
  const ciphertext = body.subarray(21 + body[20]!);
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(sub.privateKey);
  const shared = ecdh.computeSecret(serverPublicKey);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), sub.publicKey, serverPublicKey]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, Buffer.from(sub.row.auth, 'base64url'), info, 32));
  const key = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const decipher = createDecipheriv('aes-128-gcm', key, nonce);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const plain = Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()]);
  return plain.subarray(0, plain.length - 1).toString('utf8');
}

function fakePorts(subs: { id: string; endpoint: string; p256dh: string; auth: string }[]) {
  const revoked: string[] = [];
  const touched: string[] = [];
  const ports: DeliverPorts = {
    async subscriptions() { return subs; },
    async revoke(_u, id) { revoked.push(id); },
    async touch(_u, id) { touched.push(id); },
  };
  return { ports, revoked, touched };
}

const config = (fetcher: Fetcher) => ({
  keys: generateVapidKeys(), subject: 'mailto:ops@lian.test', ttlSeconds: 3600, fetcher,
});

const HER_MESSAGE = 'You were going to ask about that apartment today. How did it go?';

describe('a proactive turn produces a real push with the real message in it', () => {
  test('the words she wrote arrive, decryptable only by the subscriber', async () => {
    const sub = subscriber('s-1');
    const bodies: Buffer[] = [];
    const fetcher: Fetcher = async (_url, init) => {
      bodies.push(Buffer.from(init.body));
      return { status: 201, headers: { get: () => null } };
    };

    const report = await deliver(
      { userId: 'u-1', message: notificationFor({ assistantName: 'Lian', text: HER_MESSAGE, url: '/chat/c-1', tag: 'follow_up' }) },
      config(fetcher),
      fakePorts([sub.row]).ports,
    );

    assert.equal(report.sent, 1);
    assert.equal(report.nowhereToSend, false);
    const delivered = JSON.parse(decrypt(bodies[0]!, sub)) as { title: string; body: string; url: string; tag: string };
    assert.equal(delivered.title, 'Lian');
    assert.equal(delivered.body, HER_MESSAGE, 'her sentence, not a summary and not "you have a new message"');
    assert.equal(delivered.url, '/chat/c-1', 'and tapping it lands in the conversation');
  });

  test('every device gets it', async () => {
    const subs = [subscriber('s-1'), subscriber('s-2'), subscriber('s-3')];
    const seen: Buffer[] = [];
    const fetcher: Fetcher = async (_url, init) => {
      seen.push(Buffer.from(init.body));
      return { status: 201, headers: { get: () => null } };
    };
    const report = await deliver(
      { userId: 'u-1', message: notificationFor({ assistantName: 'Lian', text: HER_MESSAGE, url: '/chat', tag: 'x' }) },
      config(fetcher),
      fakePorts(subs.map((s) => s.row)).ports,
    );
    assert.equal(report.sent, 3);
    // Each envelope is different bytes, and each opens only with its own key.
    for (const [index, sub] of subs.entries()) {
      assert.equal((JSON.parse(decrypt(seen[index]!, sub)) as { body: string }).body, HER_MESSAGE);
    }
  });

  test('a gone subscription is revoked, not retried forever', async () => {
    const fake = fakePorts([subscriber('s-dead').row]);
    const fetcher: Fetcher = async () => ({ status: 410, headers: { get: () => null } });
    const report = await deliver(
      { userId: 'u-1', message: notificationFor({ assistantName: 'Lian', text: HER_MESSAGE, url: '/chat', tag: 'x' }) },
      config(fetcher), fake.ports,
    );
    assert.equal(report.expired, 1);
    assert.deepEqual(fake.revoked, ['s-dead'], 'a stale endpoint kept forever is how she ends up texting nobody');
    assert.equal(report.nowhereToSend, true);
  });

  test('a temporary failure keeps the subscription', async () => {
    const fake = fakePorts([subscriber('s-1').row]);
    const fetcher: Fetcher = async () => ({ status: 503, headers: { get: () => '30' } });
    const report = await deliver(
      { userId: 'u-1', message: notificationFor({ assistantName: 'Lian', text: HER_MESSAGE, url: '/chat', tag: 'x' }) },
      config(fetcher), fake.ports,
    );
    assert.equal(report.retry, 1);
    assert.deepEqual(fake.revoked, [], 'the service is unhappy, the device is fine');
  });

  test('one dead device does not stop the others', async () => {
    const alive = subscriber('s-alive');
    const fake = fakePorts([subscriber('s-dead').row, alive.row]);
    const fetcher: Fetcher = async (url) => ({ status: url.includes('s-dead') ? 410 : 201, headers: { get: () => null } });
    const report = await deliver(
      { userId: 'u-1', message: notificationFor({ assistantName: 'Lian', text: HER_MESSAGE, url: '/chat', tag: 'x' }) },
      config(fetcher), fake.ports,
    );
    assert.deepEqual({ sent: report.sent, expired: report.expired }, { sent: 1, expired: 1 });
    assert.equal(report.nowhereToSend, false);
  });

  test('no devices is a reported outcome, not a silent success', async () => {
    // She wrote something and nobody can receive it.  Worth seeing in a log
    // rather than inferring from silence.
    const report = await deliver(
      { userId: 'u-1', message: notificationFor({ assistantName: 'Lian', text: HER_MESSAGE, url: '/chat', tag: 'x' }) },
      config(async () => ({ status: 201, headers: { get: () => null } })),
      fakePorts([]).ports,
    );
    assert.equal(report.nowhereToSend, true);
    assert.equal(report.sent, 0);
  });
});

describe('lock-screen copy', () => {
  test('the title is her name and the body is her sentence', () => {
    const message = notificationFor({ assistantName: 'Noor', text: HER_MESSAGE, url: '/chat', tag: 'follow_up' });
    assert.equal(message.title, 'Noor');
    assert.equal(message.body, HER_MESSAGE);
  });

  test('an over-long message is elided at the end, never at the start', () => {
    const long = `${'a'.repeat(400)} END`;
    const message = notificationFor({ assistantName: 'Lian', text: long, url: '/chat', tag: 'x' });
    assert.ok(message.body.length <= NOTIFICATION_BODY_LIMIT);
    assert.ok(message.body.endsWith('…'));
    assert.ok(message.body.startsWith('aaa'), 'the opening is what a lock screen shows');
  });

  test('the tag collapses a repeat rather than stacking it', () => {
    assert.equal(notificationFor({ assistantName: 'Lian', text: 'x', url: '/chat', tag: 'reminder' }).tag, 'reminder');
  });
});
