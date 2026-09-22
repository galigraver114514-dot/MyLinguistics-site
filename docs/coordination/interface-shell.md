# Interface: the shared shell and the reader

**Version 0.2, updated by agent-reader after reading the real
`assets/js/shell.js` and `assets/css/shell.css`. Owner: agent-wordbook for
the shell files, agent-reader for the reader side.**

The reader side is built and tested. This file now describes the boundary as it
actually is, rather than as proposed.

## What the shell provides

    assets/css/tokens.css    colour, type, spacing, radius, shadow, safe areas
    assets/css/shell.css     nav bar (z 40), tab bar (z 50), sheet (z 60/61)
    assets/js/shell.js       static-markup behaviour; window.ML.shell

The shell owns `body`: its top and side insets, and `padding-bottom` for the
tab bar, through `body.has-shell`. The reader must not set a `body` padding
shorthand while embedded, or it would clobber that rule and let its reading
surface run under the tab bar.

## What the reader keeps

    reader/index.html        the reading surface and the reader's own sheets
    reader/reader.css        the reading surface, dictionary panel, selection
                             bar, hover bubble
    reader/js/**             all reading logic, unchanged

## How the reader detects the shell

No cooperation is required. `shellPresent()` is true if any of these hold:

- `document.documentElement.dataset.shell === 'on'`, kept for a future
  explicit opt-in;
- `document.body.classList.contains('has-shell')`, which is what shell.js adds;
- `document.querySelector('.tabbar, .navbar')` exists, which covers the static
  markup.

The reader checks at startup, again on `DOMContentLoaded`, and then watches
`body`'s class with a `MutationObserver`, because the two scripts race and
shell.js adds `has-shell` on its own schedule. When any signal is true the
reader adds `body.shell-embedded`, which hides `#bar` and `#foot` and
zeroes the top and side padding. Removing the signal restores standalone.

## z scale: the reader now sits inside the shell's

    nav bar                    40
    tab bar                    50
    reader sheets              55   dictionary panel, selection bar
    hover bubble               56
    reader overlay             58   TOC, settings, shelf, dictionary manager
    shell sheet + backdrop     60/61

The reader dropped its old 40/45/50. Its two bottom sheets are also offset by
`calc(var(--tabbar-h) + var(--safe-bottom))` when embedded, so the tab bar
stays visible and usable under a definition instead of being buried by it.

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

## The one thing the reader needs from the shell side

The shell's markup is static in each page, so adopting it means editing
`reader/index.html`, which is agent-reader's file. Rather than hand the file
over, paste the exact nav-bar and tab-bar block for a reader page - or point at
a page that already has it - and the reader will add it together with the
stylesheet and script tags. `shell.js` already resolves the `/reader/` path
to the `reader` tab, so nothing else should be needed.

## Standalone must keep working

`reader/index.html` stays openable on its own: on desktop, and in the jsdom
page tests that load the real file and click the real buttons. If
`assets/js/shell.js` is missing or throws, the reader degrades to exactly what
it is today, never to a blank page.
