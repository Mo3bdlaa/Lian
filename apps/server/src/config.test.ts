// The environment contract.
//
// A deployment fails at boot or it fails at 3am. These tests are the first
// one: every problem reported at once, production strict, development loud
// rather than silent, and one convenience that must never survive into
// production.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, ConfigError, type Env } from './config.ts';

const MINIMUM: Env = { DATABASE_URL: 'postgres://lian:lian@127.0.0.1:5432/lian_dev' };

const PRODUCTION: Env = {
  ...MINIMUM,
  NODE_ENV: 'production',
  LIAN_PUBLIC_URL: 'https://lian.example',
  ANTHROPIC_API_KEY: 'k',
  LIAN_TICK_SECRET: 's',
  LIAN_VAPID_PUBLIC_KEY: 'p',
  LIAN_VAPID_PRIVATE_KEY: 'q',
  LIAN_EMBEDDER_MODEL: 'text-embedding-3-large',
  LIAN_EMBEDDER_API_KEY: 'e',
  LIAN_STORAGE_BUCKET: 'lian',
  LIAN_STORAGE_ENDPOINT: 'https://storage.example',
  LIAN_STORAGE_ACCESS_KEY_ID: 'k',
  LIAN_STORAGE_SECRET_ACCESS_KEY: 's',
  LIAN_STRIPE_SECRET_KEY: 'sk',
  LIAN_STRIPE_PRICE_ID: 'price',
  LIAN_STRIPE_WEBHOOK_SECRET: 'whsec',
  LIAN_EMAIL_API_KEY: 're_key',
  LIAN_EMAIL_FROM: 'Lian <hello@lian.example>',
};

function problemsOf(env: Env): string[] {
  try {
    loadConfig(env);
    return [];
  } catch (error) {
    assert.ok(error instanceof ConfigError);
    return [...error.problems];
  }
}

describe('the environment contract', () => {
  test('a database is the one thing with no degraded mode', () => {
    const problems = problemsOf({});
    assert.equal(problems.length, 1);
    assert.match(problems[0]!, /DATABASE_URL/);
  });

  test('every problem is reported at once, not one deploy at a time', () => {
    const problems = problemsOf({ NODE_ENV: 'production', LIAN_PUBLIC_URL: 'https://lian.example' });
    // Database, model key, tick secret, VAPID pair, embedder, storage,
    // Stripe, email: eight.
    assert.ok(problems.length >= 8, `expected every problem at once, got ${problems.length}`);
    assert.ok(problems.some((line) => line.includes('ANTHROPIC_API_KEY')));
    assert.ok(problems.some((line) => line.includes('LIAN_TICK_SECRET')));
    assert.ok(problems.some((line) => line.includes('VAPID')));
  });

  test('each problem says what breaks, not just what is missing', () => {
    // "LIAN_TICK_SECRET is required" tells an operator nothing about whether
    // they can ship without it.
    const problems = problemsOf({ ...MINIMUM, NODE_ENV: 'production', LIAN_PUBLIC_URL: 'https://lian.example' });
    for (const problem of problems) assert.match(problem, / — .+/, problem);
  });

  test('development degrades loudly instead of failing', () => {
    const { config, degraded } = loadConfig(MINIMUM);
    assert.equal(config.nodeEnv, 'development');
    assert.ok(degraded.length >= 7, 'a fallback nobody can see becomes the production configuration by accident');
    assert.ok(degraded.some((line) => line.includes('LIAN_EMBEDDER')));
    assert.equal(config.vapid, null, 'no keys means no keys, not an empty string pretending to be one');
    assert.equal(config.tickSecret, null);
    assert.equal(config.storage, null, 'a half-configured bucket is no bucket');
    assert.equal(config.stripe, null, 'and a half-configured Stripe takes payments it cannot confirm');
    assert.equal(config.email, null, 'and no transport is no transport, not an empty key');
  });

  test('email needs both values, and the From address has to be one', () => {
    // With one of the two, every send fails at the provider rather than being
    // skipped — which is worse, because the app believes it has a transport.
    const partial = problemsOf({ ...MINIMUM, LIAN_EMAIL_API_KEY: 're_key' });
    assert.ok(partial.some((line) => line.includes('email needs both')), partial.join(' | '));

    // The From DOMAIN has to be verified with the provider, and that is the
    // commonest first-send failure — so a value that is not even an address
    // is caught before anybody goes looking at DNS.
    const bad = problemsOf({ ...PRODUCTION, LIAN_EMAIL_FROM: 'lian' });
    assert.ok(bad.some((line) => line.includes('LIAN_EMAIL_FROM')), bad.join(' | '));

    // "Name <a@b.c>" is a legitimate From and must not be refused.
    assert.notEqual(loadConfig({ ...PRODUCTION, LIAN_EMAIL_FROM: 'Lian <hello@lian.example>' }).config.email, null);
  });

  test('billing needs all three values or it is not configured', () => {
    // The shape that half-works: checkout succeeds and nothing ever marks the
    // account paid, so somebody is charged and stays on the free plan.
    const problems = problemsOf({ ...PRODUCTION, LIAN_STRIPE_WEBHOOK_SECRET: '' });
    assert.ok(problems.some((line) => line.includes('LIAN_STRIPE_SECRET_KEY')), problems.join(' | '));

    // And it is a PROBLEM rather than a degraded mode even in development:
    // none of the three set is "billing is off", which is fine; some of them
    // set is a deployment that will take a payment it cannot confirm, and
    // that is worth refusing to start over.
    const partial = problemsOf({ ...MINIMUM, LIAN_STRIPE_SECRET_KEY: 'sk' });
    assert.ok(partial.some((line) => line.includes('billing needs all three')), partial.join(' | '));
    assert.equal(loadConfig(MINIMUM).config.stripe, null, 'none of the three is billing off, not billing broken');
  });

  test('production over http is refused', () => {
    // Service workers, web push and a Secure cookie all require https.
    const problems = problemsOf({ ...PRODUCTION, LIAN_PUBLIC_URL: 'http://lian.example' });
    assert.equal(problems.length, 1);
    assert.match(problems[0]!, /https/);
  });

  test('cookies are Secure exactly when the deployment is', () => {
    assert.equal(loadConfig(PRODUCTION).config.secureCookies, true);
    assert.equal(loadConfig(MINIMUM).config.secureCookies, false);
  });

  test('the development confirmation-link log cannot reach production', () => {
    // It prints a link that grants a session. In development that is a
    // convenience; in production it is a second way in, and this codebase
    // does not have one.
    const problems = problemsOf({ ...PRODUCTION, LIAN_LOG_CONFIRMATION_LINKS: 'true' });
    assert.equal(problems.length, 1);
    assert.match(problems[0]!, /local development only/);

    const local = loadConfig({ ...MINIMUM, LIAN_LOG_CONFIRMATION_LINKS: 'true' });
    assert.equal(local.config.logConfirmationLinks, true);
  });

  test('the trusted-proxy count is a number of hops, and zero is the default', () => {
    // It decides which X-Forwarded-For entry is believed, which decides the
    // sign-in rate limit and the Security screen's location. A default of
    // zero ignores the header entirely — right for a direct deployment, and
    // the safe direction for a misconfigured one.
    assert.equal(loadConfig(MINIMUM).config.trustedProxies, 0);
    assert.equal(loadConfig({ ...MINIMUM, LIAN_TRUSTED_PROXIES: '2' }).config.trustedProxies, 2);
    for (const bad of ['-1', '1.5', 'two', '99']) {
      const problems = problemsOf({ ...PRODUCTION, LIAN_TRUSTED_PROXIES: bad });
      assert.equal(problems.length, 1, `${bad} was accepted as a hop count`);
      assert.match(problems[0]!, /hop count between 0 and 8/);
    }
  });

  test('storage needs all four values or it is not configured', () => {
    // A bucket name with no key is the shape that fails at the first upload
    // rather than at boot.
    const problems = problemsOf({ ...PRODUCTION, LIAN_STORAGE_SECRET_ACCESS_KEY: '' });
    assert.equal(problems.length, 1);
    assert.match(problems[0]!, /photographs and voice notes have nowhere to live/);
  });

  test('a full production environment loads with nothing degraded', () => {
    // Every optional service named, including the geo database — "full"
    // means nothing is missing, so a capability added later has to be added
    // here too or this test stops meaning what it says.
    const { config, degraded } = loadConfig({
      ...PRODUCTION, LIAN_SPEECH_API_KEY: 'v', LIAN_GEOIP_DB: '/srv/lian/geo.mmdb',
    });
    assert.deepEqual(degraded, []);
    assert.equal(config.storage?.bucket, 'lian');
    assert.equal(config.publicUrl, 'https://lian.example');
    assert.equal(config.modelApiKeys.length, 1);
  });

  test('a second model key is picked up when it is there', () => {
    // The key pool exists so one cooling-down key does not stop her talking.
    const { config } = loadConfig({ ...PRODUCTION, ANTHROPIC_API_KEY_2: 'second' });
    assert.deepEqual([...config.modelApiKeys], ['k', 'second']);
  });

  test('PORT 0 is allowed and means "any free port"', () => {
    assert.equal(loadConfig({ ...MINIMUM, PORT: '0' }).config.port, 0);
    assert.match(problemsOf({ ...MINIMUM, PORT: 'eight thousand' })[0]!, /PORT/);
  });

  test('a trailing slash on the public URL does not become a double slash', () => {
    const { config } = loadConfig({ ...PRODUCTION, LIAN_PUBLIC_URL: 'https://lian.example/' });
    assert.equal(config.publicUrl, 'https://lian.example');
  });
});
