# Deploying Lian

Two processes and a database. Nothing is built, bundled or transpiled:
Node 22 runs the TypeScript directly, so what runs in production is the
file you read.

```
   [ browser ] ──https──▶ [ server: node apps/server/src/main.ts ]
                                     │
                                     ├──▶ Postgres 16 + pgvector
                                     │
   [ ticker: node apps/server/src/ticker.ts ] ──signed POST /api/tick
```

## Locally, in one command

```sh
cp .env.example .env      # DATABASE_URL and LIAN_TICK_SECRET are enough
npm install
npm run up                # migrates, starts the server AND the ticker
```

`npm run up` runs both processes because a local setup without the ticker
looks like a chat app: the schedule — reminders, the morning briefing,
dreams, the diary, her reaching out first — is most of the product.

With Docker instead, and no Node or Postgres on the machine:

```sh
docker compose up
```

Either way she will run without a model key; she just cannot answer.
Every missing value is printed at boot as a `degraded:` line saying what
stops working. Nothing falls back silently.

## The environment

`.env.example` is the contract, `apps/server/src/config.ts` enforces it,
and `apps/server/src/config.test.ts` is the contract as tests. Two rules:

- **Every problem is reported at once.** A boot that fails on the first
  missing variable makes fixing five of them five deploys.
- **Required means required in production.** In development the same
  value degrades and says so.

Required in production: `DATABASE_URL`, `ANTHROPIC_API_KEY`,
`LIAN_TICK_SECRET`, the `LIAN_VAPID_*` pair, `LIAN_EMBEDDER_MODEL` and
`LIAN_EMBEDDER_API_KEY`, and an https `LIAN_PUBLIC_URL`.

`LIAN_LOG_CONFIRMATION_LINKS` is refused in production. It prints a link
that grants a session; in development that is a convenience, in
production it is a second way in.

## The database

Postgres 16 with pgvector 0.6.0 (migration 0003 creates a 1024-dimension
`vector` column and an ivfflat index). Migrations run at boot and are
idempotent, so a rolling deploy of several instances is safe.

The embedder's width must match that column. Changing the embedding model
to one of a different width is a backfill, not a config change —
`packages/analysis/src/embedder-config.ts` says which models fit.

## The ticker

The schedule is driven from outside the web process (Q16). Two reasons,
both learned rather than chosen: a serverless host has no long-lived
process to run a loop in, and Vercel Hobby cron runs roughly twice a day,
which is not a reminder system.

The ticker signs each call with an HMAC over `timestamp.body` and the
server refuses anything unsigned, mis-signed, or older than the replay
window. Any scheduler that can make a signed POST works — a container, a
systemd timer, a Kubernetes CronJob, GitHub Actions.

Every job behind the tick is idempotent (dedupe keys, unique indexes), so
the interval is a cost decision rather than a correctness one. Five
minutes is the default. **The interval bounds reminder accuracy**: a
reminder set for 14:15 arrives at the first tick after 14:15.

## What a deployment needs to survive

- **Graceful shutdown.** SIGTERM closes the socket first, then the pool,
  so an in-flight turn is not charged for a message nobody received. Give
  the container at least 15 seconds to stop.
- **One writable database.** Rate limits and idempotency live in it
  (LESSONS §12), so several instances share one limit rather than one
  each.
- **`design-system/` on disk.** The manifest and `theme-color` read the
  brand colour from `design-system/lian-tokens.css` at boot, so the
  colour is defined in one place. The Dockerfile copies it.

## What is NOT wired yet

- **Email.** There is no transport, so a device confirmation cannot be
  emailed. The sign-in stays held — the safe direction — and she raises
  it in chat instead (UI-UX §16). Wire `sendEmail` in
  `apps/server/src/app.ts` to change that.
- **Object storage.** Attachments have no bucket. Deletion reports the
  count of files that would have to go rather than zero, so the gap is
  visible instead of looking like success.
- **Screens.** The PWA shell serves a manifest, a service worker that
  draws a push notification, and `/push.js`. Everything else is API.
