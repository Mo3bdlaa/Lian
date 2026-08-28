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

### The general form: detect the wrong shape, not the absence of the right one

**Both halves above are one mistake.** The formatting gate looked for a
*second `Intl` call* — the correct mechanism, in the wrong place. Code that
used **no mechanism at all** was therefore not a violation to it, it was
nothing at all. And `walk` looked for the files it had been pointed at, so a
whole tree it never entered was not a hole, it was a healthy count.

A gate written as *"the right mechanism must only appear here"* is blind to
every implementation that reaches the same result by other means, and blind
in the worst way — it says green, with a plausible number beside it.

- **Write the rule against the OUTCOME, not the API.** "A reader-facing amount
  is formatted in one place" is the rule. `Intl` is one spelling of it,
  `toFixed` is another, and there will be a third — string concatenation,
  a regex, a lookup table of symbols. Each new spelling is a new pattern in
  the same gate, not a new gate.
- **Ask what a violation would look like if somebody avoided the API entirely.**
  That question is what turned up the third money formatter, and it is
  cheaper to ask than a screenshot.
- **This is `[a-z]+` and `--bw-1-5` again** — a pattern that matched the
  cases in front of it and reported green on the ones it could not express.
  The count beside a gate's tick is not evidence; it is the size of the set
  the gate happened to look at.

## 24. A word in the markup is not the behaviour it names

**Seven overlays carried `role="dialog"`. None of them behaved like one:
focus stayed on the button behind, Tab walked straight out into a page that
was still live, Escape did nothing, and closing left focus on `document.body`.
Nobody had ever run this product without a mouse.**

`role="dialog"` is a promise to a screen reader, in the same way a sentence in
her voice is a promise to a person (§21) — and it had exactly as much behind
it. The attribute was in seven templates and the behaviour was in none.

- **It took both halves, and each does something the other cannot.** `inert`
  on everything behind removes it from the tab order *and* from the
  accessibility tree, so a reader cannot swipe into it; a hand-rolled Tab wrap
  does not do that second part. But **`inert` is not a trap**: Tab past the
  last control wraps through the document, so focus lands on `body` with
  everything around it inert and the keyboard is nowhere at all. Measured, not
  reasoned about — the test caught it on the tenth press.
- **The test had to use real key events.** A dispatched `KeyboardEvent` is
  untrusted, so the browser runs no default action and Tab does not move
  focus. A trap test written that way passes against a page with no focus
  management whatsoever, which makes it worse than no test —
  `Input.dispatchKeyEvent` over the DevTools protocol is what actually presses
  a key.
- **Restoring focus needs a SELECTOR, not an element.** Every draw repaints
  whole regions from state, so the button that opened a sheet is a different
  DOM node by the time the sheet is on screen. Holding the reference gives a
  detached element that can be focused and does nothing, silently. What
  survives a repaint is `data-action` plus `data-id` — what identified the
  control to the click handler in the first place.
- **One manager, because one attribute marks every dialog.** It looks for
  `[role="dialog"]` anywhere rather than in the overlays region, because the
  photo viewer renders inside the album screen — a manager watching only
  `#r-overlays` would have missed the one overlay that covers the whole
  display, and would have made it inert along with the screen it sits in.

## 25. A setting that is read is not a setting that is connected

**`trustedProxies` was added to `ServerOptions`, read in `server.ts`, given a
config entry, an environment variable, documentation, and a test asserting it
parsed correctly. `app.ts` never passed it. The whole feature was inert, and
every request was attributed to the socket.**

This is §24 pointed at configuration: a name declared and the behaviour never
wired. The difference is that §24's `role="dialog"` was visibly a promise, and
a setting looks like plumbing — so nothing in review pauses on it.

- **The test asserted the wrong end.** `config.test.ts` checked that
  `LIAN_TRUSTED_PROXIES: '2'` produced `trustedProxies: 2`, which was true and
  meant nothing. **A setting needs a test that it CHANGES BEHAVIOUR**, not one
  that it parses: send the same request with the setting at 0 and at 1 and
  assert the two are treated differently.
- **The failure was three lines downstream of the cause.** A rate-limited
  sign-up returned 429, the test read `.userId` off the error body, and the
  suite reported `Cannot read properties of undefined (reading 'id')`. That
  sent me to the rate-limit table twice before I checked whether the wire
  existed. **A helper that unwraps a response must throw on the status**, or
  every failure downstream of it names a property instead of a reason.
- **I treated the messenger twice.** The tests were correctly reporting that
  the feature did nothing; I read them as flaky infrastructure and "fixed"
  them — twice — before reading them as a finding. Both fixes were real
  improvements and neither was the bug. **When a test starts failing after a
  change, the change is the suspect, not the test.**

## 26. A check that matches on its own subject matter will find itself

**And the failure looks like the thing working, which is why it survives.**

- `until ! pgrep -f "ci-test.ts"; do sleep 10; done` **can never terminate.**
  The waiting shell's own command line contains the string it greps for, so
  `pgrep` matches the waiter. Four of these spun for the rest of a session,
  each one looking exactly like a test suite that had not finished yet.
- **The boundaries gate read its own marker as SQL.** `tools/gates/promises.ts`
  requires every commitment to name a pattern proving its mechanism still
  exists, and for a delete the strongest such pattern is the delete itself:
  `/UPDATE memories SET deleted_at = now\(\)/`. The gate that forbids SQL
  outside `@lian/db` found that regex — in a file that runs no queries and
  imports no database — and objected. **Three times.** Twice the fix was to
  weaken the marker, trading a real guarantee for a green gate.
- `pgrep -c -f "node --test"` returns 1 when nothing is running.

**The fix is always the same: exclude the checker from the checked set,
explicitly.** `pgrep -f "[c]i-test.ts"` — the bracket makes the pattern not
match its own text — and the boundaries gate strips regex literals before
searching for SQL. One line each, and neither is discoverable from the
failure, because the failure is silence rather than an error.

**The general form, worth more than the three instances:** a check whose
pattern is drawn from the same vocabulary as the thing it checks is a check
that can match itself. Grep over source for a code shape; a process matcher
over its own command line; a linter that reads its own rules file. Ask what
the check sees when it is pointed at itself, and if the answer is "itself",
say so in the pattern.

## 27. A fixture that disagrees with the product produces findings about the fixture

**Three times in a fortnight the harness misreported the product, and every
one looked exactly like a real defect — one of them like the worst defect this
project could have.**

- **The clock stops at the database.** `createApplication` takes an injectable
  `now`; Postgres does not. A session that travelled to September wrote rows
  stamped with the real date, so `assistantsActiveOn` — which joins on
  `messages.created_at` — found nobody active and proposed outreach for zero
  assistants, every tick, for two simulated weeks. That reads as "I'll remind
  you" being false (§21). It was the harness.
- **A window that moves with the reader.** The briefing is read midnight to
  midnight *where they are*; in Dubai that is `[yesterday 20:00Z, today
  20:00Z]`. Running the session after 20:00 UTC put every row it wrote outside
  the window, and "the briefing has nothing of her in it" went into
  FIRST-IMPRESSIONS as a product observation.
- **A seed that disagreed with itself.** The screenshot seed wrote
  `user_agent 'Mozilla/5.0'` beside a `label` column nothing read, so the
  Security screen — which derives from the first — rendered "Device". Carried
  in HANDOFF for two runs as a missing feature. The parse had always worked.

- **When a harness reports something alarming, check the harness first.** The
  cost of being wrong in that direction is a day; the cost of the reverse is
  believing the product is broken and "fixing" something that was right.
- **An injectable clock that stops at a boundary can only test what happens
  above it.** Nothing that joins on a stored timestamp is reachable that way,
  and that is most of a scheduler.
- **Where the harness can detect its own confusion, make it say so.**
  `tools/session.ts` now prints, in the transcript, that a delivered briefing
  with no line on screen is ITS fault and not a finding.

## 28. A test that leaves state makes the suite history-dependent

**The `auth:ip:` rate limit is a database row keyed on the client address —
which is §12 done right. Tests then used fixed addresses, so the buckets
accumulated across runs: green in CI, where the database is new, and red on
the machine of whoever is actually trying to work.**

- **A bigger fixed range is not a fix.** A `/24` with a counter still repeats
  after 250 calls and still repeats across runs, and hundreds of sign-ups
  across a suite collide by birthday long before that.
- **AND NEITHER IS AN APPROXIMATION OF UNIQUENESS.** The replacement was a
  `/8` keyed on `process.pid % 256`, in six copies, one per test file. That is
  unique per call and *almost* unique per process — eight bits of process
  identity, so two files in one run collide whenever their pids are congruent
  mod 256. It held for a fortnight and then a seventh file made it near
  certain: the second file's first sign-up shared the first file's `auth:ip:`
  bucket and died on a 429 three tests in, with a failure that moved depending
  on what else ran. Addresses are now a unique-local IPv6 with 112 random
  bits, from **one** helper rather than six copies of one (§22 in test
  support), and there is no birthday problem left to reason about.
- **The corollary cost more than the cause.** One failing assertion **hung the
  whole suite** for ten minutes, because a server was closed on the test's
  last line and the failure skipped it. A hang tells you nothing; even a red
  run tells you something. Every server a test starts is closed in `after`.
- **A helper that unwraps a response must throw on the status.** A 429 read as
  `.userId` surfaced three lines later as `Cannot read properties of undefined
  (reading 'id')`, which sent me to the wrong file twice.

## 29. The cleanup on the error path fails on exactly the errors that matter

**Every `catch` block does something before it rethrows — roll back, refund,
release, close. That cleanup runs in the one state where it is least likely to
work, and unguarded it replaces the cause with its own failure.**

```ts
} catch (error) {
  await client.query('ROLLBACK');   // on a connection that just died
  throw error;                      // never reached
}
```

The interesting failure is a connection that died mid-transaction. On a dead
connection `ROLLBACK` is precisely the statement that also fails, so it
rejects, and the caller is told the rollback failed instead of what actually
went wrong — in the one case where the cause is hardest to reconstruct from
anywhere else. Postgres rolls back an abandoned session by itself; the
rollback was never the point. **Wrap the cleanup in its own `catch` and let
the original error out.**

- **The same shape wherever a failure has to undo something.** A turn that
  refunds its message reservation when the provider dies is undoing work
  *because* something already failed; a refund that throws must not turn a
  degraded turn into a crashed one, which is the thing the whole branch exists
  to prevent.
- **An 'error' event is not an error you can catch.** `EventEmitter` throws an
  `'error'` with no listener, from a socket callback, outside every `try` in
  the process. A pool listens for its *idle* clients; a client checked out for
  a transaction is not idle, and while it is held the transaction is the only
  thing positioned to listen. Both listeners are one line, and the symptom of
  either missing one is the whole server exiting because a connection nobody
  was using went away.
- **A retry that is only safe sometimes must know when.** Retrying a stream is
  correct until the first token has been delivered and wrong immediately
  after — a second attempt appends a whole answer to half of one. The
  condition is not "was it retryable" but "has anything been said yet".

## 30. A scheduler is a dependency too, and it lies in three directions

**The tick carried a comment saying "a scheduler that fires twice costs
nothing", and it was true sequentially and false concurrently — which is the
only way it could ever matter.** `sent_at` is written *after* delivery, so two
overlapping runs both saw `NULL` and both pushed. Two identical notifications
from someone who is meant to sound like a person.

Three failures, and the middle one is the one nobody writes down:

- **Twice at once.** Selecting work and marking it done are not the same
  statement, and everything between them is a window. A claim is a conditional
  `UPDATE ... RETURNING` that exactly one writer wins; a *lease* rather than a
  flag, so a run that is killed mid-delivery does not take its rows with it.
- **Not for six hours, then all at once.** Late work is not the same as stale
  work. "Shall we start the day" delivered at two in the afternoon is not a
  late message, it is a wrong one, and it is what makes somebody turn
  notifications off. Only *her* messages go stale — a reminder the user asked
  for is theirs, and late beats never (the §4 distinction, at a second layer).
- **One failure, or a hundred.** A batch loop with no per-item guard abandons
  everything behind the first row that throws, and the next run starts on the
  same broken row and does it again. The ninety-nine people after it are not
  party to that failure and should not hear about it by hearing nothing.
