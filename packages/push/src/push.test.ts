// Push, verified by decrypting our own output.
//
// "She texts you first" means her words travel through a push service we do
// not control. These tests open the envelope from the subscriber's side —
// with the browser's private key — and prove the message is intact at the far
// end and unreadable in the middle.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv, createECDH, hkdfSync, randomBytes, createVerify } from 'node:crypto';
import { encryptPayload, MAX_PAYLOAD_BYTES } from './encrypt.ts';
import { generateVapidKeys, signVapid, vapidAuthorization, audienceOf, publicKeyFrom } from './vapid.ts';
import { sendPush, classify, type Fetcher } from './send.ts';

/** A browser subscription, keys and all — so the test can decrypt. */
function subscriber(endpoint = 'https://push.example.test/send/abc') {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return {
    privateKey: ecdh.getPrivateKey(),
    publicKey: ecdh.getPublicKey(),
    subscription: {
      endpoint,
      p256dh: ecdh.getPublicKey().toString('base64url'),
      auth: auth.toString('base64url'),
    },
  };
}

/** The subscriber side of RFC 8291: what a browser does on receipt. */
function decrypt(body: Buffer, sub: ReturnType<typeof subscriber>): string {
  const salt = body.subarray(0, 16);
  const keyLength = body[20]!;
  const serverPublicKey = body.subarray(21, 21 + keyLength);
  const ciphertext = body.subarray(21 + keyLength);

  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(sub.privateKey);
  const sharedSecret = ecdh.computeSecret(serverPublicKey);

  const prkInfo = Buffer.concat([Buffer.from('WebPush: info\0'), sub.publicKey, serverPublicKey]);
  const ikm = Buffer.from(hkdfSync('sha256', sharedSecret, Buffer.from(sub.subscription.auth, 'base64url'), prkInfo, 32));
  const key = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));

  const tag = ciphertext.subarray(ciphertext.length - 16);
  const decipher = createDecipheriv('aes-128-gcm', key, nonce);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()]);
  return plain.subarray(0, plain.length - 1).toString('utf8'); // strip the 0x02 delimiter
}

const MESSAGE = {
  title: 'Lian',
  body: 'You said the presentation was making you tense. Thinking of you this morning.',
  url: '/chat',
  tag: 'follow_up',
};

describe('the message survives the journey', () => {
  test('a real message comes back out, not an empty notification', async () => {
    const sub = subscriber();
    const { body } = encryptPayload(sub.subscription, JSON.stringify(MESSAGE));
    const recovered = JSON.parse(decrypt(body, sub)) as typeof MESSAGE;
    assert.deepEqual(recovered, MESSAGE);
    assert.match(recovered.body, /presentation was making you tense/, 'the words she wrote, at the far end');
  });

  test('the push service cannot read it', () => {
    const sub = subscriber();
    const { body } = encryptPayload(sub.subscription, JSON.stringify(MESSAGE));
    assert.ok(!body.toString('utf8').includes('presentation'), 'the relay sees an opaque blob');
    assert.ok(!body.toString('utf8').includes('Lian'));
  });

  test('a different subscriber cannot open it', () => {
    const intended = subscriber();
    const other = subscriber();
    const { body } = encryptPayload(intended.subscription, JSON.stringify(MESSAGE));
    assert.throws(() => decrypt(body, other), 'the key material binds both parties (RFC 8291 §3.3)');
  });

  test('every message uses a fresh ephemeral key and salt', () => {
    const sub = subscriber();
    const first = encryptPayload(sub.subscription, 'same text');
    const second = encryptPayload(sub.subscription, 'same text');
    assert.notEqual(first.salt.toString('hex'), second.salt.toString('hex'));
    assert.notEqual(first.serverPublicKey.toString('hex'), second.serverPublicKey.toString('hex'));
    assert.notEqual(first.body.toString('hex'), second.body.toString('hex'), 'identical copy must not produce identical bytes');
  });

  test('Arabic survives the round trip', () => {
    const sub = subscriber();
    const arabic = { ...MESSAGE, body: 'قلت إن العرض كان مقلق. بفكر فيك الصبح.' };
    const { body } = encryptPayload(sub.subscription, JSON.stringify(arabic));
    assert.deepEqual(JSON.parse(decrypt(body, sub)), arabic);
  });

  test('the header is the shape a browser expects', () => {
    const sub = subscriber();
    const { body, salt, serverPublicKey } = encryptPayload(sub.subscription, 'hello');
    assert.deepEqual(body.subarray(0, 16), salt);
    assert.equal(body.readUInt32BE(16), 4096, 'record size');
    assert.equal(body[20], 65, 'key length');
    assert.deepEqual(body.subarray(21, 86), serverPublicKey);
  });

  test('copy too long to send is refused rather than truncated', () => {
    const sub = subscriber();
    assert.throws(() => encryptPayload(sub.subscription, 'x'.repeat(MAX_PAYLOAD_BYTES + 1)), /over the/);
  });

  test('a malformed subscription is rejected before anything is sent', () => {
    assert.throws(() => encryptPayload({ endpoint: 'https://x', p256dh: 'short', auth: 'AAAAAAAAAAAAAAAAAAAAAA' }, 'x'), /P-256 point/);
  });
});

describe('VAPID', () => {
  const keys = generateVapidKeys();

  test('the token verifies against the public key we publish', () => {
    const token = signVapid({ endpoint: 'https://push.example.test/send/abc', subject: 'mailto:ops@lian.test', keys, now: new Date('2026-05-18T10:00:00Z') });
    const [header, payload, signature] = token.split('.');
    const verifier = createVerify('SHA256');
    verifier.update(`${header}.${payload}`);
    assert.ok(
      verifier.verify({ key: publicKeyFrom(keys.publicKey), dsaEncoding: 'ieee-p1363' }, Buffer.from(signature!, 'base64url')),
      'a push service must be able to check this with the key the browser was given',
    );
  });

  test('the audience is the push origin, not the full endpoint', () => {
    assert.equal(audienceOf('https://push.example.test/send/abc?x=1'), 'https://push.example.test');
    const token = signVapid({ endpoint: 'https://push.example.test/send/abc', subject: 'mailto:ops@lian.test', keys, now: new Date('2026-05-18T10:00:00Z') });
    const claims = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as { aud: string; exp: number; sub: string };
    assert.equal(claims.aud, 'https://push.example.test');
    assert.equal(claims.sub, 'mailto:ops@lian.test', 'a contact, so a push service can reach us');
  });

  test('the token expires, well inside what services accept', () => {
    const now = new Date('2026-05-18T10:00:00Z');
    const token = signVapid({ endpoint: 'https://push.example.test/send/abc', subject: 'mailto:ops@lian.test', keys, now });
    const claims = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as { exp: number };
    const hours = (claims.exp - now.getTime() / 1000) / 3600;
    assert.ok(hours > 1 && hours < 24, `token life ${hours}h must be under the 24h services allow`);
  });

  test('the authorization header carries both halves', () => {
    const header = vapidAuthorization({ endpoint: 'https://push.example.test/send/abc', subject: 'mailto:ops@lian.test', keys, now: new Date() });
    assert.match(header, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
    assert.ok(header.includes(keys.publicKey));
  });
});

describe('what happens when it fails', () => {
  test('404 and 410 mean the subscription is gone — delete, never retry', () => {
    // A stale endpoint kept forever is how "she texts you first" quietly
    // becomes "she texts nobody".
    for (const status of [404, 410]) assert.equal(classify(status, null).status, 'expired');
  });

  test('429 and 5xx are retries, and honour Retry-After', () => {
    for (const status of [429, 500, 502, 503]) assert.equal(classify(status, null).status, 'retry');
    const withHeader = classify(429, '120');
    assert.ok(withHeader.status === 'retry' && withHeader.retryAfterSeconds === 120);
    const withDate = classify(503, new Date(Date.now() + 60_000).toUTCString());
    assert.ok(withDate.status === 'retry' && (withDate.retryAfterSeconds ?? 0) > 0);
  });

  test('4xx that is our fault never retries — it would fail identically forever', () => {
    for (const status of [400, 401, 403, 413]) assert.equal(classify(status, null).status, 'failed');
  });

  test('a network error is a retry, not a dead subscription', async () => {
    const fetcher: Fetcher = async () => { throw new Error('ECONNRESET'); };
    const outcome = await sendPush(subscriber().subscription, MESSAGE, {
      keys: generateVapidKeys(), subject: 'mailto:ops@lian.test', ttlSeconds: 3600, fetcher,
    });
    assert.equal(outcome.status, 'retry');
  });

  test('the request carries the headers a push service requires', async () => {
    let seen: { headers: Record<string, string>; body: Uint8Array } | null = null;
    const fetcher: Fetcher = async (_url, init) => {
      seen = { headers: init.headers, body: init.body };
      return { status: 201, headers: { get: () => null } };
    };
    const sub = subscriber();
    const outcome = await sendPush(sub.subscription, MESSAGE, {
      keys: generateVapidKeys(), subject: 'mailto:ops@lian.test', ttlSeconds: 3600, fetcher,
    });
    assert.equal(outcome.status, 'sent');
    assert.equal(seen!.headers['content-encoding'], 'aes128gcm');
    assert.equal(seen!.headers['ttl'], '3600');
    assert.equal(seen!.headers['urgency'], 'normal', 'nothing here justifies waking a sleeping phone faster');
    assert.match(seen!.headers['authorization']!, /^vapid t=/);
    // And the body that went out is the message, provably.
    assert.deepEqual(JSON.parse(decrypt(Buffer.from(seen!.body), sub)), MESSAGE);
  });
});
