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
| **ENFORCED** | + 20 onboarding turns, **once per account, never resets** | `ONBOARDING_MESSAGE_ALLOWANCE`, same file |
| **ENFORCED** | paid: 400 messages/day, 5 GB, 200k TTS chars/mo, 1,800 STT sec/mo | same file |
| **ENFORCED** | free model spend: $3.00/user/month, hard | a database counter, checked before the call |

The enforced numbers are the ones to plan capacity against, because they are
the worst case the product will actually let happen. The assumed ones are
guesses about people.

**Every price and limit below was read off the provider's own page on
2026-08-27**, and each says so where it appears. They move: re-read the line
before you rely on it, and the ones that carry real risk are marked ⚠.

Four of them were wrong in the first draft of this file, which is why the
dates are here rather than a general disclaimer:

| Was | Actually |
|---|---|
| "Anthropic usage tier 1" | the tiers are **Start / Build / Scale / Custom**, and a new organisation may start in an **Evaluation** tier *below* Start |
| "R2's free allowance covers the assumed month" | 10 GB free against a **70 GB** enforced ceiling — covered in practice, not at the ceiling |
| Stripe at 2.9% + 30¢ | **plus 0.7%** for Billing, which is what subscriptions are |
| Sonnet 5 at $2/$10 "read 2026-06-24" | still $2/$10 — and the increase to $3/$15 that was scheduled for 2026-09-01 **has been cancelled** |

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

**Tier.** Pay-as-you-go with prepaid credit; no subscription. The tiers are
**Start → Build → Scale → Custom** (not numbered), and an organisation moves
up automatically on usage history. A brand-new organisation may be placed in
an **Evaluation tier with limits BELOW Start** while it establishes history —
so the first day is the tightest the limits will ever be, and that is worth
knowing before you conclude something is broken.

⚠ **Start tier carries a $500/month SPEND CAP**, separate from rate limits.
Hit it and the API returns 429 until 00:00 UTC on the 1st — with no
`retry-after`, so the SDK's automatic retries fail too. The distinguishing
mark is `error.details.error_code = "enforced_spend_limit_reached"`.
[Read 2026-08-27.]

**That cap is the number to look at, and it is close.** The enforced worst
case here is 100 free users × $3.00 = **$300/month** against a $500 cap. The
$3.00 already covers a first month, which is the expensive one: it carries the
twenty onboarding turns on top of the daily allowance and comes to 97.2% of
the ceiling. `npm run report:economics` prints that margin and warns when it
is inside 5%, which it currently is. It is
a ceiling and not a forecast — nobody spends their whole allowance — but the
margin is under 2×, so the cap is the thing that bites first if the assumed
scale is wrong in the obvious direction.

**Prices** (read 2026-08-27): Claude Sonnet 5 is **$2/M input, $10/M output**,
with prompt caching at **1.25× base for a 5-minute write, 2× for an hour, and
0.1× for a read**. The $3/$15 increase that was scheduled for 2026-09-01 has
been cancelled and $2/$10 is now the standard price — worth knowing, because
the free tier's whole costing rests on it. `npm run report:economics` prints
the breakdown; the per-turn shape it starts from is 3,000 in / 200 out, which
is **assumed — no traffic has been measured**.

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

**Tier.** Pay-as-you-go. Prices read 2026-08-27:

| | |
|---|---|
| `text-embedding-3-large` | **$0.13 / M tokens** |
| `gpt-4o-transcribe` | **$2.50 / M in, $10 / M out**, listed at about **$0.006 / minute** |
| `gpt-4o-mini-tts` | **$0.60 / M text input, $12 / M audio output tokens** |

**Embeddings are close to free at this scale** — a month of memory writes for
100 accounts is cents.

**Voice is the one with a real bill, and it is bounded per user**: 200k TTS
characters and 1,800 STT seconds a month, enforced by a database counter, so
ten paying users cannot exceed ten times that. STT is easy to bound from the
listed figure: 1,800 seconds is 30 minutes, so **≈$0.18 per paying user per
month at the ceiling**, ≈$1.80 for ten.

⚠ **TTS is the one number here I cannot turn into a bound from the page.** It
is priced per *audio output token*, and the product's ceiling is in
*characters* — the conversion is not published, and guessing it would put a
made-up number next to real ones. Check the first month's actual usage on the
OpenAI dashboard rather than trusting an estimate; if it matters more than
that, meter one synthesis and divide.

**$20 of credit** covers the assumed month on everything except that unknown.

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

**Tier.** **Cloudflare R2**, whose free allowance is **10 GB-month of
standard storage, 1M class-A and 10M class-B operations, and no egress
charge** (read 2026-08-27). Beyond it, storage is **$0.015 / GB-month**. Any
S3-compatible store works — S3 proper, B2, MinIO, Garage — because the signing
is written against the protocol rather than a vendor SDK. Egress being free is
the reason to prefer R2 specifically: this product serves every photograph and
voice note back out through signed URLs.

**Capacity at launch scale.** The enforced ceiling is 100 × 200 MB + 10 × 5 GB
= **70 GB** if every account filled its quota. **The free 10 GB does not cover
that** — but nobody fills a quota, and the ceiling exists to stop it being
unbounded rather than to predict anything. If every account somehow did, the
bill is 60 GB × $0.015 = **$0.90/month**, which is the useful thing about this
line: even the absurd case is nothing.

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
Postgres, RDS. On **Neon, pgvector is on every plan including free, with no
add-on**; you still have to `CREATE EXTENSION vector` per database, which
migration 0003 does. [Read 2026-08-27.] The free tiers hold a launch at the
assumed scale comfortably; the reasons to pay are backups and not being
suspended for inactivity, neither of which is about capacity.

**Produces:** `DATABASE_URL=postgres://…`

```sh
psql "$DATABASE_URL" -c "select * from pg_available_extensions where name = 'vector'"
# ONE ROW, or nothing works. This is the check CI now runs before the suite.
npm run migrate
```

**RECURRING, AND NOTHING WILL REMIND YOU: rebuild the vector index once there
are real memories.**

An ivfflat index computes its list centroids **from the data it is built on**,
and a migration necessarily runs against an empty table. pgvector says so
itself, at build time:

> NOTICE: ivfflat index created with little data / DETAIL: This will cause low
> recall. / HINT: Drop the index until the table has more data.

And it was measured here: the index in the development database returned **2**
of the 60 nearest out of ten thousand vectors; rebuilt on the populated table,
**60 of 60, in 2 ms**. (The exact mechanism behind that 2 is unconfirmed — see
`docs/RETRIEVAL-CEILING.md`, which says so. The remedy is the same either way.)

```sh
psql "$DATABASE_URL" -c "REINDEX INDEX CONCURRENTLY memories_embedding_idx"
```

**Once, after the first few hundred accounts have a history**, and again after
any bulk import or re-embed. `CONCURRENTLY` so it does not lock writes.

**Nothing in the product will notice if this is never done**: the index serves
the near-duplicate check, so the failure mode is *a memory she already had,
stored a second time* — no error, no alert, just her repeating herself
slightly more often than she should.

**So it is checked rather than only written down.** `npm run preflight db`
measures the index's actual recall against the real corpus — the same query
with and without the index path — and **fails** below 80%, naming the REINDEX
as the fix. Run it after the first few hundred accounts have a history. See
`docs/RETRIEVAL-CEILING.md`.

---

## 6. Transactional email — needs step 1's DNS

**What it is for.** Email verification, new-device confirmation, and password
reset. Recovery that reaches nobody is not recovery.

**Tier.** **Resend** is what the provider is written against
(`https://api.resend.com/emails`). Its free tier is **3,000/month, 100/day,
and 3 verified domains** — so a custom sending domain does not need the paid
plan, which is the thing people assume. Pro is $20/month for 50,000 and drops
the daily cap. [Read 2026-08-27.]

⚠ **The daily cap is the one to watch, not the monthly.** 100/day sounds
generous against 100 sign-ups until you count per person: a verification, then
a device confirmation, then a reset when they mistype the password. A launch
day that goes well is exactly when this stops sending.

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

## 6a. The IP-to-place database — a file, not a service

**What it is for.** The Security screen (UI-UX §17) shows where a sign-in came
from, beside the device and the time. It resolves **locally**: a MaxMind-format
database read in process, so **no third party ever sees a user's IP address**.
That is the whole reason it is a file — a lookup service would resolve "was
that you?" by telling somebody else where you are, on every sign-in, forever.
It also works offline, works self-hosted, and costs nothing per lookup.

**Tier.** Free, either way:

- **DB-IP Lite** — no account at all. `https://db-ip.com/db/download/ip-to-country-lite`
  (or the city edition). Direct download, CC-BY licence, monthly.
- **MaxMind GeoLite2** — free but needs a signed-up account and a licence key
  to download. Worth it for one reason: **more languages**. DB-IP's free
  country file carries de, en, es, fa, fr, ja, ko, pt-BR, ru and zh-CN and
  **no Arabic**, so an Arabic reader sees "قريب من Dubai" — a Latin place name
  in an Arabic sentence. That is the database's limit, not a bug, and the
  product deliberately does not maintain its own table of place names to paper
  over it. [Read 2026-08-27.]

**City or country?** Either works. A country database answers "In Germany"; a
city one answers "Near Dubai" and falls back to the country when its own
`accuracy_radius` is over 50 km. The city edition is a bigger file for a
slightly better answer, and the phrasing hedges both.

**Produces:** `LIAN_GEOIP_DB=/path/to/dbip-country-lite.mmdb`

**THE REFRESH IS AN OPERATIONAL STEP, and it is the part that gets forgotten.**
Address allocations move. A file from last year names the wrong country often
enough to matter on a screen whose whole job is telling somebody when
something looks wrong. Both publishers update monthly:

```sh
# monthly, wherever the app runs. Download, verify, swap, restart.
curl -sSL -o /srv/lian/geo.mmdb.gz   https://download.db-ip.com/free/dbip-country-lite-$(date +%Y-%m).mmdb.gz
gunzip -f /srv/lian/geo.mmdb.gz
node -e "const{Mmdb}=await import('@lian/geo');console.log(Mmdb.open('/srv/lian/geo.mmdb').metadata)" --input-type=module
# then restart: the file is opened once at boot.
```

The last line is the check worth keeping — it prints the metadata, so a
truncated download or a renamed format is caught before the app is restarted
onto it rather than after.

**If you skip this entirely:** the screen shows device and time and no
location, and `loadConfig` says so in its degraded list. Nothing breaks.

```sh
# The reader, against your actual file — the same check the tests run.
LIAN_GEOIP_DB=/srv/lian/geo.mmdb npm test -- packages/geo/src/geo.test.ts
```

### And the setting that decides which address it looks up

`LIAN_TRUSTED_PROXIES` — **how many proxy hops you actually run**, default 0.

This is a security setting, not a convenience. `X-Forwarded-For` is appended
to left-to-right, so the entries on the **right** come from infrastructure you
control and the leftmost is whatever the client sent. Reading the leftmost —
which this product did — lets anybody choose their own address: sign-in rate
limiting is defeated by rotating a header, and the Security screen names
whatever city an attacker picked.

| Deployment | Set it to |
|---|---|
| Direct, nothing in front | `0` — the header is ignored, the socket is used |
| Cloudflare only | `1` |
| Cloudflare + your own reverse proxy | `2` |

Too high and the address falls back to the socket (safe). Too low and you
believe a forged entry — so **count the hops, and if unsure use 0** until you
have.

---

**CHECKED, not just written down.**

```sh
npm run preflight geo
```

Four questions with four different fixes: does the file exist, does it parse,
**how old is it** — read from the file's own build epoch rather than its mtime,
because a copied file keeps the wrong one — and does it resolve known
addresses at all. Age warns past 60 days (one missed monthly refresh) and fails
past 180.

**A stale database does not fail; it answers.** With a city whose range has
since been reassigned, confidently, on the one screen whose job is to answer
"was that you?" — which is the false alarm the "Near Dubai" phrasing exists to
prevent. Somebody who gets two of those stops reading the screen, and that is
worse than no location line at all.

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

⚠ **The fee is not 2.9% + 30¢, it is that PLUS 0.7%.** Subscriptions are
Stripe *Billing*, which is priced separately: 0.7% of billing volume
pay-as-you-go (or from $620/month on a contract, which is not this). On a $9
subscription, read 2026-08-27:

| | |
|---|---|
| card | 2.9% × $9 = $0.261 |
| fixed | $0.30 |
| Billing | 0.7% × $9 = $0.063 |
| **total** | **$0.624 — 6.9%** |
| **net** | **$8.38** |

**That 30¢ is the problem, not the percentages**, and it is why a $9 price is
near the floor for a monthly subscription: the fixed fee is 3.3% of it all by
itself, and it would be 10% on a $3 plan. `npm run report:economics` funds
free users off the **gross** $9 — read it as ~7% optimistic until that is
fixed, which is noted in the report itself.

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
LIAN_GEOIP_DB=/srv/lian/geo.mmdb            # 6a local file; refresh monthly
LIAN_TRUSTED_PROXIES=0                      # 6a hops in front of you; 0 ignores XFF
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
| Geo database | the location line on the Security screen | device and time, which are what actually answer "was that you?" |
| Stripe | anyone paying | the free tier, entirely |
| Tick secret | the ticker exits 78 | the app, with no scheduled outreach |

## See also

- `docs/FIRST-RUN.md` — the same services from the other end: what each
  failure looks like on the day, and how to tell them apart.
- `tools/preflight.ts` — the checks themselves. Every diagnosis in this file
  comes from a real response code that tool reads.
- `npm run report:economics` — the free tier's cost, with every assumption
  named next to the number that rests on it.
