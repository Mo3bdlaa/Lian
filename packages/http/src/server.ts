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
  readonly onError?: (error: unknown, path: string) => void;
};

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

      const rawBody = request.method === 'GET' ? '' : await readBody(request);
      const context = contextFrom(request, rawBody, match.params, url);
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
