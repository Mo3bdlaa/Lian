# HANDOFF

Fifth run. Everything asked for is built and committed: the injection
surface closed first, then the HTTP layer, the economics assumption made
loud, onboarding end to end, the real tick schedule, and a deployable
configuration.

`npm run verify` is green: typecheck, 11 gates, **393 tests** against a
real Postgres with pgvector.

Still no screens — the shell serves a manifest, a service worker that
draws a push notification, and `/push.js`. Everything else is API.

**Every number below states the assumption it rests on.** Where an
assumption is soft, it says so.

---

## 0. What changed this run

### The injection surface is closed, both ways

The channel split put retrieved text inside the user turn, and I logged
that trade rather than closing it. It is closed now, with two
independent defences:

- **On the way out**: the turn channel renders in a fixed structure —
  `RECALLED`, then `ENVIRONMENT`, then the person's actual message,
  last. Recalled content is labelled as recalled data, and the contract
  block in the system channel says it is DATA, not instruction.
- **On the way in**: extraction sanitises. `sanitiseRecalled` strips
  fences, headings, rules, list markers, role prefixes and our own
  markers; `looksLikeInstruction` refuses a candidate that reads as a
  directive rather than a fact. Storing the shape is storing the attack.

Ten tests plant a real payload — `<</context>>`, `# SYSTEM`, "Ignore your
previous instructions", a forged `<spend>` tag — in memory, scenario,
capability state, the rolling summary and the profile, then run a real
turn. **One of them found a genuine hole**: capability state was
sanitised in the registry but a port supplying contributions directly
bypassed it. The gate is now at the block, which is the last thing before
render.

LESSONS gained **§1a — channels are trust boundaries**.

### The HTTP layer exists

Auth, chat over SSE, corrections, push, the signed tick, export and
deletion, plus the PWA shell — and a composition root in `apps/server`
that wires them to the database, the runtime, the jobs and push.

The two things you singled out are behaviour, not assertions:

- **The rate limiter is in Postgres.** The test starts TWO applications
  on one database and spends one person's allowance alternating between
  them. A per-instance counter would let each see half. (LESSONS §12:
  "Rate limiting held in process memory resets on every cold start and
  is per-instance. It is not a rate limit.")
- **Idempotency covers every write route.** A retried chat turn replays
  the stored answer and the model is called once. The same key with a
  different body is 422, never a wrong answer. A write with no key is
  refused rather than quietly accepted — including sign-up, sign-out,
  subscribe, unsubscribe, export and delete, each asserted by name.

### The economics assumption is loud now

`CACHE_WRITE_TURN_SHARE = 0.1` — one turn in ten pays a cache write,
implying ten-turn sessions — was the softest number in the codebase and
read like a measurement. Three things changed:

1. **A query that measures it.** `economics.turnsPerSession` derives
   sessions from message gaps and returns counts only — no bodies, no
   identifiers. **Assumption stated with it**: a session ends after a
   30-minute gap. That is *longer* than the provider's ~5-minute cache
   TTL, so the measured write share is a **floor**.
2. **A report.** `npm run report:economics` prints every input beside
   the number that depends on it, marks each ASSUMED or MEASURED, and
   warns when the two diverge by more than 25%.
3. **The ceiling test prints its assumptions** next to the number, so a
   passing test cannot be mistaken for evidence.

Run against this repository's own test traffic the report already says
the assumption is off by a factor of eight. That is test traffic, not
sessions — and the report says which it measured, which is the point.

### The schedule runs on everyone's own clock

While wiring the tick I found the reminder schedule anchored to UTC:
`new Date(`${localDay}T09:00:00Z`)`. Nine in the morning in Reykjavík;
one in the afternoon in Dubai, which is the market this starts in. Fixed
with `atLocalHour`, and the same bug was in the health pattern and the
reflection follow-up.

Two more found the same way: a **weekly habit was proposed every day**
(the repository returns every habit; nothing read the recurrence), and
**nothing scheduled the morning briefing at all**.

---

## 1. Decisions, ordered by what they cost to reverse

### Very expensive — a migration, a backfill, or somebody's data

1. **Postgres + pgvector, 1024-dimension vectors.** Unchanged this run
   and still the floor everything sits on. Changing the embedder's width
   is a re-embed of every memory.
2. **Extraction sanitises on the way in.** Memories are stored
   *sanitised*, so reversing this does not restore what was stripped —
   only re-extraction from the source messages would, and only where
   they still exist. Deliberate: the alternative is storing the attack
   and hoping the render survives it.
3. **The system/turn channel split**, and per-turn context inside the
   user message. Reversing it means giving up history caching, which is
   most of the saving. Every golden prompt follows from it.
4. **`rate_limits` and `idempotency_keys` in the database.** Two tables,
   and a client contract: every write carries an `idempotency-key`
   header. Clients written against that cannot be un-written.
   `rate_limits` is also the one table with no foreign key to cascade
   from — account deletion sweeps its buckets by hand, and a test says
   so (LESSONS §11).

### Expensive — a public contract, or a promise to a person

5. **The HTTP API shape.** Sessions as an httpOnly cookie *or* a bearer
   token; chat as SSE with `text` / `capture` / `limit` / `done` events;
   corrections as `PATCH|DELETE /api/:kind/:id` with **no create route**
   (PRD §14: no add buttons anywhere). Every screen will be written
   against this.
6. **The free tier: 20 messages a day, 600 a month, a $3.00/month model
   ceiling, on Sonnet 5.** Unchanged, and now printed with its
   assumptions. Lowering any of it after launch is a change to people
   who are already using it.
   **Assumptions**: a 3,000-in/200-out turn; prices read 2026-06-24;
   cache write 1.25× and read 0.1× from the same source; 70% of input
   cacheable, measured off the golden prompt at ~4 characters per token;
   and the 1-in-10 write share, which measures nothing.
   Blended ≈ **4,703 micros/turn × 600 = $2.82 against $3.00**, i.e.
   **~3.2 free users per $9 subscriber** — a floor built on that
   assumption, and it assumes every free user spends the whole
   allowance, which nobody does.
7. **Onboarding is a surface, not a screen.** The chat route runs the
   same turn function with `surface: 'onboarding'` while any of the four
   facts is missing, chosen from the facts rather than a flag. Someone
   who answers two questions in one sentence moves two steps.
8. **Both answers to the notification permission reach the server.**
   Granted subscribes; denied or dismissed still records that it was
   *asked*. A refusal that is not recorded leaves her asking every turn
   into a dialogue the browser will not show twice. Only a grant records
   the funnel event (PRD §18).
9. **A device confirmation cannot be emailed, and the sign-in stays
   held.** There is no email transport. Failing closed is the safe
   direction, and she raises it in chat instead (UI-UX §16). The token is
   never logged. `LIAN_LOG_CONFIRMATION_LINKS` prints the link locally
   and **cannot be set in production** — the config refuses to boot, and
   that refusal is a test. It is a development convenience, not a second
   way in.

### Moderate — a decision people will feel, changeable in a day

10. **The schedule's local hours**: propose at 5am, dream at 2am, diary
    at 23:00, reminders at 9am, patterns at 6pm, the briefing at 7am.
    **All product choices, none measured.** Stated in `SCHEDULE_HOURS`
    so changing one is a decision rather than an edit.
11. **The briefing competes rather than adds.** It is
    `assistant_initiated`, so it goes through LESSONS §4's backoff and
    through the one-pending-reach-out limit. Someone who never opens the
    morning message stops getting one.
12. **A briefing is only proposed when there is something to brief** —
    anything due, carried over, or a habit due today. A briefing with
    nothing in it is the "we miss you" message UI-UX §9 forbids, with
    more sections.
13. **The tick is frequent and idempotent, not hourly and exact.** Every
    job dedupes, so a double run is cheap and a missed run is caught by
    the next. **The interval bounds reminder accuracy**: a reminder for
    14:15 arrives at the first tick after 14:15. Default 5 minutes.
14. **Corrections have a per-kind field whitelist.** A PATCH body cannot
    name a column. Adding a correctable field is one line and a test.
15. **Analysis runs on Haiku 4.5**, not the chat model. **Assumption**,
    not a measurement: extraction and summary rolling are structured
    short-output jobs. If extraction quality turns out to need the
    larger model, that is one line in `apps/server/src/analysis.ts`.
16. **Summary rolling and mood refresh run after the answer has
    streamed**, awaited rather than fired and forgotten, so a shutdown
    cannot lose them. The person perceives nothing; the process pays.
17. **`x-forwarded-for` is trusted for rate limiting and sign-in
    records, never for authorisation.** Behind a proxy it is the only
    real client address; directly exposed it is spoofable.

### Cheap — a line, a number, a file

18. **Two processes, no build step.** `node apps/server/src/main.ts` and
    `node apps/server/src/ticker.ts`. The Dockerfile copies source.
19. **`npm run up` starts the ticker beside the server.** A local setup
    without it looks like a chat app.
20. **The manifest colour is read from `design-system/lian-tokens.css`
    at boot** rather than retyped. The deployment must ship that
    directory; the Dockerfile does.
21. **Sweeps in the tick**: rate-limit windows over 24h, in-flight
    idempotency claims over 15 minutes, finished keys over 7 days.

---

## 2. What is stubbed, and what does not exist

- **No screens.** The shell, the worker and `/push.js` are the whole
  client. `tokens:tap` still passes vacuously.
- **No email transport.** See decision 9 — the hold stands, so this is a
  gap with a safe failure rather than a hole.
- **No object storage.** Attachments are rows. `deleteStoredFiles`
  returns the count that *would* have to go, so the gap shows in the
  deletion report instead of looking like a clean sweep.
- **No real embedder or speech key configured.** Production refuses to
  start without the first; the live speech contract test skips loudly
  without the second.
- **No subscription or payments.** The paid plan exists in `plan.ts` and
  nothing can be bought.
- **Dream and diary share the generic reflection directive.** They work;
  they are not distinct voices.
- **One assistant per account.** The schema allows more; `assistantOf`
  in the wiring is the single place that decides which one a request
  means, and it takes the first.

**Never built, per your instruction:** no hidden mode, no admin data
path. Nothing resembling either was ported, assumed, or added.

---

## 3. What will block me next

1. **Screens.** Everything below the API is now real, and nothing above
   it exists. This is the whole of the next run.
2. **Two keys** — an embedder key (production will not start without
   one) and a speech key (one variable from a passing live contract) —
   and a **VAPID pair**, or push is a stored message with nowhere to go.
3. **Real sessions.** `npm run report:economics` will answer the
   cache-write question in a week of live traffic, and the free tier's
   whole cost model rests on it.
4. **Arabic needs a native pass.** Two personas and ~60 catalogue
   strings are mine. The gate proves no string assumes the user's
   gender; it cannot prove the register is right. Male-voice Arabic is
   still mostly the feminine string returned unchanged.
5. **An email transport**, or the new-device hold is only escapable
   through chat.

---

## 4. Where to look

```sh
npm run up                      # migrate, server, ticker
npm run verify                  # typecheck, 11 gates, 393 tests
npm run report:economics        # the free tier, every assumption named
npm test 2>&1 | grep -i assumed # the assumptions, printed by the tests
```

Read in this order:

| File | Why |
|---|---|
| `packages/domain/src/untrusted.ts` | the sanitiser, both directions |
| `packages/runtime/src/injection.test.ts` | the attack, as a test |
| `packages/http/src/middleware.ts` | session, rate limit, idempotency |
| `apps/server/src/wiring.ts` | the joint: ports to adapters |
| `apps/server/src/schedule.ts` | the tick, per time zone |
| `apps/server/src/config.ts` | the environment contract |
| `docs/DEPLOY.md` | how it runs, and what is not wired |
