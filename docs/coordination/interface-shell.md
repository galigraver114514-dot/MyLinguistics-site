# Interface: the shared shell and the reader

**Version 0.4. Owner: agent-visual for the shell, the design system and
`reader/reader.css`; agent-reader for `reader/index.html` and `reader/js/**`.
Changing this file is agent-reader's, since it lives in `docs/`.**

Version 0.3 was written when the shell belonged to agent-wordbook. The human
reassigned the visual layer to agent-visual on 2026-09-22 (see
`README.md`'s map), and 0.4 records that plus the three seams that came out of
it: the page theme, the progress rail, and the version number.

0.4 additions, all of them already implemented on both sides:

- **The page theme is `data-page-theme`.** The site means light/dark by
  `data-theme` and the reader means paper/white/night; one attribute cannot
  carry two vocabularies, and the last writer won. `reader/reader.css` matches
  both spellings for one release, so either side can land first.
- **The progress rail.** `#rail` is the reader's markup; its look is the
  stylesheet's. The seam is one custom property.
- **One version number for the whole reader**, owned by `reader/index.html`.

## What the shell provides

    assets/css/tokens.css    colour, type, spacing, radius, shadow, safe areas
    assets/css/shell.css     nav bar and tab bar (z 30), sheet (z 50/51),
                             .shell-content
    assets/js/shell.js       static-markup behaviour, `markShell()`,
                             `wireReader()`; window.ML.shell

The shell owns `body`: its top and side insets, and `padding-bottom` for the
tab bar, through `body.has-shell`. The reader must not set a `body` padding
shorthand while embedded, or it would clobber that rule and let its reading
surface run under the tab bar.

## What the reader keeps

    reader/index.html        the reading surface, the reader's own sheets, and
                             the single version number (agent-reader)
    reader/reader.css        the reading surface, dictionary panel, selection
                             bar, hover bubble (agent-visual, visual layer only)
    reader/js/**             all reading logic, unchanged (agent-reader)

## How the reader detects the shell

No cooperation is required. `shellPresent()` is true if any of these hold:

- `document.documentElement.dataset.shell === 'on'`, kept for a future
  explicit opt-in;
- `document.body.classList.contains('has-shell')`, which is what shell.js adds;
- the shell's own markup is present:
  `document.querySelector('.tabbar, .navbar, .capsule, #tabbar')`.

Their `markShell()` sets both `data-shell="on"` and `body.has-shell` before
any other work, which is exactly what the reader listens for.

The reader checks at startup, again on `DOMContentLoaded`, and then watches
`body` with a `MutationObserver` for **both** late signals: the `class`
attribute (shell.js adds `has-shell` on its own schedule) and `childList`
(the navigation markup can be mounted after this module has run). Watching only
the class was a real break, not a theory: the capsule became the markup every
page carries, and a capsule mounted after startup was never seen.

The markup selector lists four names on purpose. `.tabbar` and `.navbar`
matched the classes the old static bars carried; `.capsule` is the class
every page carries now; `#tabbar` is there because the pages keep that **id**,
and a class selector never matches an id. This is the one place the reader
depends on the shell's markup names, so it is deliberately the most permissive
selector in the file - it can only add detections, never remove one.

When any signal is true the reader adds `body.shell-embedded`, which hides
`#bar` and `#foot` and zeroes the top and side padding. Removing the signal
restores standalone.

## z scale: the reader now sits inside the shell's

    nav bar                    30
    tab bar                    30
    reader sheets              40   dictionary panel, selection bar
    hover bubble               41
    reader overlay             48   TOC, settings, shelf, dictionary manager
    shell sheet + backdrop     50/51

The reader sits strictly between the bars and the shell's sheet: above the tab
bar so its panels are usable, below the shell's sheet so a shell modal still
wins. Its two bottom sheets are also offset by
`calc(var(--tabbar-h) + var(--safe-bottom))` when embedded, so the tab bar
stays visible and usable under a definition instead of being buried by it.

The scale moved once already (40/50/60 to 30/30/50/51). The reader's numbers are
deliberately mid-band so a small change on either side does not collide.

## Sheets: the reader keeps its own, and why

`window.ML.shell.openSheet` renders a flat `ios-list` from
`items: [{ label, href, onClick }]`. That is right for the TOC and settings
and wrong for the other two: the dictionary panel renders a structured-content
tree, which is not a list, and the shelf needs two actions per row plus a file
picker. So the reader keeps `#overlay`, `#dict` and `#select-bar`. If the
shell would rather own every sheet, the primitive needs to accept a DOM node and
the reader will hand it one.

## window.Reader, already built and tested

    window.Reader = {
      title()            -> string
      actions()          -> [{ id, label }]   // file / toc / dict / settings
      run(id)            -> void
      on('title'|'page') -> off
      embedded()         -> boolean
    }

The nav bar is: call `actions()`, render them, call `run(id)`. The reader
never learns what the bar looks like and the shell never learns what the buttons
do.

Their `wireReader()` consumes exactly this: it renders `actions()` into
`.navbar-reader-actions`, calls `run(action.id)`, and calls `title()` now
and on every `on('title')`. Nothing on either side needs to change for that to
keep working.

## The one thing the reader needs from the shell side

The shell's markup is static in each page, so adopting it means editing
`reader/index.html`, which is agent-reader's file. Rather than hand the file
over, paste the exact nav-bar and tab-bar block for a reader page - or point at
a page that already has it - and the reader will add it together with the
stylesheet and script tags. `shell.js` already resolves the `/reader/` path
to the `reader` tab, so nothing else should be needed.

## The page theme: `data-page-theme`, and why not `data-theme`

`<html data-theme>` used to carry two different vocabularies at once:

| Writer | Values | Means |
| --- | --- | --- |
| site chrome (`assets/js/app.js`) | `light` / `dark` | the app's appearance |
| the reader (`reader/index.html`, `reader/js/app.js`) | `paper` / `white` / `night` | the page's paper |

Standalone that is harmless, because only one of them runs. Embedded in the
shell it is not: the shell sets `data-theme="dark"` for the site while the
reader sets `data-theme="paper"` for the page, the last writer wins, and both
features break silently - the site loses its dark mode and the reader cannot
follow it.

**The rule: the site keeps `data-theme`, the reader writes
`data-page-theme`, and both stay on `<html>`.** They answer different
questions - what the app looks like, and what the paper is - so they get
different names.

For one release `reader/reader.css` matches both spellings on each theme rule,
which is what lets either commit land first without a window where the page
loses its paper. The `[data-theme='...']` half is deleted by agent-visual once
the reader has moved; after that, **a revert of the reader's half is a two-sided
revert**, not one revert.

## The progress rail: the reader states the position, the stylesheet places it

agent-visual's contract, implemented as written:

    <div id="rail" role="progressbar" aria-label="読書位置"
         aria-valuemin="1" aria-valuemax="1" aria-valuenow="1">
      <div id="rail-fill"></div>
    </div>

- **`#rail` is a sibling of `#viewport` and after it.** That order is load
  bearing: the stylesheet tells vertical writing apart with
  `#viewport.vertical ~ #rail` and flips the fill's origin to the right in that
  mode. Moving `#rail` before `#viewport` breaks vertical pages only.
- **The reader writes the numbers**, in `updateRail()`, which
  `updatePageInfo()` calls: `aria-valuemin`, `aria-valuemax`,
  `aria-valuenow`, and `--progress` as a fraction from 0 to 1.
- **Vertical pages count pages**: `max = state.pages`, `now = state.page + 1`,
  `--progress = pages > 1 ? page / (pages - 1) : 0`.
- **Horizontal pages have no pages at all** - `paginate()` leaves
  `state.pages` at 1 - so they report how far the text has scrolled instead:
  `min = 0`, `max = 100`, `now = percent`, `--progress = percent / 100`.
  This is the one extension to agent-visual's version, which described the
  vertical case only; their stylesheet reads `--progress` and nothing else, so
  it is invisible to them.
- **No book open** is the guard case: `--progress` is 0 and `aria-valuenow`
  is the minimum.
- **The style is not here.** `#rail` ships unstyled, so it is invisible and
  the reader looks exactly as it did until `reader/reader.css` draws
  `#rail-fill`. That is deliberate: the markup could land before the restyle
  without either side waiting.
- **Tap to jump and hold to scrub are gestures**, so they are `reader/js/**`
  and land after the rail can actually be seen and touched.

## Version numbers: one number for the whole reader

`reader/index.html` is the single place that names a version: every
`?v=N` in `reader/js/**` and the two references in the page itself - the
module script and `reader.css` - carry the same N, and the visible `#build`
stamp says `html rN`.

GitHub Pages serves with `cache-control: max-age=600`, so a stale module is a
10 minute bug that looks like a broken feature. **A mismatched `?v=` is worse
than a stale one**: the browser loads the same module twice under two URLs, with
two copies of its state and a second IndexedDB connection. `tests/reader-page
.test.js` asserts that every reference carries one number and that the stamp
agrees.

The visible stamp is rewritten at runtime from the same number:
`#build` shows `html rN · js rN`, and N comes out of `import.meta.url`
rather than a second constant, because a second constant is a second thing to
forget. It had already been forgotten once - the assets were at v13 while the
stamp still said r11, which is exactly the reading the stamp exists to give.
Under `node --test` the import carries no query string, so the stamp falls
back to the number written in `reader/index.html`, and the version test ties
that number to the query strings.

Consequence for the split: **a change under `reader/**` that alters behaviour
needs a version bump, and only agent-reader can make it.** agent-visual says so
in `log-visual.md` when `reader/reader.css` changes appearance and
agent-reader bumps the number in the next commit. A restyle arriving up to ten
minutes late is acceptable; a restyle that never arrives is not.

## Standalone must keep working

`reader/index.html` stays openable on its own: on desktop, and in the jsdom
page tests that load the real file and click the real buttons. If
`assets/js/shell.js` is missing or throws, the reader degrades to exactly what
it is today, never to a blank page.
