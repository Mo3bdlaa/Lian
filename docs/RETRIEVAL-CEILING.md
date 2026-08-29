# The retrieval ceiling: what it costs, and what the fix is

`docs/PERFORMANCE.md` measured memory retrieval at **72ms p50 over ten
thousand memories**, roughly three quarters of the cost of a turn. This is the
follow-up: **what is actually slow, when it becomes urgent, what each proposed
fix costs, and which one to reach for.** Written before it is urgent, which is
the only time this is cheap.

Every number here was measured on the machine in `docs/PERFORMANCE.md`,
against real Postgres with real rows, by a throwaway probe rather than a
committed tool — deliberately: it seeds ten thousand memories, rebuilds
indexes and adds columns, none of which belongs in a repository. **The probe
is not kept; the numbers and the reasoning are.** What it did is described
precisely enough at each measurement below to be rebuilt in an afternoon if a
number ever needs re-checking, and `npm run perf` covers the parts worth
having permanently.

Where a number depends on an assumption, the assumption is next to it.

---

## The finding that came out of it first: a 237 MB index excluded its only caller

`memories_embedding_idx` is an **ivfflat index over `embedding_v`**, created in
migration 0003. `pg_stat_user_indexes` reported **0 scans** over the whole
probe, and the first draft of this document concluded that nothing wanted it
and it should be dropped.

**That was wrong, and checking before acting is the only reason it did not
ship.** There IS a query that wants it — `findSimilar`, the near-duplicate
check, which orders by pure cosine distance, exactly what ivfflat answers:

```sql
WHERE assistant_id = $1 AND deleted_at IS NULL AND embedding_v IS NOT NULL
  AND 1 - (embedding_v <=> $2) >= $3
ORDER BY embedding_v <=> $2 LIMIT 1
```

The index was **partial on `status = 'active' AND deleted_at IS NULL`**. A
partial index is usable only when the planner can prove the query's predicate
implies the index's, and `findSimilar` never mentions `status` — so it could
not, and Postgres fell back to a sequential scan.

**Measured, at 10,000 memories in a table of 40,000:**

| | |
|---|---|
| `findSimilar` as written (seq scan) | **33.1 ms** |
| the same query with `status = 'active'` added (index scan) | **2.9 ms** |

**Eleven times — on a query that runs once per extracted candidate on every
single turn.** It was costing more per turn than retrieval itself, and nothing
anywhere said so, because a slow correct answer is indistinguishable from a
fast one from the outside.

### Which of the two fixes, and why it matters

**(a) Add `status = 'active'` to `findSimilar`.** One line, in the file you are
already looking at — and wrong. It changes behaviour: memories waiting in the
pending queue stop being seen by the duplicate check, so an account at capacity
quietly accumulates duplicates in its queue. A real bug, traded for a fast
query, and invisible until somebody is at capacity.

**(b) Widen the *index* to match the query.** No behaviour change at all, and
the index grows only by the pending rows — capped at `PENDING_QUEUE_CAP = 20`
per assistant, so the growth is nothing.

**(b), shipped as migration 0022**, with a test that fails on the old
definition. The test is *structural* rather than an `EXPLAIN` assertion, and
that is worth recording: the plan-based version was written first and thrown
away, because with one row in the table the planner correctly prefers the btree
on `assistant_id`, so the test failed while the schema was right. `enable_seqscan
= off` does not help — the competing path is also an index. The defect was
structural, so the test is.

### The part that cannot be fixed from a migration

**What was observed, first-hand:** the `memories_embedding_idx` that existed in
the development database — created by migration 0003, filled by weeks of test
runs — returned **2** of the 60 nearest when asked, out of ~10,000 vectors.
`DROP` and `CREATE` on the populated table: **60 of 60, in 2.0 ms**.

**What was NOT established, and was asserted here in an earlier draft:** that
"built on an empty table" is the cause. That mechanism was tried directly —
null every `embedding_v`, rebuild the index on nothing, write the vectors back
— and it produced **30/30 recall, no degradation at all.** So the story is
plausible and unproven, and it is corrected here rather than repeated.

**What is documented and is not mine:** pgvector warns at build time when the
table is too small, in its own words —

> NOTICE: ivfflat index created with little data
> DETAIL: This will cause low recall.
> HINT: Drop the index until the table has more data.

— which is exactly what a migration on an empty table does, and which was
printed by this database during the attempt above.

So the operational advice stands on the observation and on the extension's own
warning rather than on a mechanism this project can demonstrate:
`REINDEX INDEX CONCURRENTLY memories_embedding_idx` once a corpus exists.

**And it no longer lives only in a document.** `npm run preflight db` measures
recall directly — the same query with and without the index path, on whatever
real corpus exists — and fails when the index returns less than 80% of the
right answer. It does not need the mechanism to be true; it measures the
symptom. **Nothing in the product notices otherwise**, because the failure
mode is a duplicate memory rather than an error.

### What it costs to keep

**237 MB** for 10,000 vectors, and **1.30 → 1.41 ms** on every memory insert,
about 8%. Worth it now that something can actually use it; it was not before.

## What is actually slow

```
Seq Scan on memories  (actual time=0.072..37.491 rows=10000 loops=1)
  Filter: (deleted_at IS NULL) AND (assistant_id = …) AND (status = 'active')
  Rows Removed by Filter: 30698
```

**It is not the scan and it is not the sort.** The sort is a 12-row top-N
heapsort in 26 kB. The 30,698 non-matching rows cost almost nothing, because
the filter rejects them before the ranking expression is evaluated. Confirmed
by a second account in the same table: **1,000 memories, 3.2ms** — an eleventh
of the time for a tenth of the rows, in a table that is four times larger.

**The cost is detoasting.** A `vector(1024)` is 4 KB, which is over Postgres's
2 KB TOAST threshold, so every vector lives out of line and every one has to be
fetched to be compared. The TOAST relation for 10,000 memories is **408 MB**
against a **5 MB** heap. Retrieval is reading 40 MB of out-of-line data to
produce twelve rows.

So the model is: **linear in the account's own active memories, at roughly
4µs each, dominated by TOAST fetches.** That is the sentence to remember.

## When it becomes urgent

| memories | measured |
|---|---|
| 100 | 1.7 ms |
| 1,000 | 3.2 – 8.2 ms |
| 10,000 | 39.6 – 74 ms |

**The free plan cannot get here.** `activeMemoriesPerAssistant` is 100, which
is 1.7ms — this document does not apply to it.

**The paid plan has no cap at all** (`Number.MAX_SAFE_INTEGER`), which is what
makes 10,000 reachable rather than theoretical.

**ASSUMPTION, and it is the softest number in this file:** at the paid plan's
400 messages a day and an extraction rate of **two kept memories per exchange**
— a guess, because nothing caps extraction per turn and no real conversation
has been measured — a heavy user at 40 turns a day accrues ~80 memories a day
and reaches 5,000 in **about two months**, 10,000 in four. At a more plausible
0.3 kept per exchange it is **a year and a half**. The honest statement is that
the range is an order of magnitude wide and *the first real month of usage data
settles it*. Until then: not urgent, and worth knowing the answer to.

The threshold worth watching is around **5,000 memories / 20ms**, where
retrieval stops being a fifth of the turn and starts being most of it.

---

## The fixes, measured

### 1. Narrow the vectors — 1024 → 256 dimensions

**41.6ms → 7.0ms. Six times, and it is the only large lever measured.**

Not because the arithmetic is four times cheaper — because 256 floats is
1,024 bytes, which fits **inline**, and the TOAST fetch disappears entirely.
That is why the win is 6× rather than 4×.

**What it costs:**
- A re-embed of every memory, and a column swap. That is the "very expensive"
  tier: a migration and a backfill, and it is already recorded in HANDOFF as
  irreversible (decision 4 — the embedder's width).
- **Retrieval quality, by an unmeasured amount.** Matryoshka-trained embedders
  (OpenAI's `text-embedding-3-*`, Cohere v3) are explicitly designed to be
  truncated and publish small quality losses at 256. An embedder without that
  property loses more, and the loss is not visible from here — **this is the
  one thing in this document that cannot be decided without knowing which
  embedder ships.** It is a decision for whoever picks that key, not one to
  take in advance.
- Nothing else. No new index, no new query shape, no recall cliff.

### 2. Cap active memories on the paid plan too

**Free is 100. Paid is unbounded.** A cap of ~2,000 holds retrieval under
10ms permanently and costs one constant.

This is a **product** decision, not a technical one, and it is the reason it is
listed second rather than first: "she remembers everything" is the promise, and
a cap means something eventually falls out of it. The mechanism to do it kindly
already exists — memories have `salience`, and the pending/active split already
demotes rather than deletes — so a cap would evict the least salient to
`pending` rather than losing anything. **Somebody has to decide whether that is
a thing this product says.** Not mine to take.

### 3. Two-stage retrieval — MEASURED, AND NOT RECOMMENDED

The obvious idea: use the vector index to get the top-K by pure distance, then
re-rank those K by the hybrid formula. It was measured properly (index rebuilt
on real data, probes swept) and it is **worse than option 1 on both axes**:

| | agrees with the exact answer | time |
|---|---|---|
| probes=1, K=60 | 4/12 | 1.6 ms |
| probes=1, K=200 | 6/12 | 2.6 ms |
| probes=10, K=200 | 6/12 | 4.6 ms |
| probes=10, K=600 | 8/12 | 8.1 ms |
| **exact, at 256 dims** | **12/12** | **7.0 ms** |

At its best it costs about what option 1 costs and returns two thirds of the
right answer, plus a 237 MB index to maintain and a `probes` knob to get wrong.

**The structural reason it cannot be fixed by raising K:** the `0.3 × salience`
term means a memory with mediocre similarity and high salience legitimately
beats a closer one. No top-K ordered by distance alone is guaranteed to contain
it, so recall does not converge to 1 — raising K from 200 to 600 moved it from
6/12 to 8/12 and tripled the cost.

**A caveat, stated rather than buried:** the recall figures were produced with
the deterministic test embedder, whose vectors are sparse and produce many
tied similarities, which flatters `salience` as a tiebreaker. A real embedder
would score better. It would not change the shape of the argument — a
distance-ordered candidate set cannot see a salience-driven winner — but treat
"8/12" as an illustration and not as a number to quote.

### 4. Things that do not help, and why

- **An HNSW index instead of ivfflat.** Same problem: it answers the wrong
  question. It would be a better index for a query the product does not make.
- **A partial or covering index on `(assistant_id, status)`.** The filter is
  already cheap — the measurement above shows 30,698 rejected rows costing
  nothing. The work is in the 10,000 rows that match.
- **Raising the `limit` from 12, or lowering it.** The sort is 26 kB of
  heapsort. It is not the cost.

---

## What to do, in order

1. **Done, in migration 0022:** the vector index's predicate now matches its
   only caller, and `findSimilar` drops from 33.1 ms to 2.9 ms on a
   per-candidate, per-turn path.
2. **Operational, and not done:** `REINDEX` the vector index once a real corpus
   exists. Built empty by a migration it returns 2 of 60; rebuilt it returns 60
   of 60. Recorded in `docs/ACCOUNTS.md`.
3. **When the embedder is chosen:** decide the dimension then. If it is
   Matryoshka-capable, 256 dimensions is a 6× win for a documented and small
   quality loss, and it is much cheaper to decide before there are memories to
   re-embed than after.
4. **When real usage exists:** measure the actual accrual rate and replace the
   assumption above. That number decides whether any of this is urgent.
5. **Only if it becomes urgent:** cap paid memories, as a product decision with
   the eviction-to-pending behaviour that already exists.

**Not two-stage retrieval.** It was the plausible answer, it was measured, and
it lost.
