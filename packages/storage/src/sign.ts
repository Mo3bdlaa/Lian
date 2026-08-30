// SigV4, by hand.
//
// Object storage is the one dependency this product cannot avoid — audio and
// photographs have to live somewhere — so it is spoken to over its own
// protocol rather than through an SDK. The signing algorithm is public, it is
// about eighty lines, and it works against every S3-compatible service
// (S3, R2, B2, MinIO, Garage) without pinning the product to one vendor's
// client library and its transitive tree.
//
// Everything here is a pure function of the request and the clock. Nothing
// reaches the network; that is send.ts.
import { createHash, createHmac } from 'node:crypto';

export type S3Config = {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** Path style (`endpoint/bucket/key`) rather than virtual host style. True
   *  for MinIO and most self-hosted services; false for S3 proper. */
  readonly pathStyle: boolean;
};

const sha256 = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
const hmac = (key: Uint8Array | string, value: string): Buffer => createHmac('sha256', key).update(value).digest();

/** RFC 3986, which is stricter than encodeURIComponent about what is safe. */
export function uriEncode(value: string, encodeSlash: boolean): string {
  let out = '';
  for (const character of value) {
    const isUnreserved = /[A-Za-z0-9\-._~]/.test(character);
    if (isUnreserved) out += character;
    else if (character === '/') out += encodeSlash ? '%2F' : '/';
    else out += [...new TextEncoder().encode(character)].map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, '0')}`).join('');
  }
  return out;
}

export function objectUrl(config: S3Config, key: string): { url: URL; host: string; path: string } {
  const base = new URL(config.endpoint.replace(/\/$/, ''));
  const encoded = uriEncode(key, false);
  if (config.pathStyle) {
    const path = `${base.pathname.replace(/\/$/, '')}/${config.bucket}/${encoded}`;
    return { url: new URL(`${base.origin}${path}`), host: base.host, path };
  }
  const host = `${config.bucket}.${base.host}`;
  return { url: new URL(`${base.protocol}//${host}/${encoded}`), host, path: `/${encoded}` };
}

const stamp = (now: Date): { amzDate: string; day: string } => {
  const amzDate = `${now.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
  return { amzDate, day: amzDate.slice(0, 8) };
};

function signingKey(config: S3Config, day: string): Buffer {
  const date = hmac(`AWS4${config.secretAccessKey}`, day);
  const region = hmac(date, config.region);
  const service = hmac(region, 's3');
  return hmac(service, 'aws4_request');
}

/**
 * A presigned URL.
 *
 * Presigned for BOTH directions and both callers: the browser uploads
 * straight to storage with one (the bytes never touch the app server), and
 * the server itself uses the same function to write her audio. One signing
 * path, one thing to get right.
 */
export function presign(
  config: S3Config,
  input: {
    method: 'GET' | 'PUT' | 'HEAD' | 'DELETE';
    key: string;
    expiresIn: number;
    now: Date;
    /** Sent as a response header on GET — how a download gets a filename. */
    responseContentDisposition?: string;
    responseContentType?: string;
    /**
     * Extra query parameters, which MUST be signed with everything else.
     *
     * Only the backup listing uses this (`list-type=2&prefix=…`). SigV4 signs
     * the canonical query string, so a parameter appended to the URL after
     * signing produces a SignatureDoesNotMatch that reads like a credentials
     * problem and is not one — which is why they go in here rather than being
     * concatenated at the call site.
     */
    query?: URLSearchParams;
  },
): string {
  const { amzDate, day } = stamp(input.now);
  const { url, host, path } = objectUrl(config, input.key);
  const scope = `${day}/${config.region}/s3/aws4_request`;

  const query = new Map<string, string>([
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${config.accessKeyId}/${scope}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(input.expiresIn)],
    ['X-Amz-SignedHeaders', 'host'],
  ]);
  if (input.responseContentDisposition !== undefined) query.set('response-content-disposition', input.responseContentDisposition);
  if (input.responseContentType !== undefined) query.set('response-content-type', input.responseContentType);
  for (const [name, value] of input.query ?? []) query.set(name, value);

  const canonicalQuery = [...query.entries()]
    .map(([name, value]) => [uriEncode(name, true), uriEncode(value, true)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join('&');

  const canonicalRequest = [
    input.method,
    path,
    canonicalQuery,
    `host:${host}\n`,
    'host',
    // The body is not signed: a presigned URL is handed to a client that has
    // not produced the bytes yet.
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  const signature = hmac(signingKey(config, day), stringToSign).toString('hex');
  return `${url.origin}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
