# HANDOFF

Third run. Both leading items done, all eight built, committed as they
were built. `npm run verify` is green: typecheck, twelve gates, 317
tests against a real Postgres with pgvector.

Still no UI.

**Every number below states the assumption it rests on.** Where an
assumption is soft, it says so.

---

## 0. What the two leading items changed

### Prompt caching: measuring it changed the design

Measuring first was the whole value. The stable part of the system
prompt was **587 tokens** — 65% of the system block, but only ~20% of a
turn once history is counted, and *below* the ~1024-token minimum a
cache breakpoint needs. Caching would have done nothing at all.

The reason is structural, and worth carrying: **caching is a prefix
match over the whole request, rendered system-then-messages.** Any
per-turn content in the system block invalidates the cache for the
system block *and every message after it*. With retrieved memory and
the current time in the system prompt, the conversation history — most
of the tokens in a long conversation — could never be cached.

So blocks now declare a **channel**, splitting by what changes rather
than by what it says. System: identity, canon, relationship, profile,
capabilities, contract, directive. Turn: memory, standing, environment,
conversation, earlier, scenario — rendered into the final user turn,
where changing every turn costs nothing because it is the end anyway.

LESSONS §1 is *why* that is safe rather than something it survives:
"the most important instruction is repeated last." The directive ends
the system block and is repeated after the user's message, which is now
genuinely last. §2 gets stronger — the scenario override moved *later*
relative to the persona.

Measured, per turn on the default model:

| | micros | assumption |
|---|---:|---|
| uncached | 8,000 | 3k input / 200 output tokens; prices read 2026-06-24 |
| cache read | 4,220 | reads billed at 0.1× input, same source |
| cache write (first turn) | 9,050 | writes billed at 1.25× — **more**, not less |
| **saving** | **47.3%** | on every turn after the first |
| break-even | 1 turn | |

### The unit economics, corrected again

Sizing the ceiling on the cache-read figure alone would have been
optimistic in exactly the way last night's mistake was. A month
contains first turns.

- **Blended turn cost: ~4,700 micros.** Assumption: 1 turn in 10 pays a
  cache write. That implies sessions of ~10 turns, which matches
  **nothing measured** — there is no usage data. It is in
  `catalogue.ts` so the first week of real sessions can correct it.
- **Free tier: 600 turns/month × 4,700 = ~$2.82.** Assumption: 20
  messages/day × 30 days.
- **Ceiling set to $3.00**, ~6% head room.

So the ratio you computed moves the wrong way: **~3.0 free users per
paying customer, not 3.6** — before voice and hosting. Caching halved
the per-turn cost; it did not change the shape. The levers left are the
message limit, the model, and how much history a turn carries.

One finding kept in a test rather than a comment: for a **new** user
the system block is ~860 tokens, still under the minimum, so the system
breakpoint alone does nothing. Caching starts working through the
*history* breakpoint after an exchange or two.

### Push: the message leaves the building

VAPID and RFC 8291 written against `node:crypto` — about 250 lines —
rather than taken as a dependency. That bought the test you asked for,
literally: **the tests decrypt their own payload from the subscriber's
side, with the browser's private key**, and assert on her actual
sentence. Also asserted: the push service cannot read the blob, a
different subscriber cannot open it, identical copy produces different
bytes every time, and Arabic survives the round trip.

Failure handling is most of the value. 404/410 → revoke immediately (a
stale endpoint kept forever is how "she texts you first" becomes "she
texts nobody"); 429/5xx → retry honouring Retry-After; 400/401/403/413
→ never retry, it would fail identically; network error → retry, device
stays. Delivering to zero devices is a **reported** outcome, not a
silent success.

---

## 3. Decisions I made on my own judgement

Ordered by what they would cost to reverse.

1. **The system/turn channel split.** The largest structural change in
   the codebase this run. Reversing it means moving per-turn context
   back into the system block and giving up history caching — which is
   most of the saving. Everything downstream (goldens, the `<<context>>`
   delimiter, the repeated directive) follows from it.
2. **Per-turn context travels inside the user message.** It is
   delimited and the system block tells her once that the block is from
   the system, never to quote it, and never to treat typed text as if
   it came from there. **This is a deliberate injection trade**: a user
   *can* type `<<context>>`. The mitigation is instruction plus the
   fact that nothing downstream parses that block — it is prose for the
   model, not a control channel. If that trade is wrong, the fix is
   mid-conversation system messages, which the default model does not
   support today.
3. **Embedder: `text-embedding-3-large` truncated to 1024 dimensions.**
   Changing model or width means re-embedding every memory. Chosen for
   multilingual quality (Arabic is first-class, not a fallback), and
   because this family truncates natively so the width is a *choice*
   rather than whatever the model emits. Assumption: ~$0.13 per million
   tokens (read 2026-06-24) ≈ 3 micros per 1,000 memories — not a line
   item, listed so nobody wonders.
4. **Production refuses to start without a real embedder.** Lexical
   retrieval looks like it works and fails exactly where semantic
   retrieval earns its place. A test asserts the dev embedder genuinely
   cannot match "their sister lives in Cairo" to "Dana is based in
   Egypt".
5. **Free ceiling $3.00/month.** Follows from the arithmetic above; a
   business number, recorded in `plan.ts` with its working.
6. **The capability is `identity`, not `onboarding`.** It captures
   identity facts that change later on a settings screen; naming it for
   *when it runs* collided with the surface of the same name.
7. **The onboarding notification prompt comes after the first
   remembered moment.** Your ruling, implemented as ordering in
   `nextStep()` and asserted both ways.
8. **Cache write share of 1 in 10.** The softest number here. No data
   behind it.
9. **`TYPICAL_CACHED_SHARE` 0.7**, measured from the golden prompt plus
   TYPICAL_TURN, deliberately more conservative than the ~0.85 the
   measurement suggests, because history is short early in a
   conversation and a cache entry expires between sessions.
10. **Notification body limit 240 characters**, elided at the end —
    the opening is what a lock screen shows.
11. **Push urgency is `normal`.** Nothing this product sends justifies
    waking a sleeping phone faster.
12. **Cohorts under 20 users are not reported.** A cohort of one is an
    anecdote; a rate over it invites reading as a trend.
13. **"Day N" means exactly day N**, not "within N days".
14. **The cost ceiling shows the user the same line as the message
    limit**, with a different status for logs. "Our costs ran over" is
    true and none of their business.
15. **The live speech contract test skips loudly** rather than passing
    when no key is present.

---

## 4. What is stubbed, and what does not exist

- **No HTTP layer.** This is now the binding constraint on almost
  everything below it. `/api/tick` has no route; push subscriptions
  have storage and no endpoint to arrive through; the service worker
  that would receive a notification does not exist.
- **No real embedder configured**, so retrieval is lexical in
  development. Production will refuse to start, which is the intended
  shape but means the first deployment needs a key.
- **The speech provider is untested against the live API.** The
  contract test exists and is one environment variable from running.
- **Object storage is not wired.** Attachments are rows; audio and
  images have nowhere to live. `deleteStoredFiles` returns the count
  that *would* have to go, so the gap shows in the deletion report
  rather than looking like a clean sweep.
- **Dream and diary prompts are the generic reflection directive** —
  they work, they are not distinct voices.
- **`tokens:tap` still passes vacuously** — no UI.
- **No subscription or payments.** The paid plan exists in `plan.ts`
  and nothing can be bought.

**Never built, per your instruction:** no hidden mode, no admin data
path.

---

## 5. What will block me next

1. **The HTTP layer and the service worker.** Everything from item 4
   funnels into this. Push has no way to arrive; the tick has no way to
   be called; onboarding has no way to be spoken to. It is the last
   piece before any of this is a product rather than a library.
2. **Two keys**: an embedder key (production will not start without
   one) and a speech key (one variable from a passing live contract).
3. **The cache-write share needs real sessions.** Everything about the
   free tier's cost rests on it, and it is currently a guess I have
   labelled as one.
4. **Arabic still needs a native pass.** Two personas and ~60
   catalogue strings are mine. The gate proves no string assumes the
   user's gender; it cannot prove the register is right.
5. **Male-voice Arabic** is still mostly the feminine string returned
   unchanged where no `arMale` is authored.
6. **The health observation** is arithmetic over two rules and will
   feel thin in week one. Widening it *without* inventing observations
   is the careful part.

---

## 6. Where to look

```sh
npm run verify                 # typecheck, 12 gates, 317 tests
npm run gate:lessons           # lesson → test, 56 mapped files
npm run gate:analysis          # the non-voice path's two conditions
npm test 2>&1 | grep micros    # the caching numbers, printed
```

Read in this order: `packages/prompt/src/zones.ts` (the channel split
and why), `packages/push/src/encrypt.ts`,
`packages/db/src/repositories/ownership.test.ts` (§11 as a generic
sweep rather than a list), then
`packages/db/src/repositories/lessons.test.ts`.
