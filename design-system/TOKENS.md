# Lian — token reference

Every design decision in this set is a token in **`lian-tokens.css`**. The
screens consume tokens only: no raw hex, radius, size, weight, shadow or
duration appears in any `.dc.html`. Each document loads the file once:

```html
<link rel="stylesheet" href="lian-tokens.css">
```

## How it is structured

Two tiers, so that a theme switch and a recolour are different operations.

**Tier 1 — palettes.** Every colour value in the product is written once, here,
named by theme: `--day-surface`, `--night-border`, `--quiet-text`. This is the
only place a hex lives.

**Tier 2 — roles.** The names the screens actually use — `--surface`, `--text`,
`--border` — each pointing at tier 1. The `[data-t]` attribute repoints the
whole role set:

```css
:root, [data-t="day"] { --surface: var(--day-surface); … }
[data-t="night"]      { --surface: var(--night-surface); … }
```

So: **switching theme** = one attribute. **Recolouring the brand** = edit tier 1.
**Retargeting a role** (say, bubbles stop using the surface colour) = edit that
one line in tier 2. Nothing in the screens changes for any of the three. The
brand sheet's *Recolour · one edit* section is that claim rendered: the same
screen twice, the second inside a wrapper overriding fifteen tier-1 values.

The screens were written against a shorter vocabulary (`--surf`, `--ink`,
`--line`, `--sh`…). Those names still exist as aliases of the role tokens in the
same block, so both spellings work and neither is a second source of truth.

---

## 1. Colour

### Tier 1 — the five palettes

Sixteen roles × five themes. `night-warm` and `night-quiet` are the compositions
from §45: night canvas, shifted accents.

| role | day | quiet | night | night-warm | night-quiet |
|---|---|---|---|---|---|
| `canvas` | `#FFF8F3` | `#F7F3F2` | `#171827` | `#171827` | `#171827` |
| `surface` | `#FCECEF` | `#EFE8EA` | `#222238` | `#262036` | `#20202F` |
| `raised` | `#FFFFFF` | `#FBF8F8` | `#2A2A42` | `#2E2740` | `#262636` |
| `bubble-mine` | `#E7DEF4` | `#EFEAF2` | `#2B2743` | `#332941` | `#26263A` |
| `accent` (rose) | `#F6D7DE` | `#D7BBC3` | `#8D6674` | `#A5757F` | `#8A7378` |
| `accent-alt` (lilac) | `#DCCDF2` | `#C9C1D7` | `#75658E` | `#8B7399` | `#787286` |
| `decor` (taupe) | `#CDBEB6` | `#B8ACA8` | `#6A6478` | `#7A6B72` | `#666069` |
| `edge` | `#8B7870` | `#827675` | `#857F94` | `#8F8188` | `#827C8B` |
| `border` | `#E9E7F1` | `#E2DADD` | `#32324C` | `#3A3049` | `#2C2C3C` |
| `text` | `#3B2948` | `#403744` | `#F4EEF8` | `#F7EEF2` | `#EFEAF0` |
| `muted` | `#6B5B76` | `#6E6774` | `#9993AA` | `#A99BA5` | `#98939E` |
| `on-text` | `#FFF8F3` | `#F7F3F2` | `#171827` | `#171827` | `#171827` |
| `destructive` | `#A8434B` | `#9E4A50` | `#E39098` | `#E39098` | `#DC9098` |
| `nav-active` | `#EFEAF4` | `#EAE4E8` | `#232338` | `#2A2337` | `#1F1F2D` |
| `button-fill` | `#3B2948` | `#403744` | `#75658E` | `#8B7399` | `#787286` |
| `button-ink` | `#FFF8F3` | `#F7F3F2` | `#F4EEF8` | `#F7EEF2` | `#EFEAF0` |
| `board` | `#EFE7E3` | `#E9E3E2` | `#0D0E1A` | `#0D0E1A` | `#0D0E1A` |

Read as `--day-canvas`, `--night-surface`, `--night-quiet-border`, and so on.
`night-warm` and `night-quiet` previously had no button tokens at all — an
element using `--btn` under those themes fell through to the day plum. They now
carry their own, taken from each composition's lilac.

### Tier 2 — roles the screens use

| token | controls | alias |
|---|---|---|
| `--canvas` | screen background inside a phone frame | |
| `--surface` | cards, rows, her message bubbles | `--surf` |
| `--raised` | modals, sheets, the nav container, inputs | `--surf2` |
| `--bubble-hers` | her bubbles (points at `--surface`) | |
| `--bubble-mine` | the user's bubbles | `--user` |
| `--text` | primary text, icons, the logo's fill | `--ink` |
| `--muted` | secondary text, timestamps, captions | |
| `--on-text` | text and icons **on** a `--text` fill | `--onink` |
| `--border` | hairlines, dividers, input outlines | `--line` |
| `--accent` | rose: avatar tints, decorative fills | `--rose` |
| `--accent-alt` | lilac: the second assistant, decoration | `--lilac` |
| `--decor` | decoration only: waveform bars, empty-state symbols, timeline dots, the reply-strip rule, media placeholders | |
| `--edge` | boundaries the user must perceive to act: field outlines, unchecked controls, dashed affordances, the search-hit and reaction-target bubble outlines | |
| `--destructive` | delete copy, destructive buttons | `--danger` |
| `--nav-active` | the active tab's pill | `--tint` |
| `--button-fill` / `--button-ink` | primary button and its label | `--btn` / `--onbtn` |
| `--board` | the workspace behind the frames (never in-product) | |
| `--elev-1` | cards and frames | `--sh` |
| `--elev-2` | modals and sheets — defined, not yet used |

### Brand palette

`--brand-plum #3B2948`, `--brand-cream #FFF8F3`, `--brand-blush #FCECEF`,
`--brand-rose #F6D7DE`, `--brand-lilac #DCCDF2`, `--brand-lilac-200 #CFC3DD`,
`--brand-taupe #CDBEB6`, `--brand-white #FFFFFF`.

Theme-independent: use these where a thing must stay brand-coloured regardless
of theme (the app icon, the install tile). Everything else uses roles.

`--lian-brand-ink` is the logo's fill, defaulting to `var(--text)`. In product
the symbols in `lian-defs.js` are `fill="currentColor"`, so the lockup takes the
colour of whatever it sits in. The two standalone files (`lian-logo.svg`,
`lian-mark.svg`) use `fill="var(--lian-brand-ink, #3B2948)"` — the hex is a
fallback for opening the file on its own, and the only hex outside this token
file. Recolouring the brand is one value.

---

## 2. Type

`--font-latin` Nunito · `--font-arabic` Tajawal · `--font-mono` for hex values
and code. Both are **SIL Open Font License 1.1** (see DECISIONS §12).

Sizes `--fs-9 … --fs-74` and line-heights `--lh-16 … --lh-84`, named for their
px value: `--fs-16` is 16px. Twenty-one sizes and twenty-two line-heights is
more than a scale should carry — it is what the set actually uses, honestly
named, so tightening the scale means editing values here rather than hunting
1,100 inline declarations.

Weights: `--fw-400`, `--fw-500`, `--fw-600`, `--fw-700`.
Tracking: `--tracking-caps` `.12em`, `--tracking-caps-wide` `.14em`,
`--tracking-caps-wider` `.16em` — the three uppercase label treatments.

**Where the Arabic scale diverges.** In the `[dir="rtl"]` block:

- `--lh-body` 1.5 → **1.72**
- every heading line-height (`--lh-30` and above) → **+4px**
- `--fw-600` → **700**, because Tajawal has no cut 600

That is the whole divergence, and it is three lines. Font size is deliberately
*not* changed per script: Tajawal at the same size sits optically close to
Nunito, and changing sizes would break the shared layout geometry.

---

## 3. Geometry

| group | tokens | notes |
|---|---|---|
| radius | `--r-1 … --r-30`, `--r-round` (50%), `--r-pill` (999px) | named for px |
| radius by role | `--r-card` 16, `--r-bubble` 18, `--r-panel` 20, `--r-sheet` 30, `--r-chip` 14, `--r-nav` 22 | aliases of the above; the shape language in six lines |
| border width | `--bw-1` 1px, `--bw-1-4` 1.4px, `--bw-1-5` 1.5px, `--bw-1-6` 1.6px, `--bw-2` 2px, `--bw-3` 3px | the sub-pixel three are icon-adjacent strokes drawn as borders (status-bar glyphs, unchecked circles); `--bw-2` is selection and emphasis |
| spacing | `--s-1 … --s-80` | padding, gap, margin, inset. Negative margins are `calc(-1 * var(--s-8))` |
| icon / square | `--i-6 … --i-88` | icons, avatars, dots, square tiles |
| row heights | `--h-38 … --h-120` | list rows, buttons, headers |
| touch target | `--tap-min` **44px** | the floor; 41 elements sit on it |
| viewport | `--h-screen` 100vh, `--frame-w` 390px, `--frame-h` 844px | the phone frame |

`--tap-min` is the one geometry token with an accessibility contract: it is the
44px minimum from the brief. Lowering it breaks the set.

## 4. Depth, motion, icons

`--elev-1` (cards) and `--elev-2` (modals) are per-theme: a 10px/30px shadow at
10% on light canvases, 40% on dark. `--elev-2` is defined and documented but not
yet applied — the set currently draws modals with `--elev-1`.

`--dur-fast` 120ms · `--dur-base` 200ms · `--dur-slow` 360ms ·
`--dur-dots` 1.2s (her thinking indicator) · `--dur-caret` 1.1s (streaming
caret) · `--ease-standard` · `--ease-out`.

`--icon-stroke` **1.55** — one weight for the whole outline family, inherited
into the `<use>` shadow trees from a single `svg { stroke-width }` rule. Icon
colour is `currentColor` by design, so an icon is always the colour of its
context; there is no icon colour token to get out of step.

`--rule-faint` / `--rule-soft` / `--rule-strong` are the three hairline alphas
used on dark surfaces, where a solid border reads as a box.

## 5. Deliberately not brand

`--os-action` `#0A7AFF`, `--os-dialog`, `--os-label-2`, `--os-label-3`,
`--os-black` — iOS system colours in the OS permission dialog and lock screen.
The OS draws those, not us; they must not follow a rebrand.

`--incognito-canvas` `#191622`, `--incognito-canvas-deep` `#14141F`,
`--incognito-badge`, `--incognito-glow`, `--incognito-deep`, `--incognito-text` —
incognito is its own near-black family, darker than Night on purpose.

---

## 6. What is safe to change

**Safe on its own** — nothing else needs re-checking:
`--accent`, `--accent-alt`, `--decor`, `--nav-active`, `--board`,
every `--r-*`, `--s-*`, `--i-*`, `--h-*`, all `--dur-*` and `--ease-*`,
`--tracking-*`. Accents are never text backgrounds for normal text (§46), which
is what keeps them free.

**Safe within limits:**

- `--icon-stroke` — below ~1.3 the 16px icons go faint, above ~1.9 they read as
  a heavier family than the type.
- `--fs-*` — 24px is the floor for anything in a phone frame; `--fs-9` and
  `--fs-10` exist only for status-bar glyphs and badges.
- `--lh-*` — the RTL block adds 4px to headings; keep that relationship or
  Arabic headings crowd.
- `--tap-min` — never below 44px.

**Re-measure after changing.** The table below is a readable excerpt, not the
measurement: `npm run gate:tokens:contrast` prints all 175 cells and fails on
any that is missing or below its floor. Two AA failures were found that way,
neither of which appears in this excerpt — which is the point:

| pair | was | now |
|---|---:|---|
| `--muted` on `--quiet-nav-active` | 4.35 | 4.55 — `--quiet-nav-active` lifted `#EAE4E8` → `#EFE9ED` |
| `--muted` on `--quiet-board` | 4.29 | recorded, not floored — `--board` is never in-product |

`--nav-active` was the value to move rather than `--quiet-muted`: it is a
decorative tint this system introduced and §6 documents as safe to change on
its own, where `--quiet-muted #6E6774` is specified in design.md §15.1 with a
published table of its own.

The excerpt:

| pair | day | quiet | night | night-warm | night-quiet |
|---|---|---|---|---|---|
| `--muted` on `--canvas` | 5.90 | 4.94 | 5.94 | 6.62 | 5.85 |
| `--muted` on `--surface` | 5.43 | 4.51 | 5.25 | 5.90 | 5.35 |
| `--muted` on `--bubble-mine` | 4.77 | 4.60 | 4.82 | 5.16 | 4.93 |
| `--muted` on `--raised` | 6.21 | 5.16 | 4.71 | 5.35 | 4.96 |
| `--text` on `--canvas` | 12.51 | 10.31 | 15.41 | 15.44 | 14.79 |
| `--text` on `--surface` | 11.51 | 9.42 | 13.61 | 13.76 | 13.52 |
| `--text` on `--raised` | 13.15 | 10.76 | 12.22 | 12.47 | 12.53 |
| `--text` on `--bubble-mine` | 10.12 | 9.59 | 12.50 | 12.04 | 12.46 |
| `--text` on `--nav-active` | 11.11 | 9.07 | 13.46 | 13.25 | 13.70 |
| `--button-ink` on `--button-fill` | 12.51 | 10.31 | **4.60** | **4.65** | **4.66** |
| `--destructive` on `--canvas` | 5.60 | 5.37 | 7.28 | 7.28 | 7.09 |
| `--destructive` on `--surface` | 5.15 | 4.90 | 6.43 | 6.49 | 6.48 |

The lowest ratio in the set is 4.51 (`--muted` on `--surface`, quiet); the
button pairs on the three night themes are the tightest at 4.60–4.66 and pass on
a 16px/700 label. Any button or muted change needs re-measuring first.

Measuring this table caught a real failure. Giving `night-warm` and
`night-quiet` their own button tokens — they previously had none and fell
through to the day plum — first used each composition's own lilac, which scored
3.69 and 3.89 against its text colour. Both fills were darkened (`#8B7399` →
`#796485`, `#787286` → `#6B6678`) until they cleared 4.6.

Three couplings are easy to miss:

1. `--text` is also the logo's fill and every icon's colour. Changing it
   recolours the mark, the icon family and the type together — usually what you
   want, occasionally not.
2. `--surface` serves cards *and* her message bubbles (`--bubble-hers` points at
   it). Split them in tier 2 before recolouring one and not the other.
3. `--on-text` must stay legible on `--button-fill` as well as `--text`, because
   inverted chips use it on both.

## 7. Not tokenised, on purpose

One-off layout dimensions (the 1840px sheet width, a 268px thumbnail, a 320px
rail) are not design decisions the system should hold — they are the size of one
thing in one place. Hex values quoted **as text** in the brand sheet's palette
table are content, not styling. And `currentColor` is left as is wherever an
element should simply take its context's colour.

## 8. Checking the layer

Auditing for raw values is not enough: a `var()` pointing at a name that was
never defined computes to nothing, and for a shorthand like `border` the whole
declaration is dropped — `border: var(--bw-1-5) solid var(--edge)` becomes
`0px none`, so an outline disappears rather than getting thinner. Five tokens
were missing after the conversion for exactly that reason (`--bw-1-4`,
`--bw-1-5`, `--bw-1-6`, `--bw-3`, `--s-64`), and four unchecked-state circles in
the brand sheet had silently lost their outline.

So the check that matters is **resolution**, not spelling: collect every custom
property defined in `lian-tokens.css` and every `var(--…)` referenced across the
`.dc.html` files, and diff. It currently reads 337 defined, 317 referenced, none
unresolved. Run it after any edit that adds a token reference.

## 9. Required before any tier-1 override ships

Any edit to tier 1 — a recolour, a new theme, a single darkened fill —
**re-measures every pair, not a sample.** This is not advice. The recolour proof
on the brand sheet shipped with a placeholder at 1.62:1 on canvas and 1.77:1 on
raised, because three pairs were measured and reported as if they were the
palette. Nothing in the file said which pairs existed, so nothing caught it.

### The three thresholds

Every colour role falls into exactly one class. The class decides the floor,
and the floor is not negotiable within the class.

| Class | Floor | Why |
|---|---|---|
| Text | 4.5:1 | WCAG 1.4.3 |
| Boundary | 3:1 | WCAG 1.4.11 — a control the user must perceive to act |
| Decoration | none | 1.4.3 and 1.4.11 both exempt it; softness is the intent |

### Which role is which

**Text — hold to 4.5:1**

| Ink | Against |
|---|---|
| `--text` | `--canvas` `--surface` `--raised` `--bubble-mine` `--nav-active` |
| `--muted` | `--canvas` `--surface` `--raised` `--bubble-mine` `--nav-active` |
| `--destructive` | `--canvas` `--surface` `--raised` `--bubble-mine` `--nav-active` |
| `--on-text` | `--text` |
| `--button-ink` | `--button-fill` |

**Boundary — hold to 3:1**

| Ink | Against |
|---|---|
| `--edge` | `--canvas` `--surface` `--raised` `--bubble-mine` `--nav-active` |

`--border` is **not** in this class, and an earlier version of this table said
it was. Three things say otherwise: the required count below has always been
26, which excludes it; the note beside it has always said "hairlines and
dividers only"; and the shipped value measures **1.16:1** on the day canvas,
which no amount of intent makes a 3:1 boundary. It is a hairline. Anything
that is the sole outline of a control belongs on `--edge`, and
`tools/gates/boundaries.ts` is what keeps it there. `--border` is measured and
printed as a recorded pair, with no floor.

**Decoration — exempt, measure anyway and record the number**

`--decor`, `--accent`, `--accent-alt`. Exempt means no floor, not no
measurement: print the ratios so the exemption is a visible decision. `--decor`
sits near 1.7:1 on the light themes by design.

That is **22 required pairs per palette plus 13 recorded ones**, and the count
is now arithmetic rather than assertion:

| | pairs | why |
|---|---:|---|
| text, 4.5:1 | 15 | `--text` `--muted` `--destructive` × five in-product backgrounds |
| text, 4.5:1 | 2 | `--on-text` on `--text`, `--button-ink` on `--button-fill` |
| boundary, 3:1 | 5 | `--edge` × the same five backgrounds |
| recorded | 6 | `--decor` `--accent` `--accent-alt` × `--canvas` `--surface` |
| recorded | 3 | `--border` × `--canvas` `--surface` `--raised` — a hairline |
| recorded | 4 | `--text` `--muted` `--destructive` `--edge` × `--board` |

`--board` is a recorded background, not a required one: §4 defines it as the
workspace behind the phone frames, never in-product, and holding product text
to a floor against a colour no user sees is arithmetic theatre.

35 cells per palette, 175 across the five. A palette with any cell blank has
not been measured, and `npm run gate:tokens:contrast` computes all of them
from this file on every commit — the table is no longer written by hand, which
is how the sampling error below happened in the first place.

### Why `--decor` and `--edge` are two roles

They were one role, `--placeholder`, aliased `--taupe`, and it painted three
different kinds of thing: waveform bars, empty-state symbols and dots, and the
outline of the `DELETE` confirmation field on the data-deletion screen. The
first two are decoration. The third is a control boundary the user must see to
type into, and at the single role's value it measured:

| | day | quiet | night | night-warm | night-quiet |
|---|---|---|---|---|---|
| old, as `--placeholder` | 1.72 | 2.01 | 3.10 | 3.49 | 2.88 |
| now, as `--edge` (worst of six backgrounds) | 3.22 | 3.45 | 3.62 | 3.69 | 3.66 |

Three of five failed 1.4.11, on the screen where someone confirms erasing
everything. Darkening the single role would have fixed the field and ruined the
illustrations; splitting fixes the field and leaves the illustrations alone.

**When you add a boundary, ask which class it is in.** A dashed outline that is
the only affordance is `--edge`. A rule beside a quoted reply is `--decor`. If
the user has to see it to act, it is a boundary.

### Two traps this closes

- **An override that omits roles is not a palette.** The recolour block set
  fifteen values and left `--day-board` and `--day-destructive` at their rose
  originals — a warm beige board and a rose error inside a mint theme, both
  measuring fine and both wrong. Override the full tier-1 set, or state plainly
  which roles you are deliberately keeping.
- **A proof that reports a sample is worse than no proof.** Anyone recolouring
  copies the override block as their starting point. The brand sheet now prints
  all 32 ratios beside the swatches, each row labelled with the floor it is held
  to, so the arithmetic is on the page and not in a report.
