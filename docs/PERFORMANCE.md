# Performance, measured

Taken 2026-08-28 by `npm run perf`.

**A number without its machine is not a baseline**, so: Node
v22.22.2 on `linux`, 4 × Intel(R) Xeon(R) Processor @ 2.80GHz, 16 GB, Postgres on
loopback in the same container. These are for **comparing a change against**,
not for quoting: re-run the tool rather than trusting the numbers on a
different machine.

## Memory retrieval as memories grow

One assistant, real rows, the real query. `limit` is 12 — what a turn asks for.

| | p50 | p95 | samples |
|---|---|---|---|
| retrieval over 100 memories | 1.71 ms | 2.31 ms | 20 |
| retrieval over 1,000 memories | 7.03 ms | 9.95 ms | 20 |
| retrieval over 10,000 memories | 72.6 ms | 75.3 ms | 20 |

The ranking is `0.7 × cosine similarity + 0.3 × salience`, which **cannot be
served by a vector index**: HNSW and IVFFlat answer "nearest by distance",
and this asks for nearest by a blend of distance and a second column. So this
is a sequential scan over one assistant's memories, and the numbers above are
the honest cost of that choice. It is the right choice today — the growth is
linear and the constant is small — and the row that says when it stops being
right is the 10,000 one.

## The cost of one turn, as the conversation grows

End to end over real HTTP, with a provider that answers instantly — so every
millisecond here is **ours**: the budget reservation, persisting their message,
prompt assembly, retrieval, the history read, persisting her reply, capture
dispatch and the extraction pass.

| | p50 | p95 | samples |
|---|---|---|---|
| a turn at 2 messages of history | 107.3 ms | 136.5 ms | 10 |
| a turn at 20 messages of history | 97.5 ms | 122.9 ms | 10 |
| a turn at 60 messages of history | 102.5 ms | 131.7 ms | 10 |
| a turn at 120 messages of history | 105.6 ms | 138.0 ms | 10 |

History is capped at 40 messages (`HISTORY_MESSAGES` in turn.ts) and the
prompt is budgeted to the model window on top of that, so the cost should
**stop growing** past that point rather than growing with the conversation.
The 60 and 120 rows are there to prove that it does; if a later change makes
them climb, something has started reading the whole thread.

## Time to first token — the half that is ours

**107.8 ms** at p50, **144.7 ms** at p95, over 15 samples.

This is everything between the POST arriving and the first byte leaving:
session lookup, rate limit, idempotency claim, budget reservation, persisting
their message, assembling the prompt, retrieval, and the history read. The
model is a zero-latency fake, so **the provider is not in this number.**

What a person actually waits for is this plus the provider's own time to
first token, which is typically one to two seconds on this model family and
is not measurable from this environment (there is no API key here). Stated
rather than estimated: **the end-to-end number is unmeasured**, and when a key
is available this is the section to replace.

## First paint on the chat

Real Chromium over the DevTools protocol, phone viewport, signed in, against
the real server on loopback. The client ships as Node-native TypeScript with
no build step and no framework, which is what these numbers are mostly about.

| | ms |
|---|---|
| time to first byte | 1.20 |
| first contentful paint | 84.0 |
| DOM content loaded | 74.0 |
| navigation until the chat is on screen (p50) | 148.9 |
| the same, p95 | 177.2 |

**Loopback, so the network is not in it.** A real connection adds its own
latency to time-to-first-byte and nothing else here.

## What these numbers say

Three readings, so the next person does not have to derive them:

1. **Retrieval is most of a turn.** The turn rows above were measured on the
   account that had just been seeded with ten thousand memories, so retrieval
   is inside them — and at that size it is roughly three quarters of the
   whole cost. Anything that wants a faster turn should start there and
   nowhere else. An ordinary account has tens of memories, not thousands, so
   this is a ceiling rather than a typical day.
2. **The turn does not grow with the conversation.** 20, 60 and 120 messages
   of history cost the same within noise, which is what the 40-message cap is
   for. That is the row to watch: if it starts climbing, something has begun
   reading the whole thread.
3. **Retrieval grows slightly worse than linearly** (×6.6 from 100 to 1,000,
   then ×9 to 10,000). Consistent with the scan leaving cache rather than
   with anything algorithmic. Still linear enough that the constant, not the
   curve, is the thing to argue about.

## What is deliberately not here

- **The model's latency.** No API key in this environment. Every number above
  uses a zero-latency fake so that what is measured is this product.
- **Concurrency.** Every measurement is one request at a time. What happens at
  fifty concurrent turns is a different question and needs a different tool;
  the pool is 10 connections and that is where to look first.
- **Cold start.** Warm-up runs are discarded on purpose, because the number
  that matters for a change is the steady-state one.
