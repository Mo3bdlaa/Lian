# The accounts

Every external service Lian needs, in the order that lets you do them in one
sitting. The order is the point: three of these depend on something set up
earlier, and the dependency is invisible until you are already on the page
asking for a value you do not have yet.

**Read this first, it is the whole reason the order is what it is:**

- **The domain blocks email.** A transactional email provider will hand you an
  API key immediately and then silently refuse to deliver anything until the
  domain in your `From:` address is verified by DNS. The key works. Nothing
  sends. This is step 1 because DNS propagation is the only thing here you
  cannot hurry.
- **The deployed URL blocks Stripe's webhook.** The signing secret is created
  *for an endpoint*, and the endpoint has to exist and be reachable. You
  cannot get `LIAN_STRIPE_WEBHOOK_SECRET` before the app is deployed.
- **Two of them are not accounts at all.** The web-push keypair and the tick
  secret are generated on your machine. There is no Web Push console to sign
  in to — people look for one.
- **One account covers two services.** The embedder and the voice both run on
  OpenAI. If you set up "the embeddings account" and "the speech account"
  separately you will have paid attention twice for one key.

Nothing here is required to *run* the product locally except a database. Each
service degrades to a named, visible loss — `loadConfig` collects those into a
`degraded` list at boot rather than crashing, so a partial setup runs and says
what is missing.

## Scale assumptions

Every "which tier" answer below rests on these. If your launch is bigger,
re-derive rather than trusting the answer.

| | | |
|---|---|---|
| **ASSUMED** | 100 sign-ups in the first month | the tier answers change at roughly 10× this |
| **ASSUMED** | 10 of them paying | the free/paid split decides voice and storage cost entirely |
| **ENFORCED** | free: 20 messages/day, 200 MB, no voice | `PLAN_LIMITS` in `packages/domain/src/plan.ts` |
| **ENFORCED** | paid: 400 messages/day, 5 GB, 200k TTS chars/mo, 1,800 STT sec/mo | same file |
| **ENFORCED** | free model spend: $3.00/user/month, hard | a database counter, checked before the call |

The enforced numbers are the ones to plan capacity against, because they are
the worst case the product will actually let happen. The assumed ones are
guesses about people.

**Every "free tier covers this" claim below is a comparison against a
published limit I have not re-read today.** Confirm the number on the
provider's own pricing page as you go — it is one line per service, and it is
the number the tier decision rests on.

---

## 1. A domain — blocks 6, 9, and the whole deployment

**What it is for.** Three separate things, which is why it is first:

- the `From:` address on every email the product sends (verification, device
  confirmation, password reset) — and the provider will not deliver until its
  DNS records are in place;
- `LIAN_PUBLIC_URL`, which **must be https in production**. Not pedantry: the
  service worker, web push, and the `Secure` session cookie each refuse to
  work over http anywhere but localhost. `loadConfig` throws on an http
  public URL in production rather than starting a server that cannot install;
- the `mailto:` in `LIAN_VAPID_SUBJECT`, which a push service may use before
  it blocks you.

**Tier.** Any registrar. ~$10–15/year for a `.com`.

**Do now, before anything else:** buy it, and point it at wherever you will
deploy. Then start step 6's DNS records — they take longer to propagate than
everything else on this page takes to do.

**Produces:** `LIAN_PUBLIC_URL=https://yourdomain`

```sh
# no preflight of its own — it is verified by the checks that depend on it
npm run preflight email      # will fail until the DNS records land
```

---

## 2. Anthropic — she does not answer without it

**What it is for.** Every reply. This is the product.

**Tier.** Pay-as-you-go with prepaid credit; no subscription. The account's
**usage tier** governs your rate limits, and tier 1 is where a new account
starts — enough for a launch at the assumed scale, and the thing that will
bite first if it is not.

**Cost at launch scale.** The enforced worst case is 100 free users × $3.00 =
**$300/month**, and nobody spends their whole allowance, so treat it as a
ceiling rather than a forecast. `npm run report:economics` prints the
breakdown with each assumption labelled; the per-turn figure it starts from
is 3,000 in / 200 out, which is **assumed — no traffic has been measured**.

**Buy at least $50 of credit** to start. Running out mid-month presents
exactly like an outage.

**Set up a second key if you can.** The key pool cools a key down on a 429 and
rotates to the next; with one key, a rate limit stops her until it clears.
`ANTHROPIC_API_KEY_2` was silently discarded for nine runs before the pool was
wired, so preflight now reports how many keys it actually found.

**Produces:**

```
ANTHROPIC_API_KEY=sk-ant-…
ANTHROPIC_API_KEY_2=sk-ant-…       # optional, and worth it
```

```sh
npm run preflight model
# one four-token reply — a fraction of a cent. Run this the moment a key
# arrives: it separates "bad key" from "no credit" from "wrong model name"
# from "rate limited", which all present as "she did not answer".
```

---

## 3. OpenAI — ONE account, two services

**What it is for.** Two things that look unrelated and are billed together:

- **The embedder** (`text-embedding-3-large`, truncated to 1024 dimensions —
  the schema's vector width). This is memory retrieval. Without it the product
  falls back to a deterministic embedder that matches repeated text and misses
  paraphrase — it looks like it works and fails exactly where memory earns its
  place. In production, `loadConfig` refuses the fallback rather than
  pretending.
- **The voice** (`gpt-4o-mini-tts`, `gpt-4o-transcribe`). Paid plan only.

**Tier.** Pay-as-you-go. Embeddings are close to free at this scale.
Voice is the one with a real bill, and it is bounded per user: 200k TTS chars
and 1,800 STT seconds a month, enforced by a database counter. Ten paying
users cannot exceed ten times that.

**$20 of credit** covers the assumed month comfortably.

**Produces:**

```
LIAN_EMBEDDER_API_KEY=sk-…
LIAN_EMBEDDER_MODEL=text-embedding-3-large
LIAN_SPEECH_API_KEY=sk-…            # the same key is fine
```

`LIAN_EMBEDDER_URL` is optional — it defaults to the catalogue's endpoint.
Set it only for a compatible third-party host.

```sh
npm run preflight speech
# synthesises one short sentence and gets bytes back. There is no separate
# embedder check: a wrong embedder key surfaces as a failed memory write on
# the first real turn, and the config refuses to boot production without one.
```

> **Changing the embedder model later means a backfill.** Vectors from two
> models cannot share an index. `EMBEDDER_CATALOGUE` lists the two that fit
> this schema's width; adding a third is a decision, not a config change.

---

## 4. Object storage — S3-compatible

**What it is for.** Photographs and voice notes, in both directions. Not the
database: attachments are bytes behind short-lived signed URLs, so the page
source holds no durable link to anybody's photograph.

**Tier.** **Cloudflare R2** is the cheapest way to get one, and its free
allowance covers the assumed month. Any S3-compatible store works — S3
proper, B2, MinIO, Garage — because the signing is written against the
protocol rather than a vendor SDK.

**Capacity at launch scale.** The enforced ceiling is 100 × 200 MB + 10 × 5 GB
= **70 GB** if every account filled its quota, which none will. Actual usage
will be a small fraction; the ceiling is what stops it being unbounded.

**The token needs `PutObject`, `GetObject`, `DeleteObject`, `ListBucket`** —
on R2, an API token with Object Read & Write scoped to the bucket. A token
short of one of these fails only on the operation that needs it, which is
usually days later.

**Produces:**

```
LIAN_STORAGE_ENDPOINT=https://<account>.r2.cloudflarestorage.com
LIAN_STORAGE_BUCKET=lian
LIAN_STORAGE_ACCESS_KEY_ID=…
LIAN_STORAGE_SECRET_ACCESS_KEY=…
LIAN_STORAGE_REGION=auto            # 'auto' for R2; S3 proper wants its region
LIAN_STORAGE_PATH_STYLE=true        # default; virtual-host style is the opt-in
```

```sh
npm run preflight storage
# uploads one object under a preflight/ prefix and deletes it. A 403 here is
# three different problems — the signature, this machine's clock being more
# than 15 minutes off, or the policy — and the check says which, by reading
# the header the service already sent.
```

---

## 5. Postgres 16 with pgvector

**What it is for.** Everything. Memory retrieval needs the `vector` extension
specifically, and **a plain Postgres image will not do** — that exact mistake
made seventeen CI runs red while every other explanation was investigated. The
extension has to be *available*, not just requested.

**Tier.** Any managed Postgres that offers pgvector — Neon, Supabase, Fly
Postgres, RDS — on its smallest paid tier. The free tiers work for a launch at
the assumed scale; the reason to pay is backups and not being paused for
inactivity, not capacity.

**Produces:** `DATABASE_URL=postgres://…`

```sh
psql "$DATABASE_URL" -c "select * from pg_available_extensions where name = 'vector'"
# ONE ROW, or nothing works. This is the check CI now runs before the suite.
npm run migrate
```

---

## 6. Transactional email — needs step 1's DNS

**What it is for.** Email verification, new-device confirmation, and password
reset. Recovery that reaches nobody is not recovery.

**Tier.** **Resend** is what the provider is written against
(`https://api.resend.com/emails`). Its free tier — 3,000/month, **100/day** —
covers the assumed launch. The daily cap is the one to watch: a burst of
sign-ups plus device confirmations is more messages per person than it looks.

**This is the step people get wrong, and it fails silently.** The API key
works from the moment it is issued. Delivery does not, until the domain in
`LIAN_EMAIL_FROM` is verified by DNS records you add at your registrar. If
preflight says `not_authorised`, check the **domains** page, not the API keys
page — it is almost always the domain.

**Add DMARC/SPF/DKIM as the provider instructs, not just the minimum.** A
password reset in spam is a locked-out account, and a brand-new sending domain
starts with no reputation at all.

**Produces:**

```
LIAN_EMAIL_API_KEY=re_…
LIAN_EMAIL_FROM=Lian <hello@yourdomain>
```

```sh
npm run preflight email
```

Until this exists, recovery still *records* the request — what is missing is
delivery, and the app says so rather than pretending it sent something. For
local development, `LIAN_LOG_CONFIRMATION_LINKS=true` prints the link to the
server log instead. **Never set that in production**: it writes a
single-use account-access link into your logs.

---

## 7. Web push and the tick secret — no account exists

**What they are for.** Her proactive messages arriving on a locked phone, and
stopping anyone on the internet from making her send them.

**There is nothing to sign up for.** Web push identity is a P-256 keypair you
generate; the browser subscribes using your public key and the push service
trusts the signature. No registration with Apple, Google or Mozilla.

```sh
npm run keys vapid      # the keypair and the subject line
npm run keys tick       # a 32-byte shared secret
```

**Generate the VAPID pair ONCE and keep it.** Rotating it invalidates every
existing subscription — the old public key is baked into what each browser
subscribed with, so a new pair silently stops delivering to everyone who had
already allowed notifications, and nothing reports an error.

**Produces:**

```
LIAN_VAPID_PUBLIC_KEY=…
LIAN_VAPID_PRIVATE_KEY=…
LIAN_VAPID_SUBJECT=mailto:you@yourdomain
LIAN_TICK_SECRET=…
```

```sh
npm run preflight push
# reports the keys are present and then says, plainly, that it cannot check
# anything else: a push endpoint only exists once a browser has subscribed to
# one, so there is no service to call. This is the one integration that has
# never been verified end to end. The real check is a phone — FIRST-RUN.md
# step 7: open the app, allow notifications, lock the screen, run a tick.
```

---

## 8. Hosting, and somewhere to run the ticker

**What it is for.** The app, plus a **separate** process that pokes
`/api/tick` on a schedule.

**The ticker is not a cron job on the web host, and that is deliberate.** A
serverless host has no long-lived process to run a loop in, and Vercel's Hobby
cron runs roughly twice a day — which is not a reminder system. It runs every
300 seconds by default (`LIAN_TICK_INTERVAL_SECONDS`).

**Tier.** Anything that runs Node 22 with a persistent process — Fly, Railway,
Render, a small VPS. There is no build step anywhere in this repository, so
"install and run" is the whole deployment. Two processes:

```sh
node apps/server/src/main.ts      # the app
node apps/server/src/ticker.ts    # the ticker; needs LIAN_TICK_SECRET and LIAN_PUBLIC_URL
```

The ticker exits 78 if `LIAN_TICK_SECRET` is unset, rather than ticking into a
server that will refuse every call.

**Produces:** a live `https://yourdomain` — which step 9 needs.

---

## 9. Stripe — last, because it needs a live URL

**What it is for.** The $9/month subscription.

**Tier.** No plan; per-transaction. Test mode is free and complete — do the
whole flow there first.

**The ordering trap.** `LIAN_STRIPE_WEBHOOK_SECRET` is issued *per endpoint*,
and creating the endpoint means giving Stripe a URL it can reach. There is no
way to have this value before step 8. Everything else here — the key, the
price — you can create on day one.

**Create the price as a recurring monthly product** and copy the **price** ID
(`price_…`), not the product ID (`prod_…`). They look alike and only one works.

**Produces:**

```
LIAN_STRIPE_SECRET_KEY=sk_test_…    # sk_live_… when you switch
LIAN_STRIPE_PRICE_ID=price_…
LIAN_STRIPE_WEBHOOK_SECRET=whsec_…  # only after step 8
```

```sh
npm run preflight stripe
# one read-only call. It reads back the price, prints its amount and
# interval, and objects if the price is one-off (checkout is created with
# mode=subscription) or if the amount is not 900 — so a price ID pointing at
# the wrong thing is visible here rather than at somebody's first payment.
```

---

## When you are done

```sh
npm run preflight
```

Runs all six in dependency order — model, email, storage, speech, stripe, push
— and each failure says *which* of the possible causes it was rather than that
something went wrong. Anything not configured is reported as **skipped**,
which is a different thing from passing, and the summary says so.

Then:

```sh
npm run migrate && npm run verify
```

## The full environment, in one block

Everything above, collected. `NODE_ENV=production` is what turns the
required-in-production checks on.

```sh
NODE_ENV=production
PORT=8787
LIAN_PUBLIC_URL=https://yourdomain          # 1  https, or the PWA cannot install
DATABASE_URL=postgres://…                   # 5  Postgres 16 + pgvector
ANTHROPIC_API_KEY=sk-ant-…                  # 2
ANTHROPIC_API_KEY_2=sk-ant-…                # 2  optional; no rotation without it
LIAN_EMBEDDER_MODEL=text-embedding-3-large  # 3
LIAN_EMBEDDER_API_KEY=sk-…                  # 3
LIAN_SPEECH_API_KEY=sk-…                    # 3  same account
LIAN_STORAGE_ENDPOINT=https://…             # 4
LIAN_STORAGE_BUCKET=lian                    # 4
LIAN_STORAGE_ACCESS_KEY_ID=…                # 4
LIAN_STORAGE_SECRET_ACCESS_KEY=…            # 4
LIAN_STORAGE_REGION=auto                    # 4
LIAN_EMAIL_API_KEY=re_…                     # 6  needs 1's DNS verified
LIAN_EMAIL_FROM=Lian <hello@yourdomain>     # 6
LIAN_VAPID_PUBLIC_KEY=…                     # 7  npm run keys vapid
LIAN_VAPID_PRIVATE_KEY=…                    # 7
LIAN_VAPID_SUBJECT=mailto:you@yourdomain    # 7
LIAN_TICK_SECRET=…                          # 7  npm run keys tick
LIAN_STRIPE_SECRET_KEY=sk_live_…            # 9
LIAN_STRIPE_PRICE_ID=price_…                # 9
LIAN_STRIPE_WEBHOOK_SECRET=whsec_…          # 9  needs 8 deployed
```

## What each one costs you if you skip it

Nothing here crashes the app. Each absence is a named loss, collected into
`degraded` at boot and printed once.

| Missing | What stops working | What still works |
|---|---|---|
| Anthropic | she does not reply at all | nothing worth having |
| Postgres/pgvector | nothing runs | — |
| Embedder | retrieval matches repeated text, misses paraphrase | everything else, invisibly worse. **Refused in production** |
| Speech | voice notes and spoken replies | all text |
| Storage | photographs and voice notes | all text |
| Email | verification, device confirmation, reset **delivery** | the requests are still recorded, and the app says delivery is unavailable |
| Push | her messages arriving on a locked phone | a proactive turn still runs and reports `nowhereToSend` |
| Stripe | anyone paying | the free tier, entirely |
| Tick secret | the ticker exits 78 | the app, with no scheduled outreach |

## See also

- `docs/FIRST-RUN.md` — the same services from the other end: what each
  failure looks like on the day, and how to tell them apart.
- `tools/preflight.ts` — the checks themselves. Every diagnosis in this file
  comes from a real response code that tool reads.
- `npm run report:economics` — the free tier's cost, with every assumption
  named next to the number that rests on it.
