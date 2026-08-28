# First impressions

**Third run.** Same person, same day, run again after the resilience and
performance work — and the first thing it produced was a correction to the
harness, not a finding about the product. Section 0 is new and is the most
useful part of this pass. Everything below it that was true last time is still
true; what changed is marked.

Second run. I signed up as somebody called Rania, talked to Lian, let the
ticker run every hour through a whole day, watched a reminder fire, corrected
something she had got wrong, deleted a memory, and talked until she refused.
This is what that was like.

It is not a bug list. What is here is a read on whether the thing works as the
thing it is meant to be.

`npm run session` is the new part. The first run of this document was written
by reading screens; this one drives the real server over the real HTTP API,
runs the real scheduler on a real clock, and writes every exchange to
`docs/session-transcript.txt`. That difference produced most of what follows,
including one alarm that turned out to be my own error and is the most useful
paragraph in the document.

---

## What I could and could not judge

**Still no model key.** Her replies came from a scripted provider whose
answers I wrote, so **I cannot tell you whether she sounds like herself.**
Every observation below that touches her voice is marked ⚠ and is waiting on
the real-model run, which is one command away.

What I *can* judge turned out to be most of it:

- **The sequence.** What appears when, what a stranger is asked and in what
  order, whether a correction lands, whether a reminder actually fires, what
  hitting the wall is like. None of that depends on the model.
- **The authored words.** 485 catalogue strings are the product's own: the
  opening, every empty state, every limit line, every label. Judging those is
  judging the product, not a model.
- **The prompt.** What she is actually told, in full, at each turn. It is the
  product's instruction to the model and it can be read as a critic without
  ever calling one. It is printed at the end of the transcript.

---

## 0. What this run corrected before it could see anything

**Three findings, and all three were mine.** LESSONS §27 for the fourth,
fifth and sixth time — a harness that disagrees with the product produces
findings about the harness — and every one of them would have gone into this
document as a product observation.

**The transcript said this person had four hundred and ninety-nine reach-outs
waiting.** `outreach rows: 499`, every one scheduled for a date three months
in the past, most of them cancelled. It reads as an assistant who has been
trying to get somebody's attention for a season and being ignored. It was the
test suite's and the perf tool's leftovers: the session's direct-SQL reads
were `SELECT … FROM outreach`, unscoped, which is fine against a database this
tool has to itself and a lie against a developer's. Every raw read is scoped
to this account's own assistant now.

**The tick report is the whole database's, and did not say so.** `proposed
62, held back 42` reads as sixty-two messages queued for the one person the
session is about. The scheduler is a batch job over every account, so the
number is real and it is not theirs. Labelled now.

**"Did she reach out on her own? NO" — while she had.** The check tested for
`surface === 'scheduled'`, and a proactive message carries the surface its
*outreach kind* maps to: `briefing`, `scheduled`, `security` or `proactive`.
So a delivered briefing — the product's second-biggest idea, working — was
reported as her never having spoken first. **A harness that under-reports the
defining feature is worse than one that says nothing**, and this is the second
time this document has nearly recorded "she does not reach out" as a product
failure when the product was fine.

The pattern is now unmistakable enough to state as a rule: **every alarming
finding from this tool gets checked against the tool first.** Six of the last
seven were the tool.

---

## 1. The first thirty seconds are still the best thing here

Before I had typed anything, on a screen I had reached by filling in an email
and a password, there was a message:

> Good to meet you. I'm a secretary, more or less — I keep track of what you
> tell me, and bring it back when it matters. What should I call you?

No setup, no tour, no permissions dialog, no empty text box waiting for me to
work out what this is for. It says what it is in eight words, and then it asks
me something. **That is the whole positioning delivered in one sentence, and
it costs nothing** — it is authored, not generated, so it is the same on the
worst day the API is having.

The thing I keep noticing is what is *absent*. There is no "Hi! I'm Lian, your
AI companion 💫". There is no onboarding carousel. Reading the prompt later, I
found out why: the list of things she never does includes "unlock",
"supercharge", "your AI", "boost", and *"say you missed them, or ask them to
come back"*. Somebody decided what this must never sound like before deciding
what it should sound like, and it shows.

## 2. Onboarding is five exchanges and does not feel like a form

I said "Rania", then "English", then two things about work, then gave her a
name. Five messages, one question at a time, and each answer visibly landed —
the name in the header changed to Noor, and the memory count went from 0 to 2
while I was still talking.

**The part that is genuinely good design**: the step is derived from what is
known, not counted. If I had said "I'm Rania and you can be Noor" in one
sentence, it would have taken both. There is no wizard to get lost in because
there is no wizard.

### But onboarding cannot finish without a browser, and nobody says so

`nextStep` will not return `done` until `notification_prompted_at` is set, and
the only thing that sets it is the client answering the permission card. In my
session — signed up, named, two memories kept, four questions answered — the
account sat at `ask_notification_permission` indefinitely. One POST to
`/api/push/prompted` moved it to `done` instantly.

In a browser this is fine: the card appears after the first remembered thing
and any answer, including "Not now", counts. But two things follow that are
worth knowing:

- **A person who never answers the card never finishes onboarding.** They are
  not stuck in a visible way — the app works — but the last onboarding
  question (naming her) sits in front of everything, forever.
- **The free message limit was not enforced during onboarding.** Onboarding is
  a different surface, and only `surface === 'chat'` reserved against the
  daily counter — so **an account that never answered the permission card had
  no daily limit at all.** FIXED: onboarding has its own twenty-turn budget,
  spent once per account and never reset, and a turn that cannot reserve
  against it falls through to the daily counter. Nobody hits a wall while
  being asked their name, and nobody talks forever by declining to answer.

## 3. The middle of it works, and one part of it is quietly excellent

I told her three things a person actually says — "remind me to call the bank",
"I paid 400 for the gym today", "rent went out, 6500" — and each produced a
chip under her reply that I could tap to correct.

Then I corrected one. `AED 400` → `AED 350`, through the correction route.
And **the chip in the conversation, three messages up, changed to
`AED 350.00 · gym · Today`.**

That is the best-engineered thing in the product and it is invisible unless
you go looking. The chip does not store what it said; it re-derives from the
row every time the window is read. Which means the conversation cannot drift
out of step with the truth, and it means the same chip renders in Arabic if
you switch language, and it means correcting something does not leave a
fossil of the mistake sitting in the history. Nothing on screen advertises
this. You just never catch it lying.

Deleting a memory works the same way: she was holding three, I removed one,
she held two, and the sentence attached to it — "I'll remove it from
everything I remember" — is one the build now checks is still true.

## 4. The reminder fires. I nearly reported that it did not.

This is the most useful paragraph here, and it is about method rather than
the product.

My first session set the clock to a tidy Monday in September and walked
forward a fortnight, running the scheduler every hour. It reported: **no
outreach, ever. Empty briefing on the day the task was due. She never said
anything unprompted.** That is LESSONS §21 happening again — "I'll remind you"
being false — and it is the most alarming thing this project could find.

It was not true. **`createApplication` takes an injectable clock; Postgres
does not.** `messages.created_at` defaults to the database's own `now()`, so
every row my session wrote was stamped with the real date while the
application believed it was September. `assistantsActiveOn` joins on
`messages.created_at`, found nobody active on an imaginary day, and proposed
outreach for zero assistants — every tick, for two simulated weeks.

Fixed by keeping the clock on today's real date and moving only the hour, the
same run produces:

```
[tick 05:00] proposed 2, held back 0, duplicate 0
  briefing   assistant_initiated  for 03:00
  reminder   user_requested       for 05:00
[tick 07:00] delivered 1
[tick 09:00] delivered 1
  briefing SENT, message written
  reminder SENT, message written
```

**"I'll remind you" is true.** The reminder is `user_requested`, which is the
LESSONS §4 distinction doing its job: a reminder the person asked for is
invisible to the backoff that governs her own initiations.

The general lesson is worth more than the fix, and it is now written into
`tools/session.ts` where the next person will hit it: **an injectable clock
that stops at the database boundary can only test what happens above that
boundary, and nothing that joins on a stored timestamp.** That is most of the
scheduler. Every test that moves time in this repository is subject to it.

## 5. Where it feels thin

**~~The briefing has nothing of her in it.~~ I got this wrong, from the same
cause as §4.** I reported `line: null` and wrote it up as the product's
second-biggest idea presenting as a list with a number over it. The line was
there. The briefing is read from a window of midnight to midnight *where they
are*, which in Dubai is `[yesterday 20:00Z, today 20:00Z]` — and I ran the
session after 20:00 UTC, so every row Postgres stamped landed in the next
Dubai day, outside the window my injected clock computed.

Run again with the session's person in UTC, so the local day, the UTC day and
the day every row is stamped with are the same day at every hour: the briefing
carries her line, delivered by the outreach path at 03:00 and read back onto
the screen. The tool now says loudly when a briefing message exists and the
screen shows none, because **that is the harness and not the product**, and it
has now cost me two false claims. ⚠ Whether the line is any *good* is still a
model question.

**One day in, the story is one row.** "We started talking." Which is honest,
and is what a relationship one day old should look like, and is also a screen
that a curious person will open once and not open again for a fortnight. I do
not think it should be padded. I think it is simply a screen that is not for
day one, and nothing tells a new person that.

**Money on day one is a negative number — and this run showed the case where
nothing explains it.** In minus out, with no income ever mentioned, is
−AED 6,900. The headline already handles this: it says "Spent" rather than
"What's left" until something has come in.

Last run her observation appeared underneath (`Most of what went out this
month was rent.`) and I called it the first thing on that screen that sounds
like a person. **This run it did not appear at all**, and the reason is a real
design seam rather than a bug. `observe()` returns null below **three
transactions in the month** — a floor that exists because "two points are not
a pattern", which is exactly right for the branch that says *most of what went
out was rent*. But the floor is applied to every branch, including this one:

> Nothing has come in this month yet, so this is only what has gone out.

That sentence is not a pattern claim. It is a statement of fact, it is true
with **one** transaction, and it is the only thing on the screen that explains
why the big number is negative. Gating it behind three transactions means the
explanation is missing on exactly the days when the number is most alarming —
somebody's first two. **The floor belongs on the inferences, not on the one
line that is arithmetic about whether a column is empty.**

**Fixed, this run.** One condition moved above the floor, with the reasoning
in the function and a test for both sides of it. The transcript now reads:

> her observation: Nothing has come in this month yet, so this is only what
> has gone out.

on the day it is needed rather than three transactions later.

**The mood went quiet after the most active day possible, and I am not sure it
is wrong.** By evening the header read "A little quiet" — after twenty-odd
messages. `deriveMood` goes quiet when the person's *affect* is low, not when
contact is: "I am exhausted", "the deadlines are never mine", and then a run
of heavy filler. So she matches the room rather than the traffic, which is
defensible and is probably right. It is worth naming because the obvious
reading of "quiet" is "we have not spoken", and here it meant the opposite.
⚠ Half unjudgeable: the filler messages are the harness's words, not a
person's, and a real conversation would move this differently.

**The mood moved and I noticed.** By evening the header read "Quiet, late"
instead of "Getting to know you". Nothing announced it. It is a small, good
thing.

## 6. What a stranger would ask on day one that the product cannot answer

I went looking for these deliberately, because they are the questions that
decide whether somebody comes back.

1. **"What do you actually do?"** — answerable only by her, in the moment. The
   prompt tells her, but there is no screen that says it and no way to find
   out except by asking. That is a defensible product choice (this is a
   conversation, not an app with a features page) and it is also the first
   thing a sceptical person wants. ⚠ Unjudgeable without the model: if she
   answers it well, the absence is correct.
2. **"Can you see my calendar?"** — the prompt forbids her from claiming a
   calendar she does not have, which is right. But there is nowhere a person
   can find out what she is connected to, and "nothing" is a reassuring
   answer that never gets given.
3. **"Where does this go? Who can read it?"** — there IS an answer: the
   privacy document is on the consent screen before an account exists, and
   the data screen exports and deletes for real. It is a good answer, it is
   just three taps from the conversation and nothing points at it on day one.
4. **"How much is this?"** — the free tier's end is the first mention of
   price, which arrives as her saying she has reached her limit. Reaching a
   wall is a bad moment to learn there is a paid tier. The approaching line
   softens it ("We've only got a few messages left today") and is deliberately
   not an upsell. I think that restraint is right and I think the person
   still ends up surprised.
5. **"Did it get that right?"** — answerable, and well: every capture is a
   tappable chip that opens the thing it made.

## 7. Copy that is wrong in a way no test catches

Fewer than last time, because two gates now exist that did not.

- **"Getting acquainted" is doing a lot of work.** The stage prose says "Tell
  me things twice if you need to — I'm still learning what matters to you."
  That is honest and slightly deflating on day one, when the person has just
  told her four things and she demonstrably kept them. It reads as a hedge
  written for the worst case.
- **The refusal is the best line in the product.** "That's my limit for today.
  I'll still be here tomorrow, and I'll keep what we talked about." It does
  three things — states the limit, promises return, and reassures about
  memory — in twenty words, with no price in sight. It is the sentence I would
  show somebody to explain what the product is trying to be.
- **The API and the screen disagree about what a transaction is called.** The
  chip's correction route is `/money/<id>`; the API route is
  `/api/transactions/<id>`. Both are right — one is a screen, one is a table —
  and it cost me a 404 and a minute of believing corrections were broken.
  Nothing user-facing, but it is a trap laid for the next person.

## 8. What the prompt reads like

I read the whole system prompt at a turn four exchanges in. It is good — and
"good" here means specific, short, and mostly about restraint:

> - Briefly. Most replies are one or two sentences. You do not fill space.
> - Specifically. You refer to the actual thing they told you, not a category
>   of thing. "The presentation on Thursday", not "your upcoming commitments".
> - Warmly, without performing warmth. You are glad to hear from them; you do
>   not say so twice.

The instruction I did not expect, and which is the one that will decide
whether this works:

> You have a life of your own only insofar as you have said so before. What
> you have said about yourself is true and stays true.

That is a hard problem stated in two sentences and handed to the model without
pretending it is solved. Whether it holds is exactly what a real key would
tell us.

The one thing I would change: the capability list arrives as eight tag
schemas with JSON examples, in the same block as the writing guidance. It
reads like an API reference bolted onto a character description. ⚠ Whether
that dilutes her voice is a model question and I cannot answer it.

---

## What is waiting on a key

Everything below is unjudgeable from here, and the run that answers it is two
commands — `npm run preflight model`, then `npm run session -- --real`, about
**$0.26** (forty chat turns at $0.19 plus $0.07 of the extraction calls that
run beside them, from the catalogue), bounded by the free plan's own $3.00
ceiling whatever happens:

1. **Does she sound like a person?** Nothing in this document answers that.
2. **Does the briefing line make the briefing worth opening?**
3. **Does she use `<moment>` sparingly?** The prompt spends most of its words
   on when not to. A model that reaches for it every warm exchange turns the
   story into a log, and no gate can catch that — it is a judgement about
   frequency.
4. **Does capture survive real language?** Every capture here came from a
   sentence I wrote to be capturable. "I think I paid the gym, maybe 400,
   might have been last week" is the real test.
5. **Does the persona hold at turn fifty?** The context is assembled the same
   way every turn, so the mechanism is stable; whether the character is, is
   not a thing the mechanism can promise.

## The three things I would do next, in order

1. ~~**Close the onboarding hole.**~~ Done — a separate lifetime budget for
   the introduction, falling through to the daily one. See HANDOFF §3.0 for
   why neither of the two options I first proposed was right.
2. **Run the real-model session.** Half of this document is a ⚠, and after
   three passes the half I can reach is thoroughly worked over. The remaining
   findings are not going to come from reading the transcript again.
3. **Trust this document less than the transcript.** ~~Two~~ **six** of its
   claims have now been the harness rather than the product, and every one
   looked exactly like a real finding — three of them in this run alone,
   before it could see anything (§0). The tool announces two classes of that
   slip itself now and scopes its own reads; the habit that catches the rest
   is checking the row before writing the sentence.

---

## What the third run leaves behind

**One product change**, and it is small and clearly right: the line that
explains a negative money figure is no longer suppressed by a floor meant for
pattern claims.

**Five harness fixes** (the three in §0; the transcript's own summary line
reporting "she took 16 messages" against a plan that says twenty a day — she
accepted fifteen there and five earlier, and the product was exactly right;
and a warning the tool did not carry, after I ran it beside the test suite on
the same database and it delivered the suite's outreach out from under a
scheduler test). Five to one is the honest ratio for a third pass over the same day — the product's own machinery has been read closely enough that what
is left to find in it needs either a model or a person. Specifically:

- **A screen reader and somebody who uses one.** The keyboard half is done and
  tested with real key events. How any of it is *announced* is not something
  reachable from here, and it is now the largest unexamined surface in the
  product.
- **A native Arabic reader.** ~487 authored strings, judged by their author.
- **The model.** Everything marked ⚠ above.

None of those is a thing to keep re-deriving from a transcript.
