// Delivering one message to every device a user has.
//
// The push transport is in @lian/push; this is the part that knows what to do
// with the outcome. Two rules that only exist here:
//
//   - a subscription the service calls gone is revoked immediately, because a
//     stale endpoint kept forever is how "she texts you first" quietly
//     becomes "she texts nobody"
//   - delivering to zero devices is a REPORTED outcome, not a success. She
//     wrote something and nobody can receive it; that is worth being able to
//     see in a log rather than inferring from silence.
import { sendPush, type PushMessage, type PushOutcome, type SendConfig, type Subscription } from '@lian/push';

export type DeliverPorts = {
  subscriptions(userId: string): Promise<(Subscription & { id: string })[]>;
  revoke(userId: string, subscriptionId: string): Promise<void>;
  touch(userId: string, subscriptionId: string): Promise<void>;
};

export type DeliveryReport = {
  readonly sent: number;
  readonly expired: number;
  readonly retry: number;
  readonly failed: number;
  /** True when the user has no device that can receive anything. */
  readonly nowhereToSend: boolean;
};

/** Lock-screen copy: her name, then what she said. UI-UX §9 wants it to read
 *  like a person who remembers, so the body is her sentence — not a summary
 *  of it, and never "You have a new message". */
export const NOTIFICATION_BODY_LIMIT = 240;

export function notificationFor(input: { assistantName: string; text: string; url: string; tag: string }): PushMessage {
  const body = input.text.length > NOTIFICATION_BODY_LIMIT
    ? `${input.text.slice(0, NOTIFICATION_BODY_LIMIT - 1).trimEnd()}…`
    : input.text;
  return { title: input.assistantName, body, url: input.url, tag: input.tag };
}

export async function deliver(
  input: { userId: string; message: PushMessage },
  config: SendConfig,
  ports: DeliverPorts,
): Promise<DeliveryReport> {
  const subscriptions = await ports.subscriptions(input.userId);
  if (subscriptions.length === 0) {
    return { sent: 0, expired: 0, retry: 0, failed: 0, nowhereToSend: true };
  }

  let sent = 0;
  let expired = 0;
  let retry = 0;
  let failed = 0;

  for (const subscription of subscriptions) {
    const outcome: PushOutcome = await sendPush(subscription, input.message, config);
    switch (outcome.status) {
      case 'sent':
        sent += 1;
        await ports.touch(input.userId, subscription.id);
        break;
      case 'expired':
        expired += 1;
        await ports.revoke(input.userId, subscription.id);
        break;
      case 'retry':
        retry += 1;
        break;
      case 'failed':
        failed += 1;
        break;
    }
  }

  return { sent, expired, retry, failed, nowhereToSend: sent === 0 };
}
