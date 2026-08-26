# Reconciliations

Where a screen file and the specs disagreed, and what was decided.

The rule (this run's standing instruction): **the screens in
`design-system/screens` are the built truth for visual implementation; the
specs in `docs/specs` are the truth for behaviour, copy and scope.** Nothing
below was decided silently.

---

## Which of these changed the specs

Asked and answered on 2026-08-26: some of these were the SPECS being wrong,
and the specs are what the next person reads. Of the thirteen:

| # | Verdict |
|---|---|
| 1, 2, 4, 5, 7 | The build followed the specs. Nothing to change. |
| **6** | **Spec amended** — UI-UX §5 now carries the capacity line's second sentence. The screens had it; the spec named only the first half. |
| **9** | **Spec amended** — UI-UX §34.3. The waveform is a *may*. And the entry itself was out of date: storage shipped, so voice notes are real in both directions. Rewritten below. |
| **10** | **Spec amended** — UI-UX §16. The device label and place are derived and approximate; the spec should not promise what a user-agent string cannot carry. |
| **11** | **Spec amended** — UI-UX §4. "All structured captures" was written before anyone noticed the three identity tags share one row. |
| 3 | Neither. `design.md` gives a RANGE (18–22px) and both tokens sit inside it — so nothing disagrees with the spec. What is wrong is the DESIGN SYSTEM: `--r-bubble` is named for a component and is not the value any bubble draws. Repoint it to 20 or delete it; an unused token named for the job is a trap for whoever reaches for it next. Left for a design decision, not taken here. |
| 8 | Neither. Device chrome in a screen frame is not a spec statement. |
| 12 | Neither — remaining work, not a disagreement. Shrinking as the coverage matrix is built out. |
| **13** | **The entry was wrong, not the spec.** Corrected below. |

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

**9. Voice notes as a waveform.** *(Rewritten 2026-08-26 — the gap closed.)*
The screens show a voice note as a bubble with a waveform and a duration.

Object storage now exists, so the gap this entry used to describe is gone:
a voice note is uploaded, transcribed on the way into the turn, and the
audio is kept beside the transcript. The transcript is still the message
BODY — memory, search and the rolling summary all read bodies, so a message
whose content is an opaque audio blob is one the product cannot think about
— but the recording is no longer thrown away, and it plays back in the
thread. Her own sentences are spoken on demand, from the same store.

What remains a divergence, and is now a deliberate one: **there is no
waveform.** Playback is the platform's own audio element. *Decision:* the
spec is wrong here and has been amended (UI-UX §34.3). A hand-drawn player
has to reimplement scrubbing, buffering, the lock screen, the system volume
and the media session; trading those for a picture of a sound is worse for
the person holding the phone. The recording state keeps an elapsed counter
rather than a live waveform, which is the one part of §34 still owed.

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

## Attachments

**14. A photograph is read by a model, and a model reads what is written on
it.** *(Added 2026-08-26, with the vision path.)*
PRD §6.5 wants a spend captured from a photographed receipt. Nothing in the
specs says which model looks at the picture. *Decision:* the analysis path,
never hers. An image is the most untrusted input in the product — anyone can
write an instruction on a piece of paper and photograph it — so it goes to
`@lian/analysis`, which may return exactly five validated fields, and what
reaches her turn is one line composed from them. Capture still happens
through her `<spend>` tag, so money keeps one write path and a misread
receipt is corrected exactly like anything else. LESSONS §1a, applied to a
channel that did not exist when §1a was written.

## Behaviour

**13. Correction sheets are forms.** *(Corrected 2026-08-26.)*
This entry used to read "and PRD §14 says no forms". It does not: PRD §14 is
Internationalization, and no spec anywhere says "no forms". The rules that
do exist are UI-UX §7 ("No add button.") and UI-UX §4 ("No manual add-first
flow", "must look like conversation metadata, not a form"), and both are
about CREATING, not correcting.

So there was never a disagreement to reconcile — which is worth leaving on
the record, because an invented rule cited confidently is harder to catch
than a real one applied wrongly. *Decision (unchanged, and now for the right
reason):* the correction sheet can only ever change something she already
wrote down. There is no route that creates a task, a transaction or a note —
the server has no create endpoint at all, which is what makes this checkable
rather than a habit.
