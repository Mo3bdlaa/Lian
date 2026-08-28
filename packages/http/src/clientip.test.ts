// Which entry of X-Forwarded-For is the client.
//
// This decides two things that both matter: the `auth:ip:` rate limit, and
// the location on the Security screen. Getting it wrong in the obvious
// direction — trusting the LEFTMOST entry, which is what this did — means a
// client picks its own address. Sign-in throttling is then defeated by
// rotating a header, and the security screen names whatever city an attacker
// chose.
//
// The chain is appended to left-to-right, so the entries on the RIGHT are the
// ones written by infrastructure you control, and the client's own claim is
// on the left. Counting from the right by the number of hops you actually run
// is the only reading that cannot be forged.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { clientIp } from './router.ts';

const SOCKET = '203.0.113.9';

describe('the client address', () => {
  test('with no trusted proxies the header is ignored entirely', () => {
    // The default, and right for a deployment nothing sits in front of. A
    // header that arrives at a directly-exposed server came from the client.
    assert.equal(clientIp({ 'x-forwarded-for': '1.2.3.4' }, SOCKET, 0), SOCKET);
    assert.equal(clientIp({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }, SOCKET, 0), SOCKET);
    assert.equal(clientIp({}, SOCKET, 0), SOCKET);
  });

  test('behind one proxy the client is the LAST entry, not the first', () => {
    // Cloudflare alone. It appends the address it saw; anything to the left
    // of that is what the client sent.
    assert.equal(clientIp({ 'x-forwarded-for': '198.51.100.7' }, SOCKET, 1), '198.51.100.7');
    assert.equal(
      clientIp({ 'x-forwarded-for': '9.9.9.9, 198.51.100.7' }, SOCKET, 1), '198.51.100.7',
      'the client sent 9.9.9.9 and it must not be believed',
    );
  });

  test('behind two proxies it is the second from the right', () => {
    // Cloudflare, then your own reverse proxy. The rightmost is what your
    // proxy saw (Cloudflare); the one before it is what Cloudflare saw.
    assert.equal(
      clientIp({ 'x-forwarded-for': '198.51.100.7, 172.16.0.1' }, SOCKET, 2), '198.51.100.7',
    );
    assert.equal(
      clientIp({ 'x-forwarded-for': '9.9.9.9, 198.51.100.7, 172.16.0.1' }, SOCKET, 2), '198.51.100.7',
      'a forged entry on the left shifts nothing',
    );
  });

  test('A FORGED HEADER CANNOT MOVE THE ANSWER, however long it is', () => {
    // The property the whole design rests on: the attacker controls the left
    // of the chain and can make it any length. Counting from the right means
    // none of it reaches the answer.
    const real = '198.51.100.7';
    for (const forged of [
      '1.1.1.1',
      '1.1.1.1, 2.2.2.2',
      '1.1.1.1, 2.2.2.2, 3.3.3.3, 4.4.4.4, 5.5.5.5',
      'not-an-address, , 7.7.7.7',
    ]) {
      assert.equal(clientIp({ 'x-forwarded-for': `${forged}, ${real}` }, SOCKET, 1), real, forged);
    }
  });

  test('a chain shorter than the hops we trust falls back to the socket', () => {
    // The header did not come through the proxies we believe in, so it is
    // not evidence. Falling back to the socket is the safe direction; taking
    // whatever is there would mean a request that bypassed the proxy chooses
    // its own address.
    assert.equal(clientIp({ 'x-forwarded-for': '1.2.3.4' }, SOCKET, 2), SOCKET);
    assert.equal(clientIp({}, SOCKET, 2), SOCKET);
    assert.equal(clientIp({ 'x-forwarded-for': '' }, SOCKET, 1), SOCKET);
  });

  test('whitespace and empty entries in a real chain', () => {
    // Chains arrive with spaces after the commas, and proxies occasionally
    // append an empty entry. Neither may shift the count.
    assert.equal(clientIp({ 'x-forwarded-for': '  9.9.9.9 ,  198.51.100.7  ' }, SOCKET, 1), '198.51.100.7');
    assert.equal(clientIp({ 'x-forwarded-for': '9.9.9.9, , 198.51.100.7' }, SOCKET, 1), '198.51.100.7');
  });

  test('a v6 socket with no header', () => {
    assert.equal(clientIp({}, '2a00:1450::1', 0), '2a00:1450::1');
    // Node's dual-stack form, which reaches the geo lookup as-is and is
    // unwrapped there rather than here.
    assert.equal(clientIp({}, '::ffff:203.0.113.9', 0), '::ffff:203.0.113.9');
  });

  test('no socket and no header is "unknown", which stores as null', () => {
    assert.equal(clientIp({}, null, 0), 'unknown');
  });
});
