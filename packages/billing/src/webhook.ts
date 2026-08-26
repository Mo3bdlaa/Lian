// ==========================================================================
// THE WEBHOOK SIGNATURE.
//
// This is the whole security boundary of billing. Everything else in this
// package is a POST to an API we authenticate to; this is the one place
// somebody ELSE sends us bytes and we act on them — by making an account
// paid. An endpoint that parsed the JSON and believed it would be an endpoint
// where anyone on the internet can subscribe for free.
//
// So three things are true here and each is a test:
//
//   1. THE SIGNATURE IS CHECKED ON THE RAW BYTES. Not on a re-serialised
//      object. `JSON.parse` then `JSON.stringify` produces different bytes
//      for the same document — different key order, different number
//      formatting — and the signature is over what was sent.
//   2. THE COMPARISON IS CONSTANT-TIME. A byte-by-byte early return leaks
//      the prefix of a valid signature to anyone willing to time it.
//   3. THE TIMESTAMP IS BOUNDED. Without it, one captured request is a
//      replay forever — and a replay of "subscription created" is free
//      service, while a replay of "subscription deleted" is a downgrade
//      somebody did not ask for.
// ==========================================================================
import { createHmac, timingSafeEqual } from 'node:crypto';

/** How old a signed payload may be. Stripe's own guidance is five minutes,
 *  and the number is the tolerance for clock skew, not for delivery delay:
 *  Stripe retries a failed delivery with a fresh signature. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export type VerifyResult =
  | { readonly ok: true; readonly event: StripeEvent }
  | { readonly ok: false; readonly reason: 'malformed_header' | 'bad_signature' | 'too_old' | 'malformed_body' };

export type StripeEvent = {
  readonly id: string;
  readonly type: string;
  readonly object: Record<string, unknown>;
};

/**
 * Verify a Stripe-Signature header against the raw request body.
 *
 * `body` is a string of the EXACT bytes received. A caller that hands this a
 * parsed-and-reprinted object has already broken it, which is why the
 * signature is over a string and there is no overload taking an object.
 */
export function verifyWebhook(
  input: { body: string; header: string; secret: string; now: Date },
): VerifyResult {
  const parts = new Map<string, string[]>();
  for (const piece of input.header.split(',')) {
    const at = piece.indexOf('=');
    if (at === -1) continue;
    const key = piece.slice(0, at).trim();
    const value = piece.slice(at + 1).trim();
    parts.set(key, [...(parts.get(key) ?? []), value]);
  }

  const timestamp = parts.get('t')?.[0];
  // v1 is the only scheme this accepts. An unknown scheme is not "probably
  // fine": it is a signature we cannot check, which is the same as none.
  const signatures = parts.get('v1') ?? [];
  if (timestamp === undefined || signatures.length === 0) return { ok: false, reason: 'malformed_header' };

  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds)) return { ok: false, reason: 'malformed_header' };
  const age = Math.abs(input.now.getTime() / 1000 - seconds);
  if (age > SIGNATURE_TOLERANCE_SECONDS) return { ok: false, reason: 'too_old' };

  const expected = createHmac('sha256', input.secret).update(`${timestamp}.${input.body}`, 'utf8').digest('hex');
  // Stripe may send several v1 signatures during a secret rotation. Every one
  // is compared, and each comparison is constant-time.
  const matched = signatures.some((candidate) => constantTimeEquals(candidate, expected));
  if (!matched) return { ok: false, reason: 'bad_signature' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.body);
  } catch {
    return { ok: false, reason: 'malformed_body' };
  }
  const event = asEvent(parsed);
  return event === null ? { ok: false, reason: 'malformed_body' } : { ok: true, event };
}

/**
 * Constant-time string comparison.
 *
 * timingSafeEqual throws on a length mismatch, which would itself be a timing
 * signal — so the lengths are compared separately and a mismatch still walks
 * the full comparison against a same-length dummy.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) {
    // Compare something of the right shape anyway, so a wrong LENGTH takes
    // the same time as a wrong VALUE.
    timingSafeEqual(right, right);
    return false;
  }
  return timingSafeEqual(left, right);
}

function asEvent(value: unknown): StripeEvent | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const id = record['id'];
  const type = record['type'];
  const data = record['data'] as { object?: unknown } | undefined;
  if (typeof id !== 'string' || typeof type !== 'string') return null;
  if (typeof data?.object !== 'object' || data.object === null) return null;
  return { id, type, object: data.object as Record<string, unknown> };
}

/**
 * The events that change what somebody is paying for.
 *
 * Everything else Stripe sends is acknowledged and ignored — an endpoint that
 * 400s on an event type it does not handle teaches Stripe to retry forever.
 */
export const HANDLED_EVENTS = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
] as const;

export type HandledEvent = (typeof HANDLED_EVENTS)[number];

export function isHandled(type: string): type is HandledEvent {
  return (HANDLED_EVENTS as readonly string[]).includes(type);
}
