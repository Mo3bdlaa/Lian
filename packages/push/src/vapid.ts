// VAPID — proving to a push service who is sending.
//
// Written against node:crypto rather than taken as a dependency, for the same
// reason the rest of this codebase avoids them: the product is sold on
// running it yourself, and a push stack is not a good place for a supply
// chain. It is about 120 lines of standard cryptography, and the test
// decrypts its own output, which a dependency would not have let us do.
//
// RFC 8292. The signature is ES256 over a JWT whose audience is the push
// service's origin.
import { createSign, createPrivateKey, createPublicKey, generateKeyPairSync, type KeyObject } from 'node:crypto';

export type VapidKeys = {
  /** base64url, uncompressed P-256 point (65 bytes) — this is what the
   *  browser gets as applicationServerKey. */
  readonly publicKey: string;
  /** base64url, the 32-byte private scalar. */
  readonly privateKey: string;
};

/** Tokens live 12 hours; push services reject anything over 24. */
export const VAPID_TOKEN_TTL_SECONDS = 12 * 60 * 60;

export function generateVapidKeys(): VapidKeys {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    publicKey: exportPublicPoint(publicKey).toString('base64url'),
    privateKey: exportPrivateScalar(privateKey).toString('base64url'),
  };
}

export function exportPublicPoint(key: KeyObject): Buffer {
  const jwk = key.export({ format: 'jwk' });
  return Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(jwk.x!, 'base64url'),
    Buffer.from(jwk.y!, 'base64url'),
  ]);
}

function exportPrivateScalar(key: KeyObject): Buffer {
  const jwk = key.export({ format: 'jwk' });
  return Buffer.from(jwk.d!, 'base64url');
}

/** Rebuild a usable key object from the stored base64url pair. */
export function privateKeyFrom(keys: VapidKeys): KeyObject {
  const point = Buffer.from(keys.publicKey, 'base64url');
  if (point.length !== 65 || point[0] !== 0x04) throw new Error('VAPID public key must be an uncompressed P-256 point');
  return createPrivateKey({
    key: {
      kty: 'EC', crv: 'P-256',
      x: point.subarray(1, 33).toString('base64url'),
      y: point.subarray(33, 65).toString('base64url'),
      d: keys.privateKey,
    },
    format: 'jwk',
  });
}

export function publicKeyFrom(publicKey: string): KeyObject {
  const point = Buffer.from(publicKey, 'base64url');
  return createPublicKey({
    key: { kty: 'EC', crv: 'P-256', x: point.subarray(1, 33).toString('base64url'), y: point.subarray(33, 65).toString('base64url') },
    format: 'jwk',
  });
}

/** The origin of a push endpoint — the JWT's audience. */
export function audienceOf(endpoint: string): string {
  const url = new URL(endpoint);
  return `${url.protocol}//${url.host}`;
}

/** DER-encoded ECDSA signatures have to be converted to the raw r||s JOSE
 *  form. Node will do it for us with dsaEncoding: 'ieee-p1363'. */
export function signVapid(input: { endpoint: string; subject: string; keys: VapidKeys; now: Date }): string {
  const header = Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    aud: audienceOf(input.endpoint),
    exp: Math.floor(input.now.getTime() / 1000) + VAPID_TOKEN_TTL_SECONDS,
    // A contact address, so a push service can reach whoever is sending.
    sub: input.subject,
  })).toString('base64url');

  const signer = createSign('SHA256');
  signer.update(`${header}.${payload}`);
  const signature = signer.sign({ key: privateKeyFrom(input.keys), dsaEncoding: 'ieee-p1363' });
  return `${header}.${payload}.${signature.toString('base64url')}`;
}

export function vapidAuthorization(input: { endpoint: string; subject: string; keys: VapidKeys; now: Date }): string {
  return `vapid t=${signVapid(input)}, k=${input.keys.publicKey}`;
}
