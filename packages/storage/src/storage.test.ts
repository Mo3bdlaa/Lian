// Signing, and the store behind it.
//
// HOW THIS IS VERIFIED, stated because it is the weak point: the signature is
// checked against a SECOND implementation of the documented algorithm,
// written in this file from the specification rather than from the code under
// test. That catches what actually goes wrong in a hand-written signer —
// canonical query ordering, percent-encoding, the trailing newline in the
// canonical headers block — because the two implementations only agree if the
// request was assembled the same way.
//
// What it does NOT do is prove the signature against a live service. There is
// no S3-compatible endpoint in this environment, and I will not assert a
// published test vector from memory: a constant recalled rather than read is
// exactly the kind of thing that looks like verification and is not. The
// first real request to a real bucket is the remaining check, and HANDOFF
// says so.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { presign, uriEncode, objectUrl, memoryStore, s3Store, attachmentKey, MAX_ATTACHMENT_BYTES, ACCEPTED } from './index.ts';

/** The credentials and clock from the AWS documentation's worked example. */
const AWS_EXAMPLE = {
  endpoint: 'https://s3.amazonaws.com',
  region: 'us-east-1',
  bucket: 'examplebucket',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  pathStyle: false,
} as const;

/**
 * The algorithm again, from the specification, in about fifteen lines.
 *
 * Deliberately written without looking at sign.ts: it takes the canonical
 * request as a literal string, so if the implementation assembles a different
 * one — a query out of order, a missing newline, an unencoded slash — the two
 * signatures diverge.
 */
function referenceSignature(input: { canonicalRequest: string; amzDate: string; scope: string; secret: string; region: string }): string {
  const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
  const hmac = (key: Uint8Array | string, value: string): Buffer => createHmac('sha256', key).update(value).digest();
  const stringToSign = ['AWS4-HMAC-SHA256', input.amzDate, input.scope, sha256(input.canonicalRequest)].join('\n');
  let key = hmac(`AWS4${input.secret}`, input.amzDate.slice(0, 8));
  key = hmac(key, input.region);
  key = hmac(key, 's3');
  key = hmac(key, 'aws4_request');
  return hmac(key, stringToSign).toString('hex');
}

describe('SigV4', () => {
  test('agrees with an independent implementation of the documented algorithm', () => {
    const url = new URL(presign(AWS_EXAMPLE, {
      method: 'GET', key: 'test.txt', expiresIn: 86_400,
      now: new Date('2013-05-24T00:00:00Z'),
    }));
    const signature = url.searchParams.get('X-Amz-Signature');

    // The canonical request the specification describes for this call,
    // written out rather than derived.
    const canonicalRequest = [
      'GET',
      '/test.txt',
      'X-Amz-Algorithm=AWS4-HMAC-SHA256'
        + '&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request'
        + '&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host',
      'host:examplebucket.s3.amazonaws.com\n',
      'host',
      'UNSIGNED-PAYLOAD',
    ].join('\n');

    assert.equal(signature, referenceSignature({
      canonicalRequest, amzDate: '20130524T000000Z',
      scope: '20130524/us-east-1/s3/aws4_request',
      secret: AWS_EXAMPLE.secretAccessKey, region: AWS_EXAMPLE.region,
    }));
  });

  test('a key in a folder signs against the encoded path, not the raw one', () => {
    const url = new URL(presign(AWS_EXAMPLE, { method: 'PUT', key: 'u/user 1/receipt/a.jpg', expiresIn: 900, now: new Date('2026-05-18T09:00:00Z') }));
    assert.equal(url.pathname, '/u/user%201/receipt/a.jpg');
    const canonicalRequest = [
      'PUT',
      '/u/user%201/receipt/a.jpg',
      'X-Amz-Algorithm=AWS4-HMAC-SHA256'
        + '&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20260518%2Fus-east-1%2Fs3%2Faws4_request'
        + '&X-Amz-Date=20260518T090000Z&X-Amz-Expires=900&X-Amz-SignedHeaders=host',
      'host:examplebucket.s3.amazonaws.com\n',
      'host',
      'UNSIGNED-PAYLOAD',
    ].join('\n');
    assert.equal(url.searchParams.get('X-Amz-Signature'), referenceSignature({
      canonicalRequest, amzDate: '20260518T090000Z',
      scope: '20260518/us-east-1/s3/aws4_request',
      secret: AWS_EXAMPLE.secretAccessKey, region: AWS_EXAMPLE.region,
    }));
  });

  test('the URL is the one the service expects', () => {
    const url = new URL(presign(AWS_EXAMPLE, { method: 'GET', key: 'test.txt', expiresIn: 86_400, now: new Date('2013-05-24T00:00:00Z') }));
    assert.equal(url.host, 'examplebucket.s3.amazonaws.com');
    assert.equal(url.pathname, '/test.txt');
    assert.equal(url.searchParams.get('X-Amz-Credential'), 'AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request');
    assert.equal(url.searchParams.get('X-Amz-SignedHeaders'), 'host');
  });

  test('path style puts the bucket in the path — every self-hosted service', () => {
    const { url, host } = objectUrl({ ...AWS_EXAMPLE, endpoint: 'http://127.0.0.1:9000', pathStyle: true }, 'a/b.png');
    assert.equal(host, '127.0.0.1:9000');
    assert.equal(url.pathname, '/examplebucket/a/b.png');
  });

  test('a key with a space or a plus survives the round trip', () => {
    // encodeURIComponent leaves ! * ' ( ) alone and S3 does not; a key that
    // encodes differently on the two sides is a signature mismatch, which
    // arrives as a 403 with no explanation.
    assert.equal(uriEncode("a b+c!d'e", false), 'a%20b%2Bc%21d%27e');
    assert.equal(uriEncode('a/b', false), 'a/b');
    assert.equal(uriEncode('a/b', true), 'a%2Fb');
  });

  test('changing anything changes the signature', () => {
    const base: { method: 'GET' | 'PUT'; key: string; expiresIn: number; now: Date } =
      { method: 'GET', key: 'test.txt', expiresIn: 3_600, now: new Date('2026-05-18T09:00:00Z') };
    const signature = (input: Partial<typeof base>): string =>
      new URL(presign(AWS_EXAMPLE, { ...base, ...input })).searchParams.get('X-Amz-Signature')!;
    const original = signature({});
    assert.notEqual(signature({ method: 'PUT' }), original);
    assert.notEqual(signature({ key: 'other.txt' }), original);
    assert.notEqual(signature({ expiresIn: 60 }), original);
    assert.notEqual(signature({ now: new Date('2026-05-19T09:00:00Z') }), original);
  });
});

describe('the store', () => {
  test('the memory store round-trips bytes and reports their size', async () => {
    const store = memoryStore();
    await store.put({ key: 'k', bytes: new Uint8Array([1, 2, 3]), contentType: 'audio/webm' });
    assert.deepEqual((await store.get('k'))?.bytes, new Uint8Array([1, 2, 3]));
    assert.deepEqual(await store.head('k'), { bytes: 3, contentType: 'audio/webm' });
    assert.equal(await store.get('missing'), null);
    assert.equal(await store.head('missing'), null);
  });

  test('remove says how many it removed, and removing twice is not an error', async () => {
    const store = memoryStore();
    await store.put({ key: 'k', bytes: new Uint8Array([1]), contentType: 'image/png' });
    assert.equal(await store.remove(['k', 'nope']), 1);
    assert.equal(await store.remove(['k']), 0);
  });

  test('the s3 store signs what it sends, and a refusal is an error rather than a silence', async () => {
    const seen: { url: string; method: string }[] = [];
    const store = s3Store({
      ...AWS_EXAMPLE,
      now: () => new Date('2026-05-18T09:00:00Z'),
      fetcher: (async (url: string | URL, init?: { method?: string }) => {
        seen.push({ url: String(url), method: init?.method ?? 'GET' });
        return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0), headers: new Headers({ 'content-type': 'image/png', 'content-length': '0' }) } as unknown as Response;
      }) as unknown as typeof fetch,
    });
    await store.put({ key: 'a.png', bytes: new Uint8Array([1]), contentType: 'image/png' });
    assert.equal(seen[0]!.method, 'PUT');
    assert.match(seen[0]!.url, /X-Amz-Signature=[0-9a-f]{64}/);

    const refusing = s3Store({
      ...AWS_EXAMPLE,
      fetcher: (async () => ({ ok: false, status: 403 }) as unknown as Response) as unknown as typeof fetch,
    });
    await assert.rejects(() => refusing.put({ key: 'a.png', bytes: new Uint8Array([1]), contentType: 'image/png' }), /403/);
  });

  test('a missing object reads as null rather than throwing', async () => {
    const store = s3Store({
      ...AWS_EXAMPLE,
      fetcher: (async () => ({ ok: false, status: 404 }) as unknown as Response) as unknown as typeof fetch,
    });
    assert.equal(await store.get('gone'), null);
    assert.equal(await store.head('gone'), null);
    // Deleting something already gone is a success: the object is not there,
    // which is what the caller wanted.
    assert.equal(await store.remove(['gone']), 1);
  });
});

describe('what may be stored', () => {
  test('the key names the owner, so a bucket is readable without a join', () => {
    const key = attachmentKey({ userId: 'u-1', kind: 'receipt', attachmentId: 'a-1', extension: 'jpg' });
    assert.equal(key, 'u/u-1/receipt/a-1.jpg');
  });

  test('every accepted type has a ceiling, and audio is allowed to be larger', () => {
    for (const kind of ['image', 'audio', 'receipt'] as const) {
      assert.ok(MAX_ATTACHMENT_BYTES[kind] > 0);
      assert.ok(ACCEPTED[kind].length > 0);
    }
    assert.ok(MAX_ATTACHMENT_BYTES.audio > MAX_ATTACHMENT_BYTES.image);
    // No SVG, ever: it is a script container that renders as a picture.
    assert.ok(!ACCEPTED.image.includes('image/svg+xml'));
  });
});
