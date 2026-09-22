# Brief: the visual, motion, and interaction agent

Written by agent-wordbook, 2026-09-22, for a third agent that takes over the
look, the motion, and the interaction detail of this site.

Read this, then `docs/coordination/README.md`, then every `log-*.md`, then
`git log --oneline -15` and `git status --short`.

## 1. What this is

MyLinguistics is a **static, no-build** personal language workspace on GitHub
Pages: an EPUB reader (`reader/`), a Japanese wordbook (`study.html`), a home
page, and an about page. Everything runs in the browser; IndexedDB holds the
lexicon and the books; there is no backend and no bundler.

The wordbook is an iPad-first, iOS-style app: one page, two sections (Learn and
Overview) routed by the hash and switched by a bottom tab bar, over a design
system in `assets/css/tokens.css`.

Three agents share one working tree and one branch, `main`. Every push to
`main` publishes the public site automatically.

## 2. Hard constraints

1. **No build step.** Plain HTML, CSS, and ES modules. A bundler or a framework
   is a global decision: it changes the deploy and needs all three agents to
   agree first.
2. **Every push deploys.** `main` is published by
   `.github/workflows/deploy-pages.yml` (owned by agent-reader). There is no
   staging branch. Do not push a broken page.
3. **The tests are the behavioural contract.** Run
   `node --test tests/*.test.js` before every commit. They drive the real pages
   in jsdom and assert on ids, on structure, and on Japanese mode never showing
   Latin letters in the wordbook panels.
4. **Never `git add -A` or `git add .`.** Stage explicit paths only, and never
   commit another agent's unstaged work.
5. **One writer per file.** Announce a `CLAIM:` in your log before editing a
   file another agent owns.
6. **iOS Safari is the target.** iPad, usually launched from the home screen.

## 3. What you own

Proposed. The final wording belongs in `docs/coordination/README.md`, which
agent-reader owns, so ask them to add it rather than editing it.

    agent-visual owns
      assets/css/**            tokens, shell, style, wordbook, any new CSS
      assets/js/shell.js       the tab bar, the nav bar, the sheet, the shell API
      assets/js/app.js         theme and interface-language chrome
      assets/img/**            new icons or illustrations, if any
      docs/coordination/log-visual.md
      docs/ui-direction.md     the visual direction, once chosen

    agent-visual may CLAIM for a pass (one file at a time, in the log)
      index.html study.html about.html overview.html 404.html
      assets/js/i18n.js        add or rename strings; never remove one in use
      manifest.webmanifest

    agent-wordbook keeps
      src/lexicon/**           the engine, including entry.js, the page controller
      tests/** except dict-* and reader-*
      README.md, docs/ja-vocab-book-*.md, docs/coordination/log-wordbook.md
      package.json, package-lock.json, .github/**

    agent-reader keeps
      reader/**  src/dict/**
      docs/ja-reader-*.md  docs/coordination/{README,interface-*,log-reader}.md
      tests/dict-*.test.js  tests/reader-*.test.js

You own the **look**; the engine and the page structure belong to
agent-wordbook. When a visual change needs a new id, a new element, or a
different structure, write a `REQUEST` in your log instead of editing
`src/lexicon/entry.js`; the reverse also applies.

## 4. The design system as it stands

- `assets/css/tokens.css` is the only source of colour, spacing, radius, type,
  touch size, and safe areas. It defines both themes and back-compat aliases
  (`--accent` -> `--tint`).
- `assets/css/shell.css` holds the iOS shell: `.navbar` (sticky, blurred),
  `.navbar-large` (the collapsible large title), `.tabbar` (bottom, blurred),
  `.sheet`/`.sheet-backdrop`, `.ios-list`/`.ios-row`, and `.shell-content`
  (the box the reader measures).
- `assets/css/style.css` keeps the older components (`.panel`, `.btn`,
  `.pill`, `.field`, tables). `assets/css/wordbook.css` holds the wordbook's
  own classes, including the river (`.wb-river*`).
- `assets/js/shell.js` marks the active tab from the route, collapses the large
  title, opens the `more` sheet, handles edge-swipe back, sets
  `documentElement.dataset.shell = 'on'` and `body.has-shell`, exposes
  `window.Shell` (and `ML.shell`), and renders whatever
  `window.Reader.actions()` returns.
- The palette is Apple's system palette and the tint is system blue. **No visual
  direction has been chosen yet** - only a placeholder, "instrument-like density
  on paper-like surfaces". Get a reference from the user before a large restyle.

## 5. Load-bearing selectors

Do not rename one without changing its test in the same commit.

Page structure and routing:

- `[data-section="learn"]`, `[data-section="overview"]`, `.wb-section`
- `.wb-tab[data-view=...]` with the views `brick river passive pool bricks
  lexicon data`
- `#tabbar`, `.tabbar-item[data-tab="reader|learn|overview"]`, `#navbar`,
  `#shellMore`, `#themeToggle`, `.header-inner`

Wordbook panels scanned for Latin letters in Japanese mode:

- `#wbStats #wbReview #wbDigest #wbBrowse #wbRiver #wbInbox #wbBricks`
  (`#wbData` is exempt: it legitimately names Yomitan, zip, and JSON.)

The brick session:

- `#wbCard #wbFlip #wbNext #wbLookOnly #wbLookNote #wbPrompt #wbReading
  #wbDefinition #wbContext #wbTolerance #wbInput #wbTypeWrap #wbGrades
  #wbCounter #wbModeLabel #wbBrickChip #wbProgress #wbDone #wbDoneTitle
  #wbDoneNote`, and `#wbGrades [data-rating="1..4"]`

Pool, bricks, and data:

- `#wbImportText #wbImportRun #wbImportFile #wbFreqText #wbFreqRun #wbFreqFile
  #wbDictFile #wbDictForget #wbEnrol #wbInboxList #wbInboxRefresh #wbMineWord
  #wbMineReading #wbMineDefinition #wbMineSentence #wbMineAdd #wbExport
  #wbRestoreFile #wbReset #wbSearch #wbBrowseBody #wbBricksList`

River:

- `#wbRiverCanvas` **and** `#wbRiverFallback` (both are load-bearing), plus
  `#wbRiverCount #wbRiverPause #wbRiverShuffle #wbRiverCatch #wbRiverEmpty`

Interface strings:

- `[data-i18n]`, `[data-i18n-placeholder]`, `[data-i18n-aria]`; the tests
  check `wb.title`, `wb.tab.passive`, `nav.home`, `nav.reader`.

## 6. Traps that have already cost time

- **jsdom has no canvas.** `canvas.getContext('2d')` returns null in tests, so
  `river-view.js` keeps a DOM fallback (`#wbRiverFallback` with
  `.wb-river-word`). Do not remove it; a page test uses it.
- **Most page tests have no `requestAnimationFrame`.** The river's clock starts
  only when `requestAnimationFrame` exists and `prefers-reduced-motion` is off,
  so no test is left with a live timer. Keep that guard.
- **`textContent` includes hidden elements.** The Japanese-mode guard scans the
  whole panel, so a hidden English string still fails the test.
- **The river's DOM fallback uses `writing-mode: vertical-rl`.** Restyling it is
  fine; changing its text content is not.
- **`100vh` is wrong on iOS.** Use `100dvh` and `env(safe-area-inset-*)`.
- **No Vibration API on iOS Safari.** Haptics cannot be promised without a
  native wrapper.
- **The reader has its own world** (`reader/reader.css`, sepia tokens) with its
  own sheets. The agreed z scale is bars 30, reader sheets 40, shell sheets 50,
  hover bubble 60; see `docs/coordination/interface-shell.md`.
- **`package.json` is `"type": "module"`,** so any Node helper script must end
  in `.cjs`.
- **The reader is not on the shared shell yet.** agent-reader has the contract
  and the detection; `reader/index.html` still needs the two tags and a
  `.shell-content` wrapper. Coordinate rather than editing `reader/**`.

## 7. Open visual work

- The visual direction: colours, density, type scale, iconography.
- Motion: the rod's catch feedback, brick completion, list appearance, sheet
  transitions, tab changes. Honour `prefers-reduced-motion`.
- Empty, loading, and error states for every panel.
- iPad polish: large-title behaviour, context menus, pull to refresh, dynamic
  type, dark-mode contrast audit, safe-area and DPR on the device.
- The reader adopting the shared shell.
- The home page is still a marketing hero and about is prose; both may become
  something more app-like.

## 8. How to verify

    node --test tests/*.test.js        # Node 20 or newer
    python3 -m http.server 8000        # then open http://localhost:8000

The public site is published from a second repository;
`gh run list --limit 3` shows the deploy for each push.
