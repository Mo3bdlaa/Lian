// The environment contract, in one file.
//
// Two rules, both from having deployed something that did not hold them:
//
//   1. Every problem is reported at once.  A boot that fails on the first
//      missing variable makes fixing five of them five deploys.
//   2. Required means required IN PRODUCTION.  Locally, a missing speech key
//      should not stop the server — but it must be visible, so the same
//      function returns `degraded`, printed at boot, rather than a silent
//      fallback.
//
// Nothing here reads process.env directly except `fromProcess`, so a test
// passes an object and gets the real parser.
export type Env = Readonly<Record<string, string | undefined>>;

export type Config = {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly databaseUrl: string;
  readonly port: number;
  /** Where the PWA is served from — used for the push notification's URL and
   *  for the confirmation link in an email. */
  readonly publicUrl: string;
  readonly secureCookies: boolean;
  readonly modelApiKeys: readonly string[];
  readonly tickSecret: string | null;
  readonly vapid: { readonly publicKey: string; readonly privateKey: string; readonly subject: string } | null;
  readonly embedder: { readonly model: string; readonly apiKey: string; readonly url: string | undefined };
  readonly speechApiKey: string | null;
  /**
   * Object storage. Null means the deployment has nowhere to put a
   * photograph or a voice note, and says so at boot rather than at the first
   * upload.
   */
  readonly storage: {
    readonly endpoint: string; readonly region: string; readonly bucket: string;
    readonly accessKeyId: string; readonly secretAccessKey: string; readonly pathStyle: boolean;
  } | null;
  /**
   * Local development only: print the device-confirmation link to the server
   * log instead of emailing it.
   *
   * It is refused in production by `loadConfig`, and that refusal is a test.
   * A convenience that survives into production is a second way to get a
   * session, which is exactly the kind of path this codebase does not have.
   */
  readonly logConfirmationLinks: boolean;
};

export class ConfigError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(`the environment is not usable:\n  - ${problems.join('\n  - ')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

const truthy = (value: string | undefined): boolean => value === '1' || value?.toLowerCase() === 'true';

export function loadConfig(env: Env): { config: Config; degraded: string[] } {
  const problems: string[] = [];
  const degraded: string[] = [];

  const nodeEnv = (env['NODE_ENV'] ?? 'development') as Config['nodeEnv'];
  const production = nodeEnv === 'production';
  const require = (name: string, value: string | undefined, why: string): string => {
    if (value !== undefined && value !== '') return value;
    if (production) problems.push(`${name} is not set — ${why}`);
    else degraded.push(`${name} is not set — ${why}`);
    return '';
  };

  const databaseUrl = env['DATABASE_URL'] ?? '';
  // The one value with no degraded mode: there is nowhere to put anything.
  if (databaseUrl === '') problems.push('DATABASE_URL is not set — there is no database to connect to');

  const modelApiKeys = [env['ANTHROPIC_API_KEY'], env['ANTHROPIC_API_KEY_2']]
    .filter((key): key is string => key !== undefined && key !== '');
  if (modelApiKeys.length === 0) {
    require('ANTHROPIC_API_KEY', undefined, 'she cannot answer without a model key');
  }

  const tickSecret = env['LIAN_TICK_SECRET'] ?? '';
  if (tickSecret === '') require('LIAN_TICK_SECRET', undefined, '/api/tick refuses every call without it, so nothing proactive runs');

  const vapidPublic = env['LIAN_VAPID_PUBLIC_KEY'] ?? '';
  const vapidPrivate = env['LIAN_VAPID_PRIVATE_KEY'] ?? '';
  if (vapidPublic === '' || vapidPrivate === '') {
    require('LIAN_VAPID_PUBLIC_KEY / LIAN_VAPID_PRIVATE_KEY', undefined, 'she cannot reach anyone with the app closed — the message is still written, and reports nowhereToSend');
  }

  const embedderModel = env['LIAN_EMBEDDER_MODEL'] ?? '';
  const embedderKey = env['LIAN_EMBEDDER_API_KEY'] ?? '';
  if (embedderModel === '' || embedderKey === '') {
    require('LIAN_EMBEDDER_MODEL / LIAN_EMBEDDER_API_KEY', undefined, 'memory retrieval falls back to a deterministic embedder: it matches repeated text and misses paraphrase');
  }

  const speechApiKey = env['LIAN_SPEECH_API_KEY'] ?? '';
  if (speechApiKey === '') degraded.push('LIAN_SPEECH_API_KEY is not set — voice is unavailable; text is unaffected');

  const storageBucket = env['LIAN_STORAGE_BUCKET'] ?? '';
  const storageEndpoint = env['LIAN_STORAGE_ENDPOINT'] ?? '';
  const storageKeyId = env['LIAN_STORAGE_ACCESS_KEY_ID'] ?? '';
  const storageSecret = env['LIAN_STORAGE_SECRET_ACCESS_KEY'] ?? '';
  const hasStorage = storageBucket !== '' && storageEndpoint !== '' && storageKeyId !== '' && storageSecret !== '';
  if (!hasStorage) {
    require(
      'LIAN_STORAGE_BUCKET / _ENDPOINT / _ACCESS_KEY_ID / _SECRET_ACCESS_KEY',
      undefined,
      'photographs and voice notes have nowhere to live: receipts cannot be captured and voice notes fall back to text',
    );
  }

  const logConfirmationLinks = truthy(env['LIAN_LOG_CONFIRMATION_LINKS']);
  if (logConfirmationLinks && production) {
    problems.push('LIAN_LOG_CONFIRMATION_LINKS is set in production — it prints a link that grants a session, and it exists for local development only');
  }

  // 0 is allowed and means "any free port" — how a test starts a real server
  // without picking a number and hoping.
  const port = Number(env['PORT'] ?? '8787');
  if (!Number.isInteger(port) || port < 0 || port > 65_535) problems.push(`PORT '${env['PORT']}' is not a port number`);

  const publicUrl = (env['LIAN_PUBLIC_URL'] ?? `http://localhost:${port}`).replace(/\/$/, '');
  if (production && !publicUrl.startsWith('https://')) {
    // Not pedantry: the service worker, push, and a Secure cookie all refuse
    // to work over http anywhere but localhost.
    problems.push('LIAN_PUBLIC_URL must be https in production — service workers, web push and Secure cookies all require it');
  }

  if (problems.length > 0) throw new ConfigError(problems);

  return {
    config: {
      nodeEnv, databaseUrl, port, publicUrl,
      secureCookies: publicUrl.startsWith('https://'),
      modelApiKeys, tickSecret: tickSecret === '' ? null : tickSecret,
      vapid: vapidPublic === '' || vapidPrivate === '' ? null : {
        publicKey: vapidPublic, privateKey: vapidPrivate,
        subject: env['LIAN_VAPID_SUBJECT'] ?? 'mailto:ops@example.com',
      },
      embedder: { model: embedderModel, apiKey: embedderKey, url: env['LIAN_EMBEDDER_URL'] },
      speechApiKey: speechApiKey === '' ? null : speechApiKey,
      storage: hasStorage
        ? {
            endpoint: storageEndpoint, bucket: storageBucket,
            region: env['LIAN_STORAGE_REGION'] ?? 'auto',
            accessKeyId: storageKeyId, secretAccessKey: storageSecret,
            // Path style is the safe default: it works with MinIO, Garage and
            // R2's S3 endpoint, and with S3 proper. Virtual-host style is the
            // opt-in.
            pathStyle: (env['LIAN_STORAGE_PATH_STYLE'] ?? 'true') !== 'false',
          }
        : null,
      logConfirmationLinks,
    },
    degraded,
  };
}

export function fromProcess(): { config: Config; degraded: string[] } {
  return loadConfig(process.env as Env);
}
