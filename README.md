# Lian

An AI personal assistant with persistent memory, a mood, a stable
identity, and a relationship that deepens over hundreds of exchanges.
She reaches out first, without the app being opened. Everything —
tasks, notes, money, meals, workouts — is captured from ordinary
conversation or a photographed receipt, never from a form.

## Read first

**[`LESSONS.md`](LESSONS.md)** — constraints carried from the
prototype. Each one is a failure that was found in a running product
and paid for once. Read it at the start of every session.

Every lesson has a test or a gate, not a comment.
`npm run gate:lessons` prints the map and fails if a lesson loses its
cover.

## Running it

Requires Node 22.6+ (TypeScript runs directly — there is no build
step) and Postgres 16.

```sh
npm install
cp .env.example .env          # set DATABASE_URL at least
npm run db:migrate
npm run verify                # typecheck + every gate + every test
```

## Layout

```
LESSONS.md                the constraints
HANDOFF.md                what is built, what is stubbed, what is next
docs/specs/               the product and design specification
design-system/            the token layer and the built screen set
packages/
  domain/                 pure rules — plans, stages, moods, capability contract
  design/                 theme resolution and the type role tier
  i18n/                   bilingual copy and the Arabic address rule
  db/                     schema, migrations, repositories (the only SQL)
  prompt/                 the one path that builds the system prompt
  llm/                    providers, key pool, control-tag stream, budgeter
  capabilities/           the registry, plus tasks and money
  auth/                   passwords, sessions, the new-device hold
  voice/                  the single TTS write path
  runtime/                the turn — chat and proactive, one function
  jobs/                   the tick behind an HMAC-signed endpoint
tools/gates/              ten CI gates, one per constraint
```

## The gates

| Gate | Enforces |
|---|---|
| `boundaries` | the dependency graph; capabilities cannot import the prompt (§13); persona text lives in one place (§1) |
| `db:scoping` | every scoped query filters on its scope column (§11) |
| `tokens:audit` | every `var(--x)` resolves (§9) |
| `tokens:raw` | no raw hex, radius, size, weight or duration in app code (§9) |
| `tokens:contrast` | 175 contrast cells computed from the CSS; a missing cell fails (§9) |
| `tokens:tap` | the 44px touch-target floor |
| `theme:single-writer` | the runtime writes one attribute and never a colour (§7) |
| `voice:cache` | one write path for audio (§8) |
| `arabic:address` | no Arabic string assumes the user's gender (§10) |
| `lessons:index` | every lesson still has a test |

## Precedence

1. `docs/specs/` wins on behaviour, copy and scope.
2. `design-system/` wins on visual implementation.
3. `LESSONS.md` overrides both on anything it covers.
