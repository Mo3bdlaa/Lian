# HANDOFF

**Setting the accounts up? [`docs/ACCOUNTS.md`](docs/ACCOUNTS.md).** Nine
services in the order that lets them be done in one sitting, with what blocks
what said at the top: the domain blocks email (the key works, delivery does
not, until DNS verifies the sending domain) and the deployed URL blocks
Stripe's webhook secret. Two of the nine are not accounts at all — `npm run
keys vapid|tick` produces them, and people look for a Web Push console that
does not exist.

Ninth run. **Read `docs/FIRST-IMPRESSIONS.md` first.** It is the only document
here written from outside the machinery — I signed up, talked to her, and
wrote down what it was actually like. Four holes and five wrong sentences came
out of that afternoon, and none of them was findable any other way.

Then `docs/FIRST-RUN.md`, which is the ordered list of what to do on hardware,
and `npm run preflight`, which makes the five unverified integrations tell you
which of their possible failures you are looking at.

Eighth run. Email exists: provider-agnostic behind a port, address
confirmation at sign-up, recovery, new-device confirmation, and the first real
send is a preflight command that reads the provider's own error back. It found
a misclassification on its first live call, which is the whole argument for it.

**CI IS GREEN.** It was red for seventeen consecutive runs and the cause was
one line: `postgres:16` ships no pgvector, so migration 0003 died and every
database-backed test with it. `npm run verify` is green too: typecheck (server
and browser), **15 gates**, **685 tests**, including 19 that drive real
Chromium, 29 that prove each gate FAILS on a deliberate violation, and 27 that
attack the product with a second account.

**`npm run shots` photographs 98 screens** into `docs/shots/`, with six gaps
listed rather than skipped. Start there — reading HTML is not looking at a
product, and SIX things have now been wrong in ways only a picture showed.
Three of the six remaining gaps are headless Chromium's limits and will never
close from a terminal: an OS lock-screen notification, the browser's own
install dialog, and the microphone.

**`npm run test:ci` reads the summary, because the summary can lie.** Four
runs of HANDOFF have said "read the test summary, not the exit code", on the
strength of `pass 462, fail 0, cancelled 100`. That advice is not enough.
With `DATABASE_URL` merely unset the suite reports **`tests 520, pass 520,
fail 0, cancelled 0, skipped 0`** — a perfect summary, exit zero, and 155
tests that were never reported at all, because a skipped `describe` counts as
a skipped SUITE and its subtests vanish from the count. The COUNT is the only
signal, so `test:ci` asserts a floor.

**Every number below states the assumption it rests on.** Where an assumption
is soft, it says so. Where a thing has never touched a live service, it says
that too.

---

## 0. What the eleventh run did

### She speaks first, and it is not generated

Day one was silent: the positioning is "she texts you first" and nothing ran
until the user typed. `greeting.first` is now authored in both languages and
both assistant genders, written by the sign-up route, and ends by asking their
name — so the real conversation starts from a reply, where there is finally
something to respond to. **Not a model call**: there is no context to generate
from on turn zero, and a call per sign-up buys nothing.

It also resolved a contradiction in her own instruction, which claimed the
greeting was "the very first thing they will read from you" while nothing
produced one. The first thing they read exists; it just is not generated.

### The approaching-limit line, which had been authored and unread since run one

UI-UX §19 asks for a quiet line as the free day runs down. `limit.approaching`
existed in both languages, `messagesRemaining` travelled in every snapshot,
and **no screen put the two together** — LESSONS §20 again, five of six parts.
The state is computed server-side (`messagesState`), not from a threshold in
the client: a client that knew `remaining <= 5` would be a second place the
free tier is defined.

The "Free limit" row of the matrix had **no shots at all**, and its gap note
claimed the reached state was captured. It was not. Both states are now
photographed from a real `usage_counters` row, and the reached one is driven
by actually submitting a message and being refused.

### A third copy of formatting, and a hole under every gate

The Arabic screenshot showed the capture chip reading `AED 400 · جيم · ٢٤
أغسطس` — Latin digits beside Eastern numerals, under a bubble saying ٤٠٠ درهم.
A third money formatter, hand-rolled, invisible to the formatting gate because
that gate watched for a second `Intl` call and this one used none. The gate now
checks `toFixed` too, with `FIXED_POINT` as the named allowlist.

Then the worse one. `walk` skipped any directory named `screens`, for
`design-system/screens` — and the name also matched `apps/web/src/screens`, so
**twenty files of product UI were invisible to all fifteen gates** and nothing
said so, because a gate's file count counts what it can see. Skipping by path
instead immediately found `chat.ts` building a day key with its own `Intl`
call. LESSONS §23.

### docs/ACCOUNTS.md

The nine services, ordered by what blocks what, with a test that keeps the
env-var list true in both directions. Its own first draft lived in `docs/` and
was collected by no glob — the exact failure `tools/ci-test.ts` exists for,
happening to the test that catches it.

## 0a. What the tenth run did

### CI, so green means green

Seventeen red runs, one cause, and it was neither of the things we guessed:
the service container and DATABASE_URL were already right and preflight was
never in the CI path. `pgvector/pgvector:pg16` fixes it. Two steps now run
BEFORE the suite (the database is reachable; pgvector is available; migrate as
its own step) so the next breakage names itself instead of arriving as three
hundred cancelled tests. `preflight.yml` is `workflow_dispatch` only — a
push-triggered preflight is a red build meaning "no API key".

### 95 screenshots, and four bugs only a picture found

`npm run shots`. Money's headline read `AED 127.5`; a capture chip read
`2026-08-24` under a separator saying "25 August"; five transactions, none
photographed, were all captioned "from a receipt" (`fromReceipt` was
`originMessageId === null` — backwards); and **she says nothing on day one**
while the prompt tells her "this is the very first thing they will read from
you". The first three are fixed. The fourth is §3.0 below.

### LESSONS §21: she can promise what nothing performs

The generalisation of "I'll remind you". `packages/domain/src/promises.ts`
classifies every control tag and every promise-shaped sentence; the gate
enforces that each commitment names a mechanism that still exists. It found a
wrong claim on its first run — mine.

### The story timeline

Milestones built and derived from facts the product already has; moments and
inside jokes scoped OUT with the reason. `story_events` spent exactly one run
as a printed "NOT BUILT" exemption, which is what an announced hole is for.

### The matrix is checked by whether a row can be REACHED

`tools/gates/wired.ts` grew a third seam. The document has overclaimed twice;
now a row with neither a screenshot nor a stated gap fails the build.

## 0b. What the ninth run did

### It used the product

`docs/FIRST-IMPRESSIONS.md`. The headline: **"remind me to call the bank" →
"I'll remind you" → nothing could.** A `<todo>` with no date stores `due_on
NULL`, which matched no outreach query and no briefing block, so the one
sentence the product exists to make true was false the first time I asked for
it. Every part of it was individually correct. Fixed by carrying dateless
tasks in the briefing's *Carried over* — and deliberately NOT in outreach,
because a dateless task pushing a notification every morning is the nagging
LESSONS §4 exists to prevent.

Plus four dead ends and five sentences that are authored, bilingual,
gate-passing and wrong in place. All fixed except the ones in §3 below.

### LESSONS §20 and a thirteenth gate

Four things had one shape — declared in one place, connected in none: the
incognito role, `story_events`, the key pool, and `/settings/language`. Each
looks finished from whichever side of the seam you are standing on.
`tools/gates/wired.ts` reads across two of those seams every build, and
`story_events` is a NAMED exemption that prints **"NOT BUILT"** on every run.

### LESSONS §19: the ceiling that was never checked on the first use

`ON CONFLICT … DO UPDATE … WHERE` bounds the UPDATE branch only. `reserve`
granted the FIRST reservation of any period whatever it asked for — so a free
account's first voice note of every calendar month was transcribed and paid
for, forever, and every test passed because every test reserves one unit at a
time against a ceiling above one.

### The incognito role, and the plan gate audited

PRD §27 is built on both sides now. And every one of the eight PlanLimits
fields is enforced — seven by a comparison in code, the eighth by the
reservation above, which is how §19 was found.

## 0c. What the eighth run built

### Consent, terms and privacy — the mechanism, not the wording

Both documents are IN the app (§22's rule, and the only version that works on
the consent gate where there is no account yet). Every section is on
`NEEDS_LEGAL_REVIEW` — the list a lawyer gets handed, 46 strings in both
languages — and a section added without being on it fails the build, because
the documents are assembled from the marking. `LEGAL_REVIEWED` is a constant,
currently `false`, and it drives the red banner on every page carrying legal
text: flipping it removes the warning everywhere at once.

Four tests assert the privacy notice still describes the build rather than
what the build used to do — it names all four services that receive data, it
says the TTS cache outlives the account **because it does**, and it does not
promise the service cannot be breached.

### Retention and cost, in one place, with their definitions

`npm run report`. Retention prints what the words mean above the numbers,
because "D7 retention" means four different things: cohort is FIRST recorded
day, the day is the USER's local day, and returned is EXACTLY day N. Cohorts
under 20 are not offered as rates; a cohort younger than 30 days is labelled,
because its D30 has not happened yet and printing 0 reads as a collapse.

Cost prints per-account pressure against every ceiling — `nearCeiling` moves
first, `atCeiling` is people already told no — and says plainly that these
are our counters rather than an invoice.

**It is a command, not a screen**, and that is the standing instruction being
followed: a dashboard inside the app that reads across accounts is an admin
data path. `reporting.test.ts` asserts every shape it reads carries no uuid
and no `@`, so it cannot become a back door by accretion.

### Account recovery

Six decisions, each stated in the code with which way it went. The request
returns the **same object** whether or not the address has an account —
asserted byte-identical over HTTP, not just in the unit test. Single-use,
thirty minutes, hashed at rest, claimed by the database. A new link spends the
old one. A completed reset ends every other session, because recovery is what
you do when you think you have been compromised.

### The hardening pass, and three findings

`apps/server/src/hardening.test.ts` is written by somebody trying to get at
another person's year of their life. It found three things in code that looked
correct, all of them now LESSONS §17 and §18:

1. **A stranger could react to any message id in the database.** The row is
   keyed `(message_id, user_id)`; the user id came from the session and the
   message id came from the URL and was checked against nothing. Every scope
   rule was satisfied and the gate passed.
2. **Revoking a device that was not yours answered 200.** The query was
   correctly scoped; the port returned a hard-coded `true`. The security
   screen told people a device had been signed out when nothing happened.
3. **Deleting somebody else's attachment answered 200 with `deleted: false`** —
   the same false confirmation, plus an existence oracle.

Plus a cross-origin refusal behind the `SameSite=Lax` cookie. Its first
version compared `Origin` to `LIAN_PUBLIC_URL` alone and turned every browser
write into a 403 — a total outage with nothing in any log. It compares against
the request's own `Host` now.

### The conversation switcher, and what looked like the last matrix row

Every row of the coverage matrix was ticked after this. **Two of those ticks
were wrong** and the ninth run found them by using the product — see
`docs/specs/SCREEN-COVERAGE.md`, which now says which part of each row is
missing. Ending a thread is
two different things: an incognito thread is really deleted, photographs and
all, while a side thread is **closed**, because its messages are the
provenance of memories she kept.

### `npm run preflight`

The four integrations that have never touched a live service, each in its
smallest real form, each failure diagnosed. `403` from a bucket is three
different problems with three different fixes — the signature, the clock, or
the policy — and all three arrive as `403`. This reads the code in the body
and says which. Verified against a real S3 endpoint: it correctly reported
`InvalidAccessKeyId` rather than "403".

---

## 0d. What the seventh run built

### Object storage, and the two features it unblocked

S3-compatible, with SigV4 signed by hand (`node:crypto`) so there is no SDK:
S3, R2, B2, MinIO and Garage all work, and an in-process store is what
development and every test runs against. Uploads are three steps — the
server signs, the **browser** PUTs the bytes straight to storage, the server
confirms against the size *storage* reports rather than the size the client
claims. The port deliberately has **no list operation**: the database is the
index of what exists, because deletion has to be real (LESSONS §11) and a
prefix listing is eventually consistent on most services.

**Receipt capture.** The photograph goes to `@lian/analysis` and nowhere
else. It may return exactly five validated fields — an amount in minor
units, a three-letter currency, a date inside a bounded window, a merchant
that fails `looksLikeInstruction`, and a category from a closed list — and
what reaches her turn is one line composed from those. She still emits
`<spend>`, so money keeps one write path and a misread receipt is corrected
like anything else. An image is the most untrusted input in the product;
this is LESSONS §1a applied to a channel that did not exist when §1a was
written.

**Voice, both directions.** Inbound: uploaded, transcribed on the way into
the turn, and the **transcript is the message body** (Q14) with the audio
kept beside it — memory, search and the rolling summary all read bodies.
`POST /api/voice` is deleted; a second route that produced a message body
was a second path to the same thing. Outbound: `POST /api/messages/:id/voice`
synthesises on demand, never ahead of time, and `persist` is still derived
from the conversation's retention at the single write point.

### Every gate now has a failing case (LESSONS §15)

The ruling from last run. `tools/gates/gates.test.ts` points each gate at a
fixture tree carrying a deliberate violation and asserts the gate objects —
and asserts the MESSAGE, not just the exit code, one case per RULE rather
than per gate. Two of the cases are regressions for gate bugs this project
actually had. A green gate used to be ambiguous: the code is clean, or the
rule never looked at it.

### The rest of the coverage matrix

Health, album, search, the briefing screen, About you, her identity, the
five dials, quiet hours, who you talk to, subscription, consent, 404 and the
outage state. **Every route in `apps/web/src/router.ts` is built** — a path
that is not in that list renders the 404, not the conversation.

### Desktop

One breakpoint at 900px, one block of CSS, one rule for everything not
purpose-built. No second component tree: the rail IS the bottom nav
restyled, and the two-column wrappers are `display: contents` below 900px,
so a phone renders exactly what it rendered before they existed.

### Billing

Stripe over `fetch`, no SDK. The webhook is the whole security boundary and
is tested as an attack, not a shape.

### A bug older than this run, found by a flaky test

`assistantsActiveOn` had a `LIMIT` with no `ORDER BY`, and `runReflections`
filtered the result **after** the limit. Together: a busy deployment serves
the same first fifty accounts every night, nobody past them ever gets a
diary, and the report says `considered: 50` and looks healthy. Same shape as
the gate bugs — sound code, wrong scope, indistinguishable from working. It
is **LESSONS §16** now, with the two halves of the fix pinned by tests.

---

## 1. Decisions, ordered by what they cost to reverse

### Irreversible — somebody's data, or a promise already made to a person

1. **Consent is recorded with the VERSION of the text agreed to.** Without
   it, revising the terms silently reinterprets every existing agreement as
   being to the new wording. Reversing this does not recover which text
   anyone actually saw. **The text itself is mine, not a lawyer's** — a
   plain-language description of what the build does, in both languages,
   marked as unreviewed on every screen that carries it, and listed in
   `NEEDS_LEGAL_REVIEW` for whoever reviews it.
1a. **A password reset ends every other session.** Somebody who resets on a
   phone loses the session on their laptop. That is the decision, and it is
   the right one — recovery is what you do when you think you have been
   compromised — but it is felt by the person the moment it happens.
2. **Deleting an account deletes the objects, not only the rows.** Asserted
   against the store, which is the only thing that can answer it. Once
   somebody has been told that and acted on it, it cannot become untrue.
3. **The TTS cache is keyed by content hash and holds no user reference**,
   so account deletion does **not** remove cached audio — and the object key
   is deliberately not user-prefixed either, or it would reintroduce the
   reference the row avoids. This is a real trade-off, recorded rather than
   glossed: one sentence of synthesised speech, unattributable, outlives the
   account. Making it user-scoped later is a migration plus a cache miss for
   everybody.
4. **Postgres + pgvector, 1024-dimension vectors.** Changing the embedder's
   width is a re-embed of every memory.
5. **Extraction sanitises on the way in** (LESSONS §1a). Reversing it does
   not restore what was stripped.
6. **Trigram indexes for search, not full text.** Postgres ships no Arabic
   dictionary; `simple` tokenises on whitespace, so «شغل» would never match
   «للشغل». Arabic is first-class here, and a search that works in English
   and half-works in Arabic is the asymmetry this product is trying not to
   have. The cost is ranking — results are ordered by recency. Replacing it
   means per-language tsvector columns, not a second index.

6a. **An undated task is carried, not chased.** "Remind me to call the bank"
   with no day stores `due_on NULL`, and she has already said "I'll remind
   you" by then. It now appears in the briefing's *Carried over*, labelled
   "No day set", and it does NOT enter outreach. The alternative — a
   notification every morning until it is done — is the nagging LESSONS §4
   exists to prevent, and somebody who turns her notifications off over it
   does not turn them back on. The cost of this direction is that a person
   who never opens the briefing is never reminded; that is the trade, and it
   is felt by the person the first time it matters.

6b. **The story timeline holds COPY KEYS, not sentences.** A derived
   milestone stores `story.began` and is resolved on the read, in the language
   it is being read in; anything a person authors later holds their own words
   and is never re-translated. `dedupe_key IS NOT NULL` tells them apart.
   Reversing it strands half of somebody's history in whichever language they
   used on the day — and it cannot be recovered, because the words would be
   all that was kept.

### Very expensive — a migration, a backfill, or a bill

7. **The system/turn channel split.** Reversing it gives up history caching,
   which is most of the saving.
8. **`plan` on the user stays the single thing the product reads.** The
   subscription row and the plan are written in one transaction; a second
   source of truth means every gate could disagree with the table.
9. **Storage is metered under a fixed `'held'` period key** and the counter
   moves in both directions. Everything else in `usage_counters` resets;
   bytes held do not.
10. **`rate_limits` and `idempotency_keys` in the database**, and the client
    contract that every write carries an `idempotency-key`.
10a. **Every ceiling is checked on the FIRST reservation of a period as well
    as on later ones** (LESSONS §19). Reversing it re-opens a free account's
    first voice note of every month, and every test would still pass.
10b. **The model key pool is live.** `ANTHROPIC_API_KEY_2` now rotates and
    cools down on 401/403/429 through `api_key_pool` — shared state, not
    process memory. Until this run it was read at startup and discarded.
    A **400 is not retried** on another key: the request is wrong, and a
    second attempt only spends the pool. Every key cooling down is a refusal
    that says so, not a loop.
10c. **A voice note's duration is the LARGER of what the recorder reported
    and what the bytes prove** (DECISIONS §29, resolved). A client-reported
    duration is a number somebody can choose, so it is neither trusted nor
    ignored. Assumptions: 4 kB/s is ordinary Opus voice; 16 kB/s is the
    densest a browser plausibly produces, so `bytes / 16 kB/s` is the
    shortest a file of that size can honestly be. Both err in stated
    directions. Migration 0015 adds the column, nullable.

15a. **Her opening is a catalogue string, written at sign-up.** Reversing it
    means either an empty first screen again or a model call per account, and
    the rows are already written for everybody who has signed up — a change
    of wording does not reach them. It ends by asking their name because the
    reply is what the real conversation starts from; the greeting itself has
    nothing to respond to.
15b. **The free tier's end-of-day STATE is computed server side**, not a
    threshold applied in the client (`messagesState`). A client that knew
    `remaining <= 5` would be a second place the free tier is defined, and
    the two would eventually disagree about where the day ends. Reversing it
    is cheap in code and expensive in what it re-opens.

### Expensive — a public contract

11. **The Stripe API version is pinned** (`2024-06-20`). An account whose
    default version moves would silently change what the parsing receives.
    **Written from the documentation and never run against the live API.**
12. **The webhook takes RAW bytes.** `JSON.parse` then `JSON.stringify`
    produces different bytes for the same document, and the signature is
    over what was sent — so the port takes a string and there is no overload
    that takes an object. A caller cannot make the mistake.
12a. **The incognito role is refused, not truncated, above 600 characters**
    (`MAX_SCENARIO_LENGTH`). The prompt block has always rendered at most
    that; the write did not, so a longer role was displayed in full and
    obeyed in part. A role that is shown and not in effect is worse than a
    refusal — the person finds out three answers later.
13. **The capability registry's sixth consumer, `describe()`.** A captured
    row reads back in the language it is being read in NOW — including its
    AMOUNT, which for eleven runs it did not: the chip carried its own
    formatter and put `AED 400` in Latin digits inside an Arabic screen.
13a. **Reader-facing formatting is `packages/i18n/src/format.ts` and nowhere
    else**, and the gate now knows two spellings of a violation — a second
    `Intl` call and a hand-rolled `toFixed`. Amounts render with the
    currency's own precision and a non-breaking space (`AED\u00a0400.00`),
    which is Intl's and is right: an amount must not wrap between its
    currency and its number. Every test that said `AED 400` says the full
    form now. Reversing it means picking which of two answers is the real
    one, which is the state this replaced.
14. **The API shape**, now with: attachments (three-step upload, a 302 to a
    short-lived signed URL for reads), `/api/search`, `/api/briefing`,
    `/api/profile`, `/api/health`, `/api/album`, `/api/settings`,
    `/api/subscription` and its two hosted-page routes, and
    `/api/stripe/webhook`.
15. **The client is told what to show, not how to decide.** Theme resolved
    server-side (LESSONS §7), mood as a phrase never a score (UI-UX §3),
    relationship as a name with **no day count anywhere in the response**
    (LESSONS §6), and the briefing's money block as an amount rather than a
    sentence — formatting for the language being read belongs to the client,
    which already owns it.
16. **Correction sheets are the only forms, and they cannot create.** The
    server has no create route for tasks, transactions, notes or health.
17. **The free tier: 20 messages a day, 600 a month, a $3.00/month model
    ceiling, on Sonnet 5.** `npm run report:economics` prints measured
    beside assumed. New this run: **the vision call is charged to the same
    monthly meter as a turn** — a hundred photographs cannot go around the
    limit a hundred messages cannot go around.

17a. **Onboarding messages do not count against the daily limit.** Nine turns
    on a "20 a day" plan while the app still said 20. The monthly cost
    ceiling is the real bound so the business is safe, but the number on
    screen is wrong for the first nine messages of somebody's life with the
    product. Left as it is — burning a quarter of your first day on the setup
    conversation is worse — and recorded because it is a decision, not an
    oversight.

17b. **Moments and inside jokes are NOT built, deliberately.** UI-UX §8 lists
    three timeline types; milestones are derived from facts the product has,
    and the other two are a judgement only she can make — a control tag, which
    under LESSONS §21 is a promise needing a mechanism. That is a capability.
    The schema keeps all three so building it later is a writer, not a
    migration.

### Moderate — people will feel it, changeable in a day

18. **Every image sent in a conversation is read as a possible receipt.**
    A cost decision, stated in the code: one vision call per image message.
    The alternative is asking somebody to declare which of their
    photographs is a receipt, which is a form. Album photos do not come
    through this route and are not read.
19. **The vision model is the chat tier, not the analysis tier.** Reading a
    crumpled receipt is the hard task here and a misread total is money in
    the wrong place. $2/$10 per million on Sonnet 5, per the catalogue.
20. **There is no waveform.** Playback is the platform's audio element:
    a hand-drawn player reimplements scrubbing, buffering, the lock screen
    and the media session, and trades all of it for a picture of a sound.
    **This changed the spec** (UI-UX §34.3) rather than the build.
21. **Her sentence is spoken on demand.** Pre-generating every reply bills
    for audio nobody plays — and LESSONS §8's own story is a pre-generation
    path that looked fixed and was not.
22. **Quiet hours cannot silence a security message** from the screen. Quiet
    hours are about her chatting; somebody signing in at 3am is the one
    thing worth waking you for.
23. **Personality is five named stops, never a number.** A slider is a
    number wearing a costume.
24. **The identity capture chip is a moment, not a row.** **This changed the
    spec** (UI-UX §4).
25. **She catches up on a twenty-second beat while the tab is visible.**
25a. **"Our story" shows ONE stage, not five.** UI-UX §8: "Show current state
    as prose, not progression." The view still carries all five — the server
    decides what is true, the client decides what to show — so this is
    reversible in a line. RECONCILIATIONS §14.
25b. **The Money headline is what went out until income exists.** §7 asks for
    all three figures and does not say which is large; "What's left" is
    in-minus-out, so on a first month it was a negative headline for somebody
    who mentioned one gym fee. RECONCILIATIONS §15.
25c. **The mic button stays on the free plan.** Voice is paid-only. Hiding a
    feature is how nobody learns it exists, so the button remains and nothing
    is recorded or uploaded — she says once, in the conversation, that voice
    notes are on the paid plan.
26. **A test client address per test file.**

25d. **A transaction row says its date and nothing about where it came
    from.** `fromReceipt` was `originMessageId === null`, which is backwards;
    `transactions.receipt_id` has never been written, so nothing can answer
    the question. Retreating to the truth rather than guessing — and the gate
    prints the column as NOT WRITTEN every run.
25e. **Money is formatted with the currency's own precision**, by passing no
    fraction-digit options at all. AED and USD get two, JPY none, KWD three.

### Cheap — a line, a number, a file

27. **The desktop widths are tokens**, and every number in them is quoted in
    design.md §11. The rail's 260px is the one choice the spec does not
    make: it fits the longest drawer label in both languages.
28. **`DEFAULT_CURRENCY` is AED**, in one place, because the first market is
    the UAE. A receipt that prints its own code is captured in that code.
29. **Audio is charged at the LARGER of the recorder's duration and the
    bytes-derived floor** — see 10c. Superseded the estimate-only version,
    which said 4 kB per second to turn a byte count into STT
    seconds — Opus at ~32 kbit/s, what a browser's MediaRecorder produces.
    A denser codec is overcharged, which is the safe direction for a ceiling
    and the wrong one for a bill. A real duration from the recorder should
    replace it.
30. **A receipt total above 100,000.00 is refused**, and a printed date more
    than five years old is treated as a misread year. Both are about
    misreads — a barcode parsed as an amount — not about spending limits.

---

## 2. What is stubbed, and what has never touched a live service

**These are the things I could not verify here, listed plainly.**

- **Stripe has never been called.** The client is written from the
  documentation, the four calls are faked at the client boundary in tests,
  and the signature scheme is implemented from the documented construction.
  A first real checkout and a first real webhook delivery are the
  verification. **This is the thing you said you would do on hardware.**
- **The S3 signature has never been checked by a live service.** It is
  verified against a second implementation written in the test from the
  specification, which catches a mistake in one of them and not a shared
  misreading of the spec. I did not assert a remembered AWS test vector,
  because when I tried, the constant I remembered was wrong.
- **The speech provider has never been called.** No key. Both directions are
  tested against fakes.
- **A real web push has never been received on a real device.** Every layer
  is tested — VAPID, RFC 8291, delivery, the worker drawing it — but a
  sandbox cannot subscribe to a push service. **Still the one link in "she
  texts you first" that is proven in parts rather than end to end.**
- **No real email has been sent.** The transport exists and `classify()` was
  corrected by a live call; a key, a verified domain and an actual inbox are
  what remain.
- **The key pool has never rotated in anger.** It is wired, tested against a
  fake provider, and its state is in the database — but no real 429 has ever
  moved a real key out of rotation.
- **The consent text is not legal advice** and is not a lawyer's document.
  See decision 1.
- **`prefers-reduced-motion` is honoured; nothing else in the accessibility
  pass has been audited** — no screen reader run, no keyboard-only pass.
- **Male-voice Arabic is still mostly the feminine string returned
  unchanged**, where no `arMale` is authored. The gate proves no string
  assumes the USER's gender; it cannot prove the register is right.

- **UI-UX §8's story timeline is not built at all** — see §3.9. It is the one
  entry in this section that is a missing FEATURE rather than an unverified
  integration, and it is here so it stops being a ✅ on a matrix.
- **Her replies have never been judged.** `docs/FIRST-IMPRESSIONS.md` was
  written against a scripted provider, so everything in it about the
  PRODUCT's own words is first-hand and nothing in it about HER words is.
  Whether she sounds like herself is still unknown.

**Never built, per your instruction:** no hidden mode, no admin data path.

---

## 3. What will block me next

**`npm run session` is the new way to look at this.** It signs up as a
stranger over the real HTTP API, runs the real scheduler hour by hour, and
writes every exchange to `docs/session-transcript.txt`. It is what found the
hole above, and what proved "I'll remind you" is true — after first reporting,
wrongly and alarmingly, that it was not.

**THAT NEAR-MISS IS WORTH THE PARAGRAPH.** `createApplication` takes an
injectable clock; **Postgres does not.** `messages.created_at` defaults to the
database's own `now()`, so a session that time-travels to September writes rows
stamped with today's date — and `assistantsActiveOn`, which joins on
`messages.created_at`, then finds nobody active and proposes outreach for zero
assistants, every tick, forever. The general form: **an injectable clock that
stops at the database boundary can only test what happens above that boundary,
and nothing that joins on a stored timestamp.** That is most of the scheduler,
and it applies to every test in this repository that moves time.

**READY AND WAITING ON A KEY: the real-model FIRST-IMPRESSIONS run.**
`npm run preflight model` first — four output tokens, a fraction of a cent,
and it separates the four failures that all look like "she did not answer".
Then the session: **≈ $0.25**, computed from the catalogue rather than
guessed, and bounded at $3.00 by the free plan's own ceiling whatever
happens. `docs/FIRST-RUN.md` has the arithmetic and its assumptions. This is
the one thing in the repository that has never happened, and it is the half of
FIRST-IMPRESSIONS that is not first-hand.

**DECIDED, and it was neither of the two options this section offered.** She
speaks first, and the opening is AUTHORED — `greeting.first`, in both
languages and both assistant genders, written by the sign-up route, ending by
asking their name. Not a model call: there is nothing to generate from on turn
zero. Not a rewritten instruction either: the instruction was right and the
product was wrong. `docs/shots/onboarding-greet-ltr.png` is now a person
saying hello.

**One thing left that is a decision rather than a key.**

0. **An account that never answers the notification card has no daily limit.**
   Found by using the product (`npm run session`), not by reading it.
   `nextStep` will not return `done` until `notification_prompted_at` is set,
   and only the browser's permission card sets it. Meanwhile the free counter
   is reserved only on `surface === 'chat'`, and an unfinished onboarding is
   the `onboarding` surface — so the two correct rules meet in a hole. My
   session sat at `ask_notification_permission` through sixteen messages with
   `messagesRemaining` never moving off 20.

   Nobody should hit a wall while being asked their name, so the fix is not
   "count onboarding". Two ways, and it is your call:
   (a) **Complete onboarding without the card** and ask for the permission
       separately, on its own terms. Cleanest, and it unpicks the PRD §8
       ordering that puts the ask after the first remembered thing.
   (b) **Cap the onboarding surface** — after six turns it is not onboarding
       any more, whatever the card says. One number, and it leaves §8 alone.

   I did not pick because (a) changes a product ordering that was decided
   deliberately and (b) puts a magic number where a derived state used to be.

0a. **A refused message loses what the person typed.** Send at the day's limit
   and the optimistic bubble is reconciled away — nothing was written server
   side, correctly — so their sentence disappears from the conversation AND
   from the composer, which was cleared on submit. `limit-reached-ltr.png`
   shows the result: her line, and no sign of what they said. The right
   behaviour is probably to put the text back in the composer, but "probably"
   is why it is here: it could also be that the message should stand in the
   conversation as unsent, the way a failed send does. Small either way.

**Everything else here is a key, a device, or a person.**

0. **A real Stripe account, on the phone.** Checkout, the webhook reaching a
   public URL, and the plan changing under a person. Everything in billing is
   tested and audited; nothing in it has met Stripe. `npm run preflight
   stripe` makes the first call a read-only one that names its own failure.
1. **A real email send.** The transport exists and the preflight already
   caught one classification bug on its first live call. What remains is a
   key, a verified domain, and going to look in the inbox — including spam.
2. **A device**, for the one push subscription that is proven in parts.
3. **Keys**: embedder (production will not start without one), speech, and
   storage credentials against a real bucket — the first real upload is also
   the first real SigV4 check.
4. **Arabic needs a native pass.** The catalogue is ~470 strings now.
5. **An accessibility pass**: no screen reader run, no keyboard-only pass.
   The sheets and the full-screen photo viewer are focus traps by shape.

### And these need doing, not unblocking

Found by using the product; each is in `docs/FIRST-IMPRESSIONS.md` with what
it felt like.

6. **She should ask for a day when a reminder has none.** The briefing carries
   dateless tasks now, so the promise is no longer false — but the right
   answer is one more question at capture time. That is a prompt change, and
   I would not tune a prompt against a scripted model.
7. **The Security screen cannot answer its own question.** One device,
   labelled `Device`, `location: null`. It exists to let somebody decide
   *was that me?* and offers nothing to decide with. Needs a User-Agent parse
   and an IP-to-city lookup — the second is a third-party service and a
   privacy decision, not a patch.
8. ~~**"Message limit approaching" is not shown anywhere.**~~ DONE this run.
   A quiet line above the composer, from a server-computed state, in both
   languages: `limit-approaching-ltr.png`, `limit-approaching-rtl.png`.
9. ~~**`transactions.receipt_id` is never written.**~~ DONE last run. Written
   through the turn, `fromReceipt` reads it, and a test asserts a row
   claiming a receipt has one.
10. **The first briefing is a money figure and four empty lists.** The rule
    producing it is right — she has written no line, and the screen refuses
    to invent her voice. The screen is still somebody's first meeting with
    the product's second-biggest idea.
11. **Money has no "her observation"** (UI-UX §7). Not in the view at all, so
    the screen is figures and a list with nothing of her on it. It is one of
    three remaining screenshot gaps that are missing FEATURES rather than
    missing pictures — with `story_events`' `moment`/`inside_joke` (a control
    tag, because deciding something WAS a moment is a judgement only she can
    make) and the album grid (which needs bytes in a real object store, not
    rows in a seed).
12. **A refused message loses the person's text** — see §3.0. Found by
    photographing the reached state, which nothing had ever done.

## 4. Where to look

```sh
npm run up                      # migrate, server, ticker
npm run verify                  # typecheck, 15 gates, 685 tests
#   export DATABASE_URL first, or 137 of them SKIP without saying so
npm run shots                   # 98 screenshots into docs/shots/, gaps listed
npm run preflight               # the five live integrations, each diagnosed
npm run session                 # sign up as a stranger, use it, keep the transcript
npm run keys vapid              # the two credentials nothing issues
npm run keys tick               #   — see docs/ACCOUNTS.md step 7
npm run report                  # retention and cost, with their definitions
node tools/preview.ts 8790      # the app, with a model that costs nothing
npm run report:economics        # the free tier, every assumption named
```

| File | Why |
|---|---|
| `docs/ACCOUNTS.md` | the nine external services, ordered by what blocks what |
| `docs/FIRST-RUN.md` | what to do on hardware, in order, and what each failure looks like |
| `apps/server/src/hardening.test.ts` | the product attacked, rather than exercised |
| `tools/preflight.ts` | the four live integrations, and how each one fails |
| `tools/gates/gates.test.ts` | every gate, shown to fail |
| `packages/billing/src/webhook.ts` | the whole security boundary of billing |
| `packages/analysis/src/receipt.ts` | what a photograph is allowed to say |
| `packages/storage/src/store.ts` | why the port has no `list` |
| `apps/web/styles/app.css` | the token layer as it ships, desktop at the end |
| `apps/server/src/browser.test.ts` | the app, running, on a phone and at 1280px |
| `docs/RECONCILIATIONS.md` | every disagreement, and which four changed the specs |
| `docs/shots/INDEX.md` | the product photographed — start here |
| `docs/FIRST-IMPRESSIONS.md` | the product used rather than read |
| `packages/domain/src/promises.ts` | what she is allowed to promise (§21) |
| `tools/gates/wired.ts` | the two seams nothing else reads across (§20) |
| `packages/db/src/repositories/usage.ts` | why an upsert's WHERE is not a check (§19) |
| `packages/llm/src/pooled.ts` | LESSONS §12's rotation, finally connected |
