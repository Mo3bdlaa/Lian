// Assembling the application from a Config.
//
// Separate from main.ts so a test can build the same application against the
// same database with a provider that does not call an API — the routes a test
// drives are the routes that ship, not a second table built for testing.
import { anthropicProvider, type Provider } from '@lian/llm';
import { resolveEmbedder, type AnalysisModel, type Embedder } from '@lian/analysis';
import { createLianServer, staticFiles } from '@lian/http';
import { brandColor } from '@lian/design';
import type { JobDeps } from '@lian/jobs';
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
};

export type Application = {
  readonly server: Server;
  readonly deps: Deps;
  readonly runSchedule: (now: Date) => Promise<unknown>;
};

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
    sendEmail: overrides.sendEmail ?? null,
    runTick: runSchedule,
  };

  const server = createLianServer({
    routes: routesFor(deps),
    // The one literal colour in the product, read from the token file.
    staticFiles: staticFiles(brandColor('brand-cream')),
    onError: (error, path) => { log(`unhandled error on ${path}: ${String(error)}`); },
  });

  return { server, deps, runSchedule };
}
