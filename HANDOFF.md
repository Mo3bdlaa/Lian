# HANDOFF

Second run: memory. Both rulings applied, all eight items built,
committed as they were built. `npm run verify` is green — typecheck,
eleven gates, 237 tests, against a real Postgres with pgvector.

Still no UI.

---

## 0. Read this first — a correction to last night's arithmetic

I reported that the free cost ceiling bound "after 20 messages, on day
one", and you ruled the free limit to 20 on that basis. Writing the
test that keeps the two numbers in agreement showed the statement was
wrong in a way that changes the decision:

**the model-spend ceiling is monthly, and I compared it against a day
of messages.** $0.15/month ÷ ~$0.0075/turn = 20 turns *for the whole
month*, not per day. Setting the daily limit to 20 would not have
fixed the collision; it would have moved it to day two.

Corrected, with the arithmetic in `plan.ts` and asserted in
`turn.test.ts`:

| | |
|---|---|
| free allowance | 20/day × 30 days = **600 turns/month** |
| a typical turn | 3k in, 200 out ≈ **8,000 micros** on the default model |
| with prompt caching | ≈ **4,000 micros** |
| so the free ceiling is | **$2.50/month** |

Two things follow, and both are yours rather than mine:

1. **$2.50 of model spend per free user is an acquisition cost**, not a
   rounding error. It is recorded in `plan.ts` where the number lives.
2. **That figure assumes prompt caching, which is not implemented.**
   Uncached it is ~$4.80 and the ceiling bites around day 15. Our
   system prompt is stable within a conversation, which is exactly the
   shape caching wants — it is the largest untaken lever in the
   codebase and it is item 1 in §5.

The ruling itself stands: the limit is 20, it is in the PRD, the brand
guidelines, the subscription screen copy in both languages, and the
code, and the first session was not downgraded to make it work.

**Model choice**, logged as asked: `claude-sonnet-5` for chat turns. On
merit rather than to fit the ceiling — for short conversational replies
over a long structured prompt it follows instructions closely, is
meaningfully faster than Opus, and costs 2.5× less. Per-surface
configuration, so a briefing or a security notice can run elsewhere,
and swappable per Q17.

---

## 1. The two rulings

**§1 restated.** LESSONS §1 now says the constraint is *"no second path
can construct a persona"*, and names the two conditions a non-voice
path exists under. Both are enforced:

- **One clearly named place** — `packages/analysis/src/prompts.ts`
  holds every non-voice prompt, all four declared in `ANALYSIS_PROMPTS`.
  The gate fails if a system prompt is defined anywhere outside the two
  sanctioned places, and if a prompt is not in that list. "One place"
  should mean a countable set, not a directory.
- **Lint-banned from the persona** — the import ban is in
  `boundaries.ts`. `analysis-path.ts` adds what an import ban cannot
  catch: a persona rebuilt by hand out of string literals. It checks
  for the *voice path's own block headers* appearing on the analysis
  side, because that is what reconstructing a persona actually looks
  like. (First draft banned the word "canon" and flagged the canon
  extractor. A gate that fires on its own subject matter is a gate
  people delete.)

**TOKENS.md §9** is fixed in the document: 22 required + 13 recorded =
35 per palette, 175 across five; `--border` stated plainly as a hairline
rather than a 3:1 boundary it never met at 1.16:1; `--board` recorded
because it is never in-product. The published excerpt now says it is an
excerpt and names the two AA failures the gate found that it did not
contain.

---

## 2. What the eight items built

1. **The extractor** — narrow by design. A memory system does not fail
   by missing things; it fails by remembering noise and repeating it
   confidently. The prompt is mostly about what *not* to keep, an empty
   array is stated to be the common case, and the parser is tolerant
   about shape (fences, preambles, a single object where an array was
   asked for — Q17 assumes no tool-calling) and strict about content.
2. **Canon** — extracted from her side only; the user's turn is not
   even sent to that prompt. Compaction merges and verifies the count
   before and after. A `BEFORE DELETE` trigger refuses to delete canon
   at all; deleting the assistant still cascades, which is the only
   intended way it goes.
3. **Retrieval** — pgvector, reversing last night's `real[]` fallback.
   Ranking is 0.7 similarity + 0.3 salience: a salient fact about
   someone's sister should survive a turn about lunch, and pure cosine
   buries it. `embedding_model` on every row, because switching
   embedders unnoticed mixes two vector spaces in one index and
   retrieval degrades instead of failing. Plus the rolling summary,
   rewritten forward, and a new `earlier` prompt block.
4. **Relationship** — `relationshipView()` is the only thing that turns
   stage into something a client sees, and the test serialises it and
   asserts **no digit appears**, in either script.
5. **Mood** — derived from signals, stored once, read by the prompt and
   by theme resolution. The theme machinery finally has something real
   to resolve from.
6. **Notes, health, habits** — three directories and one registry line.
   Nothing in the turn, the prompt, the export or the deletion path
   changed. The export test was rewritten to run off `REGISTRY` rather
   than a list of names: a test that needs editing each time is the
   promise not being kept.
7. **Proactive** — candidate composition in one place, at most one of
   *her own* reach-outs pending; the user's reminders exempt from that
   and from backoff. Dreams and diary land in `reflections`, one per
   day, delivered nowhere — the ports have no `send`, and a test
   asserts that shape.
8. **Voice** — provider chosen against the three constraints (§3 below),
   and the transcript is the message body.

---

## 3. Decisions I made on my own judgement

Ordered by what they would cost to reverse.

1. **Embedding width is 1024, and rows record which embedder made
   them.** The genuinely annoying one: changing it means re-embedding
   every memory. 1024 is the common current width and the dev
   embedder's, so dev and production agree on shape.
2. **pgvector is now required**, reversing last night's `real[]`. It
   was unavailable then and is installed now, and you asked for
   semantic retrieval. `CREATE EXTENSION` is a one-time superuser
   deployment step; the migration is a no-op afterwards. This narrows
   the self-hosting story to boxes that can install it.
3. **Retrieval ranking is 0.7 similarity / 0.3 salience.** A weighting,
   not a law. Tunable, and the place to tune it is one line.
4. **Habits stay inside the tasks capability** with their own tag. A
   habit is a task with a recurrence; a second capability would mean
   two things writing one table. The tag is separate because a single
   tag with a boolean gets the boolean forgotten.
5. **The speech provider is OpenAI speech**, chosen against your three
   constraints: reachable from a datacenter, returns bytes rather than
   a hosted URL (so `persist:false` stays enforceable), billed per
   character and per second. Azure Speech is the documented alternative
   if Egyptian-dialect voice quality becomes binding — it has named
   ar-EG neural voices. This is the *speech* provider only.
6. **The duplicate-memory threshold is 0.94 cosine.** Deliberately
   strict: a false merge loses a memory silently, a false negative
   shows up as a repetition.
7. **The summary rolls at 20 messages** beyond the window, capped at
   200 words, cut at a sentence.
8. **At most one assistant-initiated reach-out pending at a time.** Not
   a rate limit — the plan has one of those. A composition limit: three
   good candidates on one day is how "reaches out thoughtfully" becomes
   "pesters".
9. **Affect is a bilingual lexicon, not a model call.** It will be wrong
   about sarcasm and about "fine". What makes that acceptable is that
   nothing depends on it being right — it changes the warmth of a
   phrase and the chroma of a palette. Nothing else reads the lexicon,
   so a real classifier replaces it in one file.
10. **A failed embedding still stores the memory**, unsearchable, and
    `needingEmbedding()` makes that state queryable. She should be less
    precise, never forgetful.
11. **An empty transcript is a failure, not an empty message.**
12. **A dead stream mid-tag emits none of the partial tag** (carried
    from last night, restated because it now interacts with capture
    failure copy).
13. **Voice is metered in two counters**, characters and seconds: they
    are billed separately and fail separately.
14. **The dev embedder is deterministic and not semantic**, and says so
    in the `embedding_model` of every row it writes.

---

## 4. What is stubbed, and what does not exist

**Stubbed:**

- **Prompt caching is not implemented.** See §0 — the free-tier
  arithmetic assumes it.
- **No real embedder is configured.** `httpEmbedder` is written and
  untested against a live service; the deterministic one is what runs.
  Until a real one is configured, "semantic" retrieval is lexical.
- **The speech provider is untested against the live API.** No key was
  available. Treat the first call as unverified.
- **Push delivery still does not exist.** `JobDeps.deliver` is nullable
  and null: the proactive turn runs, the message is stored, nothing is
  pushed. This is the last thing standing between the code and the
  product's defining behaviour.
- **No scheduler is running.** `/api/tick` has no HTTP route because
  there is no HTTP layer.
- **Dream and diary prompts are the generic reflection directive.**
  They work; they have not been written as distinct voices.
- **`tokens:tap` still passes vacuously** — no UI.
- **Attachments are a table.** No upload, no storage backend, no
  receipt OCR.

**Deliberately absent:** every screen; export file-building (the slices
exist, the archive does not); subscription and payments; search.

**Never built, per your instruction:** no hidden mode, no admin data
path, nothing resembling either.

---

## 5. What will block me next

1. **Prompt caching.** Cheapest large win available, and the free-tier
   number in `plan.ts` is currently a promise about it.
2. **Push, and therefore the HTTP layer.** "She texts you first" is the
   product, and it is the one claim the code cannot yet make. Web Push
   on iOS requires an installed PWA, which makes the add-to-home-screen
   prompt load-bearing rather than a nicety — worth knowing before the
   onboarding screens are designed.
3. **An embedder decision**, because it fixes the vector width.
4. **Arabic needs a native pass.** Two personas and 53 catalogue
   strings are mine. The gate proves no string assumes the user's
   gender; it cannot prove the register is right. While authoring the
   stage prose it flagged «أفتح» — first person, not an imperative,
   differing by one hamza that every naive normaliser deletes. I fixed
   the checker, but that is the class of thing a native reader catches
   and a denylist does not.
5. **Male-voice Arabic** is still mostly the feminine string returned
   unchanged where no `arMale` is authored — safe, but a male assistant
   currently speaks some feminine Arabic.
6. **The health observation is arithmetic over two rules.** It will
   feel thin the first week someone uses it. Widening it is easy;
   widening it *without* inventing observations is the part to be
   careful about.

---

## 6. Where to look

```sh
npm run verify                 # typecheck, 11 gates, 237 tests
npm run gate:lessons           # the map of lesson → test (52 files)
npm run gate:analysis          # the non-voice path's two conditions
npm run gate:tokens:contrast   # all 175 cells, printed
```

Read in this order: `packages/prompt/src/assemble.ts`,
`packages/analysis/src/prompts.ts` (the two paths, and why they are
two), `packages/runtime/src/memory.ts` (where extraction meets the
capacity rules), then
`packages/db/src/repositories/lessons.test.ts` — the lessons
executable against a real database, and still the shortest way to see
what this codebase promises.
