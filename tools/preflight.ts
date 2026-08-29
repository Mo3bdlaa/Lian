// ==========================================================================
// PREFLIGHT — the live integrations, against the real services.
//
//   node tools/preflight.ts            # everything that is configured
//   node tools/preflight.ts model      # one of: model, email, storage, speech, stripe, push, geo, db
//
// MODEL is first, because without it she does not answer at all and every
// other check is about a feature of a product that cannot talk. It is also
// the cheapest thing here by a wide margin — one four-token reply, which at
// the catalogue's prices is a fraction of a cent — so it is the right thing
// to run before spending anything on a real session.
//
// Email is next because recovery that reaches nobody is not recovery, and
// because it is the one whose first failure is almost always the same thing:
// a sending domain nobody verified.
//
// Everything else in this repository is tested against a fake. These four are
// not testable that way — a fake of S3 proves the fake, and a signature is
// either accepted by AWS or it is not. So this makes the real calls, in the
// smallest form each one has, and when something fails it says WHICH THING
// failed rather than that something did.
//
// That last part is the whole point. "403 from the bucket" is three different
// problems with three different fixes:
//
//   the signature   the key, the secret, the region, or the path style
//   the clock       this machine's time is more than 15 minutes off
//   the policy      the credentials are right and are not allowed to do that
//
// The services tell you which, in a header or an XML code, and nobody reads
// it because it arrives inside a stack trace. This reads it.
//
// NOTHING HERE WRITES TO YOUR DATABASE. It uploads one object under a
// `preflight/` prefix and deletes it, sends one short sentence to be spoken,
// makes one read-only call to Stripe, and runs two read-only SELECTs against
// Postgres to check the vector index is actually answering.
import { s3Store, presign } from '@lian/storage';
import { httpSpeechProvider, DEFAULT_SPEECH } from '@lian/voice';
import { STRIPE_API_VERSION } from '@lian/billing';
import { httpEmailProvider, EmailError } from '@lian/email';
import { DEFAULT_MODEL } from '@lian/llm';
import { db, closeDb } from '@lian/db';
import { Mmdb, lookupIn } from '@lian/geo';
import { recallOf, recallVerdict, RECALL_FLOOR } from './harness.ts';
import { loadConfig } from '../apps/server/src/config.ts';

const only = process.argv[2] ?? 'all';
const wants = (name: string): boolean => only === 'all' || only === name;

let failures = 0;
const pass = (what: string, detail = ''): void => { console.log(`  ✓ ${what}${detail === '' ? '' : `  ${detail}`}`); };
const fail = (what: string, why: string, fix: string): void => {
  failures += 1;
  console.log(`  ✗ ${what}`);
  console.log(`      what happened  ${why}`);
  console.log(`      what to do     ${fix}`);
};
const skip = (what: string, why: string): void => { console.log(`  – ${what}  (${why})`); };

const { config, degraded } = loadConfig(process.env as Record<string, string | undefined>);
void degraded;

/**
 * The model.
 *
 * ONE reply, four tokens, on the cheapest useful path. This is the check to
 * run first when a key arrives: it costs a fraction of a cent and it
 * distinguishes the four things that all present as "she did not answer".
 *
 * The status is what the KEY POOL cools down on (LESSONS §12), so the codes
 * below are the same ones that take a key out of rotation — and if a second
 * key is configured, this reports that too, because an operator who set
 * ANTHROPIC_API_KEY_2 had it silently discarded until the ninth run.
 */
async function checkModel(): Promise<void> {
  console.log('\nmodel');
  if (config.modelApiKeys.length === 0) {
    skip('model', 'ANTHROPIC_API_KEY not set — she cannot answer at all');
    return;
  }
  pass('keys configured', `${config.modelApiKeys.length} (${config.modelKeyRefs.join(', ')})`);
  if (config.modelApiKeys.length === 1) {
    console.log('      note           one key means no rotation: a 429 stops her until it clears.');
  }

  const started = Date.now();
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': config.modelApiKeys[0]!,
        'anthropic-version': '2023-06-01',
      },
      // Four tokens out, a handful in. The point is the round trip, not the
      // answer, so it asks for the shortest possible one.
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        max_tokens: 4,
        messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
      }),
    });
    const body = await response.text();

    if (response.ok) {
      const usage = (JSON.parse(body) as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
      pass('one reply', `${Date.now() - started}ms, ${usage?.input_tokens ?? '?'} in / ${usage?.output_tokens ?? '?'} out, model ${DEFAULT_MODEL}`);
      return;
    }

    // The four that all look like "she did not answer".
    const diagnosis =
      response.status === 401 ? ['the key is wrong or revoked', 'check ANTHROPIC_API_KEY — this is the key itself, not a permission.']
      : response.status === 403 ? ['the key is real and not allowed to do this', 'check the key\'s permissions and the organisation it belongs to.']
      : response.status === 429 ? ['rate limited or out of credit', 'these are DIFFERENT: read the message below. Out of credit does not clear by waiting.']
      : response.status === 404 ? [`the model id ${DEFAULT_MODEL} was not found`, 'the id in packages/llm/catalogue.ts is not one this key can reach.']
      : [`HTTP ${response.status}`, 'the message below is the provider\'s own.'];
    fail('one reply', `${diagnosis[0]} — ${body.slice(0, 300)}`, diagnosis[1]!);
  } catch (error) {
    fail('reaching the model', String((error as Error).message), 'network, DNS, or a proxy in front of api.anthropic.com.');
  }
}

// ── storage ────────────────────────────────────────────────────────────────

/**
 * S3 and its compatibles answer a refusal with XML carrying a machine code.
 * These are the ones that mean different things, and what each one is
 * actually telling you.
 */
const S3_DIAGNOSIS: { code: RegExp; why: string; fix: string }[] = [
  {
    code: /SignatureDoesNotMatch/,
    why: 'the bucket computed a different signature from the same request — the SIGNATURE is wrong, not the permissions',
    fix: 'check LIAN_STORAGE_SECRET_ACCESS_KEY first (a trailing newline in a .env file is the usual culprit), then '
      + 'LIAN_STORAGE_REGION: it is part of what gets signed, so "auto" against a bucket that wants "us-east-1" fails here '
      + 'and nowhere else. If both are right, the endpoint is probably virtual-host style while this signs path style.',
  },
  {
    code: /RequestTimeTooSkewed|Request has expired/,
    why: "this machine's clock is more than fifteen minutes from the bucket's — the signature was correct and arrived too late to be believed",
    fix: 'set the system clock (on Linux: `timedatectl set-ntp true`). Nothing in the app can work around this: the timestamp is signed.',
  },
  {
    code: /AccessDenied/,
    why: 'the credentials were RECOGNISED and are not allowed to do that — signature fine, policy wrong',
    fix: 'the key needs s3:PutObject, s3:GetObject, s3:DeleteObject and s3:ListBucket on this bucket and its contents. '
      + 'On R2, that is an API token with Object Read & Write scoped to the bucket.',
  },
  {
    code: /NoSuchBucket/,
    why: 'the credentials work and the bucket does not exist at that endpoint',
    fix: 'check LIAN_STORAGE_BUCKET spelling, and that LIAN_STORAGE_ENDPOINT points at the right account.',
  },
  {
    code: /InvalidAccessKeyId/,
    why: 'the access key id is not one this service knows',
    fix: 'check LIAN_STORAGE_ACCESS_KEY_ID — and that it belongs to the same account as the endpoint.',
  },
];

function diagnoseS3(status: number, body: string): { why: string; fix: string } {
  for (const entry of S3_DIAGNOSIS) {
    if (entry.code.test(body)) return { why: `${status} — ${entry.why}`, fix: entry.fix };
  }
  return {
    why: `${status}, and the body did not name a code this knows: ${body.slice(0, 200)}`,
    fix: 'paste the body above into the issue; the code inside it is the answer.',
  };
}

async function checkStorage(): Promise<void> {
  console.log('\n── STORAGE (S3-compatible) ───────────────────────────────');
  if (config.storage === null) {
    skip('storage', 'LIAN_STORAGE_* not set — all four are needed');
    return;
  }
  console.log(`  endpoint  ${config.storage.endpoint}`);
  console.log(`  bucket    ${config.storage.bucket}   region ${config.storage.region}   ${config.storage.pathStyle ? 'path' : 'virtual-host'} style`);

  // 1. THE CLOCK, before anything is signed. Checked first because a skewed
  //    clock makes every signature look broken, and this separates them
  //    before you have spent an hour on the wrong one.
  try {
    const probe = await fetch(config.storage.endpoint, { method: 'HEAD' });
    const served = probe.headers.get('date');
    if (served !== null) {
      const skew = Math.abs(Date.parse(served) - Date.now()) / 1000;
      if (skew > 300) {
        fail('clock', `this machine is ${Math.round(skew)}s from the storage service`,
          'fix the clock before reading anything below — a signature signs its own timestamp, so every request will fail as if the key were wrong.');
      } else {
        pass('clock', `${Math.round(skew)}s from the service`);
      }
    } else {
      skip('clock', 'the endpoint sent no Date header');
    }
  } catch (error) {
    fail('reaching the endpoint', String((error as Error).message),
      'DNS or the network. Nothing below can run until a plain HEAD to the endpoint works.');
    return;
  }

  const store = s3Store({ ...config.storage });
  const key = `preflight/${Date.now()}.txt`;
  const bytes = new TextEncoder().encode('lian preflight');

  // 2. WRITE. The first real signature.
  try {
    await store.put({ key, bytes, contentType: 'text/plain' });
    pass('put', key);
  } catch (error) {
    // s3Store throws with the status; re-run it here to read the body, which
    // is where the machine-readable code lives.
    const signed = presign(config.storage, { method: 'PUT', key, expiresIn: 300, now: new Date() });
    const response = await fetch(signed, { method: 'PUT', body: bytes, headers: { 'content-type': 'text/plain' } });
    const diagnosis = diagnoseS3(response.status, await response.text());
    fail('put', diagnosis.why, diagnosis.fix);
    console.log(`      (${(error as Error).message})`);
    return;
  }

  // 3. READ BACK — a different signed method, and the one the app uses most.
  try {
    const object = await store.get(key);
    if (object === null) fail('get', 'the object was written and came back as missing', 'if this happens with put succeeding, the bucket is eventually consistent in a way this product does not expect. Say so — it changes the design.');
    else if (new TextDecoder().decode(object.bytes) !== 'lian preflight') fail('get', 'the bytes came back different', 'a proxy is rewriting the body.');
    else pass('get', `${object.bytes.byteLength} bytes, ${object.contentType}`);
  } catch (error) {
    fail('get', String((error as Error).message), 'the write worked, so this is GetObject permission specifically.');
  }

  // 4. THE PRESIGNED URL A BROWSER USES. Different from the calls above: it
  //    is signed here and used by somebody else, with no credentials at all.
  try {
    const url = await store.presignGet({ key, expiresIn: 120 });
    const response = await fetch(url);
    if (response.ok) pass('presigned GET', 'a browser can fetch an attachment');
    else {
      const diagnosis = diagnoseS3(response.status, await response.text());
      fail('presigned GET', diagnosis.why,
        `${diagnosis.fix}\n                     This one matters most: it is how every photograph and voice note reaches a phone.`);
    }
  } catch (error) {
    fail('presigned GET', String((error as Error).message), 'the URL could not be fetched at all — CORS does not apply here, so this is network or DNS.');
  }

  // 5. DELETE. Because LESSONS §11 says deletion is real, and a key that
  //    cannot delete makes that a lie the app cannot detect.
  try {
    const removed = await store.remove([key]);
    if (removed === 1) pass('delete', 'deletion is real');
    else fail('delete', 'the delete call reported removing nothing', 'the key needs s3:DeleteObject. Without it, deleting an account leaves the files behind and the app believes it succeeded.');
  } catch (error) {
    fail('delete', String((error as Error).message), 'the key needs s3:DeleteObject — see above for why that is not optional.');
  }
}

// ── speech ─────────────────────────────────────────────────────────────────

async function checkSpeech(): Promise<void> {
  console.log('\n── SPEECH (TTS + transcription) ──────────────────────────');
  if (config.speechApiKey === null) {
    skip('speech', 'LIAN_SPEECH_API_KEY not set — voice is unavailable and text is unaffected');
    return;
  }
  const speech = httpSpeechProvider({ ...DEFAULT_SPEECH, apiKey: config.speechApiKey });
  console.log(`  provider  ${DEFAULT_SPEECH.id}   tts ${DEFAULT_SPEECH.ttsModel}   stt ${DEFAULT_SPEECH.sttModel}`);

  let spoken: { audio: Uint8Array; contentType: string } | null = null;
  try {
    spoken = await speech.synthesise({ text: 'The rent is due on the fifth.', voiceId: 'shimmer' });
    if (spoken.audio.byteLength < 1_000) {
      fail('synthesise', `the response was ${spoken.audio.byteLength} bytes — too small to be speech`,
        'it is probably a JSON error body being read as audio. Print it.');
    } else {
      pass('synthesise', `${spoken.audio.byteLength} bytes of ${spoken.contentType}`);
    }
  } catch (error) {
    const message = String((error as Error).message);
    fail('synthesise', message,
      message.includes('401') ? 'the key is wrong or has no access to the speech models.'
      : message.includes('429') ? 'rate limited or out of credit — this is a billing state, not a bug.'
      : message.includes('404') ? `the model name is wrong: DEFAULT_SPEECH.ttsModel is '${DEFAULT_SPEECH.ttsModel}' and the provider does not have it.`
      : 'the provider refused. The status is in the message.');
  }

  // Round trip: the two halves are separate APIs and a key can have one and
  // not the other.
  if (spoken !== null && spoken.audio.byteLength >= 1_000) {
    try {
      const heard = await speech.transcribe({ audio: spoken.audio, contentType: spoken.contentType, languageHint: 'en' });
      if (/rent/i.test(heard.text)) pass('transcribe', `heard "${heard.text.slice(0, 60)}"`);
      else {
        fail('transcribe', `it returned "${heard.text.slice(0, 80)}" for speech saying "The rent is due on the fifth."`,
          'the call works and the audio format may be wrong for the STT model. Check that synthesise returned mp3.');
      }
    } catch (error) {
      fail('transcribe', String((error as Error).message),
        'synthesis worked, so the key is valid — this is the transcription endpoint or model specifically.');
    }
  }
}

// ── email ──────────────────────────────────────────────────────────────────

/**
 * What each classification means and what to do about it.
 *
 * The transport's `classify` turns a status and a body into one of five
 * states; this turns a state into an instruction. They are separate because
 * the first is a property of the provider and the second is a property of
 * being at a laptop trying to make a first send work.
 */
const EMAIL_FIX: Record<string, string> = {
  not_authorised:
    'either LIAN_EMAIL_API_KEY is wrong, or — far more likely on a first send — the DOMAIN of LIAN_EMAIL_FROM '
    + 'is not verified with the provider. Adding the DNS records is the step people skip; the key works and '
    + 'nothing sends. Check the domains page in the provider dashboard, not the API keys page.',
  bad_recipient:
    'the address this was sent TO was refused: malformed, or on the provider suppression list from an earlier bounce. '
    + 'Try a different address before assuming the configuration is wrong.',
  throttled: 'rate limited or over the daily quota. A billing or plan state, not a bug — the same send later would work.',
  refused: 'the provider said no for a reason this does not recognise. The message below is its own; paste it into the issue.',
  unreachable: 'the provider was never reached. DNS or the network.',
};

async function checkEmail(): Promise<void> {
  console.log('\n── EMAIL ─────────────────────────────────────────────────');
  if (config.email === null) {
    skip('email', 'LIAN_EMAIL_API_KEY / LIAN_EMAIL_FROM not set — recovery reaches nobody');
    return;
  }
  console.log(`  from      ${config.email.from}`);

  // Where to send it. Sending to a real inbox is the point — a provider will
  // happily accept a message for an address that never receives it, and the
  // only proof is somebody looking.
  const to = process.env['LIAN_PREFLIGHT_EMAIL'] ?? '';
  if (to === '') {
    skip('the send', 'set LIAN_PREFLIGHT_EMAIL=you@example.com to actually send one');
    console.log('      Everything above is configuration. A provider accepting a message');
    console.log('      is not the same as an inbox receiving it, and only you can check');
    console.log('      the second one.');
    return;
  }

  try {
    await httpEmailProvider(config.email).send({
      to,
      subject: 'Lian preflight',
      body: 'This is the preflight check from tools/preflight.ts.\n\nIf it arrived, the transport works.',
    });
    pass('send', `accepted for ${to}`);
    console.log('      Now go and look. A provider accepting a message is not an inbox');
    console.log('      receiving it — check the spam folder too, because a reset link in');
    console.log('      spam is a locked-out account.');
  } catch (error) {
    if (error instanceof EmailError) {
      fail('send', `${error.failure} (${error.status}) — ${error.detail.slice(0, 200)}`, EMAIL_FIX[error.failure] ?? EMAIL_FIX['refused']!);
    } else {
      fail('send', String((error as Error).message), 'not an error the transport produced — network, or a bug here.');
    }
  }
}

// ── stripe ─────────────────────────────────────────────────────────────────

async function checkStripe(): Promise<void> {
  console.log('\n── STRIPE ────────────────────────────────────────────────');
  if (config.stripe === null) {
    skip('stripe', 'LIAN_STRIPE_* not set — checkout answers 503 and every account stays free');
    return;
  }
  console.log(`  api version  ${STRIPE_API_VERSION} (pinned)`);
  const live = config.stripe.secretKey.startsWith('sk_live');
  console.log(`  key mode     ${live ? 'LIVE — this will move real money' : 'test'}`);

  // A read, not a write: this proves the key and the price id without
  // creating anything.
  try {
    const response = await fetch(`https://api.stripe.com/v1/prices/${encodeURIComponent(config.stripe.priceId)}`, {
      headers: { authorization: `Bearer ${config.stripe.secretKey}`, 'stripe-version': STRIPE_API_VERSION },
    });
    const body = (await response.json()) as { id?: string; unit_amount?: number; currency?: string; recurring?: { interval?: string }; error?: { message?: string; type?: string } };
    if (!response.ok) {
      fail('the price', `${response.status} — ${body.error?.message ?? 'no message'}`,
        response.status === 401 ? 'LIAN_STRIPE_SECRET_KEY is wrong, or is a test key against a live price (or the reverse).'
        : response.status === 404 ? 'LIAN_STRIPE_PRICE_ID does not exist in this account. It starts with price_, not prod_ — a product id is the commonest mistake here.'
        : 'the message above is Stripe’s own.');
    } else {
      const amount = body.unit_amount === undefined ? '?' : (body.unit_amount / 100).toFixed(2);
      pass('the price', `${amount} ${String(body.currency).toUpperCase()} per ${body.recurring?.interval ?? '?'}`);
      if (body.recurring?.interval === undefined) {
        fail('the price is not recurring', 'checkout is created with mode=subscription and this price is one-off',
          'make a recurring price in Stripe and use its id.');
      }
      if (body.unit_amount !== 900) {
        console.log(`      note: the product says $9/month everywhere (UI-UX §18) and this price is ${amount}. One of the two is wrong.`);
      }
    }
  } catch (error) {
    fail('reaching Stripe', String((error as Error).message), 'network or DNS.');
  }

  // The webhook secret cannot be verified without a delivery — but its SHAPE
  // can, and the commonest mistake is pasting the API key into it.
  if (!config.stripe.webhookSecret.startsWith('whsec_')) {
    fail('the webhook secret', 'it does not start with whsec_',
      'that field wants the ENDPOINT SIGNING SECRET from the webhook page, not an API key. With the wrong value, checkout succeeds and nothing ever marks the account paid — the failure mode that looks like the customer’s problem.');
  } else {
    pass('the webhook secret', 'shape is right — only a real delivery can prove the rest');
  }
  console.log('      the webhook needs a PUBLIC url: POST {LIAN_PUBLIC_URL}/api/stripe/webhook');
  console.log('      events: checkout.session.completed, customer.subscription.created/updated/deleted');
}

// ── push ───────────────────────────────────────────────────────────────────

async function checkPush(): Promise<void> {
  console.log('\n── WEB PUSH ──────────────────────────────────────────────');
  if (config.vapid === null) {
    skip('push', 'LIAN_VAPID_* not set — a proactive turn still runs and reports nowhereToSend');
    return;
  }
  pass('VAPID keys', 'present');
  // Deliberately not "checked": there is nothing to call. A push service only
  // exists once a browser has subscribed, and a subscription is per browser
  // per device. Saying so is more useful than a green tick that means nothing.
  console.log('      This is the one that CANNOT be checked from here, and the one');
  console.log('      that has never worked end to end. There is no service to call:');
  console.log('      a push endpoint only exists once a browser subscribes to one.');
  console.log('');
  console.log('      The real check is in FIRST-RUN.md step 7: open the app on a');
  console.log('      phone, allow notifications, lock the screen, run the tick, and');
  console.log('      see whether her sentence arrives.');
}

/**
 * The vector index — the one thing here whose failure is SILENT.
 *
 * An ivfflat index computes its list centroids from the data it is built on,
 * and a migration necessarily runs against an empty table. Built empty and
 * then filled with ten thousand vectors, `memories_embedding_idx` returns
 * **2** of the 60 nearest when asked; rebuilt after the data exists, 60 of 60
 * (docs/RETRIEVAL-CEILING.md).
 *
 * NOTHING IN THE PRODUCT NOTICES. The index serves `findSimilar`, the
 * near-duplicate check, so a broken one does not throw and does not slow
 * anything down — it just fails to find the duplicate, and she stores a
 * memory she already had. No error, no alert, no log line. That is exactly
 * the class of defect that survives for months, and it is why this lives in a
 * command that FAILS rather than in a runbook nobody opens.
 *
 * HOW IT IS MEASURED: against the real corpus rather than a synthetic one.
 * The same query is run twice — once letting the planner use the index, once
 * with index scans disabled so it must go through the heap — and the two
 * answers are compared. The sequential answer is exact by construction, so
 * the overlap IS the recall. No seeding, no fixtures, nothing written.
 */
async function checkVectorIndex(): Promise<void> {
  console.log('\n── THE VECTOR INDEX ──────────────────────────────────────');
  if ((process.env['DATABASE_URL'] ?? '') === '') {
    skip('vector index', 'DATABASE_URL not set');
    return;
  }

  const sql = db();
  try {
    // REACHING IT AT ALL IS THE FIRST CHECK, and this file exists because a
    // stack trace is not a diagnosis. An ECONNREFUSED here used to come out
    // as fourteen lines of pg-pool internals; it is one of the three things
    // it can be and they have three different fixes.
    try {
      await sql.query('SELECT 1');
    } catch (error) {
      const message = (error as Error).message;
      const code = (error as { code?: string }).code ?? '';
      if (code === 'ECONNREFUSED' || /ECONNREFUSED/.test(message)) {
        fail('postgres', `nothing is listening at ${new URL(config.databaseUrl).host}`,
          'the server is not running, or DATABASE_URL points at the wrong host or port. Locally: `npm run db:up`.');
      } else if (/password|authenticat|role .* does not exist/i.test(message)) {
        fail('postgres', `refused the credentials: ${message}`,
          'the user or password in DATABASE_URL is wrong, or that role has no access to that database.');
      } else if (/database .* does not exist/i.test(message)) {
        fail('postgres', message, 'the server is up and the database is not. `npm run db:up` creates it.');
      } else {
        fail('postgres', message, 'the connection failed for a reason none of the usual three explains — the message above is the server\'s own.');
      }
      return;
    }
    pass('postgres', 'reachable');

    const extension = await sql.query<{ n: string }>(
      `SELECT count(*) AS n FROM pg_extension WHERE extname = 'vector'`,
    );
    if (Number(extension.rows[0]!.n) === 0) {
      fail('pgvector', 'the `vector` extension is not installed in this database',
        'a plain postgres image does not ship it. Use an image or a managed instance with pgvector, then `npm run migrate`.');
      return;
    }
    pass('pgvector', 'installed');

    // STRUCTURAL FIRST. The index was partial on `status = 'active'` while
    // findSimilar never filters status, so the planner could not prove the
    // implication and never used it — 33ms instead of 3ms, silently, for as
    // long as it took somebody to look. Migration 0022 fixed it; this is here
    // because a deployment can be hand-edited and a repository cannot.
    const definition = await sql.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'memories' AND indexname = 'memories_embedding_idx'`,
    );
    if (definition.rows.length === 0) {
      fail('memories_embedding_idx', 'the vector index does not exist',
        'run `npm run migrate` — migration 0003 creates it and 0022 corrects its predicate.');
      return;
    }
    if (/status/.test(definition.rows[0]!.indexdef)) {
      fail('memories_embedding_idx',
        'the index is partial on `status`, which findSimilar does not filter on',
        'a partial index is only usable when the planner can prove the query implies it. Apply migration 0022.');
      return;
    }
    pass('index predicate', 'matches its caller');

    // Then RECALL, on whatever corpus exists.
    const biggest = await sql.query<{ assistant_id: string; n: number }>(
      `SELECT assistant_id, count(*)::int AS n FROM memories
       WHERE deleted_at IS NULL AND embedding_v IS NOT NULL
       GROUP BY assistant_id ORDER BY n DESC LIMIT 1`,
    );
    const corpus = biggest.rows[0];
    // ASSUMPTION: 200 rows. Below that the planner will not choose the index
    // at all — correctly, a sequential scan is cheaper — so both sides of the
    // comparison would be the same plan and the recall figure would be a
    // tautology. This is the size at which the question starts to mean
    // something, not a claim about when the index starts to matter.
    const MEANINGFUL = 200;
    if (corpus === undefined || corpus.n < MEANINGFUL) {
      skip('index recall', `the largest account has ${corpus?.n ?? 0} embedded memories — under ${MEANINGFUL} there is nothing to measure`);
      console.log('      Not a pass. Run this again once real accounts have a history,');
      console.log('      because an index built by a migration on an empty table returns');
      console.log('      almost nothing and says nothing about it. See ACCOUNTS.md §5.');
      return;
    }

    const K = 30;
    const probe = await sql.query<{ embedding: string }>(
      `SELECT embedding_v::text AS embedding FROM memories
       WHERE assistant_id = $1 AND deleted_at IS NULL AND embedding_v IS NOT NULL LIMIT 1`,
      [corpus.assistant_id],
    );
    const vector = probe.rows[0]!.embedding;
    const NEAREST = `SELECT id FROM memories
       WHERE assistant_id = $1 AND deleted_at IS NULL AND embedding_v IS NOT NULL
       ORDER BY embedding_v <=> $2::vector LIMIT ${K}`;

    const client = await sql.connect();
    let viaIndex: string[];
    let exact: string[];
    let usedIndex: boolean;
    try {
      const plan = await client.query<Record<string, string>>(`EXPLAIN ${NEAREST}`, [corpus.assistant_id, vector]);
      usedIndex = plan.rows.some((r) => /memories_embedding_idx/.test(r['QUERY PLAN'] ?? ''));
      viaIndex = (await client.query<{ id: string }>(NEAREST, [corpus.assistant_id, vector])).rows.map((r) => r.id);
      // The ground truth: no index path available, so it must read the heap,
      // which is exact by construction.
      await client.query('SET LOCAL enable_indexscan = off');
      await client.query('SET LOCAL enable_bitmapscan = off');
      exact = (await client.query<{ id: string }>(NEAREST, [corpus.assistant_id, vector])).rows.map((r) => r.id);
    } finally {
      client.release();
    }

    if (!usedIndex) {
      skip('index recall', `the planner is not choosing the index at ${corpus.n} rows`);
      console.log('      Not a failure: at this size a sequential scan is genuinely');
      console.log('      cheaper, so there is no index answer to compare against.');
      return;
    }

    // The arithmetic is in tools/harness.ts and is unit-tested there — in
    // particular that an EMPTY ground truth is `unmeasurable` rather than a
    // tick or a spurious failure, which every naive spelling of 0/0 gets
    // wrong in one direction or the other.
    const measured = recallOf(viaIndex, exact);
    const verdict = recallVerdict(measured);
    if (verdict === 'unmeasurable') {
      skip('index recall', measured.kind === 'no-ground-truth' ? measured.why : 'nothing to compare');
      return;
    }
    const { overlap, of, recall } = measured as { overlap: number; of: number; recall: number };
    if (verdict === 'fail') {
      fail('index recall',
        `the index returns ${overlap} of the ${of} nearest — ${Math.round(recall * 100)}%, under the ${Math.round(RECALL_FLOOR * 100)}% floor`,
        'rebuild it on the data that exists now: psql "$DATABASE_URL" -c "REINDEX INDEX CONCURRENTLY memories_embedding_idx"');
      console.log('      This does not throw and does not slow anything down. It makes');
      console.log('      her store a memory she already had. See ACCOUNTS.md §5.');
      return;
    }
    pass('index recall', `${overlap}/${of} over ${corpus.n} memories`);
  } finally {
    await closeDb();
  }
}

/**
 * The IP-to-place database — a FILE, and files go stale silently.
 *
 * It was carried in HANDOFF as "operational, not a decision": point
 * `LIAN_GEOIP_DB` at a file and refresh it monthly. That is the same shape as
 * the vector index above — a true sentence in a document that nothing
 * enforces — and the failure mode here is worse than slowness.
 *
 * A stale database does not fail. It answers, confidently, with a city that
 * has since been reassigned to a different range. The Security screen exists
 * to answer "was that you?", and the whole reason it says "Near Dubai" rather
 * than "Dubai" is that a confident wrong city produces the false alarm the
 * screen exists to prevent — somebody who gets two of those stops reading it,
 * which is worse than no line at all.
 *
 * So: does the file exist, does it parse, how old is it, and does it actually
 * resolve something. Four questions, four different fixes.
 */
async function checkGeo(): Promise<void> {
  console.log('\n── IP → PLACE ────────────────────────────────────────────');
  if (config.geoipPath === null) {
    skip('geo database', 'LIAN_GEOIP_DB not set — the Security screen shows device and time, and no location');
    console.log('      That is a supported state, not a broken one: an unresolvable');
    console.log('      address shows nothing rather than "Unknown". ACCOUNTS.md §6a.');
    return;
  }

  let database: Mmdb;
  try {
    database = Mmdb.open(config.geoipPath);
  } catch (error) {
    fail('geo database', `${config.geoipPath} could not be read: ${(error as Error).message}`,
      'the path is wrong, the file is truncated, or it is not an MMDB. Download it again — ACCOUNTS.md §6a.');
    return;
  }
  pass('geo database', `${config.geoipPath} parses`);

  // AGE. The build epoch is in the file's own metadata, so this is the
  // provider's date rather than the filesystem's — a copied file keeps its
  // mtime and loses nothing, and mtime would call a fresh copy of an ancient
  // database new.
  const builtAt = new Date(database.metadata.buildEpoch * 1000);
  const days = Math.floor((Date.now() - builtAt.getTime()) / 86_400_000);
  // ASSUMPTION: 60 days. DB-IP and MaxMind both publish monthly, so one
  // missed refresh is normal and two is a pattern. Not a cliff — accuracy
  // degrades gradually — which is why this warns at 60 and fails at 180
  // rather than pretending there is a moment it stops working.
  if (days > 180) {
    fail('geo database age', `built ${days} days ago (${builtAt.toISOString().slice(0, 10)})`,
      'ranges get reassigned. A confident wrong city on a security screen is the false alarm that screen exists to prevent. Refresh it — ACCOUNTS.md §6a.');
  } else if (days > 60) {
    console.log(`  – geo database age  built ${days} days ago (${builtAt.toISOString().slice(0, 10)}) — past one monthly refresh`);
  } else {
    pass('geo database age', `built ${days} days ago`);
  }

  // AND DOES IT ANSWER. A file that parses and resolves nothing is a file
  // with the wrong SHAPE — a country-only database where a city one was
  // expected, or an ASN database entirely.
  const probes = ['8.8.8.8', '1.1.1.1', '208.67.222.222'];
  const answers = probes.map((ip) => lookupIn(database, ip, 'en')).filter((place) => place !== null);
  if (answers.length === 0) {
    fail('geo lookup', `none of ${probes.join(', ')} resolved to a place`,
      'the file parses but carries no city or country records for well-known addresses — it is probably the wrong kind of database (ASN, or country-only where city was expected).');
    return;
  }
  pass('geo lookup', `${answers.length}/${probes.length} known addresses resolved, e.g. ${answers[0]!.kind} ${answers[0]!.name}`);
}

async function main(): Promise<void> {
  console.log('\nLIAN — preflight');
  console.log(`${new Date().toISOString()}   NODE_ENV=${config.nodeEnv}   public url ${config.publicUrl}`);
  if (wants('model')) await checkModel();
  if (wants('email')) await checkEmail();
  if (wants('storage')) await checkStorage();
  if (wants('speech')) await checkSpeech();
  if (wants('stripe')) await checkStripe();
  if (wants('push')) await checkPush();
  if (wants('geo')) await checkGeo();
  if (wants('db')) await checkVectorIndex();

  console.log('');
  if (failures === 0) console.log('nothing failed. What was skipped is not configured, which is a different thing.\n');
  else console.log(`${failures} check(s) failed. Each says which of the possible causes it was.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

await main();
