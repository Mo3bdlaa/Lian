// The transport, and the part that matters: what it says when it fails.
//
// A send either works or it does not, and there is nothing clever to test
// about the working case. What is worth testing is the CLASSIFICATION — three
// states that need three different actions and arrive as the same status code
// often enough that guessing costs a day each.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { httpEmailProvider, classify, EmailError } from './provider.ts';

const CONFIG = { apiKey: 're_test', from: 'Lian <hello@lian.example>' };

function fakeFetch(response: { status: number; body?: string }): typeof fetch {
  return (async (_url: string, init: RequestInit) => {
    fakeFetch.lastBody = String(init.body);
    fakeFetch.lastHeaders = init.headers as Record<string, string>;
    return new Response(response.body ?? '', { status: response.status });
  }) as unknown as typeof fetch;
}
fakeFetch.lastBody = '';
fakeFetch.lastHeaders = {} as Record<string, string>;

describe('sending', () => {
  test('a message goes out as plain text, with no HTML part', async () => {
    // No HTML deliberately: a second body to keep in step with the first, and
    // the only place a tracking pixel could live.
    await httpEmailProvider(CONFIG, fakeFetch({ status: 200, body: '{"id":"x"}' })).send({
      to: 'adam@example.test', subject: 'Setting a new password', body: 'A sentence.\nA link.',
    });
    const sent = JSON.parse(fakeFetch.lastBody) as Record<string, unknown>;
    assert.deepEqual(sent['to'], ['adam@example.test']);
    assert.equal(sent['text'], 'A sentence.\nA link.');
    assert.equal(sent['html'], undefined, 'an HTML part is a second body and a place for a pixel');
    assert.equal(sent['from'], CONFIG.from);
  });

  test('the key travels as a bearer token and not in the body', async () => {
    await httpEmailProvider(CONFIG, fakeFetch({ status: 200 })).send({ to: 'a@b.test', subject: 's', body: 'b' });
    assert.equal(fakeFetch.lastHeaders['authorization'], 'Bearer re_test');
    assert.ok(!fakeFetch.lastBody.includes('re_test'));
  });
});

describe('what it says when it fails', () => {
  const cases: { name: string; status: number; body: string; failure: string }[] = [
    // The one that stops everything: nothing will ever send until somebody
    // changes the account.
    { name: 'a wrong key', status: 401, body: '{"name":"missing_api_key"}', failure: 'not_authorised' },
    { name: 'a restricted key', status: 403, body: '{"name":"restricted_api_key"}', failure: 'not_authorised' },
    // The commonest first-send failure there is, and it must not look like a
    // bad address: the DOMAIN of the From is not verified with the provider.
    { name: 'an unverified sending domain', status: 403, body: '{"name":"domain_not_verified"}', failure: 'not_authorised' },
    // This address specifically. Everything else still sends.
    { name: 'a malformed recipient', status: 422, body: '{"name":"validation_error","message":"Invalid `to` field"}', failure: 'bad_recipient' },
    // The same message later would work.
    { name: 'rate limiting', status: 429, body: '{"name":"rate_limit_exceeded"}', failure: 'throttled' },
    { name: 'a daily quota', status: 400, body: '{"name":"daily_quota_exceeded"}', failure: 'throttled' },
    // THE REGRESSION. This is the exact body a real send with a bad key
    // returned, and the first version of classify() read the `name` before
    // the status and called it a bad recipient — which sends somebody to
    // check the address they were mailing while the key is the problem.
    // Found by tools/preflight.ts making the call, not by reading the docs.
    {
      name: 'an invalid key that the provider labels validation_error',
      status: 401,
      body: '{"statusCode":401,"name":"validation_error","message":"API key is invalid"}',
      failure: 'not_authorised',
    },
  ];

  for (const scenario of cases) {
    test(scenario.name, async () => {
      await assert.rejects(
        () => httpEmailProvider(CONFIG, fakeFetch(scenario)).send({ to: 'a@b.test', subject: 's', body: 'b' }),
        (error: unknown) => {
          assert.ok(error instanceof EmailError);
          assert.equal(error.failure, scenario.failure, `${scenario.name} was classified as ${error.failure}`);
          // The provider's own words survive: a diagnosis is a summary, and
          // the summary must not be the only thing left.
          assert.ok(error.detail.length > 0);
          return true;
        },
      );
    });
  }

  test('a refusal this does not recognise is NOT guessed at', async () => {
    // A wrong diagnosis is worse than none: it sends somebody to fix the
    // thing that was not broken.
    assert.equal(classify(500, '{"name":"something_new"}'), 'refused');
  });

  test('a network failure is distinguished from a refusal', async () => {
    const dead = (async () => { throw new Error('getaddrinfo ENOTFOUND'); }) as unknown as typeof fetch;
    await assert.rejects(
      () => httpEmailProvider(CONFIG, dead).send({ to: 'a@b.test', subject: 's', body: 'b' }),
      (error: unknown) => {
        assert.ok(error instanceof EmailError);
        assert.equal(error.failure, 'unreachable', 'never reaching the provider is not the provider saying no');
        return true;
      },
    );
  });
});
