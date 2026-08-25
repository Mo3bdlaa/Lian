// Q10: the claim "I stopped them" has to be true.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { signUp, signIn, resolveDeviceConfirmation } from './signin.ts';
import { hashPassword, verifyPassword } from './password.ts';
import { newToken, hashToken } from './tokens.ts';
import type { AuthPorts, AuthDevice, AuthUser } from './ports.ts';

const NOW = new Date('2026-05-18T10:00:00Z');
const LAPTOP = { fingerprint: 'fp-laptop', userAgent: 'Firefox', locationLabel: 'Dubai' };
const STRANGER = { fingerprint: 'fp-stranger', userAgent: 'curl', locationLabel: 'Frankfurt' };

function fakePorts() {
  const users = new Map<string, AuthUser>();
  const devices = new Map<string, AuthDevice & { userId: string }>();
  const sessions: { userId: string; deviceId: string | null; tokenHash: string; revoked: boolean }[] = [];
  const attempts: { outcome: string; userId: string | null }[] = [];
  const confirmations = new Map<string, { userId: string; deviceId: string; used: boolean; expiresAt: Date }>();
  const emails: { email: string; token: string }[] = [];
  const raised: { userId: string; kind: string }[] = [];
  let n = 0;

  const ports: AuthPorts = {
    async findUserByEmail(email) { return [...users.values()].find((u) => u.email === email) ?? null; },
    async createUser(input) {
      const user: AuthUser = { id: `u${++n}`, email: input.email, passwordHash: input.passwordHash, timeZone: input.timeZone };
      users.set(user.id, user);
      return user;
    },
    async findDevice(userId, fingerprint) {
      return [...devices.values()].find((d) => d.userId === userId && d.fingerprint === fingerprint) ?? null;
    },
    async upsertDevice(userId, input) {
      const existing = [...devices.values()].find((d) => d.userId === userId && d.fingerprint === input.fingerprint);
      if (existing) return existing;
      const device = { id: `d${++n}`, userId, fingerprint: input.fingerprint, trustedAt: null, revokedAt: null };
      devices.set(device.id, device);
      return device;
    },
    async trustDevice(_userId, deviceId) {
      const device = devices.get(deviceId)!;
      devices.set(deviceId, { ...device, trustedAt: NOW, revokedAt: null });
    },
    async createSession(userId, input) {
      sessions.push({ userId, deviceId: input.deviceId, tokenHash: input.tokenHash, revoked: false });
      return `s${++n}`;
    },
    async revokeAllSessions(userId) {
      let count = 0;
      for (const session of sessions) if (session.userId === userId && !session.revoked) { session.revoked = true; count++; }
      return count;
    },
    async recordAttempt(input) { attempts.push({ outcome: input.outcome, userId: input.userId }); return `a${++n}`; },
    async createConfirmation(userId, input) {
      confirmations.set(input.tokenHash, { userId, deviceId: input.deviceId, used: false, expiresAt: input.expiresAt });
      return `c${++n}`;
    },
    async claimConfirmation(tokenHash, _decision, now) {
      const found = confirmations.get(tokenHash);
      if (found === undefined || found.used || found.expiresAt <= now) return null;
      found.used = true;
      return { userId: found.userId, deviceId: found.deviceId };
    },
    async sendDeviceConfirmation(input) { emails.push({ email: input.email, token: input.token }); },
    async raiseSecurityEvent(input) { raised.push({ userId: input.userId, kind: input.kind }); },
  };
  return { ports, sessions, attempts, emails, raised, devices };
}

async function withAccount() {
  const fake = fakePorts();
  const { userId } = await signUp({ email: 'a@example.test', password: 'correct horse battery', timeZone: 'Asia/Dubai', device: LAPTOP }, fake.ports, NOW);
  return { ...fake, userId };
}

describe('Q10 a new device is held, not merely logged', () => {
  test('a known device signs in', async () => {
    const fake = await withAccount();
    const result = await signIn({ email: 'a@example.test', password: 'correct horse battery', device: LAPTOP }, fake.ports, NOW);
    assert.equal(result.status, 'signed_in');
  });

  test('the right password from a NEW device creates no session', async () => {
    const fake = await withAccount();
    const before = fake.sessions.length;
    const result = await signIn({ email: 'a@example.test', password: 'correct horse battery', device: STRANGER }, fake.ports, NOW);
    assert.equal(result.status, 'held_new_device');
    assert.equal(fake.sessions.length, before, 'no session may exist — this is what makes "I stopped them" true');
    assert.equal(fake.attempts.at(-1)!.outcome, 'held_new_device');
    assert.equal(fake.emails.length, 1, 'the email is the second factor');
    assert.equal(fake.raised.length, 1, 'and she raises it in chat');
  });

  test('the new device is created untrusted and stays untrusted until confirmed', async () => {
    const fake = await withAccount();
    await signIn({ email: 'a@example.test', password: 'correct horse battery', device: STRANGER }, fake.ports, NOW);
    const device = [...fake.devices.values()].find((d) => d.fingerprint === STRANGER.fingerprint)!;
    assert.equal(device.trustedAt, null);
  });

  test('confirming trusts the device and issues the session', async () => {
    const fake = await withAccount();
    await signIn({ email: 'a@example.test', password: 'correct horse battery', device: STRANGER }, fake.ports, NOW);
    const token = fake.emails[0]!.token;
    const result = await resolveDeviceConfirmation({ token, decision: 'confirmed' }, fake.ports, NOW);
    assert.equal(result.status, 'confirmed');
    assert.ok(result.status === 'confirmed' && result.sessionToken.length > 20);
    const device = [...fake.devices.values()].find((d) => d.fingerprint === STRANGER.fingerprint)!;
    assert.ok(device.trustedAt);
  });

  test('answering "no" ends every existing session', async () => {
    const fake = await withAccount();
    await signIn({ email: 'a@example.test', password: 'correct horse battery', device: STRANGER }, fake.ports, NOW);
    const result = await resolveDeviceConfirmation({ token: fake.emails[0]!.token, decision: 'denied' }, fake.ports, NOW);
    assert.equal(result.status, 'denied');
    // If the password is known to someone else, a session opened earlier is
    // the thing that actually matters.
    assert.ok(result.status === 'denied' && result.sessionsRevoked >= 1);
    assert.ok(fake.sessions.every((s) => s.revoked));
  });

  test('a confirmation token is single use and expires', async () => {
    const fake = await withAccount();
    await signIn({ email: 'a@example.test', password: 'correct horse battery', device: STRANGER }, fake.ports, NOW);
    const token = fake.emails[0]!.token;
    await resolveDeviceConfirmation({ token, decision: 'confirmed' }, fake.ports, NOW);
    assert.equal((await resolveDeviceConfirmation({ token, decision: 'confirmed' }, fake.ports, NOW)).status, 'expired');

    const second = await withAccount();
    await signIn({ email: 'a@example.test', password: 'correct horse battery', device: STRANGER }, second.ports, NOW);
    const late = new Date(NOW.getTime() + 60 * 60_000);
    assert.equal((await resolveDeviceConfirmation({ token: second.emails[0]!.token, decision: 'confirmed' }, second.ports, late)).status, 'expired');
  });

  test('a wrong password and an unknown email are indistinguishable', async () => {
    const fake = await withAccount();
    const wrong = await signIn({ email: 'a@example.test', password: 'nope', device: LAPTOP }, fake.ports, NOW);
    const unknown = await signIn({ email: 'nobody@example.test', password: 'nope', device: LAPTOP }, fake.ports, NOW);
    assert.deepEqual(wrong, { status: 'rejected' });
    assert.deepEqual(unknown, { status: 'rejected' }, 'a different answer here is an account-enumeration oracle');
    // Both are still recorded, because the devices screen shows attempts.
    assert.equal(fake.attempts.filter((a) => a.outcome === 'bad_password').length, 1);
    assert.equal(fake.attempts.filter((a) => a.outcome === 'unknown_email').length, 1);
  });

  test('a wrong password from a new device does not even reach the hold', async () => {
    const fake = await withAccount();
    await signIn({ email: 'a@example.test', password: 'nope', device: STRANGER }, fake.ports, NOW);
    assert.equal(fake.emails.length, 0, 'no email for someone who did not have the password');
    assert.equal(fake.raised.length, 0);
  });
});

describe('password storage', () => {
  test('hashes are salted, and verification is exact', async () => {
    const a = await hashPassword('same password');
    const b = await hashPassword('same password');
    assert.notEqual(a, b, 'two hashes of one password must differ');
    assert.ok(await verifyPassword('same password', a));
    assert.ok(!(await verifyPassword('same password ', a)));
    assert.ok(!(await verifyPassword('', a)));
  });

  test('parameters travel with the hash so they can be raised later', async () => {
    const hash = await hashPassword('x');
    assert.match(hash, /^scrypt\$\d+\$\d+\$\d+\$/);
  });

  test('a malformed stored hash fails closed', async () => {
    assert.ok(!(await verifyPassword('x', 'garbage')));
    assert.ok(!(await verifyPassword('x', '')));
  });
});

describe('tokens', () => {
  test('only the hash is ever stored, and it is not reversible to the token', () => {
    const { token, hash } = newToken();
    assert.notEqual(token, hash);
    assert.equal(hashToken(token), hash);
    assert.ok(token.length >= 40, 'high entropy: the token is the credential');
  });
});
