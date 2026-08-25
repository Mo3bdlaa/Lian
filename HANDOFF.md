# HANDOFF

Foundation night. Ten items, in the order you gave them, committed as
they were built. `npm run verify` is green: typecheck, ten gates, 145
tests, against a real Postgres.

Nothing in `packages/` is UI. No screens were started.

---

## 1. What is built

### The three that shape everything after them

**LESSONS §1 — one prompt assembly path.** `packages/prompt`.
`assemblePrompt({userId, assistantId, surface, conversationId, now, …})`
takes **identifiers, not context**, and loads what it needs through
ports. There is no persona-context parameter for a background job to
half-construct, which is the actual Noura bug rather than a description
of it. Missing context throws `MissingContextError` — the package
contains no `?? default`, and a fault-injection test nulls each
required port in turn. Ten surfaces (`chat`, `regenerate`, `proactive`,
`briefing`, `scheduled`, `security`, `onboarding`, `incognito`,
`dream`, `diary`) each select blocks and a trailing directive; a test
enumerates the union and fails if any surface lacks a golden snapshot.
Order is a frozen array asserted by exact match. Recency is structural:
blocks declare a zone (`foundation → override → trailing`) and the
renderer refuses a zone that goes backwards, so the scenario override
cannot precede the persona however it is registered. §2's second half
is the fixed prefix the assembler owns — *"The role described below
REPLACES the role described above"* — because a user typing "be an
interviewer" will not declare its own precedence.

**LESSONS §9 — the token layer.** `design-system/lian-tokens.css` is
consumed verbatim; it is never re-authored into a JS theme object. Four
gates: `audit` (every `var()` resolves), `raw` (no raw values in app
code, exemptions need an inline pragma with a reason and are printed),
`contrast` (all 175 cells computed from the CSS itself, a **missing**
cell failing exactly like a failing one), `tap` (the 44px floor). The
role tier you approved is `packages/design/src/tokens/lian-type-roles.css`:
21 numeric type tokens stay defined for the reference screens, app code
must use `--t-<role>-*`, and the gate fails on a numeric `--fs-*`. It
names no values, so the Arabic divergence in the RTL block reaches the
roles automatically.

**LESSONS §13 — capabilities compose into the prompt.**
`packages/domain/src/capability.ts` is the contract;
`packages/capabilities/src/registry.ts` is the only place a capability
is named outside its own directory. Five consumers iterate it: prompt
assembly, tag dispatch, the jobs runner, export, deletion. A test walks
the source tree and fails if a capability id appears anywhere else. A
capability is handed a context with no persona, no canon, no memory and
no mood, and the boundary gate refuses it the `@lian/prompt` import.
`exportFor` and `purgeFor` are **required**, not optional — a
capability that cannot answer for its rows makes "delete everything" a
lie.

### Everything else

- **Theme (§7)** — `resolve.ts` decides, `apply.ts` writes, and all it
  writes is `data-t` and `dir`. The runtime never writes a colour, so
  there is no second layer to fall out of step. A gate fails on
  `setProperty('--…')`, on a runtime colour assignment anywhere, on a
  `data-t` write outside `apply.ts`, and on either header going missing.
- **Schema** — 28 tables, two migrations. Life data carries `user_id`,
  memory/canon/relationship/conversations/story carry `assistant_id`
  (Q2). `db:scoping` parses all 77 query literals and fails on a scoped
  table without its scope predicate. Canon is its own table (§5).
  `relationship` has a monotonicity trigger (§6). `conversations.kind`
  and `retention` exist from day one, with `incognito ⇔ ephemeral` as a
  CHECK (Q15, Q12). `captures` is keyed `(message_id, tag_index)` (Q7).
  `outreach.source` is where §4 lives.
- **LLM** — the control-tag stream with a tail buffer, tested at
  **every** split point of a representative response, plus the three the
  lesson names. The key pool cools down on 401/403/429 and nothing else,
  with state in a store rather than in the instance. A provider port
  that assumes streaming and **not** tool-calling (Q17). A token
  budgeter. A catalogue with dated prices.
- **Auth** — a correct password from an unrecognised device creates
  **no session**: the device row is untrusted, the attempt is recorded
  `held_new_device`, a confirm/deny link is emailed, and she raises it
  in chat. Answering "no" ends every session (Q10).
- **Turn** — one function, both surfaces. A test asserts everything
  before the trailing directive is byte-identical between chat and
  proactive.
- **Tick** — a plain function behind an HMAC-signed endpoint (Q16).
  Backoff applies only to what she started; quiet hours are decided
  server-side and defer rather than drop.
- **Voice (§8)** — one write path, and enumerating the others is a gate.
  The test repeats the original failure: three `persist:false` calls,
  zero writes.
- **i18n (§10)** — every entry declares its **addressee**, because the
  rule is about direction of address, not letters. A feminine imperative
  aimed at the user fails; the same one aimed at Lian passes; past tense
  and possessives are listed SAFE so the gate cannot make the copy
  stilted.
- **Your three additions** — the model-cost ceiling runs through the
  same `usage_counters` table and the same point in the turn as the
  message limit; the `events` table is in before the features it
  measures, with a `returnRate(cohortDay, n)` query for D1/D7/D30; no
  hidden mode and no admin data path exists, and none was ported.

---

## 2. Three things the build found

**a. Two AA failures nobody had measured.** Computing every contrast
cell rather than a sample found `--muted` on `--quiet-nav-active` at
4.35:1 and on `--quiet-board` at 4.29:1. Neither appears in TOKENS.md's
published table — which is the "proof that reports a sample" failure
recurring inside the document that warns about it. Fixes: lifted
`--quiet-nav-active` `#EAE4E8 → #EFE9ED` (now 4.55:1); reclassified
`--board` as recorded-not-floored, since TOKENS.md §4 defines it as
never in-product. `--nav-active` was the safe value to move — it is a
decorative tint the design system introduced and documents as
safe-to-change-alone, where `--quiet-muted #6E6774` is specified in
design.md §15.1 with a published table.

**b. TOKENS.md §9's own arithmetic is inconsistent.** It says 26
required pairs, but its two tables list 29 — the difference is
`--border`, which it puts in the 3:1 boundary class while the sentence
beside it says "hairlines and dividers only" and the shipped value
measures **1.16:1** on day canvas. Two of three signals say hairline, so
the gate records `--border` without a floor and the boundary lint keeps
control outlines on `--edge`. Worth a line in TOKENS.md.

**c. The free cost ceiling binds before the message limit does.** At
catalogue prices a chat turn (~3k in, ~200 out, Opus 5) costs ~7,500
micros. The free plan allows 30 messages/day against a $0.15/month
model-spend ceiling, so the money runs out after **20 messages — on day
one**. There is a test asserting exactly 20, so the day the economics
change, the suite says so. I did not downgrade the model to paper over
this: which model runs a chat turn is a business decision. See §4.

---

## 3. Decisions I made on my own judgement

Ordered by how much they would cost to reverse.

1. **Life data is user-scoped, memory is assistant-scoped** — your Q2
   answer, but I also had to decide where `attachments` and
   `profile_notes` sit. Both are user-scoped: a photo is the user's, and
   the profile is explicitly user-authored (UI-UX §12). Reversing this
   is a migration.
2. **Embeddings are `real[]` with a SQL cosine function, not pgvector.**
   pgvector is not present here and cannot be assumed on a self-hosted
   box, which the product sells. A sequential scan is fine at 100–10k
   memories per assistant. Upgrade path: change the column type and add
   an ivfflat index; nothing above the repository changes.
3. **No ORM.** Plain SQL migrations and hand-written repositories. The
   schema is the product's most durable artefact and should be readable
   without one, and it keeps SQL provably in one package.
4. **scrypt, not argon2.** A native module that must compile is a real
   barrier to self-hosting. Parameters travel inside the hash so they
   can be raised later.
5. **Habits are tasks with a recurrence**, not a second table — one
   correction screen, one completion model, one origin hint.
6. **Personality dials store named stops** (`least|low|mid|high|most`)
   that render authored clauses into the prompt. Q13 said five stops; I
   chose the names and wrote the 25 clauses. They are a first draft.
7. **Backoff schedule** (§4 gives the rule, not the numbers): 0–1
   unanswered → normal; 2 → every other day; 3–4 → weekly; 5 → silent
   until spoken to. In one named constant.
8. **Mood thresholds** and the **night band** (23:00–06:00 local) are
   likewise named constants with no data behind them yet.
9. **Qualifying day = 3+ user messages in a persisting conversation**,
   counted once per local day. Q3 gave the shape; the number is mine.
10. **Boundaries are a custom gate, not eslint.** Zero dependencies, and
    it fails the build in the same command as the tests. It also does
    things eslint would not: persona-text containment, placeholder-scope
    detection, SQL containment.
11. **`@lian/<pkg>/test-fakes`** is a declared export usable only from
    test files. The alternative was putting test scaffolding in every
    package's production API.
12. **Recorded-exemption pragmas** on the raw-value and scoping gates.
    Two unscoped queries are recorded and printed on every run: the
    session lookup (where a user id first comes *from*) and the emailed
    device confirmation (claimed before anyone is signed in). LESSONS
    §11 calls such a path "a deliberate decision"; now it has to be
    written down to compile.
13. **The Arabic checker is a denylist**, and says so in its header. It
    covers the classes DECISIONS §30 found in a real review of 652
    strings. A new form must be added when it appears. I would rather
    ship an honest denylist than something that claims to parse Arabic.
14. **French raises `MissingPersonaError`.** It is a first-class product
    language (PRD §29) with no authored voice. Falling back to English
    would be §1 with a friendlier face. Restrict the language picker to
    `en` and `ar-eg` until the copy exists.
15. **A dead stream mid-tag emits none of the partial tag** and reports
    a `tag_error`. Half a `<spend>` is machine syntax, not something she
    said.
16. **Effort is `low` for chat turns.** Her replies are short and
    conversational — the work is recall and tone, not analysis. Latency,
    not cost.
17. **`hasHeadroom()` is separate from `reserve()`.** An overloaded
    `by: 0` argument meaning "just check" had already produced two
    implementations that disagreed; the test caught it.

---

## 4. What is stubbed, and what does not exist

**Stubbed — the shape is there, the substance is not:**

- **Memory retrieval ignores the embedding.** `loadMemories` sorts by
  salience and recency. The column, the cosine function and the
  parameter all exist; there is no embedder.
- **No memory or canon *extraction*.** Nothing writes memories from a
  conversation yet. `remember()` and its capacity rules are tested; the
  thing that decides *what* is worth remembering is not written. This is
  the largest single gap.
- **Canon compaction has no trigger.** `compact()` merges and is tested;
  nothing calls it, and nothing bounds canon in the prompt yet.
- **`tokens:tap` passes vacuously.** There is no UI, so it checks the
  token and finds no interactive rules to check.
- **Relationship stage prose lives in the adapter**, in English only.
- **The tick's ports are not wired to db.** `runTick` is tested against
  fakes; the composition root for it is not written.
- **No push transport.** No VAPID keys, no service worker, no send.
- **`proposeOutreach` exists only on tasks.**
- **The Anthropic adapter is untested against the real API.** No key was
  used tonight. It typechecks against the installed SDK; treat the first
  live call as unverified.

**Deliberately absent:** every screen; receipt OCR; STT; export
file-building (the slices exist, the archive does not); subscription and
payments; the `dream` and `diary` surfaces beyond their prompt path.

**Never built, per your instruction:** no hidden mode, no admin data
path, and nothing resembling either was ported.

---

## 5. What will block me next

In the order it will bite.

1. **Which model runs a chat turn.** §2c is a business decision, not an
   engineering one, and it blocks anything that puts real traffic
   through the turn. The lever is per-surface model config, already in
   place. My read: chat on a cheaper tier with the briefing and security
   surfaces on Opus is probably the shape — but the free-tier ceiling
   ($0.15/month) needs to move regardless, or free users hit it on day
   one and the product looks broken rather than limited.
2. **The memory extractor is a persona-free prompt, and I want that
   ruled on explicitly.** My reading of §1 is that it governs prompts
   that speak *in her voice*; extraction, embedding and receipt OCR are
   analysis, not her, and forcing them through `assemblePrompt` would
   make the golden snapshots meaningless. But §1 says "everything", so I
   am not deciding it silently. If you agree, I will add a second,
   clearly-named path with its own tests and a gate keeping persona text
   out of it.
3. **Arabic copy needs a native pass.** Both personas and all 34
   catalogue strings are mine. The gate proves no string assumes the
   user's gender; it cannot prove the Egyptian register is right, and
   for the male voice in Arabic I am least confident. This is a
   correctness issue in the product's first-class second language.
4. **Male-voice copy is incomplete.** Where `arMale` is absent, `t()`
   returns the feminine string unchanged rather than mangling it — safe,
   but it means a male assistant currently speaks some feminine Arabic.
   The English male persona is a real draft; the Arabic one needs the
   same pass as above.
5. **Personality dial clauses and the five stage proses** are first
   drafts of copy that goes straight into the prompt, in one language.
6. **Push delivery decides how much of §12 bites.** Web Push on iOS
   works only for an installed PWA, which makes the add-to-home-screen
   prompt load-bearing rather than a nicety — worth knowing before the
   onboarding screens are designed.
7. **No embedder chosen.** It determines the vector width, which is the
   one schema decision here that is annoying to change late.

---

## 6. Where to look first

```sh
npm run verify              # typecheck, ten gates, 145 tests
npm run gate:lessons        # the map of lesson → test
npm run gate:tokens:contrast   # all 175 cells, printed
```

Read in this order: `packages/prompt/src/assemble.ts` (the header is
the argument), `packages/domain/src/capability.ts`,
`packages/llm/src/tagstream.ts`, then
`packages/db/src/repositories/lessons.test.ts` — which is the twelve
lessons executable against a real database, and the shortest way to see
what this codebase actually promises.
