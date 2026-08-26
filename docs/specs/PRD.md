# Lian — Product Requirements Document

Version: 1.0  
Product: AI personal assistant PWA  
Audience: privacy-minded, technically literate users who value specificity and ownership

## 1. Product summary

Lian is a persistent AI personal assistant that remembers the user over time, develops a consistent identity and mood, and can reach out first without the user opening the app.

Core positioning:

> An AI secretary that remembers you — and that you actually own.  
> Your keys. Your database. Your server if you want it.  
> She learns you, texts you first, and grows into someone who knows you.

## 2. Problem

Most assistant products are reactive, session-based, and memory-light. They wait for the user to open the product and type. They often separate reminders, tasks, money, health, and notes into form-heavy tools that feel administrative.

Users who want a long-term assistant need:

- Persistent, editable memory.
- Proactive communication.
- A consistent identity and tone.
- A simple way to capture life through conversation.
- Clear ownership of data.
- Trustworthy controls around privacy and deletion.
- A product that feels personal rather than like business software.

## 3. Product principles

1. Talking is the interface.
2. Memory must be inspectable.
3. Proactivity is opt-in and central.
4. Data belongs to the user.
5. No feature should require a form if conversation can capture it.
6. Serious system states should remain calm and human.
7. Relationship depth is earned through time and context, never scored.

## 4. Target users

Primary:

- Technical, privacy-minded early adopters.
- People comfortable with self-hosting, local models, APIs, and data ownership.
- Users who read Hacker News, r/LocalLLaMA, and adjacent communities.

Secondary:

- Users who want one personal assistant instead of multiple productivity apps.
- Users who value continuity and personal context.

## 5. Goals

### Product goals

- Make the user feel remembered within the first session.
- Establish notifications as a core capability.
- Make proactive messages useful rather than noisy.
- Let conversation create structured life data naturally.
- Make memory and data ownership transparent.
- Build enough trust for long-term daily use.

### Non-goals

- Project management.
- Calendar replacement.
- Accounting software.
- Medical tracking.
- Fitness scoring.
- Social networking.
- Enterprise team collaboration.
- Gamified companion mechanics.

## 6. Core capabilities

### 6.1 Conversational home

The chat is the primary screen and most-used surface.

Requirements:

- Text messages.
- Voice notes.
- Replies to older messages.
- Reactions.
- Side conversations by topic.
- Incognito conversation.
- Inline capture confirmations.
- Thinking, retry, offline, and fallback states.

### 6.2 Persistent memory

Memory categories:

- Fact.
- Preference.
- Ongoing topic.
- Moment.
- Person.
- Emotional state.

Requirements:

- Browse.
- Search.
- Edit.
- Delete.
- Full empty state.
- Explicit deletion confirmation.
- Memory export included in data export.

### 6.3 Proactive messaging

Lian can send notifications without being opened.

Sources:

- Memory follow-ups.
- Reminders.
- Habits.
- Unfinished conversations.
- Morning briefing.
- Noticed patterns.

Requirements:

- Notification permission pre-prompt in Lian's own voice.
- System permission request.
- Quiet hours.
- Notification categories.
- Free users: up to one proactive reach-out/day.
- Paid users: full proactive messaging and reminders.

### 6.4 Tasks, notes, and habits

Captured from ordinary conversation.

Examples:

- "Remind me to call my sister Sunday."
- "I need to return the book tomorrow."
- "I want to drink more water."

Requirements:

- One-off tasks.
- Recurring tasks/habits.
- Per-day completion.
- Notes.
- Habits strip.
- No primary manual-add workflow.

### 6.5 Money

Captured through:

- Conversation.
- Receipt photo.

Requirements:

- Monthly summary: money in, money out, what's left.
- Top spending categories.
- Lian observation.
- Recent transactions.
- Transaction correction.
- Receipt attachment.
- Delete transaction.
- No budget bars or pie charts.

### 6.6 Health context

Captured from conversation.

Requirements:

- Meal log confirmation.
- Workout log confirmation.
- Habits.
- Weekly view.
- One observed pattern in Lian's voice.
- No calories, macros, scores, rings, or grades.

### 6.7 Our story

A timeline of the relationship.

Contains:

- Milestones.
- Moments.
- Inside jokes.
- Meaningful conversations.
- Relationship stages.

Five stages are earned through interaction and trust, but must never be presented as gamified levels.

### 6.8 Multiple assistants

Users can create more than one assistant.

Each assistant has:

- Name.
- Appearance.
- Personality.
- Separate memory.
- Separate relationship context.

Assistants do not know one another.

Creating a new assistant starts as a conversation, not a setup form.

### 6.9 Security

Security should be surfaced through Lian and backed by a devices screen.

Requirements:

- Proactive notice of suspicious sign-in.
- Yes/no response in chat.
- Trusted devices.
- Recent sign-in attempts.
- Location/time metadata.
- Revoke device.
- Quick lock ending all sessions.

### 6.10 Data ownership

Requirements:

- Export all data.
- Show what export includes.
- Downloadable machine-readable file.
- Delete all data.
- Clear list of what is erased.
- Confirm destructive action.
- Respectful completion state.

### 6.11 Search

Requirements:

- Search all conversations.
- Group results by conversation.
- Open a result in-place.
- Search memory separately.
- User profile with self-authored notes.

### 6.12 Album

Requirements:

- Photos shared by user.
- Photos sent by Lian.
- Full-screen image viewing.
- Empty album.
- Photos tied to assistant memory where allowed.

## 7. Conversation types

### Main conversation

Persistent and memory-writing.

### Side conversation

Topic-specific branch.
Shares:

- Same memory.
- Same mood.
- Same identity.

### Incognito

- May read memory.
- Writes nothing to memory.
- Not retained.
- Can be deleted completely.
- Clear at-a-glance state without warning banners.

## 8. Onboarding

Sequence:

1. Welcome.
2. Sign up / sign in.
3. Consent.
4. Notification pre-prompt and OS prompt.
5. Add-to-home-screen prompt.
6. Conversation-based onboarding.

Conversation learns:

- What to call the user.
- Preferred language.
- Something meaningful about them.
- User names the assistant if product configuration allows it.

Primary onboarding emotional goal:

> "She remembers me."

## 9. Account and consent

### Account

- Welcome.
- Sign up: email + password.
- Sign in.
- Forgot password.
- Errors.

### Consent

- 18+ confirmation.
- Terms and privacy visible in-app.
- Explicit agreement.
- Under-18 state.

## 10. Subscription

Free:

- 20 messages/day.
- Text only.
- Reaches out once/day.
- Limited memory.

Paid: $9/month.

- Unlimited in practice.
- Voice messages.
- Full proactive messaging.
- Reminders.
- Full memory.
- Full timeline.

Requirements:

- Checkout.
- Success.
- Manage subscription.
- Cancel.
- Post-cancel explanation.
- No aggressive retention messaging.

## 11. Free-limit behavior

Approaching limit:

- Quiet in-conversation indicator.

At limit:

- Lian explains it in character.
- She is not "gone."
- Upgrade link is secondary.

No:

- Countdown timer.
- Fake scarcity.
- Modal takeover.
- Aggressive upsell.

## 12. Morning briefing

Available:

- On request.
- Proactively.

Includes:

- What's on today.
- Carried-over items.
- Habits due.
- One pattern noticed.
- Money if something stands out.

Presented both:

- As chat message.
- As dedicated briefing screen.

## 13. Navigation

Bottom tabs:

- Chat
- Tasks
- Money
- Our story
- Settings

Assistants are accessed inside the app.

## 14. Internationalization

Requirements:

- English.
- Arabic.
- RTL layout.
- Arabic type pairing.
- Dialect preference.
- All primary screens tested in both directions.

## 15. Theme system

Theme responds to:

- Time of day.
- Assistant mood.

Modes:

- Warm.
- Quiet/low.
- Late-night.

This affects:

- Background warmth.
- Surface tint.
- Contrast.
- Decorative atmosphere.

It must not alter information architecture.

## 16. PWA requirements

- Installable.
- Home-screen icon.
- Push notifications.
- Offline shell.
- Graceful unreachable state.
- Fast mobile startup.
- App-like navigation.
- Responsive 390 px-first design.

## 17. Privacy and ownership

Principles:

- Memory can be viewed, edited, erased.
- Data export is available.
- Account deletion removes everything.
- Self-hosting is a product direction / supported deployment mode where available.
- Users must clearly understand what is stored and why.

## 18. Success metrics

Early success indicators:

- Onboarding completion.
- Notification permission opt-in.
- Add-to-home-screen conversion.
- Day-2 and Day-7 return rate.
- Percentage of users with at least five useful memories saved.
- Proactive notification open rate.
- Correction rate on captured money/tasks/health.
- Memory edit/delete usage as a trust signal.
- Paid conversion after repeated daily use.

## 19. Risks

- Over-notification.
- Incorrect memory.
- False sense of certainty.
- Emotional overreach.
- Privacy distrust.
- Multiple-assistant confusion.
- Proactive messages becoming repetitive.
- Product drifting into dashboard complexity.

## 20. Release scope

### MVP

- Auth.
- Consent.
- Main chat.
- Memory.
- Notifications.
- Tasks/notes.
- Basic money capture.
- Settings.
- Data export/delete.
- Free/paid subscription.
- English + Arabic RTL.

### Post-MVP

- Multiple assistants.
- Health context.
- Album.
- Rich Our Story.
- Side conversations.
- Incognito.
- Expanded self-hosting.
- More advanced proactive pattern recognition.



## 21. Additional screen requirements

### Health

Must include:

- Chat capture.
- Weekly combined meals/workouts/habits view.
- Tappable correction.
- Observation in Lian's voice.
- No calorie/macro/score mechanics.

### Album

Must include:

- Album grid.
- User-sent photo.
- Lian-sent photo.
- Full-screen viewer.
- Empty state.

### Assistants

Must include:

- Assistant list.
- Active assistant state.
- Explicit active-assistant header in chat.
- Assistant profile.
- Abstract identity system using the final mark family rather than photoreal avatars.

### Task/note correction

Must include:

- Edit task.
- Edit recurrence.
- Edit due time/date.
- Delete task.
- Edit note.
- Delete note.
- Conversation origin reference.

### Manual memory addition

Allow secondary manual addition while keeping conversational capture as the primary mechanism.

### Quiet hours

Must support:

- Start/end time.
- Days.
- Security exception.

### Language/dialect

Must support:

- Arabic.
- English.
- Match user.
- Canonical language/style list: Auto, English, Egyptian Arabic, Levantine Arabic, Gulf Arabic, Maghrebi Arabic, Modern Standard Arabic, French.

### Personality

Must support non-numeric dials for warmth, playfulness, proactivity, directness, and encouragement.

### Voice

Must include:

- Recording state.
- Playing state.
- Generating state.
- Failure-to-text fallback.

### Reply and reaction

Must include selection moments, not only final rendered states.

## 22. Conversation runtime states

Must include:

- Thinking.
- Streaming.
- Retry.
- Offline.
- In-app notification.
- Long-history pagination.
- Message deletion.
- Memory provenance handling.

Conversation history should load in bounded windows with older messages fetched as the user scrolls upward.

## 23. Platform states

Must include:

- Splash.
- 404.
- General outage.
- Installed-PWA startup.

## 24. Desktop support

Lian must support wide PWA use.

Minimum desktop coverage for v1:

- Chat.
- Money.
- Memory.

Desktop requirements:

- Same design language.
- Vertical primary navigation.
- Optional contextual side rails.
- No enterprise-dashboard density.
- RTL desktop support.


## 25. Navigation drawer

Mobile provides one grouped secondary-navigation drawer for Memory, Search, Album, Morning briefing, Health, Assistants, User profile, Security, Data, Subscription. Header = active assistant + switcher. At 900px+ it becomes the persistent left rail combining primary and secondary navigation.

## 26. Assistant gender

Each assistant stores name, gender, appearance theme, `voiceId`, language/style, personality. Male and female assistants are supported. Neutral/unspecified assistant gender is out of scope for v1. Pronouns/grammar resolve from active identity. Voice recommendations may follow gender without hard-locking choice. Male/female copy is separately authored.

## 27. Incognito scenario

Incognito supports optional free-text role scenario at start, visible while active, editable/clearable, and deleted with the thread. Role override suppresses normal mood label and never writes to memory.

## 28. Theme completeness

Implement Warm, Quiet/low, Late-night. Time controls environmental luminance; mood controls accents/chroma/density/motion. Warm at 2am remains night with warmer accents.

## 29. Canonical language/style

Exactly: Auto, English, Egyptian Arabic, Levantine Arabic, Gulf Arabic, Maghrebi Arabic, Modern Standard Arabic, French. Auto is onboarding default. Gulf is not split. Arabic user-address copy is neutral where possible or provides both forms.

## 30. Desktop fallback

Chat, Money, Memory have purpose-built wide layouts. Every other route at 900px+ uses persistent left rail + centered 720px readable column (800px long-form/legal), desktop dialogs, no bottom nav, RTL support. No route is mobile-only.

## 31. Coverage completeness

Track Onboarding conversation, Morning briefing, Search, User profile, Free limit, and Conversation types (main/side/incognito).


## 32. Arabic grammatical neutrality

Arabic copy rule: any second-person verb can encode user gender in Arabic. Product-authored examples must therefore avoid second-person verbs when a natural neutral construction exists. If a second-person verb is necessary, author and test both masculine and feminine forms explicitly rather than treating one as default.


## 33. Gender scope decision

Decision: v1 supports exactly two assistant gender identities — Female and Male. Neutral/unspecified assistant gender is out of scope for v1. This avoids creating a third authored voice and grammar system without a complete product definition. The user may still choose any compatible voice regardless of assistant gender.


## 34. Single-assistant navigation state

When only one assistant exists, do not show `Switch assistant`. Show an `Assistants` destination that opens the Assistants screen and offers `Create another assistant`. `Switch assistant` appears only when at least two assistants exist.


### Free-plan limits

- Messages: **20 messages/day**.
- Modality: **text only**.
- Proactive outreach: **once per day**.
- Persistent memory: **100 memories per assistant**.

Why 100: it is large enough for normal early use to deliver the onboarding promise of feeling remembered for the first couple of weeks without exposing the queue, while still binding for long-term free use.

Why 20 messages and not 30: 30 was set before the model cost of a turn
was known. At the shipped model's price, 30 messages a day costs more
than the free plan's monthly model-spend ceiling allows — the ceiling
would have bitten on the first day, and the user would have met a limit
the product never told them about. 20 is the number both limits agree
on, so the only limit a free user meets is the one the copy names.
Revisit when retention is measured; it is a data decision, not a
product-feel one. The alternative — running the first session on a
cheaper model — was rejected: the first session is where the product is
won or lost, and we do not save there.

## 35. Free-plan memory limit

The hard capacity is **100 persistent memories per assistant**.

Free memory has a visible capacity state. Existing memories are never auto-evicted. When full, new candidate memories enter a visible `Not kept yet` queue and are not promoted to persistent memory until the user frees room or upgrades. Source chat remains available according to conversation retention. Users can review, delete, or replace memories without upgrading. Upgrade remains secondary.
