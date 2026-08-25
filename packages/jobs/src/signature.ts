// The tick endpoint is protected by an HMAC signature rather than a bearer
// token so that a leaked log line is not a working key, and so a replay is
// bounded by the timestamp window.  Q16: "your server if you want it" means
// the scheduler is outside the app, which means the endpoint is public.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_WINDOW_SECONDS = 300;

export function signTick(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('base64url');
}

export function verifyTick(
  input: { secret: string; timestamp: number; body: string; signature: string; now: Date },
): { ok: true } | { ok: false; reason: string } {
  const age = Math.abs(Math.floor(input.now.getTime() / 1000) - input.timestamp);
  if (age > SIGNATURE_WINDOW_SECONDS) return { ok: false, reason: 'timestamp outside the replay window' };
  const expected = Buffer.from(signTick(input.secret, input.timestamp, input.body));
  const given = Buffer.from(input.signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: 'bad signature' };
  return { ok: true };
}
