# HANDOFF

Sixth run. The library has a face: you can open it, sign up, talk to her,
correct what she wrote down, read everything she remembers, delete it, and
have her message you first.

`npm run verify` is green: typecheck (two projects — server and browser),
11 gates, **445 tests**, including 14 that drive real Chromium.

**Every number below states the assumption it rests on.** Where an
assumption is soft, it says so.

---

## 0. What this run built

### The app is server-rendered HTML and native ES modules

No build step here either. Node strips the client's TypeScript types
itself (`stripTypeScriptTypes`), so the browser code is written in
TypeScript, typechecked by the same `tsc`, scanned by the same gates —
and served as modules the browser loads natively. The asset pipeline
walks the import graph from one entry, rewrites specifiers to served
URLs, and refuses to send a module that imports `node:` anything.

One consequence is load-bearing: `@lian/i18n`, `@lian/domain` and
`@lian/design` are pure, so **the browser imports the same modules the
server does**. There is no second copy catalogue, no second theme
resolver and no second `t()`. When the theme gate caught the client
writing `data-t` itself, the fix was to serve the real writer rather than
to grant an exemption.

### The screens

Welcome, sign-up, sign-in, the new-device hold; chat; memory; tasks &
notes; money; our story; settings; security; data. The five-tab nav, the
grouped drawer, RTL, the five palettes, and the PWA (manifest, generated
icons, service worker, install offer).

Everything renders from the token layer. `tokens:raw` scans
`apps/web/styles/app.css` exactly as it scans the design system: no hex,
no numeric type token, no raw radius, no raw duration, and every
interactive control at `--tap-min`.

### Tests, in three layers

- **String render** (`apps/web/src/screens.test.ts`): every screen is a
  pure function of state, so what it produces is asserted directly — a
  message body escaped, a control tag rendered as text, no add button, no
  number on Our story, provenance on every memory, and for ten screens
  that the Arabic rendering has **no English left in it**.
- **Browser** (`apps/server/src/browser.test.ts`): real Chromium over the
  DevTools protocol, no driver dependency. Sign-up through the form, a
  turn streaming into the DOM, the theme as one attribute with no inline
  colour anywhere, the notification ask arriving only after she has
  remembered something, export and deletion end to end, the new-device
  hold, RTL resolving the Arabic type scale, and she-messages-first
  landing in an open conversation.
- **Service worker** (`apps/server/src/push.test.ts`): the worker source
  executed in a fake worker global, fed the payload the tick actually
  produces. A push arrives with **her sentence** in it, drawing is inside
  `waitUntil`, and tapping it focuses the window already open.

### Three bugs older than this run, found by building on top of them

1. The boundaries gate's own pattern was `/@lian\/([a-z]+)/` — no digit —
   so **every import of `@lian/i18n` was silently unchecked**.
2. The raw-shadow rule backtracked past its lookahead and reported the
   correct spelling as a violation.
3. `date` columns came back from the driver as `Date` objects while typed
   as `string`, so `occurredOn === localDay` — which decides whether a
   capture row says "Today" — could never be true.

---

## 1. Decisions, ordered by what they cost to reverse

### Very expensive — a migration, a backfill, or somebody's data

1. **Postgres + pgvector, 1024-dimension vectors.** Unchanged. Changing
   the embedder's width is a re-embed of every memory.
2. **Extraction sanitises on the way in** (LESSONS §1a). Memories are
   stored sanitised; reversing it does not restore what was stripped.
3. **The system/turn channel split.** Reversing it gives up history
   caching, which is most of the saving.
4. **`rate_limits` and `idempotency_keys` in the database**, and the
   client contract that every write carries an `idempotency-key`.
5. **`messages.reply_to_id` and `message_reactions`** (migration 0008).
   One reaction per person per message — the primary key is UI-UX §36's
   "keep it compact. No large emoji tray" as a constraint.

### Expensive — a public contract, or a promise to a person

6. **The capability registry's sixth consumer, `describe()`.** A captured
   row reads back as the line UI-UX §4 shows, in the language it is being
   read in NOW. Storing the line at capture time would freeze the
   language; every capability answers for its own rows, and a test walks
   the registry rather than a list.
7. **The API shape**, now with reads: `/api/me` (one snapshot: theme,
   mood phrase, stage NAME, capacity line — resolved server-side),
   messages with keyset paging and a `since` catch-up, memories, tasks,
   money, story, security, settings, voice.
8. **The client is told what to show, not how to decide.** The theme is
   resolved server-side (LESSONS §7), the mood arrives as a phrase and
   never a score (UI-UX §3), and the relationship arrives as a name with
   **no day count anywhere in the response** (LESSONS §6).
9. **Correction sheets are the only forms, and they cannot create.** The
   server has no create route for tasks, transactions, notes or health —
   which is what makes PRD §14 checkable rather than a habit.
10. **Every string is in the catalogue.** The Arabic gate gained a second
    rule: no Arabic literal in `apps/` or `packages/http`. Prompt-side
    Arabic (personas, capability fragments, word lists) is addressed to
    the model and stays where it is.
11. **The free tier: 20 messages a day, 600 a month, a $3.00/month model
    ceiling, on Sonnet 5.** Unchanged, and still printed with its
    assumptions. `npm run report:economics` prints measured beside
    assumed; the cache-write share is still a guess labelled as one.

### Moderate — a decision people will feel, changeable in a day

12. **A voice note is a transcript.** There is no object storage, so the
    audio is not kept. The recorder matches the screens; what it produces
    is text — searchable, correctable, rememberable. Reconciliation 9.
13. **The identity capture chip is a moment, not a row** (reconciliation
    11): shown live, absent on re-read, corrected in Settings.
14. **She catches up on a twenty-second beat while the tab is visible**,
    and immediately when it returns to the foreground. Polling rather
    than a second stream: a proactive message arrives a few times a day
    and a persistent connection per tab is a poor trade.
15. **Screens in the drawer that this build does not have say so.** A
    drawer item that silently renders the conversation is worse.
16. **A test client address per test file** (`192.0.2.0/24`,
    `198.51.100.0/24`, `203.0.113.0/24`). Sign-up is rate limited per
    address; two files sharing one made the limiter the thing under test,
    and only when they ran in the same minute.

### Cheap — a line, a number, a file

17. **`@lian/design/server`**: the filesystem half of the design package,
    split out so the rest can be served to a browser.
18. **Icons generated by the browser that is already here**
    (`node tools/icons.ts`), committed, with a maskable pair.
19. **Assets rebuilt per request in development**, built once at boot in
    production.
20. **`tools/preview.ts`** runs the real app with a scripted model for
    looking at screens. Test tooling, not a product mode: `main.ts` does
    not import it and no environment variable selects it.

---

## 2. What is stubbed, and what does not exist

- **Screens named in the specs and not built here**: Search, Album,
  Morning briefing (as a screen — the briefing itself is scheduled and
  delivered), Health, Assistants, About you, Subscription, and the three
  Settings sub-screens. Each is a route that says so.
- **No email transport**, so a device confirmation cannot be emailed. The
  sign-in stays held — the safe direction — and she raises it in chat.
- **No object storage**: attachments, receipt photos and audio have
  nowhere to live. Deletion reports the count that *would* have to go.
- **No real embedder or speech key configured.** Production refuses to
  start without the first; voice reports `voice_unconfigured` without the
  second, and the client falls back to text with her line.
- **No subscription or payments.**
- **A real web push has never been received on a real device.** Every
  layer is tested — VAPID, RFC 8291 encryption, delivery, the worker
  drawing the notification — but a sandbox cannot subscribe to a push
  service. **This is the one link in "she texts you first" that is proven
  in parts rather than end to end.**
- **`prefers-reduced-motion` is honoured; nothing else in the
  accessibility pass has been audited** — no screen reader run, no
  keyboard-only pass.

**Never built, per your instruction:** no hidden mode, no admin data
path.

---

## 3. What will block me next

1. **A device.** The push path needs one real subscription against a real
   push service to close the last gap in item 2.
2. **Keys**: embedder (production will not start without one), speech
   (voice is otherwise unavailable), VAPID (or push has nowhere to go).
3. **The remaining screens**, in the order the drawer lists them — Search
   first, because it is the one people will look for once memory has
   anything in it.
4. **Arabic still needs a native pass.** The catalogue is now ~250
   strings and the gate proves none of them assumes the user's gender; it
   cannot prove the register is right. Male-voice Arabic is still mostly
   the feminine string returned unchanged.
5. **An accessibility pass**, including a keyboard-only run over the
   sheets — they are the part most likely to trap focus.

---

## 4. Where to look

```sh
npm run up                      # migrate, server, ticker
npm run verify                  # typecheck, 11 gates, 445 tests
node tools/preview.ts 8790      # the app, with a model that costs nothing
node tools/icons.ts             # regenerate the app icons from the mark
npm run report:economics        # the free tier, every assumption named
```

| File | Why |
|---|---|
| `apps/server/src/assets.ts` | how the client is served, and what may reach a browser |
| `apps/web/src/main.ts` | boot, routing, one delegated listener, the turn |
| `apps/web/src/screens/chat.ts` | the screen the product is |
| `apps/web/styles/app.css` | the token layer as it ships |
| `apps/server/src/browser.test.ts` | the app, running |
| `docs/RECONCILIATIONS.md` | every place the screens and the specs disagreed |
