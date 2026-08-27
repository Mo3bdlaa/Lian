// ==========================================================================
// The email transport.
//
// Q14's shape again: constraints rather than a vendor, and the choice follows
// from them.
//
//   1. MUST WORK FROM A DATACENTER IP, and must not need a warmed sending
//      reputation to deliver a password reset. That rules out SMTP through a
//      box we run: a fresh IP sending its first transactional mail lands in
//      spam, and a reset link in spam is a locked-out account.
//   2. MUST BE A PLAIN HTTP API. No SDK, like everything else here.
//   3. MUST REPORT A MACHINE-READABLE REASON. This is the one that decided
//      it. A transport that answers "400 Bad Request" to an unverified
//      sending domain, a suppressed recipient and a malformed address alike
//      is a transport whose failures cost a day each. tools/preflight.ts
//      reads the reason back, the same way it does for SigV4.
//   4. MUST NOT BE A MARKETING PLATFORM. Nothing here has a list, an
//      unsubscribe segment or an open-tracking pixel, and a product that
//      promises "nobody reads your conversations" should not ship a tracker
//      in the one message it sends.
//
// Chosen default: Resend. One JSON endpoint, a documented error `name` on
// every refusal, and no tracking by default.
//
// Documented alternatives, both satisfying the four: Postmark (same shape,
// stricter about transactional-only, which is a feature here) and Amazon SES
// — which this repository could already sign for, since the SigV4 code exists
// in @lian/storage. SES is the cheapest at volume and the most work to set
// up; swapping is a file in this folder.
export type EmailMessage = {
  readonly to: string;
  readonly subject: string;
  /** Plain text. No HTML, deliberately: the three messages this product sends
   *  are a sentence and a link, an HTML part is a second thing to keep in
   *  step with the text one, and plain text cannot carry a tracking pixel. */
  readonly body: string;
};

export type EmailProvider = {
  readonly id: string;
  send(message: EmailMessage): Promise<void>;
};

export type EmailConfig = {
  readonly apiKey: string;
  /** The From address. Its DOMAIN has to be verified with the provider, and
   *  that is the single commonest reason a first send fails. */
  readonly from: string;
  readonly url?: string;
};

export const DEFAULT_EMAIL = { id: 'resend', url: 'https://api.resend.com/emails' } as const;

/**
 * Why a send failed, in terms of what to do about it.
 *
 * The provider's own words are kept in `detail` — this is the classification
 * on top, and it exists because the three states below need three different
 * actions and arrive as the same status code often enough to matter.
 */
export type SendFailure =
  /** The key is wrong, or the sending domain is not verified. Nothing will
   *  ever send until somebody changes the account. */
  | 'not_authorised'
  /** This address specifically: malformed, suppressed, or bounced before. */
  | 'bad_recipient'
  /** Rate limited or over quota. The same message later would work. */
  | 'throttled'
  /** Reached the provider and it said no for a reason not in this list. */
  | 'refused'
  /** Never reached the provider. */
  | 'unreachable';

export class EmailError extends Error {
  readonly failure: SendFailure;
  readonly status: number;
  readonly detail: string;
  constructor(failure: SendFailure, status: number, detail: string) {
    super(`email ${failure}: ${detail}`);
    this.name = 'EmailError';
    this.failure = failure;
    this.status = status;
    this.detail = detail;
  }
}

/**
 * Map a refusal to something actionable.
 *
 * Written from the provider's documented error names. A name this does not
 * know becomes 'refused' with the provider's own text attached, rather than
 * being guessed at — a wrong diagnosis is worse than none.
 */
export function classify(status: number, body: string): SendFailure {
  // ORDER MATTERS HERE, and the first version had it wrong in a way only a
  // real call could show. Resend answers an invalid API key with 401 AND
  // `"name":"validation_error"`, so a body-first reading called it
  // 'bad_recipient' and sent somebody to check the address they were mailing
  // while the key was the problem. tools/preflight.ts found that on its first
  // live send, which is the entire argument for the preflight.
  //
  // So: the STATUS decides authorisation, because a status is unambiguous
  // about it and a provider's `name` field is a grab-bag. Only then does the
  // body get a say, and the generic names come last.
  if (status === 401 || status === 403) return 'not_authorised';
  if (/missing_api_key|invalid_api_key|restricted_api_key|domain_not_verified|unverified|not_authori[sz]ed/i.test(body)) return 'not_authorised';
  if (status === 429 || /rate_limit|daily_quota|quota_exceeded|too_many/i.test(body)) return 'throttled';
  if (/invalid_(to|from)_address|invalid_recipient|suppress|bounce|blocked/i.test(body)) return 'bad_recipient';
  // `validation_error` is generic. It reaches here only once the specific
  // readings above have declined, which is where a grab-bag belongs.
  if (status === 400 || status === 422 || /validation_error|invalid_parameter/i.test(body)) return 'bad_recipient';
  return 'refused';
}

export function httpEmailProvider(config: EmailConfig, fetcher: typeof fetch = fetch): EmailProvider {
  const url = config.url ?? DEFAULT_EMAIL.url;
  return {
    id: DEFAULT_EMAIL.id,
    async send(message) {
      let response: Response;
      try {
        response = await fetcher(url, {
          method: 'POST',
          headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({ from: config.from, to: [message.to], subject: message.subject, text: message.body }),
        });
      } catch (error) {
        throw new EmailError('unreachable', 0, (error as Error).message);
      }
      if (response.ok) return;
      const detail = (await response.text()).slice(0, 400);
      throw new EmailError(classify(response.status, detail), response.status, detail);
    },
  };
}
