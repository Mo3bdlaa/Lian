// Sending, and what to do when it fails.
//
// The failure handling is most of the value here. A push subscription is a
// URL that goes stale without telling anyone: the browser is reinstalled, the
// user clears site data, the service rotates. A sender that ignores that
// accumulates dead endpoints and silently sends into nothing — which is
// exactly what "she texts you first" must not become.
import { encryptPayload, MAX_PAYLOAD_BYTES, type Subscription } from './encrypt.ts';
import { vapidAuthorization, type VapidKeys } from './vapid.ts';

export type PushMessage = {
  readonly title: string;
  readonly body: string;
  /** Where tapping it goes. */
  readonly url: string;
  /** Collapses an older notification with the same tag, so a reminder sent
   *  twice does not stack on a lock screen. */
  readonly tag: string;
};

export type PushOutcome =
  | { readonly status: 'sent' }
  /** The subscription is gone. Delete it — this is not a retry. */
  | { readonly status: 'expired'; readonly reason: string }
  /** The service is unhappy for now. Retry later, keep the subscription. */
  | { readonly status: 'retry'; readonly reason: string; readonly retryAfterSeconds: number | null }
  /** Our fault: a payload too large, a bad key. Do not retry; it will fail
   *  identically forever. */
  | { readonly status: 'failed'; readonly reason: string };

export type Fetcher = (url: string, init: { method: string; headers: Record<string, string>; body: Uint8Array }) => Promise<{ status: number; headers: { get(name: string): string | null } }>;

export type SendConfig = {
  readonly keys: VapidKeys;
  /** RFC 8292 requires a contact: mailto: or an https URL. */
  readonly subject: string;
  /** How long the service should hold the message for an offline device. */
  readonly ttlSeconds: number;
  readonly fetcher?: Fetcher;
  readonly now?: () => Date;
};

export const DEFAULT_TTL_SECONDS = 4 * 60 * 60;

export async function sendPush(
  subscription: Subscription,
  message: PushMessage,
  config: SendConfig,
): Promise<PushOutcome> {
  const now = config.now?.() ?? new Date();
  const fetcher = config.fetcher ?? ((url, init) => fetch(url, init) as unknown as ReturnType<Fetcher>);

  let body: Buffer;
  try {
    body = encryptPayload(subscription, JSON.stringify(message)).body;
  } catch (error) {
    // A payload too large or a malformed key never becomes a retry: it would
    // fail identically every time.
    return { status: 'failed', reason: (error as Error).message };
  }

  let response: { status: number; headers: { get(name: string): string | null } };
  try {
    response = await fetcher(subscription.endpoint, {
      method: 'POST',
      headers: {
        authorization: vapidAuthorization({ endpoint: subscription.endpoint, subject: config.subject, keys: config.keys, now }),
        'content-encoding': 'aes128gcm',
        'content-type': 'application/octet-stream',
        ttl: String(config.ttlSeconds),
        // Push services throttle on urgency; a personal message is 'normal',
        // never 'high' — this product does not have anything urgent enough to
        // justify waking a sleeping phone faster.
        urgency: 'normal',
        topic: message.tag.slice(0, 32),
      },
      body,
    });
  } catch (error) {
    return { status: 'retry', reason: (error as Error).message, retryAfterSeconds: null };
  }

  return classify(response.status, response.headers.get('retry-after'));
}

export function classify(status: number, retryAfter: string | null): PushOutcome {
  if (status >= 200 && status < 300) return { status: 'sent' };

  // 404 and 410 are the push service saying the subscription no longer
  // exists. Keeping it means sending into nothing forever.
  if (status === 404 || status === 410) return { status: 'expired', reason: `push service returned ${status}` };

  if (status === 429 || status === 502 || status === 503 || status === 504 || status >= 500) {
    return { status: 'retry', reason: `push service returned ${status}`, retryAfterSeconds: parseRetryAfter(retryAfter) };
  }

  // 400, 401, 403, 413: our request is wrong. Retrying sends the same wrong
  // request again.
  return { status: 'failed', reason: `push service returned ${status}` };
}

function parseRetryAfter(value: string | null): number | null {
  if (value === null) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

export { MAX_PAYLOAD_BYTES };
