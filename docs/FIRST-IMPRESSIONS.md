# First impressions

I signed up as somebody called Rania, talked to Lian for a while, let a day of
ticks pass, came back, corrected something, deleted a memory, and hit the free
limit. This is what that was like.

It is not a bug list. Bugs found on the way are in HANDOFF and most of them are
fixed; what is here is a read on whether the thing works as the thing it is
meant to be.

**What I could and could not judge.** There is no model key in this
environment, so her replies came from `tools/preview.ts` — a scripted provider
whose answers I wrote. So I cannot tell you whether she sounds like herself.
What I *can* judge is everything the product itself says: ~470 authored
strings, every empty state, every error, the prompt that constitutes her
character, and the shape of what happens on day one. That turned out to be
plenty, because almost everything wrong was in that half.

---

## 1. The best thing about it is real, and it is the first thirty seconds

The first message is not a screen. It is:

> Good to meet you. I'm a secretary, more or less — I keep track of what you
> tell me. What should I call you?

No account setup, no permissions dialog, no tour. I answered in words and it
worked. Then it asked one thing at a time, and — this is the part that is
genuinely good — **it asked in whatever order I had left things unanswered**,
not in a fixed sequence. `nextStep` derives the question from what is still
missing, so somebody who says "I'm Rania, and you can be Lian" in one sentence
is not asked both again. That is a real design idea and it is implemented
exactly as described.

And then:

> I'll remember that you run every morning before work. That's the sort of
> thing I keep.

Followed by a memory row I could go and look at, with a link back to the
message it came from. The promise of the product is "she remembers me", and
within four messages it had been made, kept, and shown its working. Nothing
else I have seen in this category does that in the first minute.

The permission ask comes *after* that sentence, deliberately, and it is the
right call — by then you have seen what the permission is for.

**What is unquestionably right:** no forms anywhere; every captured thing is a
tappable chip in the conversation; the free limit says *"That's my limit for
today. I'll still be here tomorrow, and I'll keep what we talked about"* and
does not mention money. The relationship screen says *"There is nothing to
unlock and nothing to lose."* The whole product has one voice and it is a
restrained one.

---

## 2. The thing that broke my trust, and it is the core promise

I said: **"remind me to call the bank."**

She said: **"I'll remind you."**

She cannot. The model emitted `<todo>{"title":"call the bank"}</todo>` with no
date, because I did not give one. A task with `due_on IS NULL` matches
`due_on = $2::date` in no outreach query, does not satisfy `dueOn === localDay`
in the briefing's *Today*, did not satisfy `dueOn !== null` in *Carried over*,
and is not a habit. **It was in no block of any screen she raises unprompted,
and no reminder would ever have fired, on any day, forever.**

Every part of that is individually correct. The capture worked, the row is
right, the chip is right, the Tasks screen shows it. And the one sentence the
product exists to make true — *I'll remind you* — was false, silently, the
first time I asked for it.

The Tasks screen says **"No date"** beside it, which reads as *whenever*. The
truthful word was *never*.

Fixed this run: the briefing's *Carried over* now includes tasks that never had
a day, labelled "No day set". Deliberately not added to outreach — a dateless
task that pushed a notification every morning until it was done is the nagging
LESSONS §4 exists to prevent. She raises it where she lists things; she does
not chase.

**What is still not fixed, and needs a person to decide:** she should probably
ask for a day when none is given. That is a prompt change and I am not willing
to tune a prompt blind against a scripted model.

---

## 3. Where it feels thin

**The briefing on day one is a money figure and four empty lists.** After a
real conversation — a name, a language, a memory, a spend, a task — the
morning briefing had `line: null`, empty today, empty carried-over, empty
habits, no pattern, and one number. She has no sentence to say because she has
not written one yet, and the screen correctly refuses to invent her voice.
That is the right *rule* producing a thin *screen*. The first briefing is
somebody's first impression of the product's second-biggest idea, and it is a
figure and some whitespace.

**"Our story" was a five-rung ladder.** All five relationship stages rendered
as cards, three of them ahead of me, with their prose spelled out — on the page
whose own copy says *"There is nothing to unlock and nothing to lose."* The
page argued with itself and the ladder won, because the ladder was the part
with pictures. UI-UX §8 says "Show current state as prose, not progression".
Fixed: one stage, the one you are in.

**The Security screen cannot answer the question it exists for.** My only
device is labelled `Device`, with a timestamp and `location: null`. The screen
is for deciding *was that sign-in me?* and it offers nothing to decide with.
The spec asks for location/time metadata; the time is there and nothing else
is. Not fixed — it needs a User-Agent parse and an IP-to-city lookup, and the
second is a third-party service and a privacy decision, not a patch.

**The timeline in "Our story" did not exist at all.** `story_events` had held
the three types the spec names — milestone, moment, inside joke — since
migration 0001, with an index, and no code had ever written a row. The coverage
matrix said ✅. It became a named exemption in `tools/gates/wired.ts` printing
"NOT BUILT" on every CI run, and then it got looked at: **milestones are built**
(the day you started talking, each stage reached), and moments and inside jokes
are scoped out with a reason — that is a judgement only she can make, which is
a capability, not a repository function.

**Money's "her observation"** (UI-UX §7) is not in the view either. The screen
is figures and a list, with nothing of her on it — on a screen the spec wanted
her voice on.

---

## 4. Where the copy is wrong in a way no test catches

Every string below is authored, in both languages, addressee-tagged, and passes
the Arabic gate. Each is wrong *in place*, which no test looks at.

**"Still with you."** The mood phrase over the very first message somebody ever
reads. It is the right sentence for a person coming back and the wrong one for
a stranger — it claims a continuity that has not happened. Fixed: an authored
first-meeting phrase, used while onboarding is unfinished.

**"What's left: −AED 400."** I told her about one payment and no income, so
in-minus-out was negative, and that was the biggest number on the Money screen
— a headline that reads as debt for somebody who mentioned one gym fee. Fixed:
with no income recorded the headline is what went out; "What's left" waits
until it is true. Both figures stay underneath, as §7 asks.

**"en".** The capture chip confirming the language I had just chosen showed the
raw code. The eight language names existed — in `packages/prompt/src/blocks.ts`,
authored for the *model's* prompt and nowhere for the person. Fixed: authored
in the catalogue, in both languages, in UI-UX §47's exact wording.

**"I couldn't make out that recording. Tell me instead?"** What a free account
was told when it sent a voice note. Voice is paid-only. The sentence says the
product is broken when the truth is the feature is on the other plan; a paid
user out of minutes got the same sentence. Three outcomes, one string. Fixed.

**"No date"** on the Tasks screen — see §2. Reads as *whenever*, means *never*.

---

## 5. What a stranger asks on day one that the product cannot answer

**"Where did the thing I just corrected go?"** Every capture chip carries a
`correctionRoute` pointing at the exact row. The client parsed the id out of
the URL and **dropped it on the floor** — `match()` returned params and nothing
read them. Tapping "AED 400 · gym · Today" opened the Money *list* and left you
to find the row again. On the product's signature interaction. Fixed.

**"How do I change the language?"** The chip's route was `/settings/language`.
That route was in `ROUTES`, `screenFor` had no case for it, so it fell to the
default and rendered **the conversation** — with `/settings/language` still in
the address bar. The `set-language` action handler already existed, waiting for
a screen that had never been built. Fixed: the screen exists, with §47's eight
options and its sample line.

**"How many messages do I have left?"** Nothing shows it. `messagesRemaining`
travels in every snapshot and no screen reads it. UI-UX §19's "approaching"
state does not exist — you find out at zero. (The *reached* message is good,
and arrives in the conversation, which is right.) Not fixed.

**"Why are onboarding messages free?"** They are, and nothing says so. The
message counter only starts once onboarding finishes, so I sent nine messages
against a "20 a day" plan and the app still said 20. The monthly cost ceiling
is the real bound, so the business is safe — but the number on screen was
wrong for the first nine messages of a person's life with the product.

**"Does she know it's me?"** — see the Security screen above.

---

## 5b. And then I looked at it

`npm run shots` photographs 95 screens. Four things were wrong in ways that
were invisible in HTML, in tests, and in prose, and obvious in a picture.

**`AED 127.5`.** In the Money headline, the largest text on the screen. The
formatter said `minimumFractionDigits: 0`, so a half-dirham lost its second
decimal and read as a typo. Every test asserted `AED 400` — the one amount
where two decimals and zero decimals agree.

**`AED 400 · gym · 2026-08-24`** on a capture chip, three lines under a day
separator reading "25 August". The chip returned the raw column for anything
that was not today.

**Five transactions, none photographed, every one captioned "from a
receipt".** `fromReceipt` was `originMessageId === null` — not what that
means, and backwards, since a real receipt capture HAS an origin message.
`transactions.receipt_id` has existed since migration 0002 and nothing has
ever written it, so nothing can answer the question. A fourth §20.

**She says nothing on day one.** The first screen a new person sees is an
empty conversation: *"We haven't talked yet. I'm here when you're ready."*
Her greeting — the "Good to meet you. I'm a secretary, more or less" that §1
calls the best thing about the product — only happens in reply to their first
message. Meanwhile the prompt instruction she is given for that step reads
**"This is the very first thing they will read from you."** It is not. The
instruction is written for an assistant opening a conversation and the
mechanism has her answering one.

That last one is not a bug I fixed, because it is a product decision with a
cost: greeting somebody at sign-up means a model call per account, and it
changes what the app is on first open — a person, or a text box. It is at the
top of HANDOFF §3 with both options. The first three are fixed.

## 6. The pattern underneath most of this

Four things this afternoon had the same shape, and it is now LESSONS §20:

| | declared | connected |
|---|---|---|
| The incognito role | column, CHECK, prompt block, zone, injection test, create route | nothing a person could touch |
| The story timeline | table, three types, index | nothing at all |
| The key pool | class, tests, table, a second key read at startup | `modelApiKeys[0]` |
| `/settings/language` | route, action handler | no screen |

Each looks finished from wherever you happen to be standing. A migration
reviewer sees a table; a prompt reviewer sees a block; a router reviewer sees a
route. Nothing read across the seam, so nothing objected — and the coverage
matrix said ✅ because it was checked by the person making the claim.

The key pool one is the most expensive: `ANTHROPIC_API_KEY_2` was read,
validated at startup, carried through config, and discarded. When the first key
rate-limits, she stops answering, with a spare key sitting unused. That is
LESSONS §12's own rule, written down, implemented, tested, and unplugged.

`tools/gates/wired.ts` now reads across two of those seams on every build.

---

## 7. So: does it work as the thing it is meant to be?

**Yes, in the first five minutes, and that is the hardest part to get right.**
The conversation genuinely is the interface. Nothing asked me to fill anything
in. She remembered something and showed me where it came from. The restraint is
real and it is everywhere — no streaks, no scores, no day counts, no upgrade
nag at the limit.

**The gap is between what she says and what the machinery does.** "I'll remind
you" was the clearest case, and it was not a bug in the reminder system — the
reminder system is fine. It was a promise made in one place by a model and kept
in another place by a query, with nobody standing where you could see both. The
product's whole design is that she speaks for the machinery, which means every
one of those seams is a place she can be made to lie.

The tests are excellent at the things they test and structurally cannot see
this class. `hardening.test.ts` attacks the product as a stranger; nothing uses
it as its owner. That is the missing test file, and I do not think it can be
written — it is a person, signing up, and asking her for a reminder.

**What I would do next, in order.** Make her ask for a day when a reminder has
none. Give the Security screen something to recognise a device by. Give the
first briefing something to say. Then the story timeline, which is the largest
genuinely unbuilt thing left and the only one whose absence a person would
notice as an absence rather than as a thinness.
