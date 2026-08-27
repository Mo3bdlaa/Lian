# Lian — Screen Coverage Matrix

Status: ✅ purpose-built · ◐ standard desktop fallback, or (in the Mobile
column) **partly built — the row says which part**

| Area | Mobile | Desktop | RTL | Key states |
|---|---:|---:|---:|---|
| Chat | ✅ | ✅ | ✅ | thinking, streaming, retry, offline, reply, reactions, voice, history, delete/provenance |
| Tasks & notes | ✅ | ◐ | ✅ | empty, recurring, edit task/note, delete |
| Money | ✅ | ✅ | ✅ | summary, correction, receipt, empty |
| Memory | ✅ | ✅ | ✅ | full, empty, add, edit, delete, search, provenance, free-limit queue |
| Our story | ◐ | ◐ | ✅ | stage as prose, timeline of milestones; **moments and inside jokes NOT BUILT** |
| Health | ✅ | ◐ | ✅ | chat capture, week, correction, empty |
| Album | ✅ | ◐ | ✅ | grid, user sends, assistant sends, viewer, empty |
| Assistants | ✅ | ◐ | ✅ | single-assistant state, create second, switch (2+), active identity, gender, profile |
| Settings | ✅ | ◐ | ✅ | quiet hours, language/style, personality, voice |
| Security | ✅ | ◐ | ✅ | chat alert, devices, attempts, revoke, quick lock |
| Data | ✅ | ◐ | ✅ | export, ready, delete, completion |
| Account | ✅ | ◐ | ✅ | welcome, signup, signin, reset, errors |
| Consent | ✅ | ◐ | ✅ | 18+, legal text, agreement, under-18 |
| Subscription | ✅ | ◐ | ✅ | checkout, success, manage, cancel |
| Notifications & permissions | ✅ | ◐ | ✅ | pre-prompt, OS dialog, lock screen, in-app |
| PWA install | ✅ | ◐ | ✅ | pre-prompt, native install, first installed launch |
| Splash / 404 / outage | ✅ | ◐ | ✅ | startup, not found, unavailable |
| Onboarding conversation | ✅ | ◐ | ✅ | introduction, naming, Auto/language, first remembered detail |
| Morning briefing | ✅ | ◐ | ✅ | proactive, requested, chat, dedicated screen |
| Search | ✅ | ◐ | ✅ | conversations, grouped results, open in place, memory search |
| User profile | ✅ | ◐ | ✅ | name, about me, what assistant should know, self-authored notes |
| Free limit | ◐ | ◐ | ✅ | reached (built); **approaching NOT SHOWN**; memory capacity, pending memories, quiet upgrade |
| Conversation types | ✅ | ◐ | ✅ | main, side, incognito, scenario role, edit/clear, switcher |
| Account recovery | ✅ | ◐ | ✅ | forgot, link sent, new password, every other session ended |
| Navigation drawer / rail | ✅ | ✅ | ✅ | grouped secondary nav, assistant header, open/close, desktop rail |

## Desktop fallback rule

Every `◐` row uses persistent left rail + centered 720px main column at 900px+ (800px for legal/long-form), no bottom navigation, desktop dialogs/side sheets, and RTL mirroring. Only Chat, Money, Memory require purpose-built wide layouts for v1.

## This matrix was wrong, and how it was caught

**Audited by grep, then audited by USE — and use found more (2026-08-27).**

The first pass followed each key state to the code that serves it. It found
one row overclaiming: **`scenario role` was built on the server and nowhere
else** — the column, its CHECK constraint, the prompt block in the override
zone, an injection test, and a create route that accepted the field, with
nothing a person could touch. (Two others looked missing and were not:
`recurring` is built as habits, and `quick lock` is `sign-out-everywhere`.)

Then I signed up and used the product, and found **two more rows this file
claimed**, both of which the grep pass had missed because I had not thought to
grep for the word:

- **Our story's timeline.** `story_events` had held the three types UI-UX §8
  names since migration 0001, with an index, and no code had ever written a
  row. It spent exactly one run as a named "NOT BUILT" exemption in
  `tools/gates/wired.ts`, printing on every CI run, and then got looked at and
  closed — which is what an announced hole is for. **Milestones are built**
  and derived from facts the product already has: the day you started talking,
  and each stage reached. **Moments and inside jokes are not**, and that split
  is deliberate: deciding something WAS a moment is a judgement only she can
  make, which is a control tag, which under LESSONS §21 is a promise that has
  to name the mechanism keeping it. That is a capability, not a repository
  function, and building half of one to fill a screen is how these holes
  happen in the first place.
- **Free limit's "approaching".** `messagesRemaining` reaches the client in
  every snapshot and **no screen reads it**. The *reached* state is built and
  good; the quiet indicator near the end is not there at all.

The lesson is in LESSONS §20, and the point of writing it here is that **a
coverage matrix is a claim checked by the person making it**. Two of these
rows survived seven runs of review with a ✅ against them. What broke them was
one afternoon of using the product as a person rather than reading it as an
author — see `docs/FIRST-IMPRESSIONS.md`.

**Every other mobile row is built (2026-08-27).** The switcher was the last
screen:
`/api/conversations` lists every thread including incognito — unlike search,
which must never see one — and closing a side thread keeps its messages,
because they are the provenance of what she remembered, while deleting an
incognito thread takes its photographs with it.

**Built as stated (2026-08-26).** One breakpoint at 900px, in one block at the
end of `apps/web/styles/app.css`, and one rule for everything not
purpose-built — so a screen added tomorrow gets the desktop layout by
existing. There is no second component tree: the same markup a phone renders
is laid out differently, and the two-column wrappers are `display: contents`
below 900px, so a phone renders exactly what it rendered before they existed.

The rail is the bottom nav element, restyled, with the drawer's groups
rendered from the same array the drawer uses — two copies of that list is how
one of them quietly loses an entry. The chat's right-hand contextual panel is
genuinely optional: it appears at 1200px, renders from the snapshot the app
already has, and nothing about the conversation depends on it.

`apps/server/src/browser.test.ts` drives all of it at 1280px in real
Chromium — the rail's shape and position, the 720px fallback column across
five screens, and the two-column split collapsing back to one on a phone. A
media query that never matches looks exactly like one that does.
