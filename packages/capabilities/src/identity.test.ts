import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ownerOfTag, REGISTRY } from './registry.ts';
import { fakePorts } from './test-fakes.ts';
import type { CapabilityContext } from '@lian/domain';

const onboarding: CapabilityContext = {
  userId: 'u-1', assistantId: 'a-1', surface: 'onboarding', localDay: '2026-05-18',
  timeZone: 'Asia/Dubai', plan: 'free', language: 'en',
};
const chat = { ...onboarding, surface: 'chat' };

const handle = (name: string, payload: unknown, ports: ReturnType<typeof fakePorts>, context = onboarding) =>
  ownerOfTag(name)!.handle({ context, tag: { name, payload, index: 0 }, messageId: 'm-1' }, ports);

describe('identity capture is a capability, not a wizard', () => {
  test('she is told about these tags during onboarding and never after', () => {
    const capability = REGISTRY.find((c) => c.id === 'identity')!;
    assert.ok(capability.promptFragment(onboarding) !== null);
    assert.equal(capability.promptFragment(chat), null, 'otherwise she re-asks questions already answered');
  });

  test('what to call them is captured from what they said', async () => {
    const ports = fakePorts();
    const outcome = await handle('call_me', { name: 'Adam' }, ports);
    assert.ok(outcome.ok);
    assert.equal(ports.identityRows['user:u-1:name'], 'Adam');
    assert.match(ownerOfTag('call_me')!.tags[0]!.usage, /not a guess from their email/);
  });

  test('a language outside the canonical list is refused', async () => {
    const ports = fakePorts();
    assert.deepEqual(await handle('language', { style: 'klingon' }, ports), { ok: false, reason: 'not one of the languages offered' });
    assert.ok(await handle('language', { style: 'ar-eg' }, ports).then((o) => o.ok));
    assert.equal(ports.identityRows['user:u-1:language'], 'ar-eg');
  });

  test('Q18 they name her — and "you choose" is recorded as a different fact', async () => {
    const theirs = fakePorts();
    await handle('my_name', { name: 'Noor', chosenByThem: true }, theirs);
    assert.equal(theirs.identityRows['assistant:a-1:name'], 'Noor');
    assert.equal(theirs.identityRows['assistant:a-1:chosenByThem'], true);

    const hers = fakePorts();
    await handle('my_name', { name: 'Lian', chosenByThem: false }, hers);
    assert.equal(hers.identityRows['assistant:a-1:chosenByThem'], false, 'she picked because they asked her to');
  });

  test('an unusable name is refused rather than stored', async () => {
    const ports = fakePorts();
    assert.equal((await handle('call_me', { name: '   ' }, ports)).ok, false);
    assert.equal((await handle('my_name', { name: 'x'.repeat(50) }, ports)).ok, false);
    assert.equal(Object.keys(ports.identityRows).length, 0);
  });

  test('its purge is empty ON PURPOSE, and says so', () => {
    // An empty purge is otherwise indistinguishable from a forgotten one.
    const capability = REGISTRY.find((c) => c.id === 'identity')!;
    assert.equal(typeof capability.purgeFor, 'function');
  });
});
