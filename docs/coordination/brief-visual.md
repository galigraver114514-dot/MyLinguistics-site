# Brief: the visual, motion and interaction agent

Written by agent-reader for a third agent joining this repository. Read
`README.md` in this directory first for the protocol; read this for the
parts of the project that will bite you. Everything here was already paid for.

## 1. What you are joining

- One working tree, one branch (`main`), several agents at once. Every push
  mirrors to the public Pages site within a few minutes: **a broken commit is a
  broken website.**
- The site is **build-free**: plain ES modules served as-is. `package.json`
  exists only for `node --test`. No bundler, no CSS framework, no build
  script unless every agent agrees.
- iPad first: iPadOS 26.6, Safari, normally launched from the home screen in
  standalone mode. Desktop is a secondary target.
- No backend. No COOP/COEP, therefore no SharedArrayBuffer. GitHub Pages cannot
  set custom headers.

## 2. The one rule that outranks everything

The reader anchors **every** annotation to a base-text offset:
`{ chapter, start, end }` for a highlight or a note, `{ chapter, offset }`
for a bookmark. Never pixels, never DOM paths.

What that means for you:

- **Never mutate the text nodes inside `#content`.** Wrapping a range in a
  span, inserting a marker into the text, or splitting a node breaks the model
  every highlight, note and bookmark depends on. This is why note markers are
  overlays positioned from a range's rect rather than inline elements.
- **Animate transforms, opacity and scroll on containers - not the text.**
- Anything that changes layout (font size, writing mode, ruby) must keep the
  reading position; the reader restores it from the offset.
- `reader/js/text-model.js` and `reader/js/app.js` are load-bearing.
  Ask for a hook; do not edit them.

## 3. Device facts that decide interaction (measured, not guessed)

| Fact | Consequence |
| --- | --- |
| Pencil hover fires `pointermove` with `pointerType === 'pen'` even though `hover: hover` and `any-hover` are both false | do not feature-detect hover; test the pointer type |
| WebKit bug 269535: no pen pointer events while a touch is present | never require a finger and the Pencil down at the same time |
| iOS owns long-press, the selection callout, edge swipes and scroll bounce | reading mode already sets `user-select: none` and `-webkit-touch-callout: none`; do not add a gesture that fights them |
| No Vibration API in Safari | haptics are unavailable without a native wrapper; feedback is visual or audible only |
| `navigator.storage.persist()` is granted; quota measured at 39,322 MB | storage is not the constraint |
| `env(safe-area-inset-*)`, `100dvh` and standalone mode are real | the status bar area is a separate concern from the layout viewport |
| Native vertical selection works | an offset-based selection is not needed for v1 |

## 4. Territory: read this before you touch anything

Current owners: **agent-reader** owns `reader/**` and `src/dict/**`;
**agent-wordbook** owns `assets/**`, the root pages and `src/lexicon/**`.

**The collision you are about to have.** "Visuals, animation, interaction" here
spans three different filesystems:

1. the **design system** (`assets/css/tokens.css`) and the **shell**
   (`assets/css/shell.css`, `assets/js/shell.js`): nav bar, tab bar,
   bottom sheets - built by agent-wordbook;
2. the **reader's reading surface** (`reader/reader.css`) and its gestures
   (`reader/js/app.js`) - agent-reader;
3. the **wordbook pages** (`study.html`, `assets/css/wordbook.css`) -
   agent-wordbook.

Recommended split, which keeps one writer per file:

| Path | Owner |
| --- | --- |
| `assets/css/tokens.css` | **you** - a design system needs exactly one owner |
| `assets/css/motion.css`, `assets/js/motion.js` (new) | **you** |
| `assets/css/shell.css`, `assets/js/shell.js` | **you**, after an `ANSWER:` from agent-wordbook |
| `reader/reader.css` | split: structure stays with agent-reader, a new `reader/theme.css` is **yours** |
| `reader/js/**` | agent-reader. Request hooks; do not edit |
| root `*.html` markup, `study.html` | agent-wordbook |
| `assets/css/style.css`, `assets/css/wordbook.css` | agent-wordbook, or yours for visuals by agreement |

Taking a file that already has an owner needs a `CLAIM:` in your log and an
`ANSWER:` in theirs. New files need only the `CLAIM:`.

## 5. Interaction decisions already made - do not re-litigate quietly

- **Finger navigates, Pencil annotates.** A finger tap on text looks up; the
  margins page-turn; the centre toggles chrome. The split is enforced by
  geometry: a tap counts as "on text" only if it lands inside a tracked text
  node's rectangle, so a margin tap cannot look up the nearest word.
- Double tap selects a sentence, again for the paragraph.
- Pencil tap looks up, Pencil drag highlights, Pencil hover previews the reading
  after 120 ms of rest - the delay is deliberate.
- Selection action bar: メモ / 蛍光 / コピー / 辞書 / 解除.
- 辞書 and しおり are bottom sheets, and the tab bar stays visible under them.
- Generated furigana is **dropped by decision**, not pending. See
  `ja-reader-design.md` section 7.

Each of these was a decision. If you want to change one, say so with a reason.

## 6. Contracts you can build on

- `window.Reader` - `title()`, `actions()`, `run(id)`,
  `on('title'|'page')`, `embedded()`. The shell renders whatever
  `actions()` returns and follows `on('title')`.
- `docs/coordination/interface-shell.md` - the shell/reader boundary: the
  content box, the z scale, and the standalone fallback.
- CSS custom properties the reader honours: `--reader-size`,
  `--accent`, `--paper`, `--ink`, `--muted`,
  `--line`. Theme is `html[data-theme]` with `paper`,
  `white`, `night`.
- `body.shell-embedded` marks the reader as wrapped by the shell and hides
  the reader's own bar and footer.

Z scale today: nav bar and tab bar 30, reader sheets 40, hover bubble 41, reader
overlay 48, shell sheet 50/51. The reader sits between the bars and the shell's
sheet on purpose. Changing this needs agent-reader and agent-wordbook.

## 7. Motion: the hook that does not exist yet

A page turn is currently an instant `scrollLeft` jump, which is exactly
what you will want to animate. Do not implement it by editing the gesture
handler; ask for this instead:

    REQUEST: a page-turn animator hook in the reader
      to: agent-reader
      why: a page turn is an instant scrollLeft jump; animating it must not
           desync state.page from the real scroll position
      shape: window.Reader.setPageAnimator(fn), where fn({ from, to, direction,
             apply }) is called instead of the jump and apply(page) performs the
             real one for a fallback
      needs-by: whenever

Until it exists, anything you add must be pure CSS or a separate overlay, and
must not assume control of `scrollLeft`.

Rules that matter for motion in this reader:

- `prefers-reduced-motion: reduce` must disable motion, not merely shorten
  it. The busy spinner and the sheet transitions already respect it.
- Vertical text scrolls **horizontally** and the next page lies to the **left**.
  An animation that slides the wrong way reads as going backwards.
- An interrupted page turn must leave `state.page` and `scrollLeft`
  consistent; the reader re-derives the page from `scrollLeft` when it
  restores a position.
- Do not rely on `requestAnimationFrame` as a guarantee: the reader races
  it against a 50 ms timer, because rAF does not fire while the document is
  hidden. A loader that waits on it forever is indistinguishable from a hang.

## 8. The CSS Custom Highlight API footgun

Highlights (`::highlight(reader-highlight)`, `reader-note`,
`reader-selection`, `reader-draft`, `reader-hover`) are painted
with the CSS Custom Highlight API. Registering a highlight whose subtree has **no
layout boxes** - a `display: none` container, or before layout has run -
fails **silently and permanently**: the API reports success, the range has
geometry, and nothing ever paints.

The reader guards this by measuring `range.getClientRects()` before
registering and never registering an empty highlight. Do not remove that guard,
and do not paint before the content is laid out.

## 9. Versioning and caching: this will bite you on your first change

GitHub Pages serves static files with `cache-control: max-age=600`. A module
or stylesheet you changed can be shadowed by the cached copy for ten minutes. The
reader loads everything with `?v=N` and shows `html rN · js rN` in the
footer, so a stale module can be told apart from a real bug.

**Any change to a reader file needs the version bumped** in `reader/index.html`
and in every import inside `reader/js/*.js`. If you only change
`assets/**`, ask agent-wordbook how they version those.

## 10. Testing: what can and cannot be checked without the device

- `npm test` runs the Node test runner with `jsdom` and
  `fake-indexeddb`.
- The reader's page tests load the **real** `reader/index.html`, click the
  real buttons and feed a real EPUB. Breaking the page's wiring fails them.
- **jsdom has no layout.** Every geometry result is zero,
  `document.elementFromPoint` returns nothing, and animation cannot be
  observed. Anything positional - markers, tap targets, transitions - has to be
  verified on the device, and your log should say what you could not verify
  rather than implying it works.
- A pure function is always worth a test: an easing, a direction rule, a
  placement calculation. There are examples in `tests/reader-*.test.js`.

## 11. Traps that already cost time here

- **`importNode` copies, it does not move.** A
  `while (body.firstChild) container.appendChild(importNode(body.firstChild))`
  loop never terminates. It froze the reader on its loading screen once.
- **Highlights registered on a hidden subtree fail silently and permanently**
  (section 8). This cost three probe rounds.
- **`git add` with a nonexistent pathspec is fatal and stages nothing.**
  After a `git mv` the old path is gone and the whole command aborts.
  Always read `git status` after staging.
- **Never `git add -A`.** Several agents' unfinished work is in this tree.
- **A 30 MB fixture was committed and then had to be removed and the mirror's
  history rewritten.** Do not commit binaries; icons and fonts should be small
  and few.
- `package.json` has `"type": "module"`, so any Node helper script in
  this repository must be `.cjs`.
- The deploy workflow removes `tests/`, `package.json` and
  `package-lock.json` with an explicit `rm` **and** an
  `--exclude`. rsync `--delete` protects excluded paths on the
  receiver, so either half alone leaves them published.

## 12. Where to read

| File | Why |
| --- | --- |
| `docs/coordination/README.md` | the protocol and the ownership map |
| `docs/coordination/interface-shell.md` | the shell/reader boundary and the z scale |
| `docs/ja-reader-ios-interaction.md` | the gesture map, and section 15 for what is actually built |
| `docs/ja-reader-design.md` | the text model, vertical typesetting, and the furigana decision |
| `docs/ja-reader-spike.md` | every device measurement, with the probe that produced it |
| `reader/reader.css` | the reading surface, the sheets, and the existing z-index ladder |
| `assets/css/tokens.css` | the design tokens you are inheriting |
