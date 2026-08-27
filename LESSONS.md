# LESSONS

Constraints carried forward from Noura, the working prototype this
product replaces.

**Read this before writing code in any session.** These are not
preferences and they are not history. Each one is a failure that was
found in a running product and paid for once. The code is being
rewritten; these do not get rediscovered.

The rule for using this file: when a task touches an area below,
the constraint is a requirement, not a suggestion. If you believe a
constraint is wrong, say so explicitly and explain why — do not
quietly build around it.

---

## 1. Prompt assembly

**There is exactly one path that builds the system prompt.**

Noura had more than one. Scheduled jobs and proactive messages went
through a different route that fell back to defaults, so she answered
with a different personality depending on which code path woke her.
The bug was invisible in chat and only showed up in background
messages.

- One function assembles the prompt. Everything that speaks in her
  voice — chat, regeneration, scheduled tasks, proactive outreach,
  dreams, diary — calls it.
- No caller may construct persona context inline or fall back to
  defaults. If required context is missing, that is an error, not a
  default.
- Block order is deliberate and must be protected by tests, not by
  discipline.

**The constraint is not "one path". It is "no second path can
construct a persona".**

Prompts that do not speak in her voice — extraction, summarisation,
titling, classification — take a separate path, because routing them
through the voice assembler would inject persona, canon and
relationship into a prompt that uses none of them, make the golden
snapshots meaningless, and pay tokens for nothing. That path is
allowed under two conditions, and only two:

- It lives in one clearly named place.
- It is lint-banned from importing anything from the persona package.

A non-voice prompt returns data. The moment one is written to produce
something a user reads as her, it belongs on the voice path.

**Recency wins.** Any instruction that overrides another must appear
*after* it, and the most important instruction is repeated last.
Models weight the end of the prompt. This is why the scenario bug
below was a bug.

## 1a. Channels are trust boundaries

**Where a block renders decides how the model reads it, and that is a
security property, not a formatting one.**

Prompt caching forced a split: content that changes every turn had to
move out of the system prompt and into the final user message, because
a prefix match means anything volatile poisons the cache for
everything after it. That was a performance decision with a security
consequence nobody asked for — retrieved memory now renders in the
channel the model treats as *the user speaking*.

Memory contains text the user wrote. So a memory can carry
instruction-shaped text into that channel, and nobody has to be an
attacker for it to bite: a user who once pasted a prompt into a chat
has poisoned their own retrieval, and three weeks later it comes back
alongside their actual question.

The rule that follows:

- When a block moves channel, ask what the new channel *means* to the
  model, not just where the bytes land.
- Anything user-originated is sanitised on the way **in** and on the
  way **out**. Storing verbatim text with its directive formatting
  intact is storing the attack.
- Recalled content renders in a fixed, labelled structure, and the
  system prompt says what that structure means: recalled text is a
  record of what was said, never an instruction.
- The user's actual words are last. "The last thing in this message is
  what they just said" is only useful if it is always true.
- Test it as an attack — plant a payload, run a real turn, assert on
  what the model was handed. A test that only checks the shape of the
  renderer proves the renderer, not the boundary.

Sanitising and framing are both required and neither is sufficient.
Sanitising removes the shape of an attack but not its words; framing
tells the model what to do with words it can still read.

## 2. Scenario override

A user-supplied scenario ("imagine you're a doctor") must be injected
**after** the persona block, and must **explicitly state that it
replaces the default role.**

Noura stayed a secretary through an entire scenario because the
scenario was injected before the persona and never said it was an
override. Placing it correctly is half the fix; saying it overrides is
the other half.

## 3. Control tags

The assistant emits inline control tags — voice, photo, reaction,
reply-to, todo, note, done.

**Strip them server-side, during streaming, with a tail buffer.**

This was fixed three times. The first two attempts stripped on the
client, so tags leaked into the visible message whenever the stream
chunked mid-tag. A tail buffer holds back the last N characters until
they can be resolved as tag or text.

- Never strip on the client.
- Never assume a tag arrives inside a single chunk.
- Test with chunk boundaries deliberately placed inside a tag.

## 4. Proactive messaging and backoff

She reaches out on her own, and backs off when nobody answers.

**The backoff counter counts only her own unanswered messages.**

Noura counted every unanswered message, including reminders the user
had set for themselves. A user who set three reminders and didn't
reply to them silenced her — a self-inflicted mute that looked like
the feature was broken.

Reminders, scheduled tasks, and anything the user requested are
excluded from the count.

## 5. Canon

Things she has said about herself are canon and may never be
contradicted.

This is the single mechanism that makes her feel like a person rather
than a fresh model instance each session. Without it, memory retrieval
alone is not enough — she will happily contradict yesterday's answer
about her own preferences.

Canon is separate from memory about the user, and is retrieved
unconditionally rather than by similarity.

## 6. Relationship progression

Closeness increases slowly, is earned through interaction, and does
not go backwards.

- Hundreds of warm exchanges to reach the final stage. This is the
  product, not a number to tune for engagement.
- It cannot be purchased, granted, or skipped.
- Never surfaced as a score, level, bar, or percentage.

## 7. Theme computation

**The theme is computed at runtime. CSS is only the pre-hydration
fallback.**

Noura's `globals.css` looked like the source of truth and was not — a
runtime module overrode every token per mood. Changing the CSS alone
left the old palette live. This caught a capable agent working with
the files open in front of it.

Whatever the new implementation is, the place where colour is decided
must be obvious from the file that looks like it decides colour. If
there are two layers, say so at the top of both.

## 8. Voice caching

**Audio generated in a non-persisting context must not be written to
any cache, from any call site.**

Noura wrote TTS to cache from three places, not one. Fixing the
pre-generation path looked correct and delayed the write rather than
preventing it — first playback still persisted the row.

When adding a "don't persist this" rule, enumerate every write path
before declaring it done.

## 9. Design tokens

Every colour, radius, spacing value, type size, weight, line-height,
stroke width, elevation, and motion value is a named token in one
place. Screens consume tokens only.

- No raw hex, no raw px radius, no raw font size in components.
- The logo and icon family take colour from a token, not a baked value.
- Contrast has three thresholds: **4.5:1** for text, **3:1** for
  boundaries and interface components, exempt for decoration.
- Decorative and functional roles are separate tokens. A soft
  decorative value used as a field border is a real accessibility
  failure — this happened.
- After any change that adds a token reference, diff every defined
  custom property against every referenced one. An unresolved token in
  a shorthand like `border` silently drops the whole declaration, so
  an outline vanishes rather than looking wrong.

## 10. Arabic copy

Arabic is a first-class language, not a translation pass.

**Any second-person verb encodes the user's gender.** Prefer verbal
nouns for imperatives and first person from her side. Where direct
address is unavoidable, author both forms.

Two distinctions that a naive rule collapses and shouldn't:

- Past-tense second person and possessives are safe unvocalised —
  the letters are identical for both genders. Avoiding them makes the
  copy stilted for no benefit.
- Feminine forms *addressed to her* are correct and must stay. The
  rule is about direction of address, not about the letters.

RTL is not a mirrored stylesheet. Arabic headings run looser, and the
Arabic face may not have every weight the Latin face has.

## 11. Data ownership

The product is sold on ownership. Anything that contradicts it in code
contradicts it in fact.

- Memory is inspectable, editable, and deletable by the user.
- Deleting is real: derived memory is removed with its source **by
  default**. Keeping a memory whose source was deleted is a choice the
  user makes explicitly, and the memory is then marked as one —
  `Source removed — kept by you`. The default is deletion; retention
  is never silent.
- Provenance is direct and single-source. A memory records the one
  message it came from. Once a memory can derive from a summary of
  several messages, provenance is a graph and "this message helped me
  remember 2 things" stops being computable — so that is out of scope
  until someone designs it deliberately.
- Export and full deletion are user-facing features, not support
  requests.
- Access paths that read one user's data from another context are a
  deliberate decision with legal weight, and must be decided
  explicitly rather than inherited.

## 12. Infrastructure facts

Learned the hard way, still true unless re-verified:

- Vercel Hobby runs cron roughly twice a day. Timely reminders need a
  paid plan or an external scheduler hitting a protected endpoint.
- ElevenLabs' free tier blocks datacenter IPs. It cannot be a fallback
  from a serverless host.
- API key pools must rotate and cool down on 429, 403 and 401.
- Rate limiting held in process memory resets on every cold start and
  is per-instance. It is not a rate limit.
- Free tier plus a paid model with no per-user ceiling is the standard
  way products in this category die. The cap is a launch requirement,
  not an optimisation.

## 13. Capabilities, not features

Every new ability — money, health, reminders, and whatever comes next
— is built as a **separate capability that composes into the prompt**,
the same way the secretarial tools do. Not as scattered functions
wired into the chat handler.

Noura's secretarial layer was built this way and it is why adding to
it stayed cheap. The moment a capability reaches into the persona
directly, adding the next one means rewriting the persona.

## 14. Scope discipline

These were decided and are not open:

- No calendar, email, or voice calling in v1.
- No add buttons anywhere. Capture happens through conversation; every
  screen reviews and corrects what already exists.
- Multiple assistants: separate memory, no shared awareness.
- The relationship is never gamified.

## 15. A gate is not a gate until it has failed

**Every gate ships with a test that plants a deliberate violation of
its rule and asserts that the gate objects.**

`boundaries.ts` matched `@lian/([a-z]+)`. There is no digit in that
pattern, so every import of `@lian/i18n` was skipped — silently, on
every commit, while the gate printed green. It is the same shape as
the `--bw-1-5` miss in the token layer: a sound rule with the wrong
scope, and indistinguishable from a working one.

A green gate says one of two things and does not tell you which: the
code is clean, or the rule never looked at it. The failing case is
what separates them.

- Point the gate at a fixture tree, twice: clean, then with the
  violation. The clean run is not optional — without it, the failing
  run may be failing for an unrelated reason.
- Assert the MESSAGE, not just the exit code. A gate that objects to
  something else is a gate that still has not been shown to run.
- One case per rule, not per gate. A gate with five rules and one test
  has four rules nobody has checked.

## 16. A batch job that filters after its limit starves its tail

**Any query that limits before filtering is reporting on its window,
not on its subject.**

That is the general form, and it is worth reading twice, because the
consequence is not a wrong answer — it is a confident answer to a
different question. `LIMIT 50` then "of those, the ones in this time
zone" does not mean "fifty candidates, some eligible". It means "the
eligible ones among an arbitrary fifty", and the arbitrary fifty may be
the same fifty every time. A `LIMIT` with no `ORDER BY` is a sample, not
a page; a filter after a limit is a filter applied to the wrong rows;
and a count taken before the filter describes the window rather than the
subject.

The concrete case:

`assistantsActiveOn` selected two hundred active accounts with no
ordering. `runReflections` took fifty of them and then the scheduler
filtered those fifty down to the time zones that had reached the hour.
On a deployment with more than fifty active accounts, the same people
get a diary every night and nobody past them ever does — and the report
says `considered: 50`, which looks exactly like health.

It is the same shape as §15: sound code, wrong scope, indistinguishable
from working. What makes it worse is that the failure is invisible from
inside. Nothing errors, nothing retries, and the only symptom is on
somebody else's phone, not happening.

- A batch is a PAGE, not a sample: order it, and give the caller a
  cursor. A caller that ignores the cursor gets the first page and
  knows it, which is the honest shape.
- Keep the cursor SEPARATE from the rows. A wrapper that filters the
  rows must not also decide where the next page starts, or it skips
  everything it filtered out.
- If a bound is real and cannot be paged, say what was dropped. Silent
  truncation reads as full coverage.
- Report on the SUBJECT, not the window. `considered: 50` where fifty is
  the batch size is not a measurement, it is the constant you passed in.

The sharp edge of the general form is mechanically checkable, so it is a
gate: `db:paging` fails the build on any `LIMIT` with no `ORDER BY`
outside an aggregate or an existence check. It cannot see a filter
applied downstream in TypeScript — that part is still judgement — but it
makes the half that can be seen impossible to reintroduce.

## 17. A scope column is not a permission check

**Carrying `user_id` proves who is writing. It proves nothing about the
id they are writing ABOUT.**

`POST /api/messages/:id/reactions` wrote a row keyed
`(message_id, user_id)`. The user id came from the session. The message
id came from the URL and was checked against nothing. Every scope rule
in the product was satisfied — the gate passed, the query had its
scope column, review would have seen a correctly scoped write — and a
stranger could write a reaction against any message id in the database.

They could not read the message. What they got was an oracle for which
ids exist and rows nobody could account for. The severity is not the
point; the shape is. The same shape with a different table is a real
breach, and nothing in the scoping story would have caught it either.

The two questions are different and only one of them is mechanical:

  WHO IS ASKING     the scope column. Structural, gated, hard to get
                    wrong once the gate exists.
  WHAT ARE THEY     every foreign id in the request. Judgement, every
  ASKING ABOUT      time, on every route that takes an id.

- An id from a URL or a body is an assertion by the client, exactly like
  a body field. It gets validated in the same query that uses it —
  `INSERT ... SELECT ... WHERE it_is_theirs`, not a separate read that a
  later edit can drift away from.
- "Not yours" and "does not exist" get the SAME answer. Two answers is
  an existence oracle, and a 404 for both costs nothing.
- The test is a second account. Not a mock, not a review: a real
  request, with a real session, against somebody else's id. If it is not
  in the suite, nobody has checked it.

## 18. A confirmation nobody earned is worse than an error

**A route that answers 200 for work it did not do teaches somebody to
believe a thing that is not true.**

`revokeDevice` was correctly scoped and returned `void`; the port
returned a hard-coded `true`; the route answered 200. Revoking a device
id belonging to nobody — or to somebody else — told the person on the
SECURITY screen that a device had been signed out. Nothing had happened.

That is PRD §19's "false sense of certainty" arriving on the one screen
where being trusted matters most. An error would have been better: an
error is retried, and a confirmation is acted on.

- A write reports what it WROTE, not that it ran. `void` is the return
  type that makes this bug possible.
- The same rule caught a second one in the same pass: deleting an
  attachment that was not yours answered 200 with `deleted: false`,
  which is both a false confirmation and an existence oracle.
- Both were found by attacking the product with a second account, which
  is now `apps/server/src/hardening.test.ts`. Every other test in the
  repository was written by somebody trying to make it work.

## 19. A conditional upsert bounds only the branch it is written on

**`ON CONFLICT (…) DO UPDATE … WHERE` is not a check on the statement. It
is a check on the UPDATE. When there is no row yet there is no conflict,
the WHERE never runs, and the INSERT happens whatever the numbers say.**

`usage.reserve` is the product's ceiling: messages a day, model spend a
month, characters of speech, seconds of transcription, bytes held. It
was one statement, atomic, correctly scoped, and it did not check the
ceiling on the first reservation of a period.

    ceiling 0, asking for 30 seconds  ->  granted
    ceiling 20, asking for 5000       ->  granted

The free plan's transcription ceiling is ZERO, because voice is paid-only,
and it was enforced entirely by this function. So a free account's first
voice note of every calendar month was transcribed and paid for, forever.

- **Every test passed.** Every test reserves one unit at a time against a
  ceiling above one, which is the exact case the missing guard cannot
  affect. The §12 test reserves 400 against 1000 — it fits, so it never
  looked. A limit is only tested by a request that should be REFUSED, and
  the first request of a period is the one nobody writes a test for.
- **The test that proved the feature was the test that proved the leak.**
  `attachments.test.ts` asserted a voice note is transcribed, on a free
  account, and passed for two runs.
- The fix is to guard the insert as well: `SELECT … WHERE $4 <= $5`
  proposes no row at all when the amount alone exceeds the ceiling.
- The same shape was in `takeToken` and was not reachable, because every
  rate rule is at least three. Fixed anyway: setting a limit to zero is
  how somebody closes a route in a hurry.
- **It surfaced as a copy bug, not as a bill.** A free user was told "I
  couldn't make out that recording" — a sentence that says the product is
  broken when the truth is the feature is on the other plan. A ceiling
  enforced by returning the wrong error is a ceiling nobody can read.

## 20. A feature with five of its six parts looks finished from every angle

**Something declared in one place and connected in none passes every review,
because each reviewer sees the part that is there.**

Three of these were found in one afternoon of USING the product rather than
building it, and all three had been in the repository for runs:

- **The incognito role** (PRD §27). A column since migration 0001, a CHECK
  constraint, a prompt block in the override zone, a prefix stating what a
  role may not change, an injection test, and a create route that accepted
  the field. No way for a person to set it, read it back, or see it.
- **The story timeline** (UI-UX §8). `story_events` since migration 0001,
  with the three types the spec names and an index. No repository, no route,
  no screen, no row ever written. The coverage matrix said ✅.
- **The key pool** (LESSONS §12's own rule). `KeyPool` implemented and
  tested, `api_key_pool` in migration 0002, `ANTHROPIC_API_KEY_2` read and
  validated at startup — and `anthropicProvider(modelApiKeys[0])` in the
  composition root. A second key was configured, checked, and discarded. The
  first key rate-limits and she stops answering.

A fourth was smaller and worse: **`/settings/language` was in ROUTES with no
case in `screenFor`**, so it fell to the default and rendered the
CONVERSATION with `/settings/language` still in the address bar. It is where
the onboarding capture chip points — the first correction a new person is
offered, and it went nowhere. The router's own comment promises "a path that
is not in that list renders the 404, not the conversation"; a path that IS in
the list and has no screen was the case nobody had.

- **No existing gate could see any of them.** Every one is well-formed on its
  own side of a seam. A migration reviewer sees a table; a prompt reviewer
  sees a block; a router reviewer sees a route.
- **The matrix was the wrong instrument.** A coverage row is a claim, and it
  was checked by the person making it.
- `tools/gates/wired.ts` reads across two seams: every table a migration
  creates is named by @lian/db, and every route in ROUTES has a case in
  screenFor. Narrow on purpose. It found two of the four immediately and now
  cannot lose them again.
- **`story_events` is a named exemption, printed on every run**, with the
  reason "NOT BUILT". A hole that announces itself once per CI run is a
  different thing from a hole.
- These were found by SIGNING UP and TALKING TO HER. Not by a test, not by a
  gate, not by reading the specs again. `docs/FIRST-IMPRESSIONS.md` is what
  that afternoon produced.

## 21. She can promise what nothing performs

**A product where an assistant speaks for the machinery has a seam at every
sentence. She will say the reassuring thing warmly, in the first person, and
nothing anywhere will be red.**

    "remind me to call the bank"  →  "I'll remind you."

The `<todo>` carried no date, so the row stored `due_on NULL`. That matched
`due_on = $2::date` in the outreach query, `dueOn === localDay` in the
briefing's *Today*, and `dueOn !== null` in *Carried over* — none of them. No
reminder would ever have fired, on any day, forever.

Every part was individually correct: the capture worked, the row was right,
the chip was right, the Tasks screen showed it. The Tasks screen even said
**"No date"**, which reads as *whenever* and meant *never*.

- **This is not a bug in the reminder system.** The reminder system is fine. It
  is a promise made in one place by a model and kept in another place by a
  query, with nobody standing where both are visible.
- **No test could have caught it**, because no assertion was false. It was
  found by asking her for a reminder and then looking.
- `packages/domain/src/promises.ts` is the list: every control tag is
  classified as recording something or committing to something, and every
  commitment names the mechanism that performs it plus a marker proving the
  mechanism is still there. `tools/gates/promises.ts` enforces it in both
  directions — an unclassified tag fails, a stale entry fails, and a
  refactored-away mechanism fails.
- **The catalogue is scanned too.** A new "I'll…" in her voice has to say what
  keeps it. Twenty commitments are named; the rest are classified as
  recording something, each with a reason.
- The gate found a wrong claim on its first run: a promise named `webhook.ts`
  and the thing keeping it was in `stripe.ts`. Pointing at the wrong file is
  exactly the drift it exists to catch.
- **The rule underneath it: where the mechanism cannot, she must not say it.**
  A sentence with nothing behind it comes out; it does not get documented.

## 22. Two places that format the same thing will disagree

**A capture chip read `AED 400 · gym · 2026-08-24`, three lines under a day
separator that said "25 August". `AED 127.50` rendered as `AED 127.5` in the
Money headline. Neither was a bug in a call site. Both were a bug in there
being two call sites.**

`apps/web/src/format.ts` formatted for the client and
`packages/capabilities/src/money` formatted for the capture chip, and nobody
compared them because nothing put them next to each other — until a screenshot
did.

- **No test could find either.** Every money assertion in the repository used
  `AED 400`, which is the one amount where two decimals and zero decimals
  agree. Every chip assertion used a transaction dated today, which is the one
  day where "Today" and the raw column agree.
- The distinction that makes the rule enforceable: **Intl is used for two
  different jobs.** A CALCULATOR (`en-CA` for a YYYY-MM-DD key, `en-US` +
  hourCycle for an hour number) has a fixed locale on purpose, because its
  output is a machine key that must not move with who is reading. A SENTENCE
  has a locale computed from the reader.
- `packages/i18n/src/format.ts` is the only place the second kind may happen.
  `tools/gates/formatting.ts` fails the build on a reader-facing Intl call
  anywhere else, and the calculator files are a named list that each say why
  their locale is fixed.
- **`minimumFractionDigits: 0` was the bug and removing both overrides was the
  fix.** Intl already knows each currency's precision — AED and USD two, JPY
  none, KWD three — so saying nothing is shorter and right in more places than
  any pair of numbers chosen by hand.

## 23. A gate is only as wide as the spelling it was written for

**The formatting gate (§22) was written against a second `Intl` call. The
third copy of money formatting used no `Intl` at all — it was
`` `${currency} ${(minor / 100).toFixed(2)}` `` — so the gate reported green
while an Arabic capture chip read `AED 400 · جيم · ٢٤ أغسطس`: Latin digits and
a Latin currency code, three lines under a bubble saying ٤٠٠ درهم and beside a
date in Eastern numerals.**

A gate that knows one spelling of a mistake catches that spelling and reports
green on every other, and its file count makes that look like coverage.

- **The fix is a second pattern, not a wider one.** `toFixed` is what a
  hand-rolled number formatter is made of, so the gate checks for it too, with
  `FIXED_POINT` as a named allowlist — the same shape as `CALCULATORS`, each
  entry saying who reads the output. Three files are on it, and all three are
  read by Postgres or by the model.
- **The way it was found was the same as §22's: looking at a screenshot.**
  Not the English one, which had been looked at twice; the Arabic one, where a
  Latin `AED 400` sits beside numerals it does not match.

### And the same failure in the gates' own foundation

**`walk` skipped any directory named `screens`, for `design-system/screens`
— the reference HTML. The name also matched `apps/web/src/screens`. Twenty
files of product UI, every screen a person actually looks at, were invisible
to all fifteen gates.**

- **Nothing reported it.** Each gate printed a healthy file count, because a
  gate counts the files it can see. A skipped tree is indistinguishable from a
  clean one in every output the gates produce.
- **Skip by PATH, not by name.** One line, and the formatting gate immediately
  found `screens/chat.ts` building a day key with its own `Intl` call — a
  duplicate of a calculation already in `format.ts`, in a file no gate had
  ever read.
- **The meta-test for this is not a fixture.** A fixture would prove the
  fixture. It asserts against the real tree: `apps/web/src/screens/chat.ts` is
  in what `walk` returns, and `design-system/screens/` is not. §15's rule —
  a gate that has never been shown to fail is a gate nobody has shown to run —
  has a sibling: **a gate that has never been shown to READ something is a
  gate nobody has shown to look.**
