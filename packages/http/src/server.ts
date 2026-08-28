// The server.
//
// One place that turns a Node request into a RequestContext, finds a route,
// runs it, and turns the result back into a response — including the SSE
// case, which is the only one that writes incrementally.
import { createServer, type Server } from 'node:http';
import {
  HttpError, contextFrom, findRoute, readBody, writeResult,
  type Route, type HandlerResult,
} from './router.ts';

export type ServerOptions = {
  readonly routes: readonly Route[];
  /**
   * How many proxy hops you actually run in front of this.
   *
   * Decides which entry of `X-Forwarded-For` is believed — see `clientIp`.
   * ZERO means the header is ignored and the socket is used, which is right
   * for a direct deployment and fails safe for a misconfigured one. Behind
   * Cloudflare alone it is 1; behind Cloudflare and your own reverse proxy, 2.
   */
  readonly trustedProxies?: number;
  /** Static files: the PWA shell, the manifest, the service worker. */
  /** A body may be binary — the app icons are PNGs. */
  readonly staticFiles?: Readonly<Record<string, { contentType: string; body: string | Uint8Array }>>;
  /**
   * What to serve for a path that is neither an API route nor a file — a deep
   * link into a screen. The client routes it once it loads; without this the
   * first load of /memory is a 404 and the app looks broken to anyone who
   * bookmarks anything.
   */
  readonly appShell?: string;
  /**
   * The origin this app is served from, for the cross-origin check below.
   * Omit it and the check is skipped — which is honest for a deployment that
   * does not know its own URL, and loud, because config.ts requires one.
   */
  readonly origin?: string;
  readonly onError?: (error: unknown, path: string) => void;
};

/** Methods that change something. GET and HEAD are excluded because a browser
 *  will send a cross-site one on any navigation and refusing those breaks
 *  every ordinary link into the app. */
const CHANGES_SOMETHING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Refuse a state-changing request that a DIFFERENT SITE sent.
 *
 * Belt and braces. The session cookie is already `SameSite=Lax`, which means
 * a browser does not attach it to a cross-site POST at all — so this should
 * never fire in a working browser. It exists because that is one mechanism,
 * enforced by somebody else's code, and the cost of a second one is six lines.
 *
 * An ABSENT Origin is allowed, deliberately. It means the request did not come
 * from a browser page: the tick, Stripe's webhook, curl, a test. Those carry
 * their own credential — an HMAC, a signature, a bearer token — and none of
 * them is what CSRF is about. CSRF is a browser being made to act with a
 * cookie it holds, and a browser always sends Origin on these methods.
 */
function crossOrigin(request: { method?: string; headers: Record<string, unknown> }, configured: string | undefined): boolean {
  if (!CHANGES_SOMETHING.has(request.method ?? 'GET')) return false;
  const origin = request.headers['origin'];
  if (typeof origin !== 'string' || origin === '') return false;

  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    // An Origin that is not a URL is not one that can match anything.
    return true;
  }

  // Compared against the request's OWN Host first, not only against the
  // configured URL — and that ordering is the whole lesson of this function.
  //
  // Checking Origin against LIAN_PUBLIC_URL alone looks stricter and is a
  // trap: any drift between what an operator configured and what a browser
  // actually asks for — http vs https, a port, www vs apex, a proxy that
  // rewrites the scheme — makes every write 403 while reads keep working,
  // which presents as a total outage with no error in any log. This was
  // caught by the browser tests going red, on a server whose configured URL
  // was localhost and whose real one was 127.0.0.1. In production it would
  // have been caught by nobody being able to send a message.
  //
  // Host is safe to compare against: in the attack this defends, the browser
  // sets Host to the SITE BEING ATTACKED and Origin to the attacker's page,
  // so they differ. An attacker who can control both is already the site.
  const requestHost = request.headers['host'];
  if (typeof requestHost === 'string' && host === requestHost) return false;

  if (configured !== undefined) {
    try {
      if (host === new URL(configured).host) return false;
    } catch {
      // A configured URL that does not parse is a configuration problem, not
      // a reason to accept a foreign origin.
    }
  }
  return true;
}

/** A body this size is refused before it is read (see MAX_BODY_BYTES). */
export function createLianServer(options: ServerOptions): Server {
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

    try {
      const staticFile = options.staticFiles?.[url.pathname];
      if (staticFile !== undefined && request.method === 'GET') {
        response.writeHead(200, {
          'content-type': staticFile.contentType,
          // The service worker must not be cached, or a broken one is
          // permanent. A module or stylesheet asked for with ?v= is
          // content-addressed by the deployment's newest mtime, so it can be
          // held for a year; everything else briefly.
          'cache-control': url.pathname === '/sw.js' || url.pathname === '/'
            ? 'no-cache'
            : url.searchParams.has('v') ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
        });
        response.end(staticFile.body);
        return;
      }

      const match = findRoute(options.routes, request.method ?? 'GET', url.pathname);
      if (match === null && options.appShell !== undefined && request.method === 'GET' && !url.pathname.startsWith('/api/')) {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
        response.end(options.appShell);
        return;
      }
      if (match === null) {
        // UI-UX §42: no status code language in her voice — but this is the
        // API, and a client needs the code. The COPY for a 404 screen lives
        // in the catalogue; this is the machine half.
        response.writeHead(404, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'not_found' }));
        return;
      }

      if (crossOrigin(request as unknown as { method?: string; headers: Record<string, unknown> }, options.origin)) {
        // Before the body is read: a cross-site request should cost nothing.
        response.writeHead(403, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'cross_origin', message: 'that request came from somewhere else' }));
        return;
      }

      const rawBody = request.method === 'GET' ? '' : await readBody(request);
      const context = contextFrom(request, rawBody, match.params, url, options.trustedProxies ?? 0);
      const result: HandlerResult = await match.route.handler(context);

      if ('stream' in result) {
        response.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
          // Proxies that buffer would defeat the point of streaming.
          'x-accel-buffering': 'no',
        });
        const write = (event: string, data: unknown) => {
          response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };
        try {
          await result.stream(write, () => response.end());
        } catch (error) {
          // The headers are already sent, so an error has to travel as an
          // event. A stream that just stops is indistinguishable from a
          // network failure, and the client would retry a turn that already
          // charged for itself.
          options.onError?.(error, url.pathname);
          write('error', errorBody(error));
          response.end();
        }
        return;
      }

      writeResult(response, result);
    } catch (error) {
      if (!(error instanceof HttpError)) options.onError?.(error, url.pathname);
      const status = error instanceof HttpError ? error.status : 500;
      if (!response.headersSent) {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(JSON.stringify(errorBody(error)));
      } else {
        response.end();
      }
    }
  });
}

function errorBody(error: unknown): { error: string; message: string } {
  if (error instanceof HttpError) return { error: error.code, message: error.message };
  // Never the internal message: it is the one place a stack trace or a
  // connection string escapes into a response.
  return { error: 'internal', message: 'something went wrong on my side' };
}
