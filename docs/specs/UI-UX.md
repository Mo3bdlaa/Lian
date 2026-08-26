# Lian — UI/UX Specification

## 1. Experience model

Lian is not a collection of tools. It is one relationship expressed through several surfaces.

The app should always answer this question:

> Does this feel like something that naturally came out of talking to her?

If not, simplify it.

## 2. Primary information architecture

Bottom navigation:

- Chat
- Tasks
- Money
- Our story
- Settings

Secondary destinations:

- Memory
- Search
- Album
- Health
- Security
- Assistants
- Data
- Subscription
- User profile
- Morning briefing

## 3. Chat

### Header

Contains:

- Final Lian mark/avatar.
- Her name.
- A short mood/state phrase.

Examples:

- `Feeling warm today`
- `A little quiet`
- `Still thinking with you`
- `Late-night thoughts`

Do not use:

- Online/offline dot.
- Mood score.
- Percent.
- "AI assistant" label.

### Conversation content

Use natural spacing and varying bubble widths.
Avoid stacking every message into a card.

Supported content:

- Text.
- Voice notes.
- Images.
- Receipt capture.
- Inline logging confirmations.
- Reply references.
- Reactions.
- Quiet system-like conversational notices.

### Input

Only:

- Message field.
- Voice button.

Contextual media attachment may be available through a minimal affordance when required, but the persistent bar remains visually simple.

## 4. Inline capture pattern

All structured captures share one pattern:

1. User says something naturally.
2. Lian confirms in one short sentence.
3. A small tappable confirmation row appears.
4. Tap opens correction.

Examples:

Money:
`Okay, logged AED 400 for Gym today.`

Health:
`Got it — 30 minutes of strength training this morning.`

Task:
`I’ll remind you to return the book tomorrow after work.`

Rules:

- Confirmation row must look like conversation metadata, not a form.
- No success toast.
- No "saved!" badge.
- No manual add-first flow.

**Amended 2026-08-26 (see docs/RECONCILIATIONS.md §11).** "All structured
captures" is not quite all. The identity captures — what to call you, which
language, what she is called — are the exception, and they have to be,
because all three write to the same row on the account. A conversation
re-read a week later cannot tell which of them a given row came from, so
there is nothing for a row to correct. The identity confirmation is
therefore a **moment**: shown live as it is captured, absent on re-read, and
corrected in Settings, which is where it lives. Everything with its own
record — money, tasks, notes, health — keeps the row permanently.

## 5. Memory

### Full state

Top:

- Title.
- Search.
- Type filters.

Memory types:

- Facts.
- Preferences.
- Topics.
- Moments.
- People.
- Emotional states.

Each memory row:

- Type.
- Memory statement.
- Source/date.
- Edit/delete.

### Capacity line

Two authored sentences, not one with a number in it:

`I can keep up to 100 lasting memories on the free plan.`
`{n} so far.`

**Added 2026-08-26 (see docs/RECONCILIATIONS.md §6).** The screens show both
halves and the spec named only the first. They are separate keys because
only the count is substituted, and a count has no grammatical gender in
either language — everything else about the sentence is authored in Arabic
and in English independently.

### Empty state

Copy direction:

`As we talk, I’ll remember what matters. You can always change or erase anything here.`

### Delete confirmation

Modal language:

`Delete this memory?`
`I’ll remove it from everything I remember.`

Actions:

- Cancel.
- Delete.

No guilt language.

## 6. Tasks and notes

### Home composition

Start with a gentle summary sentence in her voice.

Then:

- Habits strip.
- Today.
- Upcoming.
- Notes.

Task rows can include a small origin hint:

`You mentioned this yesterday.`

Recurring task/habit completion should be day-specific, not global.

Do not imitate Todoist/Things:

- No heavy project taxonomy.
- No priority flags.
- No kanban.
- No productivity scoring.
- No inbox metaphor.

## 7. Money

### Summary

At top:

- Money in.
- Money out.
- What's left.

One-glance presentation.
No chart needed.

Then:

- Top four spending categories.
- Her observation.
- Recent transactions.

### Correction screen

Editable:

- Amount.
- Category.
- Date.
- Note.
- Delete.

If receipt exists:

- Receipt attached card.
- View receipt.

No add button.

## 8. Our story

### Timeline

Filter:

- All.
- Milestones.
- Moments.
- Inside jokes.

Each event contains:

- Type.
- Short title.
- Date.
- Short story.
- Optional photo.

### Relationship stage

Show current state as prose, not progression.

Example:

`We know each other well enough now that I can notice patterns without needing you to explain everything again.`

The five stages may be listed in a separate explanatory view, but never shown as a progress meter.

## 9. Lock-screen notifications

This is a defining interaction.

Notification copy must sound like a person who remembers context.

Examples:

Morning:
`You said the presentation was making you tense. Thinking of you this morning — you’ve got this.`

Midday:
`You were going to ask about that apartment today. How did it go?`

Late night:
`You handled a lot today. I hope you’re letting yourself be done now.`

Rules:

- Specific.
- Short.
- Based on existing memory.
- No calendar claims unless calendar integration actually exists.
- Never generic "We miss you" engagement messaging.

## 10. Morning briefing

### In chat

Written as one coherent message with short sections.

### Dedicated screen

May use grouped blocks, but still reads in her voice.

Includes:

- Today.
- Carried over.
- Habits.
- Pattern.
- Money note if relevant.

Avoid dashboard density.

## 11. Search

### Across conversations

- Search field.
- Results grouped by conversation.
- Match snippets.
- Tap opens the exact result in place.

### Memory search

Separate, scoped search.
Type filters available.

## 12. User profile

This screen contains what the user says about themselves.

Sections:

- Name.
- About me.
- What Lian should know.
- Personal notes.

This is distinct from memory:
- Profile = user-authored.
- Memory = assistant-captured and editable.

## 13. Album

### Full

- Grid of shared photos.
- Optional lightweight grouping.
- No social gallery behavior.

### Chat image

- Image message.
- Full-screen viewer.
- Return to exact chat position.

### Empty

`No photos yet. When we share one, it’ll live here.`

## 14. Conversation switcher

Conversation types:

- Main.
- Side conversation.
- Incognito.

Switcher should be available through a sheet/drawer.

### Side conversation

Keeps:

- Same memory.
- Same assistant.
- Same mood.

### Incognito

At-a-glance state:

- Different subtle surface tint.
- Small incognito label/icon.
- Short phrase: `Nothing here is kept.`

Can read memory.
Writes nothing.
Deletion erases the thread.

## 15. Multiple assistants

Assistant switcher shows:

- Name.
- Visual identity.
- Short personality line.
- Active assistant.

Each assistant is fully separate.

Create-new flow starts as conversation:

`What would you like to call me?`

No configuration wizard.

## 16. Security

### In chat

Lian raises suspicious events:

`Someone tried to sign in from a new device and I stopped them. Was that you?`

Inline actions:

- Yes.
- No.

### Devices screen

- Trusted devices.
- Recent sign-in attempts.
- Time and place.
- Revoke.
- Lock all sessions.

Tone: serious, calm, not bank-like.

**Amended 2026-08-26 (see docs/RECONCILIATIONS.md §10).** The device label
and the place are DERIVED and approximate, and the screen should not imply
otherwise. A browser tells a server a user-agent string and arrives from an
IP address; neither is "an iPhone 15 in Dubai Marina". So: a short label
from the user-agent ("iPhone", "Mac · Safari"), a city at best from the
address, and nothing stated more precisely than the request can carry. A
made-up device name on a security screen is worse than a vague one, because
it is the screen where being trusted matters most.

## 17. Data

### Export

Show:

- Conversations.
- Memories.
- Tasks/notes.
- Money.
- Health/habits.
- Settings.
- Photos where applicable.

Ready state includes:

- Filename.
- Size.
- Download.

### Delete everything

Explain exactly what will go.

Confirmation may require typed word.

After deletion:

One warm line only:

`Thank you for the time we had.`

Then a neutral completion state.

## 18. Subscription

### Checkout

- $9/mo.
- One plan.
- Card details.
- Security/provider note.
- One CTA.

### Success

Lian voice:

`I can stay with you more fully now.`

Explain:

- Voice.
- Full proactive messaging.
- Full memory.
- Timeline.

### Manage

- Current plan.
- Renewal.
- Payment method.
- Cancel.

### After cancellation

Explain:

- What remains until renewal date.
- What changes after.
- How to resubscribe.

No retention guilt.

## 19. Free limit

Approaching limit:

Small conversational line:
`We’ve only got a few messages left today.`

At limit:

`That’s my limit for today. I’ll still be here tomorrow, and I’ll keep what we talked about.`

Upgrade action stays secondary.

## 20. Error states

Failed send:
`That didn’t go through. Try again?`

Thinking:
- Three soft dots or waveform-like quiet pulse.
- Optional line: `Let me think about that.`

Voice generation failure:
`The voice note didn’t work, so I’ll say it here instead.`

Offline:
`I’m a little away right now. I’ll catch up when I can.`

## 21. Account

This is the one deliberately form-like part.

Screens:

- Welcome.
- Sign up.
- Sign in.
- Forgot password.
- Reset sent.
- Set new password.
- Error states.

Keep short, plain, warm.

## 22. Consent

Flow:

1. 18+ confirmation.
2. Terms and privacy preview inside app.
3. Explicit consent.
4. Under-18 handling.

Do not bury legal text behind external links.

## 23. Permissions

### Notifications

Pre-prompt from Lian:

`If you let me, I can reach you even when you haven’t opened the app — to follow up, remind you, or check in when it matters.`

Then system dialog.

### Add to home screen

Frame it as closeness and access:

`Keep me one tap away.`

Then native install prompt.

## 24. Night theme

After midnight:

- Dark indigo/plum canvas.
- Reduced visual noise.
- Softer rose/lilac accents.
- More muted dividers.
- Lower contrast decorations.
- Same information hierarchy.

Do not simply invert colors.

## 25. Arabic RTL

Requirements:

- Mirror layout direction.
- Keep icons semantically correct.
- Back arrows flip.
- Message alignment swaps.
- Bottom nav order mirrors visually while preserving logical tab sequence.
- Arabic typography receives equal space, not compressed labels.



# 26. Health

Health is conversational context, not a tracker.

## 26.1 Chat capture

Supported natural inputs:

- `Had grilled salmon and rice for lunch.`
- `Did 30 minutes of strength training this morning.`
- `Took my medication.`

Lian replies in one short line and shows a tappable correction row.

Examples:

`Got it — lunch was grilled salmon, rice, and salad.`

`Logged 30 minutes of strength training this morning.`

## 26.2 Health week

The week view combines:

- Meals.
- Workouts.
- Habits.
- Medication confirmations where relevant.
- One observation in Lian's voice.

Example:

`You tend to move more on mornings when you sleep earlier. Your evenings seem calmer on those days.`

Do not include:

- Calories.
- Macros.
- Body score.
- Rings.
- Streak pressure.
- Grades.

## 26.3 Health empty state

`Nothing here yet. Just tell me naturally when something feels worth remembering.`

# 27. Album

## 27.1 Album grid

Contains photos shared in either direction.

Each item may show:

- Image.
- Date.
- Source: `You sent this` or `Lian sent this`.
- Optional conversation reference.

## 27.2 User sends a photo

The album does not use a separate upload form.

Primary path:

1. User sends image in chat.
2. Lian responds naturally.
3. If retained, image appears in album.

## 27.3 Lian sends a photo

A Lian-originated photo appears as a chat message with:

- Image preview.
- Optional short line.
- Tap to open full-screen.

It should be visibly from Lian, but use the same final Lian mark/avatar as elsewhere.

## 27.4 Full-screen viewer

Requirements:

- Edge-to-edge image.
- Close/back.
- Date/source metadata.
- Optional `Open in conversation`.
- No social actions.
- No likes/comments UI.

## 27.5 Empty album

`No photos yet. When we share one, it’ll live here.`

# 28. Assistants — identity system

Multiple assistants must not use photoreal human portraits by default.

## 28.1 Visual identity

Each assistant uses:

- The same Lian mark family.
- A distinct palette theme.
- A distinct name.
- A distinct mood surface.
- Optional abstract texture or environment.

Do not use realistic human avatars as the default product identity.

Reason:

- Avoids implying a fixed human body.
- Keeps the product consistent with the abstract brand.
- Scales better across RTL, night, notifications, and small sizes.
- Prevents assistants from feeling like unrelated characters.

## 28.2 Assistant list

Each row shows:

- Mark/avatar.
- Assistant name.
- Short personality line.
- Current/active state.

## 28.3 Chat with multiple assistants

The chat header must always make the active assistant explicit.

Header contains:

- Active assistant avatar.
- Name.
- Mood/state phrase.
- Assistant switch affordance.

Example:

`Lian`
`A little quiet`

or

`Noor`
`Focused with you`

No ambiguity is allowed about which assistant owns the current memory/context.

## 28.4 Assistant profile

Accessible from:

Settings → Her identity

Contains:

- Name.
- Appearance theme.
- Voice.
- Language.
- Dialect.
- Personality.
- Quiet hours.
- Notification behavior.

Memory remains separate and is managed from that assistant's Memory screen.

# 29. Edit task / edit note

## 29.1 Task correction

Accessible by tapping a task row.

Editable:

- Title.
- Due date.
- Time.
- Recurrence.
- Reminder behavior.
- Completion state.
- Delete.

Origin context shown quietly:

`You mentioned this in chat on May 18.`

## 29.2 Note correction

Editable:

- Note text.
- Title if present.
- Related topic.
- Delete.

No "create note" form as primary entry.
New notes still originate from conversation.

# 30. Add memory manually

Manual addition is allowed, but secondary.

Entry point:

Memory → Manage → Add something I should remember

The screen asks one conversational question:

`What would you like me to remember?`

Then optional type selection:

- Fact.
- Preference.
- Topic.
- Moment.
- Person.
- Emotional state.

This is not the default path; conversation remains primary.

# 31. Quiet hours

Settings → Notifications → Quiet hours

Screen contains:

- Start time.
- End time.
- Days.
- Toggle enabled/disabled.
- Optional `Allow urgent security alerts`.

Copy:

`I’ll keep things quiet during these hours unless something important needs your attention.`

Use a simple time picker.
No timeline visualization.

# 32. Language & style

Canonical options:
- Auto — match the user.
- English.
- Egyptian Arabic.
- Levantine Arabic.
- Gulf Arabic.
- Maghrebi Arabic.
- Modern Standard Arabic.
- French.

`Auto` is the onboarding default unless explicitly changed. Gulf stays one user-facing option; Saudi and Emirati are not separate top-level choices because they overlap. French is first-class. Do not use flags. Arabic examples must be neutral where natural; if gendered address is unavoidable, show both forms.


# 33. Personality dials

Settings → Her personality

Use descriptive sliders, not numeric percentages.

Dials:

- Warmth: Calm ↔ Affectionate
- Playfulness: Serious ↔ Playful
- Proactivity: Waits for you ↔ Reaches out
- Directness: Gentle ↔ Direct
- Encouragement: Subtle ↔ Motivating

Rules:

- No numbers.
- No "AI parameters."
- Changes preview as sample text.

# 34. Voice states

## 34.1 Voice note playing

Show:

- Play/pause.
- Waveform.
- Progress fill.
- Elapsed / total time.
- Playback speed only if needed; otherwise omit.

## 34.2 Recording

Input transforms into a recording state:

- Live waveform.
- Elapsed time.
- Cancel.
- Send.

Do not expose technical recording controls.

## 34.3 Generating voice

Before Lian's audio arrives:

`I’m putting this into words for you…`

Then waveform appears.

**Amended 2026-08-26 (see docs/RECONCILIATIONS.md §9).** The waveform in
34.1 and 34.3 is now a *may*, not a *must*, and the built product does not
draw one. A custom player has to reimplement scrubbing, buffering, the lock
screen, the system volume and the media session, and every one of those is
something the platform's own audio element already does correctly in both
directions of text. Trading all of it for a drawn waveform is a worse
product for the person holding the phone, not a more polished one. The live
waveform while RECORDING (34.2) is a different question — nothing is lost by
drawing it — but the elapsed counter is what ships today, and the recording
state is otherwise as specified: cancel, send, no technical controls.

Her audio is also generated **on demand**, when the play control is pressed,
rather than ahead of every reply. So `I'm putting this into words for you…`
is the state after that press, not something that appears under a message
nobody asked to hear.

# 35. Reply interaction

## 35.1 Choosing a message to reply to

Gesture/tap opens a compact action sheet:

- Reply.
- React.
- Copy.
- Delete if allowed.

Selecting Reply:

- Pins a slim quoted reference above the input.
- Input remains active.
- User can dismiss the reference.

## 35.2 Final reply message

Shows one-line quoted context above the new message.

# 36. Reaction interaction

Long-press/tap reaction control opens a small anchored picker.

Default set:

- Heart.
- Smile.
- Laugh.
- Support.
- Surprise.

Keep it compact.
No large emoji tray.
Reaction appears attached to the message edge.

# 37. Streaming response

Streaming is a primary product state.

Requirements:

- Lian's bubble appears immediately after thinking ends.
- Text streams line by line or phrase by phrase.
- Bubble height grows smoothly.
- User may scroll while it continues.
- Input remains available unless a voice response is being generated.
- Stop control may appear quietly if generation is long.

Never show:

- Token counters.
- "Generating..."
- Technical model language.

# 38. Long conversation history

The visible conversation window targets the most recent ~60 messages.

When user scrolls upward:

1. Show a quiet top loading affordance.
2. Load older messages in batches.
3. Preserve exact scroll position.
4. Insert date separators only when useful.

Copy:

`Earlier`

No spinner takeover.
No jump to top after load.

# 39. Delete message + provenance

Deleting a message must account for derived memory.

If no memory depends on it:

`Delete this message?`

If memories were derived from it:

`This message helped me remember 2 things.`

Then show:

- Delete message only.
- Delete message and derived memories.

User must understand provenance.

Memory rows should expose source:

`From your message on May 18.`

If source is deleted but memory is retained intentionally, mark:

`Source removed — kept by you.`

# 40. In-app notification

When a reminder/proactive event arrives while the app is open:

- Do not use OS-style alert.
- Show a small in-world banner at the top.
- Uses Lian avatar.
- One short line.
- Tap opens relevant context.

Example:

`You wanted me to remind you about the gym membership.`

Dismisses naturally.
Does not block typing.

# 41. Splash / first run after install

On launch after installation:

- Cream or current time-aware background.
- Final Lian mark centered.
- No slogan.
- No loading bar unless startup is unusually long.

If session is restored, transition directly to chat.

# 42. 404 and general outage

## 42.1 404

Copy:

`I can’t find that page.`

Actions:

- Go to Chat.
- Go back.

## 42.2 General outage

Copy:

`I’m having trouble reaching everything right now. I’ll come back as soon as I can.`

Actions:

- Try again.
- Stay here.

No status code.
No technical stack language.

# 43. Desktop / wide PWA

Desktop must feel like the same product, not a separate admin experience.

Breakpoints:

- Mobile: 320–479 px.
- Tablet: 480–899 px.
- Desktop: 900 px+.

## 43.1 Desktop chat

Three-column capable layout:

Left rail:
- Bottom-nav destinations become vertical navigation.
- Conversation switcher.
- Assistant switcher.

Center:
- Conversation.
- Max readable width around 720–820 px.

Right contextual rail:
- Optional memory/context panel.
- Hidden by default or collapsible.

The conversation remains visually primary.

## 43.2 Desktop money

Two-column layout:

Left:
- Month summary.
- Top categories.
- Lian observation.

Right:
- Recent transactions.

Selecting a transaction may open:
- Right-side detail panel.
- Or centered correction sheet.

No finance-dashboard charts.

## 43.3 Desktop memory

Two-pane layout:

Left:
- Search.
- Type filters.
- Memory list.

Right:
- Selected memory detail.
- Edit/delete.
- Provenance.

Empty state collapses gracefully to a centered single pane.

## 43.4 RTL desktop

All rails mirror.
Reading order remains logical.
Navigation labels and icons must preserve semantics.


# 44. Navigation drawer / desktop left rail

The corner menu control opens secondary navigation; it is navigation, not another Settings screen.

Top: active assistant mark/avatar, name, current-state phrase, and `Switch assistant`. The user is not the drawer header; User profile is a destination.

Groups:
- **Remember & revisit:** Memory, Search, Album, Morning briefing.
- **Life with Lian:** Health, Assistants, User profile.
- **Trust & ownership:** Security, Data, Subscription.

Settings remains primary navigation and is not duplicated. Open by menu tap; optional start-edge swipe. Close by close/back, scrim tap, Escape, destination selection, or optional reverse swipe. Preserve underlying state and scroll; trap keyboard focus while open.

RTL: opens from the right; directional controls mirror; rows align right; semantic item order remains unchanged.

At 900px+ this becomes the persistent left rail containing active-assistant identity/switching, the five primary destinations, these three secondary groups, and user/account at the bottom.


## Single-assistant state

When only one assistant exists, the drawer header does not show a misleading `Switch assistant` control. Instead it shows a quiet `Assistants` row beneath the active assistant identity.

Tapping it opens the Assistants screen, where the current assistant is shown and the user can start `Create another assistant`.

Once two or more assistants exist, that row becomes `Switch assistant` and opens the switcher directly.

# 45. Assistant gender and voice identity

Assistant profile includes Name, Gender, Appearance theme, Voice / `voiceId`, Language & style, Personality, Quiet hours, and Notification behavior.

Female and male assistants are supported. Gender changes pronouns, grammatical self-reference, and voice defaults, but not memory, permissions, capabilities, subscription, navigation, or relationship history. Voice recommendations may follow gender but do not hard-lock voice choice.

All examples using `she`, `her`, `herself`, `Her identity`, `Her personality`, `Her messages`, `She texts you first`, `She remembers`, `She reaches out`, `She is thinking`, or `She is not gone` are female-assistant examples and require separately authored masculine counterparts in production. A male voice is not a mechanical pronoun swap.

# 46. Incognito scenario / role override

The incognito start sheet includes the privacy explanation plus optional free text: `Who should I be in this conversation?`

Examples: `Act as an interviewer for a senior RPA role.` · `Be a skeptical customer reviewing my pitch.` · `Help me rehearse this as if you were my manager.`

While active, the header uses an incognito tint, shows `Incognito`, and a role line such as `Playing: Interviewer`. The normal mood phrase is suppressed. A slim persistent scenario chip may sit above the conversation.

Tap the role line/chip to Edit scenario, Clear role, or Delete incognito conversation. Scenario/role context never writes to memory.

# 47. Canonical language & style list

Use exactly: Auto — match the user; English; Egyptian Arabic; Levantine Arabic; Gulf Arabic; Maghrebi Arabic; Modern Standard Arabic; French.

`Auto` removes an unnecessary onboarding choice. Gulf stays one user-facing option because Gulf/Saudi/Emirati overlap at this level. French remains first-class. Setting label: `Language & style`.

Neutral Arabic sample: `أتكلم معك بالطريقة دي؟`

Arabic copy rule: any second-person verb can encode user gender in Arabic. Product-authored examples must therefore avoid second-person verbs when a natural neutral construction exists. If a second-person verb is necessary, author and test both masculine and feminine forms explicitly rather than treating one as default.

# 48. Desktop fallback for all remaining screens

Chat, Money, and Memory have purpose-built desktop layouts. Every other route at 900px+ uses the persistent left rail, a centered 720px max-width main column (800px for legal/long-form), responsive cards, desktop dialogs/side sheets instead of bottom sheets, no bottom navigation, and RTL mirroring.

Applies to Tasks & notes, Our story, Health, Album, Assistants, Settings, Security, Data, Account, Consent, Subscription, Notifications/permissions, PWA install, Onboarding conversation, Morning briefing, Search, User profile, Free limit, Conversation types, and splash/404/outage.


# 49. Gender scope decision

Decision: v1 supports exactly two assistant gender identities — Female and Male. Neutral/unspecified assistant gender is out of scope for v1. This avoids creating a third authored voice and grammar system without a complete product definition. The user may still choose any compatible voice regardless of assistant gender.


# 50. Free-plan memory limit

Free-plan capacity: **100 persistent memories per assistant**.

Why 100: it gives a new user enough room to build a convincing remembered relationship through the first couple of weeks without encountering the queue, while still making persistent memory a meaningful long-term free-tier limit.

`Limited memory` must be visible and understandable before it silently affects behavior.

## Memory screen treatment

Free users see a quiet capacity line near the Memory header, phrased without storage jargon:

`I can keep up to 100 lasting memories on the free plan.`

As the limit approaches, Lian adds:

`I’m nearly at what I can keep in mind here. I’ll show you what I’m holding so you can decide what still matters.`

At the limit:

- Existing memories remain intact.
- New candidate memories are not silently discarded.
- They enter a temporary `Not kept yet` queue visible at the top of Memory.
- Each queued item shows its source and offers:
  - `Keep this` — requires deleting/replacing an existing free-plan memory.
  - `Leave it in the chat` — keeps the source message but does not promote it to persistent memory.
- The user can manage/delete existing memories to free capacity.
- Paid upgrade is a quiet secondary action, never required to review or delete memory.

Lian's explanation:

`I’m at what I can keep in mind on the free plan. I haven’t forgotten our chat — I just won’t turn new details into lasting memory until there’s room.`

No oldest-memory auto-eviction. No hidden dropping. No countdown or storage meter.
