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
    // Database, model key, tick secret, VAPID pair, embedder: five, in one go.
    assert.ok(problems.length >= 5, `expected every problem at once, got ${problems.length}`);
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
    assert.ok(degraded.length >= 4, 'a fallback nobody can see becomes the production configuration by accident');
    assert.ok(degraded.some((line) => line.includes('LIAN_EMBEDDER')));
    assert.equal(config.vapid, null, 'no keys means no keys, not an empty string pretending to be one');
    assert.equal(config.tickSecret, null);
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

  test('a full production environment loads with nothing degraded', () => {
    const { config, degraded } = loadConfig({ ...PRODUCTION, LIAN_SPEECH_API_KEY: 'v' });
    assert.deepEqual(degraded, []);
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
