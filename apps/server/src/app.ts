// Assembling the application from a Config.
//
// Separate from main.ts so a test can build the same application against the
// same database with a provider that does not call an API — the routes a test
// drives are the routes that ship, not a second table built for testing.
import { anthropicProvider, type Provider } from '@lian/llm';
import { resolveEmbedder, type AnalysisModel, type Embedder } from '@lian/analysis';
import { createLianServer, manifestJson, SERVICE_WORKER, PUSH_CLIENT } from '@lian/http';
import { brandColor, resolveTheme } from '@lian/design';
import { clientModules, stylesheets, icons, version } from './assets.ts';
import { shell } from './shell.ts';
import type { JobDeps } from '@lian/jobs';
import { httpSpeechProvider, DEFAULT_SPEECH } from '@lian/voice';
import type { Server } from 'node:http';
import { analysisModelFrom } from './analysis.ts';
import { routesFor, type Deps } from './wiring.ts';
import { scheduleRunner } from './schedule.ts';
import type { Config } from './config.ts';

export type Overrides = {
  readonly provider?: Provider;
  readonly analysisModel?: AnalysisModel;
  readonly embedder?: Embedder | null;
  readonly now?: () => Date;
  readonly sendEmail?: Deps['sendEmail'];
  readonly log?: (line: string) => void;
  readonly fetcher?: typeof fetch;
  readonly speech?: Deps['speech'];
};

export type Application = {
  readonly server: Server;
  readonly deps: Deps;
  readonly runSchedule: (now: Date) => Promise<unknown>;
};

/**
 * Everything served that is not an API route.
 *
 * Built once at boot: the client's modules with their types stripped, the
 * three stylesheets in load order, the icon sprite, the PWA files, and the
 * shell — which is also returned for every unknown path, so a deep link into
 * a screen works on first load rather than 404ing before the client can
 * route it.
 */
export function assets(): Record<string, { contentType: string; body: string | Uint8Array }> {
  const themeColor = brandColor('brand-cream');
  const v = version(['apps/web', 'design-system/lian-tokens.css', 'packages/i18n/src', 'packages/domain/src']);
  // The unauthenticated default: day, ltr. The pre-hydration script corrects
  // it from the cookie before first paint, and /api/me corrects it again.
  const page = shell({
    theme: resolveTheme({ localHour: 12, mood: 'neutral', preference: 'auto' }),
    direction: 'ltr', themeColor, version: v, title: 'Lian',
  });
  return {
    ...clientModules(['apps/web/src/main.ts']),
    ...stylesheets(),
    ...icons(),
    '/': { contentType: 'text/html; charset=utf-8', body: page },
    '/manifest.webmanifest': { contentType: 'application/manifest+json; charset=utf-8', body: manifestJson(themeColor) },
    '/sw.js': { contentType: 'text/javascript; charset=utf-8', body: SERVICE_WORKER },
    '/push.js': { contentType: 'text/javascript; charset=utf-8', body: PUSH_CLIENT },
  };
}

/** The same map, rebuilt when it is stale. Only for development. */
export function liveAssets(): Record<string, { contentType: string; body: string | Uint8Array }> {
  let built = assets();
  let builtAt = 0;
  const fresh = (): Record<string, { contentType: string; body: string | Uint8Array }> => {
    if (Date.now() - builtAt > 250) {
      built = assets();
      builtAt = Date.now();
    }
    return built;
  };
  return new Proxy({} as Record<string, { contentType: string; body: string | Uint8Array }>, {
    get: (_target, key) => (typeof key === 'string' ? fresh()[key] : undefined),
    has: (_target, key) => typeof key === 'string' && key in fresh(),
    ownKeys: () => Reflect.ownKeys(fresh()),
    getOwnPropertyDescriptor: (_target, key) => Object.getOwnPropertyDescriptor(fresh(), key),
  });
}

export function createApplication(config: Config, overrides: Overrides = {}): Application {
  const log = overrides.log ?? ((line: string) => { console.log(line); });
  const now = overrides.now ?? (() => new Date());

  const provider = overrides.provider ?? anthropicProvider(config.modelApiKeys[0] ?? '');
  const analysisModel = overrides.analysisModel ?? analysisModelFrom(provider);
  const embedder = overrides.embedder !== undefined
    ? overrides.embedder
    : resolveEmbedder({
        model: config.embedder.model, apiKey: config.embedder.apiKey, url: config.embedder.url,
        requireReal: config.nodeEnv === 'production',
      }).embedder;

  const jobDeps: JobDeps = {
    provider, analysisModel, embedder,
    push: config.vapid === null ? null : {
      keys: { publicKey: config.vapid.publicKey, privateKey: config.vapid.privateKey },
      subject: config.vapid.subject,
      ttlSeconds: 4 * 60 * 60,
      ...(overrides.fetcher === undefined ? {} : { fetcher: overrides.fetcher }),
      now,
    },
    now,
  };
  const runSchedule = scheduleRunner(jobDeps);

  const deps: Deps = {
    config, provider, analysisModel, embedder, now, log,
    // Voice is unavailable rather than broken when there is no key: the
    // route says so, and the client falls back to text with her line.
    speech: overrides.speech !== undefined
      ? overrides.speech
      : config.speechApiKey === null
        ? null
        : httpSpeechProvider({ ...DEFAULT_SPEECH, apiKey: config.speechApiKey }),
    sendEmail: overrides.sendEmail ?? null,
    runTick: runSchedule,
  };

  // In development the assets are rebuilt on demand, so editing a client
  // module or the stylesheet is a refresh rather than a restart. In
  // production they are built once at boot: reading from disk per request is
  // a syscall on the hot path for no benefit.
  const files = config.nodeEnv === 'production' ? assets() : liveAssets();
  const server = createLianServer({
    routes: routesFor(deps),
    staticFiles: files,
    appShell: String(files['/']!.body),
    onError: (error, path) => { log(`unhandled error on ${path}: ${String(error)}`); },
  });

  return { server, deps, runSchedule };
}
