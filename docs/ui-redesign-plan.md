# Overall UI redesign - decided

**Status: decided by the human on 2026-09-22. Not yet implemented.** This
supersedes the visual parts of `ja-vocab-book-redesign.md`; the engine and
the information architecture there are kept.

## 1. What was wrong

The site is two visual worlds sharing a tab bar.

| | Site pages | Reader |
| --- | --- | --- |
| Tokens | `assets/css/tokens.css` - Apple system palette, blue tint | its own `:root` - 生成り paper, sepia ink |
| Type | `--font`, system sans, 17px base | Mincho, `--reader-size`, 2.1 leading |
| Theme | `html[data-theme]`, light and dark | `data-theme` paper / white / night, bridged through `ml.theme` |
| Accent | `--tint #007aff` | `--accent #7a5c3e` |
| Radius | tokens, 8/12/18/980 | 9 / 10 / 16, hard-coded |
| Motion | sheets at 0.22s and 0.28s, a spinner; everything else instant | page turn is an instant `scrollLeft` jump |

Two accents with no rule about which is which, and no motion language: some
things move, most snap, and nothing says why.

## 2. The direction

**Pure iOS for the app, a document view for the page.**

- **The app is stock iOS.** Shell, navigation, management, settings, lists,
  sheets, typography: the system palette, the system font, grouped insets,
  standard materials, standard motion. No editorial styling, no decorative
  rules, no custom scrollbars, nothing that announces itself as a website.
- **The reading view is an iOS document view.** Full-bleed page, its own page
  theme (白 / 生成り / 夜), chrome that recedes while reading, a page-turn
  gesture. It is the one place with typographic character, and it is contained:
  **nothing editorial leaks out of the reading page into the app.**

The distinction that makes this work: the reader's sepia is not a second brand
colour, it is *the ink of one page theme*. It never appears on a button.

**One consequence to accept.** With 純 iOS as the direction, the default page
theme must follow the system appearance - 白 in light, 夜 in dark - and 生成り
becomes an opt-in "warm paper" choice. Today the reader defaults to 生成り, so
this is a visible behaviour change.

## 3. Colour

Keep the system palette as the base; it is already iOS-correct and its dark mode
is done. Add the page surface as **tokens**, not as a second theme.

    app surface      --bg --surface --surface-2 --surface-3
                     --text --muted --border --separator --fill
    action           --tint --tint-strong --tint-soft --tint-contrast
    page surface     --page-bg --page-ink --page-muted --page-rule
    annotation       --hl-mark --hl-note --hl-selection --hl-hover

**The accent rule: blue acts, sepia reads.** Anything tappable is the system
tint. Sepia appears only as `--page-ink` / `--page-rule` inside the
生成り page theme, and nowhere else. In the 白 and 夜 themes the page ink is the
system label colour, so the same component works in all three.

Highlight colours move out of the hard-coded `rgba()` values in
`reader.css` into `--hl-*`, defined per page theme, so the night
theme stops being a special case.

## 4. Type

- **UI**: the existing system stack (`--font`) and the existing iOS scale
  (`--text-large-title 30/34, --text-title 17, --text-base 17, --text-callout
  15, --text-footnote 13, --text-caption 11`). No new sizes.
- **Reading**: Mincho (`Hiragino Mincho ProN, Yu Mincho, Noto Serif JP`),
  which is the document view's serif option, not a site-wide style. Size from
  `--reader-size` (14-34, default 19); leading 2.1 vertical, 1.9
  horizontal; `--reading-measure` caps the horizontal line length.
- **Reading UI** - dictionary panel, notes, captions - is Mincho for definitions
  and system sans for labels and metadata. That split already exists; it becomes
  a stated rule.

## 5. Shape, spacing, depth

The token values, nothing new: radius sheets 16 / cards 12 / controls 8 or pill;
spacing `--space-1..7`; depth `--shadow-sm` for controls and
`--shadow-md` for sheets, and nothing else gets a shadow. The reader's
9/10/16 fold into these.

## 6. Motion

| Token | Value | Used by |
| --- | --- | --- |
| `--motion-fast` | 120 ms | control feedback, tab press, marker appear |
| `--motion-base` | 220 ms | sheets, toggles, list insert and delete |
| `--motion-slow` | 320 ms | page turn, chapter change |
| `--ease-ios` | cubic-bezier(0.32, 0.72, 0, 1) | sheets, nav title collapse |
| `--ease-out` | cubic-bezier(0.22, 1, 0.36, 1) | page turn, scroll |

**Animates**: page turn, sheet in and out, tab switch, nav title collapse, list
insert and delete, marker appear, progress rail.

**Never animates**: text reflow, font size change, theme change, highlight paint.
Those are instant on purpose - they are the reader changing its mind about
typography, not the interface moving.

Page turn scales its duration with distance (120-320 ms), eases out, and is
interruptible: a second turn re-targets from the current offset instead of
queueing. **`state.page` is authoritative and the scroll position is
derived from it**, so an interrupted turn cannot desync the page indicator.

`prefers-reduced-motion: reduce` turns motion **off**, not shorter, and a
setting turns it off regardless of the system.

## 7. Page by page

**Shell.** The existing model stays: bottom tab bar (Reader / Learn / Overview),
per-tab nav bar, bottom sheets. It gains the motion tokens, one sheet
implementation, and the reader's actions in the nav bar.

**Reader.** A document view inside the shell. Full-bleed page; nav bar and tab
bar float over it as translucent material; its own bar and footer stay hidden
when embedded.
- Replace the footer with a **thin progress rail above the tab bar**: page
  position, tap to jump, hold to scrub. Swipe and the margin taps already turn
  pages; prev/next buttons are a desktop affordance.
- `A−` and `A＋` move into the nav bar's actions.
- Default page theme follows the system; 生成り is a choice in 表示.

**Wordbook (Learn).** The brick session is the other document-like surface: ten
word cards, Mincho, one card in focus. The river and net stay canvas, framed by
the app surface.

**Overview.** App surface throughout: grouped insets, the pool and brick
progress as lists, data management behind a `...` menu.

**Home and About.** Absorbed into Overview and the nav bar's `more` sheet.
Three tabs, nothing else.

## 8. Decisions recorded

| Question | Decision |
| --- | --- |
| Visual direction | **Pure iOS system**, with the reading view as a document view |
| Accent | **Blue acts, sepia reads** - the system tint for anything tappable, sepia only as the 生成り page ink |
| Reading themes | **Keep three** (生成り / 白 / 夜), rewritten as `--page-*` tokens; the default now follows the system appearance |
| Page position | **A thin progress rail above the tab bar**; A−/A+ into the nav bar |
| Reference | none given - the above is the spec |

## 9. Rollout, each step shippable

1. **Tokens only.** Move the reader's page colours and highlight colours into
   tokens, add the page and motion tokens, change the default page theme to
   follow the system. Visible but structural, one or two files.
2. **Motion.** The page-turn animation, the motion tokens, the reduced-motion
   rule and a setting. The most visible change, the least structural.
3. **Reader inside the shell.** Progress rail, actions in the nav bar, full-bleed
   page. This is where the reader stops being a separate world.
4. **Wordbook pages.** The markup is agent-wordbook's and the styling is mine, so
   this needs a `REQUEST:` / `ANSWER:` before any of it.
5. **Overview, Home, About.** Consolidation last, when the tokens have settled.

Steps 1 and 2 are independent of everybody else and can start immediately.
