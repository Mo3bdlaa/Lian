# Reconciliations

Where a screen file and the specs disagreed, and what was decided.

The rule (this run's standing instruction): **the screens in
`design-system/screens` are the built truth for visual implementation; the
specs in `docs/specs` are the truth for behaviour, copy and scope.** Nothing
below was decided silently.

---

## Type

**1. The promise heading on the welcome screen.**
The screen sets `--fs-30 / --lh-40`. The role tier (`lian-type-roles.css`)
has no 30 — application code chooses a ROLE, and the nearest is `h1`
(28/36). *Decision:* `--t-h1-*`. The role tier exists precisely so that
application code stops choosing between 28 and 30 by feel (TOKENS.md §2,
LESSONS §9), and the difference is two pixels.

**2. Numeric type tokens are unavailable to the app.**
Every screen file uses `--fs-16`, `--lh-24` and so on directly. Application
code may not (`tokens:raw` fails the build). *Decision:* every screen in
`apps/web` uses `--t-<role>-fs|lh|fw`. This is a difference in kind, not in
value: the screens are the reference set and were audited when they were
produced.

## Shape

**3. Bubble radius.**
`--r-bubble` is 18px; the chat screens draw bubbles at `--r-20`.
*Decision:* the built screens win on visual implementation, so bubbles use
`--r-panel` (20px) — the token whose value matches what was drawn — rather
than the token whose name matches. Renaming or repointing `--r-bubble` would
change the design system to match one reading of it; that is a design
decision, not an implementation one, and it is left alone.

## Copy

**4. `chat.empty` in Arabic.**
Catalogue: «لسه ما اتكلمناش. أنا هنا في أي وقت.» Screen: «لسه ما تكلمناش…».
*Decision:* the catalogue. The specs are the truth for copy, and the
catalogue is the specs' copy layer — it is also the only place the Arabic
address gate can see.

**5. `error.offline` in Arabic.**
Catalogue: «هلحق كل حاجة أول ما أقدر.» Screen: «هلحق على اللي فاتني لما أقدر.»
Same decision, same reason.

**6. The memory capacity line.**
The screen reads as one sentence: "I can keep up to 100 lasting memories on
the free plan. 34 so far." The catalogue key stops at "free plan."
*Decision:* a second authored key, `memory.kept_so_far`, with `{n}` for the
count. Both languages are authored; the only thing substituted is a number,
which has no grammatical gender in either.

**7. "Where it went" / «أكتر أربع بنود».**
The English names the question, the Arabic names the answer ("the top four
items"). *Decision:* kept as authored, in both languages. This is what
"authored together, never one derived from the other" (LESSONS §10) looks
like when it is working.

## Scope

**8. The iOS status bar.**
Every screen frame draws one (`LianStatus`: 9:41, signal, battery).
*Decision:* not implemented. It is a device chrome mock for the reference
set; the OS draws it. The app reserves the space instead
(`env(safe-area-inset-top)`).

**9. Voice notes as a waveform.**
The screens show a voice note as a bubble with a waveform and a duration.
*Decision:* the transcript is the message. There is no object storage yet
(HANDOFF has said so since the third run), so the audio has nowhere to live
— and a transcript is searchable, correctable and rememberable, which the
audio would not be. The recorder UI matches the screens; what it produces is
text. **This is a gap, not a redesign.**

**10. Device names on the Security screen.**
The screen shows "iPhone · this device". A browser does not tell a server
what kind of phone it is beyond a user-agent string. *Decision:* derive a
short label ("iPhone", "Mac · Safari") from the UA, and show nothing more
precise than that string can carry.

**11. Identity capture rows in history.**
UI-UX §4 shows an inline confirmation row under her message. For tasks,
money, notes and health it stays: it is the correction handle. For the
identity tags (what to call you, which language, her name) all three write
to the same row, so re-reading a conversation cannot tell them apart.
*Decision:* the identity chip is a MOMENT — shown live as it is captured,
absent on re-read. Those facts are corrected in Settings, which is where the
row's route already pointed.

**12. Screens that are in the drawer and not in this build.**
Search, Album, Morning briefing, Health, Assistants, About you,
Subscription, and the three Settings sub-screens are specified, are in the
drawer, and are not built. *Decision:* they are routes that say "This part
is not built yet." A drawer item that silently renders the conversation is
worse than one that says what it is.

## Behaviour

**13. Correction sheets are forms, and PRD §14 says no forms.**
§14 says "no add buttons anywhere" and UI-UX §4 says every capture is
tappable and correctable. *Decision:* the correction sheet is the only form
in the product, and it can only ever CHANGE something she already wrote
down. There is no route that creates a task, a transaction or a note — the
server has no create endpoint at all, which is what makes this checkable
rather than a habit.
