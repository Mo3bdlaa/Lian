# HANDOFF

Seventh run. Storage exists, so the two features that were waiting on it
exist: **a photographed receipt becomes a transaction**, and **a voice note
is a real voice note in both directions**. Every screen in the coverage
matrix is built, desktop has its three purpose-built layouts and its
fallback rule, and there is a billing path.

`npm run verify` is green: typecheck (two projects — server and browser),
11 gates, **560 tests**, including 17 that drive real Chromium and 12 that
prove each gate FAILS on a deliberate violation.

**Every number below states the assumption it rests on.** Where an
assumption is soft, it says so. Where a thing has never touched a live
service, it says that too.

---

## 0. What this run built

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
   and a reviewed document has to replace or wrap it before this ships to
   anyone who is not you.
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

### Expensive — a public contract

11. **The Stripe API version is pinned** (`2024-06-20`). An account whose
    default version moves would silently change what the parsing receives.
    **Written from the documentation and never run against the live API.**
12. **The webhook takes RAW bytes.** `JSON.parse` then `JSON.stringify`
    produces different bytes for the same document, and the signature is
    over what was sent — so the port takes a string and there is no overload
    that takes an object. A caller cannot make the mistake.
13. **The capability registry's sixth consumer, `describe()`.** A captured
    row reads back in the language it is being read in NOW.
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
26. **A test client address per test file.**

### Cheap — a line, a number, a file

27. **The desktop widths are tokens**, and every number in them is quoted in
    design.md §11. The rail's 260px is the one choice the spec does not
    make: it fits the longest drawer label in both languages.
28. **`DEFAULT_CURRENCY` is AED**, in one place, because the first market is
    the UAE. A receipt that prints its own code is captured in that code.
29. **Audio is charged at 4 kB per second** to turn a byte count into STT
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
- **No email transport**, so a device confirmation cannot be emailed. The
  sign-in stays held — the safe direction — and she raises it in chat.
- **The consent text is not legal advice** and is not a lawyer's document.
  See decision 1.
- **`prefers-reduced-motion` is honoured; nothing else in the accessibility
  pass has been audited** — no screen reader run, no keyboard-only pass.
- **Male-voice Arabic is still mostly the feminine string returned
  unchanged**, where no `arMale` is authored. The gate proves no string
  assumes the USER's gender; it cannot prove the register is right.

**Never built, per your instruction:** no hidden mode, no admin data path.

---

## 3. What will block me next

1. **A real Stripe account, on the phone.** Checkout, the webhook reaching
   a public URL, and the plan changing under a person. Everything else in
   billing is tested; nothing in it has met Stripe.
2. **A device**, for the one push subscription that closes item 2 above.
3. **Keys**: embedder (production will not start without one), speech, and
   storage credentials against a real bucket — the first real upload is
   also the first real SigV4 check.
4. **Arabic needs a native pass.** The catalogue is now ~330 strings.
5. **An accessibility pass**, including a keyboard-only run over the sheets
   and the new full-screen photo viewer — both are focus traps by shape.
6. **The recorder should report a duration.** Until it does, STT seconds are
   inferred from bytes (decision 29).

---

## 4. Where to look

```sh
npm run up                      # migrate, server, ticker
npm run verify                  # typecheck, 11 gates, 560 tests
node tools/preview.ts 8790      # the app, with a model that costs nothing
npm run report:economics        # the free tier, every assumption named
```

| File | Why |
|---|---|
| `tools/gates/gates.test.ts` | every gate, shown to fail |
| `packages/billing/src/webhook.ts` | the whole security boundary of billing |
| `packages/analysis/src/receipt.ts` | what a photograph is allowed to say |
| `packages/storage/src/store.ts` | why the port has no `list` |
| `apps/web/styles/app.css` | the token layer as it ships, desktop at the end |
| `apps/server/src/browser.test.ts` | the app, running, on a phone and at 1280px |
| `docs/RECONCILIATIONS.md` | every disagreement, and which four changed the specs |
