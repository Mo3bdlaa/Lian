// Message encryption — RFC 8291 (aes128gcm).
//
// The push service never sees the message. It relays an opaque blob that only
// the subscribed browser can open, using a key derived from the subscription's
// own public key and auth secret.
//
// That property is the reason to implement this rather than take it on trust:
// "she texts you first" means her words travel through a third party, and the
// test in this package decrypts its own output to prove they are unreadable
// there and intact at the other end.
import { createCipheriv, createECDH, hkdfSync, randomBytes } from 'node:crypto';

export type Subscription = {
  readonly endpoint: string;
  /** base64url, the browser's public key (uncompressed P-256 point). */
  readonly p256dh: string;
  /** base64url, 16 bytes of shared secret from the browser. */
  readonly auth: string;
};

/** Record size. 4096 is the conventional value and comfortably over any
 *  notification we send; a message longer than this would need multiple
 *  records, which no notification copy should ever reach. */
export const RECORD_SIZE = 4096;
/** Payload limit push services guarantee, minus the 103-byte header and the
 *  16-byte GCM tag. Copy longer than this is a bug in the copy. */
export const MAX_PAYLOAD_BYTES = 3993;

function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer {
  return Buffer.from(hkdfSync('sha256', ikm, salt, info, length));
}

export type EncryptedPush = { readonly body: Buffer; readonly salt: Buffer; readonly serverPublicKey: Buffer };

export function encryptPayload(
  subscription: Subscription,
  plaintext: string,
  options: { salt?: Buffer; serverKeys?: { publicKey: Buffer; privateKey: Buffer } } = {},
): EncryptedPush {
  const data = Buffer.from(plaintext, 'utf8');
  if (data.length > MAX_PAYLOAD_BYTES) {
    throw new Error(`push payload is ${data.length} bytes, over the ${MAX_PAYLOAD_BYTES}-byte limit`);
  }

  const userPublicKey = Buffer.from(subscription.p256dh, 'base64url');
  const authSecret = Buffer.from(subscription.auth, 'base64url');
  if (userPublicKey.length !== 65) throw new Error('subscription key must be an uncompressed P-256 point');
  if (authSecret.length !== 16) throw new Error('subscription auth secret must be 16 bytes');

  // An ephemeral keypair per message: the shared secret is never reused, so
  // one intercepted message tells an attacker nothing about the next.
  const ecdh = createECDH('prime256v1');
  if (options.serverKeys !== undefined) ecdh.setPrivateKey(options.serverKeys.privateKey);
  else ecdh.generateKeys();
  const serverPublicKey = ecdh.getPublicKey();
  const sharedSecret = ecdh.computeSecret(userPublicKey);

  // RFC 8291 §3.3: the key material binds both parties' public keys, so a
  // relayed blob cannot be replayed at a different subscriber.
  const prkInfo = Buffer.concat([
    Buffer.from('WebPush: info\0', 'utf8'),
    userPublicKey,
    serverPublicKey,
  ]);
  const ikm = hkdf(authSecret, sharedSecret, prkInfo, 32);

  const salt = options.salt ?? randomBytes(16);
  const contentEncryptionKey = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0', 'utf8'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0', 'utf8'), 12);

  // A single record: the delimiter is 0x02 ("last record").
  const padded = Buffer.concat([data, Buffer.from([0x02])]);
  const cipher = createCipheriv('aes-128-gcm', contentEncryptionKey, nonce);
  const ciphertext = Buffer.concat([cipher.update(padded), cipher.final(), cipher.getAuthTag()]);

  const recordSize = Buffer.alloc(4);
  recordSize.writeUInt32BE(RECORD_SIZE, 0);
  const header = Buffer.concat([salt, recordSize, Buffer.from([serverPublicKey.length]), serverPublicKey]);

  return { body: Buffer.concat([header, ciphertext]), salt, serverPublicKey };
}
