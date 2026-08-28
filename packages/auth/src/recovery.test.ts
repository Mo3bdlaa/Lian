// Account recovery, tested as the hole it is.
//
// A reset endpoint is the biggest thing a product hands an attacker on
// purpose, so every test below is a way of using it for something other than
// recovering your own account.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { requestPasswordReset, completePasswordReset, RESET_TTL_MINUTES } from './recovery.ts';
import { hashToken, newToken } from './tokens.ts';
import { hashPassword, verifyPassword } from './password.ts';
import type { AuthPorts, RecoveryPorts, AuthUser } from './ports.ts';

const NOW = new Date('2026-05-18T06:30:00.000Z');
const DEVICE = { fingerprint: 'fp-laptop', userAgent: 'Firefox', ip: '5.1.2.3' };

function fakePorts(users: AuthUser[] = []) {
  const resets: { userId: string; tokenHash: string; expiresAt: Date; usedAt: Date | null }[] = [];
  const sent: { email: string; token: string }[] = [];
  const attempts: { userId: string | null; outcome: string }[] = [];
  const raised: { userId: string; kind: string }[] = [];
  const sessions: { userId: string }[] = [];
  const passwords = new Map<string, string>();
  let revoked = 0;

  const ports: AuthPorts & RecoveryPorts = {
    async findUserByEmail(email) { return users.find((user) => user.email === email) ?? null; },
    async createUser() { throw new Error('not used'); },
    async findDevice() { return null; },
    async upsertDevice(_userId, input) { return { id: `d-${input.fingerprint}`, fingerprint: input.fingerprint, trustedAt: null, revokedAt: null }; },
    async trustDevice() {},
    async createSession(userId) { sessions.push({ userId }); return 's-1'; },
    async revokeAllSessions() { revoked += 1; return 3; },
    async recordAttempt(input) { attempts.push({ userId: input.userId, outcome: input.outcome }); return 'a-1'; },
    async createConfirmation() { return 'c-1'; },
    async claimConfirmation() { return null; },
    async sendDeviceConfirmation() {},
    async raiseSecurityEvent(input) { raised.push({ userId: input.userId, kind: input.kind }); },
    async recordEvent() {},

    async createPasswordReset(userId, input) {
      // The real repository spends every earlier unused reset first; the fake
      // does the same, or the "an older link stops working" test would be
      // testing the fake.
      for (const reset of resets) if (reset.userId === userId && reset.usedAt === null) reset.usedAt = NOW;
      resets.push({ userId, tokenHash: input.tokenHash, expiresAt: input.expiresAt, usedAt: null });
      return 'r-1';
    },
    async claimPasswordReset(tokenHash, now) {
      const reset = resets.find((row) => row.tokenHash === tokenHash && row.usedAt === null && row.expiresAt > now);
      if (reset === undefined) return null;
      reset.usedAt = now;
      return { userId: reset.userId };
    },
    async setPasswordHash(userId, passwordHash) { passwords.set(userId, passwordHash); },
    async sendPasswordReset(input) { sent.push({ email: input.email, token: input.token }); },
  };

  return { ports, resets, sent, attempts, raised, sessions, passwords, revokedCount: () => revoked };
}

const ADAM: AuthUser = { id: 'u-1', email: 'adam@example.test', passwordHash: 'old', timeZone: 'Asia/Dubai' };

describe('asking for a link tells you nothing about the account', () => {
  test('a known and an unknown address are indistinguishable from the outside', async () => {
    const known = fakePorts([ADAM]);
    const unknown = fakePorts([ADAM]);
    const a = await requestPasswordReset({ email: 'adam@example.test', ip: '1.1.1.1', userAgent: null }, known.ports, NOW);
    const b = await requestPasswordReset({ email: 'nobody@example.test', ip: '1.1.1.1', userAgent: null }, unknown.ports, NOW);
    assert.deepEqual(a, b, 'the two answers must be the same object, not merely similar');
    assert.deepEqual(a, { status: 'accepted' });
  });

  test('the address is lower-cased and trimmed, so casing is not an oracle either', async () => {
    const fake = fakePorts([ADAM]);
    await requestPasswordReset({ email: '  ADAM@Example.Test  ', ip: null, userAgent: null }, fake.ports, NOW);
    assert.equal(fake.sent.length, 1);
  });

  test('an unknown address is still RECORDED, so a list being walked is visible', async () => {
    const fake = fakePorts([ADAM]);
    await requestPasswordReset({ email: 'nobody@example.test', ip: null, userAgent: null }, fake.ports, NOW);
    assert.deepEqual(fake.attempts, [{ userId: null, outcome: 'unknown_email' }]);
    assert.equal(fake.sent.length, 0, 'and no mail is sent to an address with no account');
  });

  test('the token is stored hashed, never in the clear', async () => {
    // A leaked backup must not be a set of working reset links.
    const fake = fakePorts([ADAM]);
    await requestPasswordReset({ email: ADAM.email, ip: null, userAgent: null }, fake.ports, NOW);
    const token = fake.sent[0]!.token;
    assert.notEqual(fake.resets[0]!.tokenHash, token);
    assert.equal(fake.resets[0]!.tokenHash, hashToken(token));
  });

  test('the link expires within the stated window', async () => {
    const fake = fakePorts([ADAM]);
    await requestPasswordReset({ email: ADAM.email, ip: null, userAgent: null }, fake.ports, NOW);
    assert.equal(fake.resets[0]!.expiresAt.getTime() - NOW.getTime(), RESET_TTL_MINUTES * 60 * 1000);
  });
});

describe('using a link', () => {
  async function withLink() {
    const fake = fakePorts([ADAM]);
    await requestPasswordReset({ email: ADAM.email, ip: null, userAgent: null }, fake.ports, NOW);
    return { fake, token: fake.sent[0]!.token };
  }

  test('the password changes, a session opens, and every other session ends', async () => {
    const { fake, token } = await withLink();
    const outcome = await completePasswordReset({ token, password: 'a-long-enough-password', device: DEVICE }, fake.ports, NOW);
    assert.equal(outcome.status, 'reset');
    assert.ok(await verifyPassword('a-long-enough-password', fake.passwords.get('u-1')!));
    assert.equal(fake.sessions.length, 1);
    // Recovery is what somebody does when they think they have been
    // compromised. Leaving the intruder signed in would make it ceremonial.
    assert.equal(fake.revokedCount(), 1);
  });

  test('she is told about it afterwards', async () => {
    const { fake, token } = await withLink();
    await completePasswordReset({ token, password: 'a-long-enough-password', device: DEVICE }, fake.ports, NOW);
    assert.deepEqual(fake.raised, [{ userId: 'u-1', kind: 'password_reset' }]);
  });

  test('a link works ONCE', async () => {
    const { fake, token } = await withLink();
    assert.equal((await completePasswordReset({ token, password: 'first-password-here', device: DEVICE }, fake.ports, NOW)).status, 'reset');
    const second = await completePasswordReset({ token, password: 'second-password-x', device: DEVICE }, fake.ports, NOW);
    assert.equal(second.status, 'invalid');
    // And the second attempt changed nothing.
    assert.ok(await verifyPassword('first-password-here', fake.passwords.get('u-1')!));
  });

  test('asking for a new link stops the old one working', async () => {
    // The shape that matters: an older link sitting in an inbox somebody else
    // can read, still valid after a newer one was requested.
    const { fake, token: first } = await withLink();
    await requestPasswordReset({ email: ADAM.email, ip: null, userAgent: null }, fake.ports, NOW);
    const second = fake.sent[1]!.token;
    assert.notEqual(first, second);
    assert.equal((await completePasswordReset({ token: first, password: 'a-long-enough-password', device: DEVICE }, fake.ports, NOW)).status, 'invalid');
    assert.equal((await completePasswordReset({ token: second, password: 'a-long-enough-password', device: DEVICE }, fake.ports, NOW)).status, 'reset');
  });

  test('an expired link is refused', async () => {
    const { fake, token } = await withLink();
    const later = new Date(NOW.getTime() + (RESET_TTL_MINUTES + 1) * 60 * 1000);
    assert.equal((await completePasswordReset({ token, password: 'a-long-enough-password', device: DEVICE }, fake.ports, later)).status, 'invalid');
  });

  test('a made-up token is refused, and is not distinguishable from an expired one', async () => {
    const { fake } = await withLink();
    const forged = await completePasswordReset({ token: newToken().token, password: 'a-long-enough-password', device: DEVICE }, fake.ports, NOW);
    assert.deepEqual(forged, { status: 'invalid' });
  });

  test('a weak password is refused BEFORE the token is spent', async () => {
    // Otherwise a typo costs somebody their only link.
    const { fake, token } = await withLink();
    assert.equal((await completePasswordReset({ token, password: 'short', device: DEVICE }, fake.ports, NOW)).status, 'weak_password');
    assert.equal((await completePasswordReset({ token, password: 'a-long-enough-password', device: DEVICE }, fake.ports, NOW)).status, 'reset');
  });

  test('nothing is changed by a refused attempt', async () => {
    const { fake } = await withLink();
    await completePasswordReset({ token: 'not-a-token', password: 'a-long-enough-password', device: DEVICE }, fake.ports, NOW);
    assert.equal(fake.passwords.size, 0);
    assert.equal(fake.sessions.length, 0);
    assert.equal(fake.revokedCount(), 0, 'a forged token must not be able to sign anybody out');
  });
});

describe('the hash is a hash', () => {
  test('the same password hashes differently every time, and both verify', async () => {
    // Salted. Two accounts with the same password must not have equal rows.
    const a = await hashPassword('a-long-enough-password');
    const b = await hashPassword('a-long-enough-password');
    assert.notEqual(a, b);
    assert.ok(await verifyPassword('a-long-enough-password', a));
    assert.ok(await verifyPassword('a-long-enough-password', b));
    assert.ok(!(await verifyPassword('a-long-enough-passwore', a)));
  });
});
