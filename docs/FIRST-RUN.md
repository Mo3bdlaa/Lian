# FIRST RUN

Taking this from a sandbox to something you can hand a stranger.

Written for a laptop with the repository and nothing else set up. Every step
says what to run, what right looks like, and what each way of failing looks
like — because the failures that cost a day are the ones where three
different problems produce the same message.

**Five integrations in here have never touched a live service:** email,
object storage, the speech provider, Stripe, and web push. Everything about them is
written from a specification and tested against a fake, which is a different
claim from working. Steps 3–7 are those five, and `npm run preflight` exists
for them specifically: it makes the real calls in their smallest form and
tells you *which* of the possible causes it was.

Total time if nothing goes wrong: about an hour, most of it waiting for DNS.

---

## 0. Before anything

```sh
node --version      # must be 22.x — this repo has no build step and relies on it
git clone <repo> && cd Lian
npm install
```

`npm install` should pull two packages (`pg`, `@anthropic-ai/sdk`) and their
dependencies, and nothing else. If it downloads hundreds, you are on the
wrong branch.

**Check the clock now, before it costs you an hour later.**

```sh
date -u
```

Every signature in this product — S3, Stripe's webhook, the tick — signs its
own timestamp. A machine more than a few minutes off produces signatures that
are computed correctly and rejected as forgeries, and the error says nothing
about time. On Linux: `timedatectl set-ntp true`.

---

## 1. The database, and the app running locally

```sh
cp .env.example .env
# fill in: DATABASE_URL, LIAN_TICK_SECRET (any long random string)
npm run up
```

`npm run up` migrates, then starts the server *and* the ticker. Both, because
a local setup without the ticker looks like a chat app: the schedule is most
of the product.

**Right looks like** a boot log that lists what is missing rather than
pretending. With only those two values set you will see six or seven
`degraded` lines — no model key, no embedder, no storage, no speech, no
Stripe, no VAPID. That list is the honest state of the deployment and it is
worth reading once.

**Wrong looks like:**

| what you see | what it is |
|---|---|
| `cannot reach Postgres at …` | it is not running, or `DATABASE_URL` names the wrong host |
| `role "…" does not exist` | the user in the URL has not been created |
| `the environment is not usable:` then a list | production-required values are missing **and** `NODE_ENV=production`. In development these degrade instead |
| `billing needs all three of …` | some but not all Stripe values. See step 5 — this one refuses to start on purpose |

Then:

```sh
npm test              # 624 tests. Requires DATABASE_URL; without it they SKIP
npm run verify        # typecheck + 12 gates + tests
```

**Read the summary, not just the exit code.** `pass 462, fail 0, cancelled
100` means a hundred tests did not run — that is what a dead database looks
like, and `fail 0` is technically true.

At this point sign up at `http://localhost:8787`, talk to her, and confirm
the local product works before adding anything remote. Nothing below is worth
debugging on top of a broken step 1.

---

## 2. The model key

```
ANTHROPIC_API_KEY=sk-ant-…
```

The only value with no fallback that matters immediately: without it she
cannot answer. Restart and send a message.

**Wrong looks like:** a 401 in the server log and the turn failing. There is
no ambiguity here and no preflight for it — a message either arrives or it
does not.

An embedder key (`LIAN_EMBEDDER_MODEL`, `LIAN_EMBEDDER_API_KEY`) is separate.
Without it, retrieval falls back to a deterministic embedder that matches
repeated text and misses paraphrase — which is the case memory exists for.
Production refuses to start without one; development says so and continues.

---

## 3. Email — do this one first

**Needs:** an account with a transactional email provider, and a domain you
control.

```
LIAN_EMAIL_API_KEY=re_…
LIAN_EMAIL_FROM=Lian <hello@yourdomain>
```

Both or neither: with one of them, every send fails at the provider rather
than being skipped, and the app believes it has a transport.

**This is first because recovery that reaches nobody is not recovery.** A
password reset and a new-device confirmation are both *created* without a
transport and neither is delivered — the rows are real, so adding a transport
later loses nothing, but until then anybody who forgets their password is
locked out with no way back.

```sh
LIAN_PREFLIGHT_EMAIL=you@example.com npm run preflight email
```

Without `LIAN_PREFLIGHT_EMAIL` it checks the configuration and does not send.
With it, it sends one message and reads the provider's own refusal back.

**Wrong looks like:**

| what the preflight says | what it is |
|---|---|
| `not_authorised` | the key, **or** — far more likely on a first send — the DOMAIN of `LIAN_EMAIL_FROM` is not verified. Adding the DNS records is the step people skip: the key works and nothing sends. Check the domains page, not the API keys page |
| `bad_recipient` | that address specifically — malformed, or suppressed after an earlier bounce. Try a different one before touching the config |
| `throttled` | rate limit or quota. A plan state, not a bug |
| `unreachable` | DNS or the network; the provider was never reached |

A note on that first row: the provider answers a bad key with `401` *and*
`"name":"validation_error"`, so a naive reading calls it a bad recipient and
sends you to check the address. The preflight found that on its first live
send and it is now a regression test. If you are debugging email and the tool
says `bad_recipient`, believe it — but if it says `not_authorised`, check DNS
before the key.

**Then go and look at the inbox.** A provider accepting a message is not an
inbox receiving one, and only you can check the second. **Check spam too** — a
reset link in spam is a locked-out account, and a brand-new sending domain
lands there until it has a reputation.

**Then the three real flows:**

1. Sign up. A confirmation should arrive; the app does not block on it.
   Follow the link and `/security` should stop asking.
2. `/forgot` with that address. The link should arrive; setting a new password
   should sign you in and end every other session.
3. Sign in from a different browser. The sign-in is *held* and a "Was this
   you?" message should arrive.

All three are in the reader's language, so if the account is set to Arabic the
message should be Arabic.

---

## 4. Object storage — the first real SigV4

**Needs:** an S3-compatible bucket and a key with read, write and delete on
it. Cloudflare R2 is the cheapest way to get one; MinIO on the laptop also
works and is faster to debug against.

```
LIAN_STORAGE_BUCKET=lian
LIAN_STORAGE_ENDPOINT=https://<account>.r2.cloudflarestorage.com
LIAN_STORAGE_ACCESS_KEY_ID=…
LIAN_STORAGE_SECRET_ACCESS_KEY=…
LIAN_STORAGE_REGION=auto        # 'auto' for R2; S3 proper wants its region
```

```sh
npm run preflight storage
```

This is the check to run first and the one most likely to fail, because the
signature is implemented here by hand with `node:crypto`. It is verified in
the test suite against a second implementation written from the specification
— which catches a mistake in one of them and **not** a shared misreading of
the spec. This step is where a shared misreading would show up.

**Right looks like** five ticks: clock, put, get, presigned GET, delete.

**Wrong looks like one of three things that all arrive as `403`,** and the
preflight tells you which:

| the code in the body | what it means | what to change |
|---|---|---|
| `SignatureDoesNotMatch` | the signature is wrong. Not the permissions | the secret first — a trailing newline in `.env` is the usual culprit. Then `LIAN_STORAGE_REGION`: it is part of what gets signed, so `auto` against a bucket wanting `us-east-1` fails here and nowhere else |
| `RequestTimeTooSkewed` | the clock, not the key | `timedatectl set-ntp true`. The app cannot work around this: the timestamp is signed |
| `AccessDenied` | credentials recognised, action not allowed | the key needs `PutObject`, `GetObject`, `DeleteObject`, `ListBucket`. On R2: an API token with Object Read & Write scoped to the bucket |
| `NoSuchBucket` | bucket name or endpoint account | spelling, and whether the endpoint is the right account |
| `InvalidAccessKeyId` | the key id is not known here | it belongs to a different account than the endpoint |

**The one that is not a 403:** if `put` succeeds and `delete` fails, stop and
fix it. LESSONS §11 says deletion is real; a key that cannot delete makes
that a lie the app cannot detect — deleting an account will remove the rows,
report success, and leave every photograph in the bucket.

**Then check it end to end,** because presigning is not the same as a browser
actually uploading:

1. Open the app, send a photo in a conversation.
2. It should appear in the thread and — if she read it as a receipt — a
   transaction should appear on `/money`.
3. `/album` should show it.

If the upload URL is signed but the browser's `PUT` fails with a CORS error,
the bucket needs a CORS rule allowing `PUT` from `LIAN_PUBLIC_URL`. That is
the one failure the preflight cannot see, because the preflight is not a
browser.

---

## 5. Speech

**Needs:** one key for both directions.

```
LIAN_SPEECH_API_KEY=…
```

```sh
npm run preflight speech
```

It speaks one sentence and transcribes the result back — a round trip,
because the two halves are separate APIs and a key can have one and not the
other.

**Right looks like** two ticks, the second quoting the sentence back.

**Wrong looks like:**

| what the preflight says | what it is |
|---|---|
| `401` on synthesise | the key is wrong, or has no access to the speech models |
| `404` on synthesise | the model name in `DEFAULT_SPEECH` is not one this provider has. It is pinned in `packages/voice/src/providers/speech.ts` |
| `429` | rate limit or no credit. A billing state, not a bug |
| synthesise passes, transcribe fails | the key is valid — this is the transcription endpoint specifically |
| transcribe returns the wrong words | the call works and the audio format is wrong for the STT model |

**Then check it end to end:** record a voice note in the app. The transcript
becomes the message and the audio plays back beside it. On a paid account,
press play on one of her messages.

Voice is paid-only (PRD §10). On a free account the play control is not shown
and the route answers `402` — that is the plan gate, not a failure.

---

## 6. Stripe — the one you said you would do on hardware

**Needs:** a Stripe account, a recurring price, and a webhook endpoint on a
public URL.

```
LIAN_STRIPE_SECRET_KEY=sk_test_…      # test mode first, always
LIAN_STRIPE_PRICE_ID=price_…          # price_, not prod_
LIAN_STRIPE_WEBHOOK_SECRET=whsec_…    # from the WEBHOOK page, not the API keys page
```

All three or none: the config **refuses to start** on a partial set, because
that is the shape where checkout succeeds and nothing ever marks the account
paid — a customer charged and still on the free plan, which looks like their
problem and is yours.

```sh
npm run preflight stripe
```

It reads the price back (a read, so nothing is created) and checks the
webhook secret's shape.

**Wrong looks like:**

| what the preflight says | what it is |
|---|---|
| `401` on the price | the secret key is wrong, or a test key against a live price |
| `404` on the price | that price does not exist here. **A product id (`prod_…`) instead of a price id is the commonest mistake** |
| `the price is not recurring` | checkout is created with `mode=subscription`; make a recurring price |
| `the webhook secret does not start with whsec_` | an API key was pasted into that field. This is the failure that half-works |
| a note that the amount is not $9 | the product says $9/month everywhere (UI-UX §18). One of the two is wrong |

**The webhook needs a public URL**, which a laptop does not have. Use the
Stripe CLI:

```sh
stripe listen --forward-to localhost:8787/api/stripe/webhook
```

It prints a `whsec_…` of its own — use *that* one while forwarding. Then, in
another terminal:

```sh
stripe trigger checkout.session.completed
```

**Right looks like** a `200` in the forwarder and nothing in the app log.
The endpoint acknowledges every verified event, including types it does not
act on — an endpoint that errors on an unhandled type teaches Stripe to retry
forever and eventually gets itself disabled.

**Then the real thing, which is what you said you would do:**

1. Open the app on the phone, go to `/subscription`, press Subscribe.
2. Pay with a test card (`4242 4242 4242 4242`, any future date, any CVC).
3. You land back on `/subscription` and it says the paid plan.

**If it does not, the question is which half failed,** and they fail
differently:

- **You never reached Stripe's page.** Checkout was not created. The app log
  has the reason; `503 billing_unconfigured` means the key is missing.
- **You paid and the app still says free.** The webhook did not arrive or did
  not verify. This is the one to expect. Look at the Stripe dashboard's
  webhook attempts:
  - **no attempt at all** — the endpoint URL is wrong, or the events are not
    subscribed. It needs `checkout.session.completed` and
    `customer.subscription.created/updated/deleted`.
  - **attempt with a `400`** — the signature did not verify. Either the
    secret is from the wrong endpoint, or something in front of the app is
    rewriting the request body. The signature is over the **raw bytes**: a
    proxy that pretty-prints JSON breaks it, and it will look like a wrong
    secret.
  - **attempt with a `200` and still free** — the event verified and named a
    user the app could not find. Check that the checkout carried
    `subscription_data[metadata][user_id]`, which it does only if it was
    started from inside the app rather than from a Stripe payment link.

Cancel from the app afterwards and confirm the plan says it ends on a date
rather than ending immediately.

Only move `sk_test_` to `sk_live_` after all of that. The preflight prints
`LIVE — this will move real money` when you do.

---

## 7. Web push — the one that cannot be checked from a terminal

**Needs:** VAPID keys, HTTPS, and a phone.

```sh
node -e "import('./packages/push/src/index.ts').then(m=>console.log(m.generateVapidKeys()))"
```

```
LIAN_VAPID_PUBLIC_KEY=…
LIAN_VAPID_PRIVATE_KEY=…
LIAN_VAPID_SUBJECT=mailto:you@example.com
LIAN_PUBLIC_URL=https://…            # MUST be https, and must match what the browser uses
```

There is nothing to preflight. A push endpoint does not exist until a browser
subscribes to one, so `npm run preflight push` says only that the keys are
present and points here.

**`LIAN_PUBLIC_URL` must be `https://`** or three separate things silently do
not work: service workers refuse to register, push subscription refuses, and
the session cookie is not `Secure`. Config refuses to start on `http` in
production for exactly this reason.

**The check, in order:**

1. Open the app on the phone over HTTPS. Add it to the home screen when she
   offers.
2. Have a real conversation — tell her something worth remembering. She asks
   about notifications **after** she has remembered something, never before,
   so a fresh account will not offer it.
3. Allow notifications.
4. Confirm the subscription reached the server:
   ```sh
   psql "$DATABASE_URL" -c "select count(*) from push_subscriptions"
   ```
   Zero means the browser never subscribed — check the console on the phone.
5. Lock the screen.
6. Fire a tick by hand:
   ```sh
   npm run tick
   ```

**Right looks like** a notification on the lock screen with a sentence about
something you actually told her.

**Wrong looks like:**

| what you see | what it is |
|---|---|
| the tick reports `nowhereToSend` | no subscription — step 4 |
| the tick reports it sent, nothing arrives | the push service accepted it and the phone did not show it. On iOS this is nearly always that the app is not installed to the home screen: Safari does not deliver push to a tab |
| a `410` or `404` from the push service | the subscription is dead; the row is removed and the browser must subscribe again |
| a notification with generic text | she had nothing specific to say. That is the product working — PRD §9 forbids "we miss you" — but it means step 2 did not go deep enough |

**This is the last link that has never worked end to end.** Every layer is
tested — VAPID, RFC 8291 encryption, delivery, the worker drawing it — and a
sandbox cannot subscribe to a push service. If it works on the phone, that
gap closes.

---

## 8. Before a stranger

Things that are true right now and should not be when somebody who is not you
uses this:

1. **The legal text is not a lawyer's.** `LEGAL_REVIEWED` in
   `packages/i18n/src/legal.ts` is `false`, and every screen carrying legal
   text says so in red. `NEEDS_LEGAL_REVIEW` in the same file is the list to
   hand a lawyer — 46 strings, both languages. Flipping that constant to
   `true` removes the banner everywhere at once; a test will remind you it
   was a deliberate act.
2. **Nobody has done an accessibility pass.** `prefers-reduced-motion` is
   honoured; there has been no screen-reader run and no keyboard-only pass.
   The sheets and the full-screen photo viewer are focus traps by shape.
3. **Arabic has not had a native pass.** The catalogue is 407 strings. The
   gate proves none of them assumes the *user's* gender; it cannot prove the
   register is right, and male-voice Arabic is still mostly the feminine
   string returned unchanged.
4. **Set the free-tier ceilings against real traffic.** `npm run report`
   prints per-account pressure against every ceiling — `nearCeiling` is the
   number that moves first. `npm run report:economics` prints the assumptions
   the ceilings were chosen with. Both say plainly which numbers are measured
   and which are guesses.

---

## Where to look when something is wrong

```sh
npm run preflight           # the four live integrations, each diagnosed
npm run preflight email     # or storage, speech, stripe, push
npm run verify              # typecheck, 12 gates, 624 tests
npm run report              # retention and cost, with their definitions
npm run report:economics    # the free tier, every assumption named
```

| File | What it answers |
|---|---|
| `apps/server/src/config.ts` | every environment variable, what breaks without it, and whether it is required or degrades |
| `.env.example` | the same list, with the notes |
| `docs/DEPLOY.md` | the two processes and the database |
| `HANDOFF.md` §2 | what has never touched a live service, and why that is a different claim from working |
| `LESSONS.md` | eighteen rules, each of which is a bug this project actually had |
