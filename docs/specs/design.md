# Lian — Design System

Version: 1.0  
Platform: Mobile-first PWA  
Primary viewport: 390 px  
Direction: English LTR + Arabic RTL

## 1. Design intent

Lian is a personal space built around a persistent relationship with an assistant who remembers, notices patterns, and can reach out first. The product must feel warm, calm, and inhabited — never like a dashboard, chatbot shell, productivity suite, or corporate SaaS product.

Design principles:

- Conversation first. Features emerge from talking, not from forms.
- Memory is visible and editable. Trust comes from control.
- Proactivity feels human. Lian reaches out first through notifications.
- Softness without vagueness. The interface is gentle, but information remains specific.
- Mood changes the surface. Time of day and her mood can shift tone, warmth, density, and contrast.
- RTL is a first-class layout, not a mirrored afterthought.
- No AI clichés: no sparkle icons, robot imagery, brain/circuit motifs, or generic purple AI gradients.

## 2. Final logo system

Use one mark everywhere: two soft opposing organic forms with a narrow curved negative-space separation. Do not redraw, stretch, rotate, or substitute alternate leaf shapes.

Assets:

- `lian-logo.svg` — final lockup.
- Mark-alone form is the two-part symbol from the SVG.
- Wordmark: lowercase `lian`.
- App icon: mark centered in a rounded square.
- Chat avatar: mark centered in a circular or soft-round container.

Minimum sizes:

- Mark alone: 16 px minimum.
- Lockup: 48 px minimum width.
- Chat avatar: 24 px minimum.
- App icon: 32 px minimum for UI use; 512 px source asset.

Clear space:

- Minimum clear space around the mark = one-half of the mark height.
- Around the lockup = one-half of the mark height on every side.

## 3. Colour system

### Day palette

| Token | Hex | Use |
|---|---|---|
| Rose 100 | `#F6D7DE` | Warm surfaces, selected accents |
| Lilac 100 | `#DCCDF2` | Secondary surfaces |
| Blush 50 | `#FCECEF` | Quiet cards and message backgrounds |
| Cream 0 | `#FFF8F3` | Main canvas |
| Warm Taupe | `#CDBEB6` | Neutral detail and secondary illustration |
| Lavender Grey | `#E9E7F1` | Dividers, inactive controls |
| Deep Plum | `#3B2948` | Primary text and icons |

### Night palette

Night mode is not pure black. It is a softened after-midnight atmosphere.

| Token | Hex |
|---|---|
| Night Canvas | `#171827` |
| Night Surface | `#222238` |
| Night Rose | `#8D6674` |
| Night Lilac | `#75658E` |
| Night Plum | `#CFC3DD` |
| Night Muted | `#9993AA` |
| Night Text | `#F4EEF8` |

Rules:

- Never use green/red finance semantics.
- Avoid high-saturation gradients.
- Gradients may appear only as low-contrast environmental surfaces, never as "AI effect."
- Critical destructive actions can use a softened coral-red, but never as a full-width alarm banner.

## 4. Typography

Recommended Latin: a warm humanist sans with soft terminals.  
Recommended Arabic pairing: a modern, highly legible Arabic sans with similarly open proportions.

Scale:

| Style | Size / Line | Weight |
|---|---:|---|
| Display | 36 / 44 | 600 |
| H1 | 28 / 36 | 600 |
| H2 | 22 / 30 | 600 |
| H3 | 18 / 26 | 600 |
| Body | 16 / 24 | 400 |
| Small body | 14 / 20 | 400 |
| Caption | 12 / 16 | 500 |

Arabic must use the same optical hierarchy rather than numerically identical letterforms.

Examples:

- Display: `I remember the little things.`
- Arabic display: `أتذكّر الأشياء الصغيرة التي تهمك.`
- Body: `You can edit or erase anything I remember.`
- Arabic body: `يمكنك تعديل أو حذف أي شيء أتذكره.`

## 5. Spacing and shape

Base spacing unit: 4 px.

Preferred spacing scale:

- 4, 8, 12, 16, 20, 24, 32, 40, 48, 64.

Corner radii:

- Message bubble: 18–22 px.
- Card: 20 px.
- Input: 22 px.
- Bottom navigation container: 20–24 px.
- Modal: 24 px.

Shadows:

- Use rarely.
- Soft elevation only for modals, floating menus, and system-like overlays.
- Never rely on shadow for separation; whitespace is primary.

## 6. Core components

### Her message bubble

- Left-aligned in LTR, right-aligned in RTL.
- Warm blush or cream surface.
- Lian avatar appears only when conversational rhythm benefits from it.
- No heavy border.

### User message

- Slight lilac tint.
- Distinct by position and surface, not by dramatic color contrast.

### Reply-to reference

- Compact inset strip above the reply.
- Shows one or two lines of quoted context.
- Never becomes a nested card stack.

### Reaction

- Small floating chip attached to the lower edge of a message.
- Heart/reaction should feel personal, not social-media gamified.

### Voice note

- Play control, waveform, duration.
- Same bubble language as messages.
- If generation fails, Lian falls back to text in her voice.

### Input bar

Only:

- Text field.
- Voice button.

No attachment clutter in the default state.

### Buttons

Primary:
- Deep plum fill.
- Cream/white label.
- Rounded.
- Reserved for one clear next action.

Quiet:
- Transparent or cream surface.
- Plum text.
- Soft border.

### Cards

Cards are used only when a piece of information benefits from being tappable or grouped. The product should not become a grid of widgets.

### Toggle

Small, calm, conventional.
Avoid decorative toggles.

### List row

- 52–64 px typical height.
- Leading icon optional.
- Main label + secondary metadata.
- Trailing chevron only if the row navigates.

## 7. Bottom navigation

Fixed tabs:

1. Chat
2. Tasks
3. Money
4. Our story
5. Settings

Assistants are never in the bottom bar.

Rules:

- Single line icon family.
- Active state uses plum fill/tint and stronger label.
- Inactive states stay quiet.
- Order mirrors correctly in RTL.
- Same bar component appears on all main product screens.

## 8. Screen behavior

### Chat

The primary space.

Must support:

- Her messages and user's messages.
- Voice notes.
- Reactions.
- Replies to older messages.
- Side conversations.
- Incognito conversation.
- Thinking state.
- Retry states.
- Money/health/task captures inline.

Header includes her name and a phrase conveying state, e.g.:

- `Feeling warm today`
- `A little quiet`
- `Still with you`
- `Late-night thoughts`

Never use a presence dot or percentage.

### Memory

A trust surface.

Typed memories:

- Fact
- Preference
- Ongoing topic
- Moment
- Person
- Emotional state

Every memory can be edited or deleted.

### Tasks & notes

Everything originates from conversation.
Do not show an "add new" workflow as the primary model.

### Money

No charts that require interpretation.
No budgets, scores, red/green semantics, or manual add button.
Entries arrive from chat or receipt photos.

### Our story

Relationship timeline with milestones, inside jokes, and moments.
Five earned relationship stages, but never shown as levels, XP, or progress percentage.

### Settings

Keep settings inside the emotional world of Lian.
Group around:

- Her identity
- Language & dialect
- Personality
- Quiet hours
- Notifications
- Trusted devices
- Data ownership
- Subscription

## 9. States

### Empty states

Empty does not mean broken.

Examples:

- Chat: `We haven't talked yet. I'm here when you're ready.`
- Memory: `As we talk, I'll remember what matters — and you'll always be able to change it.`
- Money: `Nothing here yet. Tell me naturally, or send a receipt.`
- Tasks: `Nothing on your plate yet.`
- Our story: `This starts with our first real moment.`

### Errors

Never show technical language or red system banners.

Use her voice:

- Failed message: `That didn't go through. Want me to try again?`
- Offline: `I'm a little away right now. I'll catch up when I can.`
- Voice fallback: `The voice note didn't work, so I'll say it here instead.`

## 10. Motion

Motion should feel alive but unhurried.

Use:

- 160–220 ms UI transitions.
- 250–400 ms surface mood transitions.
- Low-amplitude opacity and background changes.

Avoid:

- Bouncy onboarding.
- Confetti except possibly after explicit subscription confirmation, and even then keep it subtle.
- Repeated ambient animations.

## 11. Accessibility

- Minimum 44×44 px touch targets.
- Body text 16 px default.
- Contrast must remain WCAG-friendly even in soft palettes.
- Do not use color as the only state signal.
- RTL must be tested screen-by-screen.
- Dynamic themes must preserve contrast and legibility.



## 12. Responsive layouts

Lian is mobile-first but not mobile-only.

### Mobile

- 390 px reference.
- Bottom navigation.
- Single-column content.

### Desktop

At 900 px+:

- Replace bottom navigation with a left vertical rail.
- Preserve the same five primary destinations.
- Keep content warm and spacious.
- Avoid turning desktop into a dense dashboard.

Recommended content widths:

- Chat center column: 720–820 px.
- Detail rails: 280–360 px.
- Overall max app width: 1440 px.

### Desktop Chat

- Left rail: navigation + conversations + assistant switcher.
- Center: chat.
- Right optional contextual panel: memory or current topic.

### Desktop Money

- Summary + observation left.
- Recent transactions right.
- Edit transaction in detail panel.

### Desktop Memory

- Search and memory list left.
- Selected memory detail right.

## 13. Interaction states

### Streaming

- Text streams inside Lian's bubble.
- Bubble grows smoothly.
- No technical labels.

### History loading

- Load older messages in place.
- Preserve scroll position.
- Use subtle top affordance.

### In-app notification

- Small top banner.
- Lian avatar.
- One short line.
- Tap to open context.

### Voice

Playing:
- Play/pause, waveform, progress, duration.

Recording:
- Waveform, elapsed time, cancel, send.

## 14. Provenance

Any structured memory derived from conversation should preserve a source reference.

Source presentation:

`From your message on May 18.`

If deleting a source message affects derived memory, offer explicit control over whether derived memory is also deleted.


## 15. Quiet / low palette

| Token | Hex | Use |
|---|---|---|
| Quiet Canvas | `#F7F3F2` | Main background |
| Quiet Surface | `#EFE8EA` | Cards / assistant bubbles |
| Quiet Rose | `#D7BBC3` | Warm accent |
| Quiet Lilac | `#C9C1D7` | Secondary accent |
| Quiet Taupe | `#B8ACA8` | Neutral detail |
| Quiet Muted | `#6E6774` | Secondary text |
| Quiet Text | `#403744` | Primary text/icons |


## 15.1 Quiet palette contrast verification

Measured WCAG contrast ratios:

| Foreground | Background | Ratio | Result |
|---|---|---:|---|
| Quiet Text `#403744` | Quiet Canvas `#F7F3F2` | 10.31:1 | Pass AA normal text |
| Quiet Muted `#6E6774` | Quiet Canvas `#F7F3F2` | 4.94:1 | Pass AA normal text |
| Quiet Text `#403744` | Quiet Surface `#EFE8EA` | 9.42:1 | Pass AA normal text |
| Quiet Muted `#6E6774` | Quiet Surface `#EFE8EA` | 4.51:1 | Pass AA normal text |
| Quiet Text `#403744` | Quiet Lilac `#C9C1D7` | 6.54:1 | Pass AA normal text |
| Quiet Text `#403744` | Quiet Rose `#D7BBC3` | 6.38:1 | Pass AA normal text |

Rule: secondary text must use `Quiet Muted #6E6774` or darker on Quiet Canvas/Surface. Do not use Quiet Taupe/Rose/Lilac as text colors unless a specific contrast check passes.

## 16. Mood × time composition

Time controls luminance/environment; mood controls accent temperature, chroma, density, and motion. Warm+day uses Day; quiet+day uses Quiet; late-night uses Night. Warm at 2am keeps Night canvas/surfaces with warmer Rose/Lilac accents. Quiet at night keeps Night canvas with Quiet Rose/Lilac influence and reduced decoration/motion.

## 17. Navigation drawer / rail

Mobile groups: Remember & revisit (Memory, Search, Album, Morning briefing); Life with Lian (Health, Assistants, User profile); Trust & ownership (Security, Data, Subscription). Top = active assistant + switcher. RTL opens right. At 900px+ it becomes the persistent left rail with primary navigation too.

## 18. Assistant gender

Identity includes gender and voice. Use the abstract mark system for all genders, not default photoreal portraits. Gender changes copy grammar/pronouns and voice defaults, not layout/capability. Male/female copy are separately authored voices.

## 19. Desktop fallback

Purpose-built: Chat, Money, Memory. All other screens use persistent rail + centered 720px column (800px long-form), desktop dialogs/side sheets, no bottom nav, RTL mirroring.

## 20. Canonical language & style

Auto, English, Egyptian Arabic, Levantine Arabic, Gulf Arabic, Maghrebi Arabic, Modern Standard Arabic, French. Do not split Gulf into Saudi/Emirati. Arabic examples are neutral where possible; otherwise show both user-gender forms.


## 21. Arabic grammatical neutrality

Arabic copy rule: any second-person verb can encode user gender in Arabic. Product-authored examples must therefore avoid second-person verbs when a natural neutral construction exists. If a second-person verb is necessary, author and test both masculine and feminine forms explicitly rather than treating one as default.


## 22. Gender scope decision

Decision: v1 supports exactly two assistant gender identities — Female and Male. Neutral/unspecified assistant gender is out of scope for v1. This avoids creating a third authored voice and grammar system without a complete product definition. The user may still choose any compatible voice regardless of assistant gender.


## 23. Single-assistant drawer state

With one assistant, the identity block shows `Assistants`, not `Switch assistant`. The switch label appears only when 2+ assistants exist.

## 24. Free memory limit UI

Free-plan capacity is **100 persistent memories per assistant**. 
Use a quiet text treatment near the Memory header, never a progress bar. At capacity, show a `Not kept yet` section using ordinary memory rows with a subtle pending label. Do not use warning red, quota meters, countdowns, or automatic eviction.
