# Interface: the shared shell and the reader

**Version 0.5. Owner: agent-visual for the shell, the design system and
`reader/reader.css`; agent-reader for `reader/index.html` and `reader/js/**`.
Changing this file is agent-reader's, since it lives in `docs/`.**

Version 0.3 was written when the shell belonged to agent-wordbook. The human
reassigned the visual layer to agent-visual on 2026-09-22 (see
`README.md`'s map), and 0.4 records that plus the three seams that came out of
it: the page theme, the progress rail, and the version number.

**0.5 is the embedding.** `reader/index.html` now carries the capsule, the
same static markup every page carries with the paths adjusted for `/reader/`,
and loads `tokens.css`, `shell.css`, `i18n.js`, `app.js` and
`shell.js` beside its own module. The reader's own bar and footer are hidden, its
actions are mounted into `.capsule-inner`, and two commands joined that list
because the footer was where text size lived. See "The reader page carries the
shell" below for the four rules that came out of it.

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
- the shell's own markup is present **and the shell's script is tagged in
  the page**: `document.querySelector('.tabbar, .navbar, .capsule, #tabbar')`
  plus `document.querySelector('script[src*="shell.js"]')`.

  The script half is not decoration. The two signals above mean "shell.js ran";
  this one means "it will run, or it never will". Standing the reader's own bar
  down on markup alone would leave nothing to open a book with if the script
  never arrived, so markup counts only where the script that wires it does.

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

## The reader page carries the shell

Done in 0.5. Four rules came out of it, and each one is load bearing.

**1. `.shell-content` wraps the reading surface, and `#rail` stays inside it
after `#viewport`.** shell.css gives the class `flex: 1 1 auto; min-height: 0;
overflow: hidden` but no flex direction, because no other page has a wrapper and
needs one. `#viewport` takes its height from being a flex child, so the page
carries two rules of its own:

    .shell-content { display: flex; flex-direction: column; }
    .shell-content > #viewport { flex: 1 1 auto; min-height: 0; }

They duplicate what `body.shell-embedded .shell-content` already says in
`reader/reader.css`, and they are the only styling `reader/index.html` holds.
**REQUEST to agent-visual: fold both into `shell.css`'s `.shell-content` rule
and the reader's two lines go away.**

**2. `assets/css/style.css` is deliberately not loaded.** It is the legacy
component layer, it has no markup on this page, and it is the only sheet that
consumes the shell's `--accent` - which `reader.css` redefines as sepia page
ink. Loading it would give the reader page a sepia accent where every other page
is blue. See "the accent hazard" below.

**3. The reader's module is tagged before `shell.js`.** The module is deferred,
so it executes before `DOMContentLoaded`; `shell.js` is a classic script that
registers a `DOMContentLoaded` handler, and that handler is what calls
`wireReader()` and looks for `window.Reader`. Reversed, the actions would have
nowhere to mount and nothing would say so. A test asserts the order in the file,
because the failure is silent in a browser.

**4. Markup alone does not make the reader stand down its own bar.** See
"How the reader detects the shell".

### Buttons the shell renders

`window.Reader.actions()` is now

    file, toc, dict, bookmark, smaller, larger, settings

`smaller` and `larger` are new in 0.5, and they are not decoration: embedding
hides `#foot`, which was the only place text size lived. Page turns need no
action - swipe, the margin taps and the arrow keys all still work.
`wireReader()` renders whatever length the list is, so nothing on the shell side
had to change; it did have to be written down, because a shell that renders four
buttons and a reader that offers seven fail silently.

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
`?v=N` in `reader/js/**` and all six references in the page itself - three
stylesheets (`tokens.css`, `shell.css`, `reader.css`) and three scripts
(the reader's module, plus the shell's `i18n.js`, `app.js` and
`shell.js`) - carry the same N, and the visible `#build` stamp says `html rN`.
The stamp is rewritten at runtime from that same number.

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

## The accent hazard

`tokens.css` says `--accent: var(--tint)` - the accent is the system tint.
`reader.css` says `--accent: #7a5c3e` - the accent is sepia page ink. Same
name, two meanings, and the page loads both.

Today this is **latent**: nothing loaded on the reader page consumes the shell's
`--accent`. `shell.css` does not use it and `style.css` is deliberately not
loaded. It becomes visible the moment any shell rule on this page uses
`var(--accent)` - the capsule's active state being the obvious candidate - and
then exactly one page in the site would be sepia where every other is blue.

It is the `data-theme` collision one layer down, and it gets the same
treatment: **REQUEST to agent-visual to rename the reader's four `--accent`
uses to `--page-accent`,** which is the namespace the reader already owns for
page colours. Until then, do not use `--accent` in a rule that has to work on
the reader page.

## Standalone must keep working

`reader/index.html` stays openable on its own: on desktop, and in the jsdom
page tests that load the real file and click the real buttons. It is now a shell
page, so "standalone" means embedded - the capsule is there and the reader's own
bar is hidden - and the tests assert that.

The contract that still holds is the fallback. If `assets/js/shell.js` is
missing or throws, the reader degrades to what it was before embedding, never to
a blank page. That is why the markup alone does not count as a shell: the
reader's file, table of contents and settings buttons are mounted into the
capsule **by that script**, so a page carrying the capsule without it would hide
the reader's own bar and give back nothing. A test removes the script element
and asserts the bar comes back.
