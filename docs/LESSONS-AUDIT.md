# LESSONS, re-read against the code

`LESSONS.md` was written from one prototype and has now had a fortnight of a
second. This is every entry checked against what is actually in the tree:
whether it is still true, what enforces it, and — where nothing does — what a
gate would cost and whether it is worth building.

**None are stale.** That is the first finding and it surprised me: twenty-five
entries written against a codebase that has been rewritten around them, and
every rule still describes this build. Two have *widened* (§17 and §23 each
found a second instance this fortnight), and none has been outgrown.

## The table

`GATE` means a CI check fails the build. `tests` means the rule is asserted but
a new violation elsewhere would not be caught. `meta` means the entry is about
the checking machinery itself.

| § | Rule | Enforced by | Still true? |
|---|---|---|---|
| 1 | One path builds the system prompt | **GATE** `boundaries`, `analysis-path` | yes |
| 1a | Channels are trust boundaries | tests (`injection.test.ts`, `zones.ts`) | yes |
| 2 | The scenario states that it overrides | tests | yes |
| 3 | Control tags never reach the client | tests (`tagstream`, `turn`) | yes |
| 4 | Proactive backoff; who wanted it | tests (`candidates`, `tick`) | yes |
| 5 | Canon is never dropped | tests (`memory`, `ownership`) | yes |
| 6 | Which stage, never how far through | tests (`relationship`, `lessons`) | yes |
| 7 | Theme is computed in one place | **GATE** `theme-single-writer` | yes |
| 8 | Voice is cached, one write path | **GATE** `voice-cache` | yes |
| 9 | Design tokens | **GATE** ×4 `tokens-*` | yes |
| 10 | Arabic is authored, not translated | **GATE** `arabic-address` | yes |
| 11 | Data ownership; deletion is real | **GATE** `boundaries`, `db-scoping` + tests | yes |
| 12 | Rate limiting is a row, not memory | prose + `usage` tests | yes |
| 13 | Capabilities, not features | **GATE** `boundaries` | yes |
| 14 | Scope discipline | **GATE** `lessons-index` | meta |
| 15 | A gate is not a gate until it has failed | **GATE** 30 meta-tests | meta |
| 16 | Filter before the limit, not after | **GATE** `db-paging` | yes |
| 17 | A scope column is not a permission check | tests only | **yes, and it recurred** |
| 18 | A confirmation nobody earned | tests | yes |
| 19 | A conditional upsert bounds one branch | tests | yes |
| 20 | Five of six parts looks finished | **GATE** `wired` | yes |
| 21 | She can promise what nothing performs | **GATE** `promises` | yes |
| 22 | Two places that format will disagree | **GATE** `formatting` | yes |
| 23 | A gate is only as wide as its spelling | half a **GATE** + a meta-test | **yes, and it recurred** |
| 24 | A word in the markup is not the behaviour | tests (browser, real keys) | yes |
| 25 | A setting read is not a setting connected | tests (`http`, behavioural) | yes |

**Fourteen of twenty-five have a gate.** The eleven that do not are mostly
behavioural rules about what the product *says* and *when*, which is the right
shape for prose plus tests — a gate for "she does not escalate" would be a
pattern match on intent.

## The two that recurred, and what that means

**§17 recurred this fortnight.** `beginUpload` took a `conversationId` from the
request body, looked it up scoped — correctly — and then wrote the client's
value onto the row regardless of what the lookup returned. The scope column
proved who was asking; nothing proved what they were asking about. Second
instance of the exact rule. **This is the strongest case in the file for a
gate, and one is proposed below.**

**§23 recurred too**, which is almost funny: the lesson about a check being
only as wide as the spelling it was written for was itself written too narrow,
and the boundaries gate then read a *regex marker* containing SQL as SQL —
three separate times. The general form is now §26.

## What this build learned that is not in LESSONS yet

Three, and the first is the one you named.

### §26 — a check that matches on its own subject matter will find itself

The failure looks like the thing working, which is why it survives.

- `until ! pgrep -f "ci-test.ts"; do sleep; done` **can never terminate**: the
  waiting shell's own command line contains the string it greps for, so it
  matches itself and waits forever. Four watchers spun for the rest of a
  session on that, each looking exactly like a test suite that had not
  finished.
- The **boundaries gate read its own marker as SQL**. `tools/gates/promises.ts`
  requires every commitment to name a pattern proving its mechanism exists,
  and for a delete the strongest such pattern is the delete itself —
  `/UPDATE memories SET deleted_at = now\(\)/`. The gate that forbids SQL
  outside `@lian/db` found that regex, in a file with no database access, and
  objected. Three times. Twice the fix was to *weaken the marker*, trading a
  real guarantee for a green gate.
- The same shape, differently: `pgrep -c -f "node --test"` returns 1 when
  nothing is running, because the `pgrep` is itself a process whose command
  line contains `node --test`.

The fixes are all one idea: **exclude the checker from the checked set,
explicitly**. `pgrep -f "[c]i-test.ts"` (the bracket makes the pattern not
match its own text), and the boundaries gate now strips regex literals before
searching for SQL. Both are one line and neither is discoverable from the
failure, because the failure is silence.

### §27 — a fixture that disagrees with the product produces findings about the fixture

Three times this fortnight the harness misreported the product, and each one
looked exactly like a real defect:

- **The clock.** `createApplication` takes an injectable `now`; Postgres does
  not. A session that travelled to September wrote rows stamped with the real
  date, so `assistantsActiveOn` found nobody and proposed no outreach — which
  reads as "I'll remind you" being false, the most alarming thing this project
  could find. It was the harness.
- **The local-day window.** The briefing is read midnight-to-midnight *where
  they are*; in Dubai that is `[yesterday 20:00Z, today 20:00Z]`. Running the
  session after 20:00 UTC put every row outside it, and I wrote "the briefing
  has nothing of her in it" into FIRST-IMPRESSIONS as a product observation.
- **The seeded user agent.** The shots seed wrote `user_agent 'Mozilla/5.0'`
  beside a `label` column nothing read, so the Security screenshot rendered
  "Device" — carried in HANDOFF for two runs as a product gap. The parse had
  always worked.

The rule: **when a harness reports something alarming, check the harness
first** — and where the harness can detect its own confusion, make it say so.
`tools/session.ts` now announces that a briefing message exists while the
screen shows none is *its* fault, not the product's.

### §28 — a test that leaves state makes the suite history-dependent

The `auth:ip:` rate limit is a database row keyed on the client address
(§12, correctly). Tests used fixed addresses, so buckets accumulated across
runs: **green in CI, where the database is new, and red on the machine of
whoever is actually working.** A `/24` with a counter was not enough either —
hundreds of sign-ups collide by birthday. Addresses are now unique per call
*and* per process.

Its corollary cost more than the cause: **one failing assertion hung the whole
suite** for ten minutes, because a server was closed on the test's last line
and a failure skipped it. A hang tells you nothing; a red run at least tells
you something. Servers are closed in `after` now.

## Where a prose-only rule could become a gate

Only two are worth building. The rest are cheaper as prose, and saying why is
the point of the exercise.

### Worth it: §17, a scope-pairing gate — **BUILDING**

**The rule a gate can check:** a repository function that takes a scope *and*
an entity id must constrain both in its SQL. `WHERE user_id = $1 AND id = $2`
passes; `WHERE id = $2` with `$1` unused, or a second id checked against
nothing, fails.

**Cost:** medium. It needs to find the SQL in a function, extract the
parameters, and check that the scope parameter appears in a `WHERE`. That is a
regex over template literals, not a SQL parser, and it will need an allowlist
for genuinely unscoped batch queries — which already exists as the
`db-scoping:allow-unscoped` marker.

**Worth it because the rule has produced two real holes in two months**, and
because the failure mode is invisible: the code reads correctly, every test
passes, and the hole is only found by attacking it with a second account.

### Worth it: §25, a dead-setting gate — **BUILDING**

**The rule:** every field on `Config` is read somewhere other than
`config.ts`. `trustedProxies` had an env var, a parser, a test, documentation
and a `ServerOptions` field, and `app.ts` never passed it — the whole feature
was inert while everything about it was true.

**Cost:** low. One grep per config field over `apps/` and `packages/`. No
allowlist needed today.

**Worth it** because it is cheap, it generalises (every future setting gets it
free), and the failure is silent by construction.

### Not worth it: §3, tag parsing outside the parser

A gate could forbid tag-shaped regexes outside `tagstream.ts`. Cost is low —
but there is exactly one such file and the boundaries gate already stops other
packages importing into it. The tests are specific and strong (every single
split point of a streamed tag). A gate here would catch a mistake nobody is
positioned to make.

### Not worth it: §12, in-process counters

A gate could flag a `Map` used as a counter near the word "limit". The false
positive rate would be high — caches, dedupe sets and memo tables all look
like that — and the true positive is one thing that has already been fixed and
is now structurally hard to reintroduce, because the reservation goes through
one repository function.

### Not worth it: §2, §4, §5, §6, §18, §19, §24

All behavioural. "The scenario states that it overrides", "she does not nag",
"canon is never dropped", "which stage, never how far", "a confirmation
nobody earned", "a conditional upsert bounds one branch", "a dialog traps
focus" — each is a statement about what the product *does*, checked by a test
that does it. A gate would be a pattern match on intent, which is the kind of
check that goes green while the thing it names stops being true. §19's real
protection is the test that fails against the old query; §24's is a browser
pressing Tab twenty times with real key events.

**The general rule this suggests:** a gate is worth building when the mistake
is *structural* (a thing in the wrong place, a name declared and not wired, a
second copy of something) and cheap to describe as a shape. A rule about
behaviour belongs in a test, because behaviour is what a test can run and a
grep cannot.
