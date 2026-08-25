# Lian — decisions log

Every judgement call made while producing this set, with the reason. Precedence
applied throughout: `01-source-of-truth/` beats `02-locked-references/` beats
`03-exploration-superseded/`.

## What was produced

| File | Contains |
|---|---|
| `Lian Core Screens.dc.html` | Chat (8 states), Tasks & notes (5), Money (4), Memory (7) |
| `Lian Life Screens.dc.html` | Our story (3), Health (4), Album (4), Morning briefing (3), Search (2), User profile (1), Conversation types (4), Drawer (2) |
| `Lian Trust Screens.dc.html` | Assistants (4), Settings (5), Security (3), Data (4), Subscription (3), Free message limit (1) |
| `Lian Entry Screens.dc.html` | Account (4), Consent (2), Onboarding (3), Permissions (4), PWA install (1), Splash / 404 / outage (3) |
| `Lian Desktop.dc.html` | Purpose-built desktop Chat, Money, Memory + the fallback rule shown on Tasks |
| `Lian Components.dc.html` | Component sheet — messages, voice, input, buttons, toggle, rows, cards, nav in all five states, drawer, dialogs, sheets, empty states, errors, icon family |
| `Lian Themes and Direction.dc.html` | Day / Quiet / Night × LTR / RTL, plus the two mood×time compositions |
| `Lian Brand Sheet.dc.html` | One sheet: logo family, three palettes with hex and measured ratios, type scale in both scripts, key components, six screens, three unprompted messages |
| `Type Pairing Test.dc.html` | The Latin/Arabic pairing test that settled the typeface choice |
| `lian-logo.svg` | Corrected lockup |
| `lian-mark.svg` | Mark alone (avatars, app icon, notifications) |
| `LianStatus / LianHead / LianTop / LianInput / LianNav / LianRail .dc.html` | The shared chrome, so the nav bar is provably the same component on every screen |
| `lian-defs.js` | The mark, the lockup and the 62-icon outline family as one SVG symbol library |

Theme and language are switches on each screen file (Day / Quiet / Night ×
English / العربية). The themes sheet hardcodes all six combinations side by side
so coverage is visible without toggling.

---

## The mark and the wordmark

1. **The mark is auto-traced from the attached PNG, then regularised.** The
   silhouette was upscaled 6×, contour-followed at the antialiased edge,
   resampled to 720 points, Gaussian-smoothed with the two corners protected,
   and refitted as 70 and 76 cubic Béziers. Smoothing cut the tracer's spurious
   curvature reversals from 12 to 4 on the upper leaf and 8 to 6 on the lower,
   with the fitted curve never more than 0.6 units (0.5% of the mark height)
   from the smoothed contour — and it costs nothing in fidelity: the regularised
   mark scores IoU 0.9810 against the locked reference, the same as the raw
   trace.
2. **The two leaves are NOT the same drawing, and were not forced to be.** The
   asymmetry looked like sampling noise, but it reproduces at four independent
   sizes in the reference (mark panel, app icon, lockup, 48px lockup): the lower
   leaf is 0.958 × width and 0.881 × height of the upper, offset down by 0.626 ×
   the upper's height, all four instances agreeing within 1%. Normalised into
   the same box the two leaves agree only to IoU 0.80 — measured on the
   reference raster itself, not on the trace — so they are different outlines,
   not one outline scaled. Forcing them identical was tried and dropped: it
   pushed the mark from IoU 0.981 to 0.897. What was noise (the wobble within
   each leaf) is gone; what is in the source artwork (the size relationship) is
   kept.
3. **The wordmark is set in Nunito Bold and converted to outlines, not traced.**
   The first pass auto-traced it and lost the letterforms — notched stems, a
   lumpy `a` bowl, a polygonal `i` dot. Nunito was verified against the locked
   reference before use, not assumed: 24 candidate faces were scored by
   silhouette overlap and Nunito 700 won at IoU 0.863 (next: Zen Maru Gothic
   0.828, Figtree 0.811, Baloo 2 0.751, Quicksand 0.619). A separate metric
   fingerprint — 11 ratios read off the reference render — confirmed the weight:
   x-height/ascender 0.692 against Nunito's 0.704, `a` and `n` widths within 1%.
   Nunito does have the tailed `l`; the earlier note that no available face
   matched it was wrong. Outlines are extracted from the real
   `Nunito_700Bold.ttf` glyf table, so the curves are the type designer's.
4. **The `l` tail is trimmed to the reference — the one bespoke move in the
   wordmark.** Unmodified retail Nunito Bold in lowercase is not an owned asset;
   the reference's shorter tail is what makes the wordmark ours, and the
   reference specifies the length. Two ways to shorten it were built and scored
   against the reference's own `l` (30x107px of ink): cut-and-recap fails —
   solving cut + cap-radius = target puts the cut where the tail is still 128
   units thick, giving a fat round stub — while compressing the tail region
   (x > 190, the stem's right edge) horizontally keeps the taper. Scored by
   overlap, compression to **k = 0.64** wins at IoU 0.8665 against 0.8166
   untrimmed, and the optimum is flat from 0.58 to 0.68, so the exact value
   carries no risk. Independently, the tail measured off the reference gives
   12px/19px = 0.63. The tail now extends 0.115 of the ascender past the stem
   against the reference's 0.112. Nothing else in any glyph is touched.
5. **Letters are placed by measured ink gaps, not by tracking.** The reference's
   ink gaps are 61/81/101 per 1000 em for `li`/`ia`/`an`; each glyph is
   positioned so its ink sits exactly that far from the previous one. This is
   worth stating plainly: it costs wordmark-alone overlap. Scaled to the
   reference's ascender height, the ink-gap build scores IoU 0.699 against the
   reference wordmark, where a uniform −44/1000 em tracking scores 0.863 — the
   tracking fit wins that test by squeezing the letters until the total width
   matches, because Nunito's glyphs are ~8% wider than the face in the reference
   render. The rhythm is the thing a reader sees, so the gaps win: the tracking
   version collapses the `li` gap to 10 units and crowds the trimmed tail
   against the `i`. In the lockup, where scale is a free parameter, the ink-gap
   build is also the better fit (below).
6. **Lockup placement is fitted by overlap, not measured off bounding boxes.**
   Direct measurement gives wordmark-ascender = 0.759 (lockup panel) and 0.810
   (clear-space panel) of the mark height; either leaves the lockup 5–9% wider
   than the reference. A two-parameter fit against both reference lockups gives
   ascender = **0.726 × mark height**, gap = **0.345 × mark height**, wordmark
   ink optically centred: **IoU 0.929** against the lockup panel and 0.829
   against the clear-space panel (avg 0.879). Before the tail was trimmed the
   same fit reached 0.862/0.773 — the trim improved the whole-lockup match by
   nearly seven points and moved the fitted scale from 0.702 toward the measured
   0.759, which is the check that the trim was right rather than merely
   different. Matching the whole lockup beats matching the letter size, because
   a reviewer overlays the lockup.
7. **viewBox is `0 0 571.37 216`** — the actual artwork bounds of the fitted
   lockup, aspect 2.645 against the reference lockup's 2.639 (0.2% out). The
   source file had `0 0 640 192`, which left ~240px of dead space on the right.
   The four in-product usages carry the matching height.
8. **`lian-mark.svg` added as a second asset.** The brief asked for one corrected
   SVG; the product needs the mark alone at 16–512px for avatars, app icon and
   notifications, and slicing it out of the lockup at runtime is fragile.
9. **Both files ship monochrome and take their fill from a token.** The identity
   reference specifies single-colour use. In product the symbols in
   `lian-defs.js` are `fill="currentColor"`, so the lockup is whatever colour
   its context is; the two standalone files use
   `fill="var(--lian-brand-ink, #3B2948)"` so they are correct opened on their
   own and follow the token when inlined. That fallback is the only hex outside
   `lian-tokens.css`.

## Typeface

10. **Nunito (Latin) + Tajawal (Arabic).** Tested before committing, in
   `Type Pairing Test.dc.html`: the same Latin line beside five candidate Arabic
   faces at identical size, weight and colour. IBM Plex Sans Arabic — the
   obvious first pick — runs cold and flat-terminalled next to Nunito, against
   §9's "humanist, rounded, soft terminals". Rubik is geometric with tight
   apertures. Cairo is legible but dry and slightly condensed, which fights
   "Arabic labels receive equal space". Almarai sits well but ships only 400/700.
   Tajawal matched on x-height, stroke weight and terminal softness and has a
   full weight range. **Almarai is the documented fallback** if Tajawal's
   coverage becomes a problem.
11. **Arabic headings run one weight heavier and 4–12px looser than Latin.**
    Tajawal has no cut 600, and Arabic needs the leading. §4's rule is "same
    optical hierarchy, not numerically identical letterforms", so the numbers
    differ deliberately: Display 36/48·700 against 36/44·600.
12. **Both faces are SIL Open Font License 1.1 — checked, not assumed, and
    this item closes the question.** Nunito: OFL 1.1, Vernon Adams and Jacques
    Le Bailly, confirmed in the `OFL.txt` of the upstream `googlefonts/nunito`
    repository. Tajawal: OFL 1.1, © 2017 Boutros International, confirmed in the
    font's own embedded licence string and the `googlefonts/tajawal`
    repository. The OFL permits commercial use, app and web embedding, and
    embedding in software sold for money; the single restriction is that the
    fonts may not be sold on their own. Two clauses are worth knowing for this
    project: a *derivative font* must keep the OFL and drop the reserved name,
    and no attribution is required in the product UI. Outlining glyphs into the
    lockup — including the trimmed `l` (§4) — produces artwork, not font
    software, so neither clause is triggered: the reserved-name rule applies to
    fonts you redistribute, not to a logo drawn with one. Nothing here needs a
    licence purchase and nothing needs crediting on screen.

## Corrections to the locked navbar reference

13. **Five tabs, each exactly once, in the specified order.** The reference's
    Tasks screen showed `المهام` twice with two different icons; that duplicate
    is gone and each tab has one icon it does not share.
14. **`المتنا` → `قصتنا`.** Typo in the reference.
15. **The budget progress bar (`١,٧٥٠ من ٣,٠٠٠`) is gone.** There are no budgets
    in this product. Money is money in, money out, what's left, top four
    categories, an observation in her voice, and recent transactions.
16. **The phone/call icon is gone from the chat header.** Voice calling does not
    exist. The header carries the drawer control, the mark, her name, the mood
    phrase, and a quiet overflow control.

## Corrections to the exploration folder

17. **Only the leaf survives.** The spiral and petal marks are not used anywhere.
18. **One incognito treatment: the mask.** The exploration showed both a mask and
    a cloud. The mask reads as deliberate concealment; a cloud reads as sync or
    weather, which is exactly the wrong association for a mode whose promise is
    "nothing here is kept". Applied identically in the switcher, the start sheet,
    the active header, the scenario chip and the desktop conversation list.
19. **`design.md` palette only.** Every earlier hex value is discarded.
20. **No calendar copy anywhere**, including the welcome screen and the briefing.
    The briefing says "the library closes at 7" — a fact she was told — never
    "your 10am meeting".
21. **Onboarding never says "friend".** She introduces herself as "a secretary,
    more or less" and describes what she keeps. Closeness is earned in the Our
    story stages, never claimed at signup.
22. **Assistants use the mark family with distinct palette tints** (Lian = rose,
    Noor = lilac). No photoreal portraits.
23. **No add button on any screen**, health included. The Health empty state
    explains conversational capture instead.
24. **Voice is stated flat**: "Voice messages" on the paid plan, no "(when
    available)".

## Product judgement calls

25. **The five relationship stages are named and described as prose, and the
    names are ours** — Getting acquainted / Finding a rhythm / Knowing the shape
    of your week / Noticing without asking / Long familiarity. The specs require
    five earned stages that are never metered but name none. These read as
    descriptions of a relationship, not as ranks. The current stage is marked
    "Where we are now"; the others are dimmed, with no numbers, order badges or
    progress. The screen closes by saying going backwards is fine.
26. **Habits show today's state only, not a seven-day dot row.** A week of dots
    is a streak by implication, and §26.2 bans streak pressure. Completion is
    day-specific as required.
27. **The inline capture row ends in a chevron, not "Tap to correct".** The row
    must read as conversation metadata rather than a form; a chevron carries the
    affordance without a label, and the label crowded at 390px in both scripts.
28. **AED is the display currency**, following the `AED 400` example in UI-UX §4,
    with `د.إ` in Arabic. The reference images used EGP; the specs win.
29. **Arabic uses Arabic-Indic numerals** (`٤٠٠`, `٩:٤١`), matching the locked
    references' own typesetting. Latin numerals in Arabic would look like an
    untranslated build.
30. **No Arabic string addressed to the user contains a second-person verb.**
    This was claimed here before it was true: a review of all 652 Arabic strings
    found 38 that broke it — 25 addressing the user as male (`شوف بريدك`,
    `اكتب DELETE للتأكيد`, `إنت قادر`, `مش محتاج أي إجراء`, `ابدأ`, `اشترك`,
    `التقط النهاردة`, `ابحث في الذاكرة`, `اشرح لي`, `قوللي`, `خليني`, `تسيبها`,
    `صاحي متأخر`, `حاسس`, and others) and 3 addressing her as female
    (`اكتبي رسالتك`, inherited from the superseded navbar reference, plus two
    `قوليلي`). 42 occurrences were rewritten across seven files; a fresh
    extraction is clean. The rules used:
    - **Imperatives become verbal nouns.** `اكتبي رسالتك` → `كتابة رسالة`,
      `ابحث في الذاكرة` → `البحث في الذاكرة`, `اشترك` → `الاشتراك`,
      `التقط النهاردة` → `لقطة النهاردة`, `اكتب DELETE` → `كتابة DELETE`,
      `افتحها في الدردشة` → `فتحها في الدردشة`, `اسمح لها توصلني` →
      `السماح لها بالتواصل`, `ابدأ محادثة فرعية` → `بدء محادثة فرعية`.
    - **Where a CTA needs a verb, it is first person plural**: `ابدأ` → `نبدأ`.
    - **Lian speaks in the first person** rather than instructing:
      `قوللي حاجة واحدة…` → `حاجة واحدة تساعدني…؟`, `خليني أفكر شوية` →
      `محتاجة أفكر شوية`, `بعدها اطلبها تاني` → `بعدها أجهّز واحدة جديدة بطلب تاني`.
    - **Statements about the user become statements about the thing.**
      `تسيبها خلاص، ولا تخلّصها` → `تسقط خلاص، ولا تخلص` (third person, about
      the task); `هتلاقيها هنا` → `بتبان هنا`; `هتقرا الشروط` →
      `الشروط للقراءة`; `اللي بتحفظه` → `اللي بيتحفظ`.
    - **Predicates describing the user are replaced by nouns.** `إنت قادر` →
      `العرض ده مقدور عليه`; `حاسس بتوتر منه` → `توتر منه`; `صاحي متأخر` →
      `سهر تاني الليلة`. The one sample message where the user described
      themselves (`ومتوتر منه`, masculine) was neutralised too, so the mockups
      do not imply a gender anywhere.
    - **Past-tense second person is kept** (`قلت`, `أتمتتها`, `غيّرت`, `حبيت`):
      unvocalised, `فعلتَ` and `فعلتِ` are the same letters. So are `أنت`,
      `عليك`, `بريدك`, `يمكنك` — possessives and prepositions carry no gender in
      writing, and avoiding them would make the copy stilted for no gain.
    - **Feminine forms addressed to Lian are correct and were kept**:
      `احفظيها`, `افتكري ده`, `فكّريني بالدفعة`, `تساعديني`, `اتصرفي كمُحاوِرة`.
      Lian is female; the user is never gendered. This is the distinction the
      earlier pass missed — it treated the two directions as one rule.
31. **The chat header shows the drawer control on the start edge.** Chat is a
    root tab, so a back arrow would be wrong; the locked reference showed one
    because it was drawn as a pushed screen.
32. **Messages are bottom-anchored** in every chat frame, as a real conversation
    is, rather than top-aligned.
33. **Free plan quoted as 30 messages/day, one reach-out/day, text only, 100
    memories per assistant.** From PRD §34 / §35. The memory limit is a quiet
    text line near the header and a `Not kept yet` queue at capacity — no meter,
    no eviction, no countdown.
34. **`Delete everything` requires typing DELETE** (UI-UX §17 allows a typed
    word) and offers "Export first instead" — an alternative, not a retention
    play. The completion state is one warm line and a Close.
35. **Security uses "Sign out everywhere" rather than "Lock all sessions"**, and
    says the current session ends too. Plainer, and it removes the bank-vault
    register §16 warns against.
36. **The desktop context rail is hidden by default** and states that opening it
    changes nothing about what she keeps — the panel is a reader, not a control.
37. **Photography is placeholder.** Album, Our story and the moments carry
    labelled placeholders rather than stock imagery; §11 asks for quiet
    interiors, soft daylight and small domestic details, which needs real
    material rather than invented SVG scenes.

## Colour introduced beyond the specs, measured

`design.md` gives verified ratios for Quiet and hex values for Day and Night, but
Day has no secondary-text token and neither Day nor Night has a user-bubble,
raised-surface or destructive value. Every pair introduced was measured against
its own canvas:

38. **Day Muted Plum `#6B5B76`** — 5.90:1 on Cream `#FFF8F3`, 5.43:1 on Blush
    `#FCECEF`, 4.77:1 on the user bubble. Passes AA for normal text everywhere it
    is used. Not used on Lilac (4.16:1) or Night Rose.
39. **Day user bubble `#E7DEF4`** — a lighter tint of Lilac 100, same hue. Deep
    Plum on it is 10.12:1.
40. **Day raised surface `#FFFFFF`** — modals, sheets, nav container and inputs
    only. Deep Plum on it is 13.15:1.
41. **Quiet user bubble `#EFEAF2`** and **raised surface `#FBF8F8`** — Quiet
    Muted `#6E6774` reaches 4.6:1+ on both, keeping §15.1's rule that secondary
    text is Quiet Muted or darker.
42. **Quiet divider `#E2DADD`** — non-text, decorative only.
43. **Night raised surface `#2A2A42`**, **user bubble `#2B2743`**, **divider
    `#32324C`**, **taupe `#6A6478`** — Night Muted `#9993AA` is 4.71:1 and 4.82:1
    on the two surfaces; Night Text is 12.2:1 and 12.5:1.
44. **Destructive `#A8434B` day / `#9E4A50` quiet / `#E39098` night** — 5.60:1,
    5.37:1 and 7.28:1 on their canvases. A softened plum-red, never a full-width
    banner, and never paired with a green counterpart.
45. **Primary button fill is a separate token from the ink.** On Day and Quiet it
    is the plum text colour; on Night an inverted near-white button would shout,
    so it is Night Lilac `#75658E` with Night Text on it — 4.60:1, AA for the
    16px/700 label.
46. **Night-warm and night-quiet compositions** (themes sheet) keep the night
    canvas and shift only accents, chroma and decoration, per §16. Night-warm
    lifts rose to `#A5757F` and lilac to `#8B7399`; night-quiet flattens them to
    `#8A7378` and `#787286`. Text tokens stay at or above the night ratios.
47. **Night rose and lilac are never text backgrounds for normal text** — Night
    Text on Night Rose is 4.30:1, which passes only at large sizes.

## Build decisions a developer should know

48. **Every design decision is a token in `lian-tokens.css`; the screens consume
    tokens only.** Colour, type, geometry, depth and motion all live in one file
    that each document links once. Audited: no raw hex, radius, font size, font
    weight or line-height remains in any of the fifteen `.dc.html` files. The
    only hex values left in the set are the brand sheet's palette table (text,
    not styling), the fifteen override values in its recolour proof (which is
    the point of that section), and the standalone logos' fallback fill.
49. **Colour is two-tiered: palettes, then roles.** Tier 1 names every colour by
    theme (`--night-surface`); tier 2 gives the screens semantic roles
    (`--surface`) that point at tier 1, and `[data-t]` repoints the whole set.
    A theme switch is one attribute, a recolour is tier 1, and retargeting a
    role — bubbles no longer following the card colour — is one line in tier 2.
    None of the three touches a screen. The brand sheet renders that claim: the
    same screen twice, the second inside a wrapper overriding fifteen tier-1
    values to a mint-and-amber palette that is deliberately not ours.
50. **The token layer is where the Arabic type scale diverges, in three lines:**
    `--lh-body` 1.5 → 1.72, every heading line-height +4px, and `--fw-600` → 700
    because Tajawal has no cut 600. Font size deliberately does not change per
    script — Tajawal sits optically close to Nunito at the same size, and
    changing sizes would break shared layout geometry. §11's claim about looser
    Arabic headings is now true in the files rather than only in this log.
51. **Two AA failures were found by measuring the tokens rather than trusting
    them.** `night-warm` and `night-quiet` had no button tokens at all — an
    element using `--btn` under those themes fell through to the day plum. Given
    their own, taken from each composition's lilac, the button label scored 3.69
    and 3.89. Both fills were darkened (`#8B7399` → `#796485`, `#787286` →
    `#6B6678`) until they cleared 4.6. Every pair in the set is now measured and
    tabulated in TOKENS.md; the lowest is 4.51.
52. **Both languages are in the DOM; one is hidden.** Each string ships as
    `<span data-l="en">` and `<span data-l="ar">`, switched by `dir` on the root.
    That keeps every screen bilingual without a second copy of the file, and both
    languages stay directly editable in place.
53. **Language visibility is decided by each span's own computed direction, not
    by an ancestor selector.** The rule was `[dir="ltr"] [data-l="ar"] { display:
    none }`, which is a descendant selector: in the themes sheet, where three
    `dir="rtl"` frames sit inside the `dir="ltr"` page, it hid the Arabic inside
    the RTL frames — every Arabic bubble in that file was rendering empty.
    `[data-l="ar"]:dir(ltr)` asks the span instead, and the nearest `dir`
    attribute wins. The old pair is kept first as a fallback for engines without
    `:dir()`. Consolidating the stylesheet is what surfaced this; it had been
    wrong in all fifteen copies.
54. **RTL is real mirroring, not a translation pass.** Layout uses logical
    properties throughout (`padding-inline`, `margin-inline-end`,
    `inset-inline-start`, `border-inline-start`), so rows, rails, drawers,
    bubbles and the nav order mirror automatically. Directional icons carry
    `data-flip` and are scaled on the X axis; semantic icons are not.
55. **The chrome is componentised on purpose.** Status bar, chat header, screen
    header, input bar, bottom nav and desktop rail are separate DCs, so "the nav
    bar never changes between screens" is enforced structurally rather than by
    discipline — one edit changes all ~60 screens.
56. **`lian-defs.js` injects the mark, the lockup and the icon family as SVG
    symbols.** One outline family, 1.55px stroke, rounded caps and joins, legible
    at 16px. The lockup symbol is generated from `lian-logo.svg` itself, so the
    product UI and the brand asset can never drift apart.
57. **The OS notification dialog and the iOS add-to-home-screen sheet are drawn
    in system chrome, not Lian's.** They are not ours to style, and showing them
    unstyled makes the boundary between her voice and the platform's obvious.

## Open items for you

- Real photography for Album, Our story moments and the receipt capture.
- Male-voice Arabic and English copy. Every line here is the female-assistant
  voice; §45 is explicit that the masculine counterpart is separately authored,
  not a pronoun swap.
- Levantine, Gulf, Maghrebi, MSA and French copy. The Arabic here is Egyptian,
  matching the locked references.
- A licence check on Tajawal and Nunito for the app bundle and the app icon.
