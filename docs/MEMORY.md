# The memory budget

Measured 2026-08-30 by `npm run memory`, on Node v22.22.2,
4 × Intel(R) Xeon(R) Processor @ 2.10GHz, 16 GB.
**Not the target box** — an Ampere A1 is a different machine and these are
for comparing against, not for quoting. Re-run it there.

## Under concurrent streams

Every request is a real turn over real HTTP against a real database, with a
provider that streams over about a second — because a zero-latency fake is
never concurrent with anything and would measure one turn however many were
asked for. Three rounds at each level, peak sampled every 20ms.

| concurrent streams | peak RSS | peak heap | per extra stream | wall clock |
|---|---|---|---|---|
| 1 | 146.8 MB | 33.9 MB | — | 3.4 s |
| 10 | 153.2 MB | 37.3 MB | 0.7 MB | 3.5 s |
| 25 | 159.3 MB | 40.6 MB | 0.5 MB | 3.7 s |
| 50 | 168.8 MB | 46.6 MB | 0.4 MB | 4.0 s |

## What the box holds

**Memory is not the constraint, and printing a headline number of concurrent
streams would invite exactly the wrong conclusion.** The measured marginal
cost is under a megabyte per stream, so a linear extrapolation gives a
figure in the tens of thousands — and long before that, something else binds.

**What binds first is the database pool.** `max: 10` in
`packages/db/src/client.ts`. A turn takes a connection several times —
reserving the budget, persisting the message, assembling the prompt,
retrieving, persisting the reply — so concurrency is bounded by how long
each of those holds a connection, not by heap. At 50 concurrent streams
the wall clock in the table above barely moves, which says the pool was
not saturating at that level; it is the number to watch as load grows,
and the reason not to simply raise it is that Neon's free tier has its own
connection ceiling.

The arithmetic, for completeness rather than as a promise:

- 25,178 streams, if memory were the only limit. It is not.
- **10 GB usable** of the 12 GB Ampere A1. The OS, the ticker process and an
  ssh session need the rest, and a box with nothing spare is one you cannot
  log into when it is in trouble.
- **168.8 MB at 50 concurrent** is the measured base, and the marginal
  cost per additional stream above that is what the last column reports.
- **Linear extrapolation**, which is the weakest step here: it holds while
  the cost per stream is dominated by the prompt and the response buffer,
  and stops holding when something else binds first. On this stack the thing
  that binds first is almost certainly **the database pool** — `max: 10`
  connections in `packages/db/src/client.ts` — not memory. A hundred
  concurrent turns queue on connections long before they run out of heap.

**So the honest headline is that memory is not the constraint.** The pool is.
Raising it is one number, and the reason not to raise it blindly is that
Neon's free tier has its own connection ceiling.

## The heap, set deliberately

`NODE_OPTIONS=--max-old-space-size=1024` in the Dockerfile.

Node's default old-space is derived from the machine — about a quarter of
physical memory on a large box, most of it on a small one. Neither is a
number anybody chose. **1024 MB is roughly ten times the measured peak at 50
concurrent streams**, which leaves room for a burst while still being a
ceiling V8 will GC against rather than one the kernel enforces by killing
the process. An OOM kill loses every open stream; a GC pause loses nobody.
