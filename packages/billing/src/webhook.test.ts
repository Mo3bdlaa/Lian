// The webhook, tested as an attack.
//
// This endpoint is the one place someone else's bytes decide whether an
// account is paid. Every test below is a way of getting a free subscription,
// and each one has to fail.
//
// What these tests do NOT do: prove the signature against a real Stripe
// delivery. No key was available in this environment. The scheme is
// implemented from the documented construction (`t=<unix>,v1=<hex hmac of
// "<t>.<body>" with the endpoint secret>`), and a first real delivery is the
// remaining verification — HANDOFF says so.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyWebhook, constantTimeEquals, isHandled, SIGNATURE_TOLERANCE_SECONDS } from './webhook.ts';

const SECRET = 'whsec_a_test_endpoint_secret';
const NOW = new Date('2026-05-18T06:30:00.000Z');
const BODY = JSON.stringify({
  id: 'evt_1', type: 'customer.subscription.updated',
  data: { object: { id: 'sub_1', customer: 'cus_1', status: 'active', current_period_end: 1_782_000_000, cancel_at_period_end: false } },
});

const sign = (body: string, at: Date = NOW, secret: string = SECRET): string => {
  const t = Math.floor(at.getTime() / 1000);
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`, 'utf8').digest('hex')}`;
};

describe('a signed webhook is accepted', () => {
  test('the real thing goes through, and the event comes back parsed', () => {
    const result = verifyWebhook({ body: BODY, header: sign(BODY), secret: SECRET, now: NOW });
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.event.type, 'customer.subscription.updated');
    assert.equal(result.ok && result.event.object['id'], 'sub_1');
  });

  test('several v1 signatures are accepted, so a secret can be rotated without downtime', () => {
    const real = sign(BODY);
    const header = `${real},v1=${'0'.repeat(64)}`;
    assert.equal(verifyWebhook({ body: BODY, header, secret: SECRET, now: NOW }).ok, true);
  });
});

describe('every way of getting a free subscription', () => {
  test('no signature at all', () => {
    const result = verifyWebhook({ body: BODY, header: '', secret: SECRET, now: NOW });
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.reason, 'malformed_header');
  });

  test('a signature made with the wrong secret', () => {
    const result = verifyWebhook({ body: BODY, header: sign(BODY, NOW, 'whsec_not_ours'), secret: SECRET, now: NOW });
    assert.equal(!result.ok && result.reason, 'bad_signature');
  });

  test('a real signature over a DIFFERENT body', () => {
    // The shape that matters: capture one legitimate delivery, keep its
    // header, send whatever you like.
    const swapped = BODY.replace('sub_1', 'sub_someone_elses');
    const result = verifyWebhook({ body: swapped, header: sign(BODY), secret: SECRET, now: NOW });
    assert.equal(!result.ok && result.reason, 'bad_signature');
  });

  test('the same body re-sent an hour later', () => {
    const header = sign(BODY);
    const later = new Date(NOW.getTime() + 60 * 60 * 1000);
    const result = verifyWebhook({ body: BODY, header, secret: SECRET, now: later });
    assert.equal(!result.ok && result.reason, 'too_old');
  });

  test('a timestamp from the future, forged to sit inside the window', () => {
    // Skew works in both directions, so the tolerance is absolute.
    const ahead = new Date(NOW.getTime() + (SIGNATURE_TOLERANCE_SECONDS + 60) * 1000);
    const result = verifyWebhook({ body: BODY, header: sign(BODY, ahead), secret: SECRET, now: NOW });
    assert.equal(!result.ok && result.reason, 'too_old');
  });

  test('a signature under a scheme we do not check', () => {
    // v0 is Stripe's test-mode scheme and is not a signature we verify.
    // Accepting an unknown scheme is accepting no signature.
    const t = Math.floor(NOW.getTime() / 1000);
    const result = verifyWebhook({ body: BODY, header: `t=${t},v0=${'a'.repeat(64)}`, secret: SECRET, now: NOW });
    assert.equal(!result.ok && result.reason, 'malformed_header');
  });

  test('a signature that is valid but the body is not an event', () => {
    const body = JSON.stringify({ hello: 'there' });
    const result = verifyWebhook({ body, header: sign(body), secret: SECRET, now: NOW });
    assert.equal(!result.ok && result.reason, 'malformed_body');
  });

  test('a header with junk in it does not throw', () => {
    for (const header of ['t', 'v1=', '=,=', 't=abc,v1=def', ',,,', 't=,v1=']) {
      assert.doesNotThrow(() => verifyWebhook({ body: BODY, header, secret: SECRET, now: NOW }));
      assert.equal(verifyWebhook({ body: BODY, header, secret: SECRET, now: NOW }).ok, false, header);
    }
  });
});

describe('the signature is over the RAW bytes', () => {
  test('re-serialising the same document breaks it, which is why the input is a string', () => {
    // This is the mistake the API shape exists to prevent: parse, then
    // stringify, then verify. Same document, different bytes, no signature.
    const header = sign(BODY);
    const round = JSON.stringify(JSON.parse(BODY));
    const reordered = JSON.stringify({ data: JSON.parse(BODY).data, type: JSON.parse(BODY).type, id: 'evt_1' });
    assert.equal(verifyWebhook({ body: round, header, secret: SECRET, now: NOW }).ok, true, 'identical bytes still verify');
    assert.equal(verifyWebhook({ body: reordered, header, secret: SECRET, now: NOW }).ok, false, 'reordered keys must not');
  });

  test('whitespace is part of the body', () => {
    const pretty = JSON.stringify(JSON.parse(BODY), null, 2);
    assert.equal(verifyWebhook({ body: pretty, header: sign(BODY), secret: SECRET, now: NOW }).ok, false);
    assert.equal(verifyWebhook({ body: pretty, header: sign(pretty), secret: SECRET, now: NOW }).ok, true);
  });
});

describe('the comparison does not leak', () => {
  test('a wrong length is false rather than a throw', () => {
    // timingSafeEqual throws on a length mismatch; a caller that let that
    // propagate would turn a length check into a 500 and a timing signal.
    assert.equal(constantTimeEquals('abc', 'abcd'), false);
    assert.equal(constantTimeEquals('', 'a'), false);
    assert.equal(constantTimeEquals('', ''), true);
    assert.equal(constantTimeEquals('abcd', 'abcd'), true);
  });

  test('a signature sharing a long prefix is still refused', () => {
    const real = sign(BODY).split('v1=')[1]!;
    const nearly = `${real.slice(0, -1)}${real.endsWith('0') ? '1' : '0'}`;
    const t = Math.floor(NOW.getTime() / 1000);
    assert.equal(verifyWebhook({ body: BODY, header: `t=${t},v1=${nearly}`, secret: SECRET, now: NOW }).ok, false);
  });
});

describe('which events are acted on', () => {
  test('the four that change what somebody pays for', () => {
    assert.ok(isHandled('checkout.session.completed'));
    assert.ok(isHandled('customer.subscription.created'));
    assert.ok(isHandled('customer.subscription.updated'));
    assert.ok(isHandled('customer.subscription.deleted'));
  });

  test('anything else is not handled — and the route must still acknowledge it', () => {
    // An endpoint that errors on an unhandled type teaches Stripe to retry it
    // forever, which eventually gets the endpoint disabled.
    assert.equal(isHandled('invoice.paid'), false);
    assert.equal(isHandled('customer.created'), false);
    assert.equal(isHandled('anything.at.all'), false);
  });
});
