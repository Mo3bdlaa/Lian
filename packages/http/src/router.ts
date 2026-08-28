// A router, on node:http.
//
// DECISION, because it is the kind that gets questioned later: the HTTP layer
// is plain functions of (request) → (response) over Node's own server, not a
// framework.
//
// Three reasons. The product is sold on "your server if you want it", and a
// framework is a deployment story as much as a dependency. The screens do not
// exist yet, so committing the API to whatever the UI is eventually built in
// would be deciding the wrong thing first. And every handler here is an
// ordinary async function — when a framework does arrive, it mounts them
// rather than replacing them.
//
// What this is NOT is a general-purpose router. It does what this product
// needs and nothing else.
import type { IncomingMessage, ServerResponse } from 'node:http';

export type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export type RequestContext = {
  readonly method: Method;
  readonly path: string;
  readonly params: Readonly<Record<string, string>>;
  readonly query: URLSearchParams;
  readonly headers: Readonly<Record<string, string>>;
  readonly rawBody: string;
  body<T>(): T;
  readonly ip: string;
};

export type HandlerResult =
  | { readonly status: number; readonly json: unknown; readonly headers?: Record<string, string> }
  | { readonly status: number; readonly text: string; readonly headers?: Record<string, string> }
  /** Server-sent events: the handler writes and closes. */
  | { readonly stream: (write: (event: string, data: unknown) => void, close: () => void) => Promise<void> };

export type Handler = (context: RequestContext) => Promise<HandlerResult>;

export type Route = { readonly method: Method; readonly pattern: string; readonly handler: Handler };

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

/** `/tasks/:id` → matches `/tasks/abc`, capturing `id`. */
function matchPattern(pattern: string, path: string): Record<string, string> | null {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = path.split('/').filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (const [index, part] of patternParts.entries()) {
    const actual = pathParts[index]!;
    if (part.startsWith(':')) params[part.slice(1)] = decodeURIComponent(actual);
    else if (part !== actual) return null;
  }
  return params;
}

export function findRoute(routes: readonly Route[], method: string, path: string): { route: Route; params: Record<string, string> } | null {
  for (const route of routes) {
    if (route.method !== method) continue;
    const params = matchPattern(route.pattern, path);
    if (params !== null) return { route, params };
  }
  return null;
}

/** Bodies are small by design; anything larger is refused rather than buffered. */
export const MAX_BODY_BYTES = 1_000_000;

export async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'body_too_large', 'that is larger than I can take in one request');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function contextFrom(
  request: IncomingMessage, rawBody: string, params: Record<string, string>, url: URL,
  trustedProxies = 0,
): RequestContext {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === 'string') headers[name.toLowerCase()] = value;
  }
  return {
    method: request.method as Method,
    path: url.pathname,
    params,
    query: url.searchParams,
    headers,
    rawBody,
    body<T>(): T {
      if (rawBody === '') return {} as T;
      try {
        return JSON.parse(rawBody) as T;
      } catch {
        throw new HttpError(400, 'bad_json', 'that request body was not valid JSON');
      }
    },
    ip: clientIp(headers, request.socket.remoteAddress ?? null, trustedProxies),
  };
}

/**
 * The client's address, counting from the RIGHT.
 *
 * `X-Forwarded-For` is appended to by each proxy, so the rightmost entries
 * are the ones written by infrastructure you control and the leftmost is
 * whatever the client sent. Taking `[0]` — which this did — means anybody can
 * choose their own address by sending the header.
 *
 * That is not academic here. It is used for the `auth:ip:` rate limit, so a
 * rotating header defeats sign-in throttling; and now for the location on the
 * Security screen, where an attacker choosing the city defeats the one
 * question the screen exists to answer.
 *
 * So: `trustedProxies` is how many hops you actually run, and the address is
 * that many from the end. DEFAULT ZERO — the header is ignored entirely and
 * the socket is used, which is right for a direct deployment and fails safe
 * for a misconfigured one. Behind Cloudflare alone it is 1; behind Cloudflare
 * and your own reverse proxy, 2.
 *
 * Exported because it is the kind of thing that has to be tested against the
 * header chains that actually arrive, not reasoned about.
 */
export function clientIp(
  headers: Record<string, string | undefined>,
  socketAddress: string | null,
  trustedProxies: number,
): string {
  const socket = socketAddress ?? 'unknown';
  if (trustedProxies <= 0) return socket;
  const chain = (headers['x-forwarded-for'] ?? '')
    .split(',').map((entry) => entry.trim()).filter((entry) => entry !== '');
  // The chain is [client, proxy1, proxy2, …]; our own hops are on the right.
  // With one trusted hop the client is the last entry, and so on leftwards.
  // A chain shorter than the hops we trust means the header did not come
  // through them: fall back to the socket rather than believing the client.
  if (chain.length < trustedProxies) return socket;
  return chain[chain.length - trustedProxies] ?? socket;
}

export function writeResult(response: ServerResponse, result: HandlerResult): void {
  if ('stream' in result) return; // handled by the server
  const headers = { ...(result.headers ?? {}) };
  if ('json' in result) {
    const body = JSON.stringify(result.json);
    response.writeHead(result.status, { ...headers, 'content-type': 'application/json; charset=utf-8' });
    response.end(body);
    return;
  }
  response.writeHead(result.status, { ...headers, 'content-type': 'text/plain; charset=utf-8' });
  response.end(result.text);
}
