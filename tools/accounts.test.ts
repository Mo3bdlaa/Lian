// ACCOUNTS.md is a working document — somebody sets up nine services from it
// in one sitting — and the way it fails is by going quietly out of date. A
// variable renamed in config.ts leaves the old name in the file, and the
// first sign of it is a service that will not start.
//
// So the list is checked in both directions, the same way TAG_PROMISES is:
// a variable the server reads and the file does not mention is a step
// somebody will be missing, and a variable the file names and nothing reads
// is a step somebody will waste an evening on.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// In tools/, not beside the document it checks. `npm test` globs
// packages/**, apps/** and tools/** — a test under docs/ is collected by
// nothing, runs never, and reports as neither failed nor skipped. Which is
// the exact failure tools/ci-test.ts was written about, and it very nearly
// happened to the test that catches it.
const ROOT = new URL('../', import.meta.url).pathname;
const read = (path: string): string => readFileSync(`${ROOT}${path}`, 'utf8');

const ACCOUNTS = read('docs/ACCOUNTS.md');

/**
 * Every environment variable the running product names.
 *
 * A quoted name of the right SHAPE, not `env['X']` specifically: the model
 * keys are read through `MODEL_KEY_REFS`, a list of the two names, and a
 * pattern that only knew the direct form reported them as documented-but-
 * unread — which is the false alarm that would get this test deleted.
 */
const ENV_NAME = /['"](LIAN_[A-Z0-9_]+|ANTHROPIC_API_KEY(?:_\d)?|DATABASE_URL|NODE_ENV|PORT)['"]/g;
const READS = [
  'apps/server/src/config.ts',
  'apps/server/src/ticker.ts',
  'tools/keys.ts',
].flatMap((file) => [...read(file).matchAll(ENV_NAME)].map((match) => match[1]!));

/**
 * Read from the environment but not a thing anybody sets up an account for.
 *
 * `HTTPS_PROXY` and friends would belong here too if the product read them.
 * Each entry is a variable a reader would gain nothing from seeing in a list
 * of external services.
 */
const NOT_A_SETUP_STEP = new Set<string>([]);

describe('docs/ACCOUNTS.md describes the environment that exists', () => {
  test('every variable the product reads is in the file', () => {
    const missing = [...new Set(READS)]
      .filter((name) => !NOT_A_SETUP_STEP.has(name))
      .filter((name) => !ACCOUNTS.includes(name));
    assert.deepEqual(
      missing, [],
      'these are read at boot and ACCOUNTS.md does not mention them — somebody working '
      + 'down that file will finish with an incomplete environment and no indication of it',
    );
  });

  test('every variable the file names is one something reads', () => {
    const named = [...new Set([...ACCOUNTS.matchAll(/\b(LIAN_[A-Z0-9_]+|ANTHROPIC_API_KEY(?:_\d)?|DATABASE_URL|NODE_ENV|PORT)\b/g)]
      .map((match) => match[1]!))];
    const stale = named.filter((name) => !READS.includes(name));
    assert.deepEqual(
      stale, [],
      'ACCOUNTS.md tells somebody to set these and nothing reads them — a renamed variable '
      + 'leaves its old name here, and the cost is an evening on a service that was already done',
    );
  });

  test('the services are numbered in dependency order, and the file says what blocks what', () => {
    // The ordering IS the deliverable — the file exists so nobody discovers on
    // the third service that the second needed a verified domain first. These
    // three dependencies are the ones that are invisible until you are already
    // on the page asking for a value you cannot have yet.
    const position = (heading: string): number => {
      const at = ACCOUNTS.indexOf(heading);
      assert.notEqual(at, -1, `ACCOUNTS.md no longer has a section for ${heading}`);
      return at;
    };
    assert.ok(position('## 1. A domain') < position('## 6. Transactional email'),
      'the domain must come before email: the API key works and delivery does not until DNS is verified');
    assert.ok(position('## 8. Hosting') < position('## 9. Stripe'),
      'the webhook secret is issued per endpoint, so the app has to be deployed and reachable first');
    assert.ok(ACCOUNTS.includes('LIAN_STRIPE_WEBHOOK_SECRET') && ACCOUNTS.includes('only after step 8'),
      'the one value that cannot be obtained on day one has to say so where it is listed');
  });

  test('every preflight section the file cites is one preflight has', () => {
    const preflight = read('tools/preflight.ts');
    for (const name of ['model', 'email', 'storage', 'speech', 'stripe', 'push']) {
      assert.ok(ACCOUNTS.includes(`npm run preflight ${name}`), `ACCOUNTS.md never tells anybody to run preflight ${name}`);
      assert.ok(preflight.includes(`wants('${name}')`), `ACCOUNTS.md cites 'preflight ${name}' and preflight has no such section`);
    }
  });
});
