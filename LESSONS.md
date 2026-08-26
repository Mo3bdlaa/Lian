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

**A `LIMIT` with no `ORDER BY` is an arbitrary sample, and a filter
applied after a limit is a filter applied to the wrong rows.**

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

