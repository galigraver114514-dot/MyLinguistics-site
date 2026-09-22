# Coordination between agents

Several agents work in this repository **at the same time, in the same working
tree, on the same branch**. This directory is the protocol that stops them from
destroying each other's work. It is not documentation for the site.

## The situation

- One working tree: `/home/galigraver/projects/MyLinguistics`
- One branch, `main`. Every push mirrors the site to the public Pages repo
  within a few minutes, so a broken commit is a broken website.
- The agents:
  - **agent-reader** - the Japanese EPUB reader, the shared dictionary module,
    and the frozen interfaces between them.
  - **agent-wordbook** - the study/vocabulary system: the engine, the wordbook
    pages and their feature UI.
  - **agent-visual** - **the design system, the shell, motion and interaction
    across the site, and the reader's visual layer.** The human reassigned this
    to a third agent on 2026-09-22, after it had been briefly given to
    agent-reader; the arbitration is recorded below and in `log-reader.md`.
- No agent can message another. The only channels are the files in this
  directory, the git history, and the human, who relays anything urgent.

## Hard rules

1. **Never `git add -A` or `git add .`.** Always stage explicit paths. The
   other agent's unfinished work sits in the same working tree and will be swept
   into your commit otherwise. This nearly happened once already.
2. **Write only inside your own paths.** Taking new territory means writing a
   `CLAIM:` entry in your own log first, then committing the files.
3. **At the start of every turn**, read the other agent's log, then run
   `git log --oneline -10` and `git status --short` before touching anything.
4. **Never commit a broken state.** Every push to `main` is a deploy.
5. **One writer per file.** If you need a change in a file you do not own, put a
   `REQUEST:` block in **your own** log. The owner answers with an `ANSWER:`
   block in **their** log. Never edit the other agent's log.
6. **Frozen interfaces.** `interface-dict.md` carries a version number.
   Changing it needs a version bump plus an entry in both logs.
7. **Do not delete or rewrite anything outside your territory**, including
   another agent's temporary fixtures.

## Ownership map

| Path | Owner |
| --- | --- |
| `reader/**` except `reader/reader.css` | agent-reader |
| `reader/reader.css` | agent-visual, **visual layer only**: `--page-*` tokens, the highlight colours, the progress rail, the embedded state. The reader's structure and everything in `reader/js/**` stay agent-reader's, and `brief-visual.md` section 2 applies unchanged. |
| `src/dict/**` | agent-reader |
| `tests/dict-*.test.js`, `tests/reader-*.test.js` | agent-reader |
| `docs/ja-reader-*.md`, `docs/ui-redesign-plan.md`, `docs/coordination/brief-visual.md` | agent-reader |
| `docs/coordination/README.md`, `interface-*.md`, `log-reader.md` | agent-reader |
| `.github/workflows/deploy-pages.yml` | agent-reader |
| `assets/css/**` | agent-visual |
| `assets/js/shell.js`, `assets/js/app.js`, `assets/js/motion.js` | agent-visual |
| `designs/**` | agent-visual |
| `docs/coordination/agent-visual-brief.md`, `log-visual.md` | agent-visual |
| `src/lexicon/**` | agent-wordbook |
| `tests/**` except the two prefixes above | agent-wordbook |
| `package.json`, `package-lock.json`, `node_modules` | agent-wordbook |
| root `*.html` **markup** (including `study.html`) | agent-wordbook; layout and styling come from agent-visual's CSS |
| `docs/ja-vocab-*.md`, `docs/coordination/log-wordbook.md` | agent-wordbook |
| the rest of `assets/**` | agent-wordbook |
| `.gitignore`, `README.md` (root), `.github/**` except the deploy workflow | agent-wordbook |
| `assets/js/i18n.js` | shared: `REQUEST:` / `ANSWER:` before editing |

Anything not listed belongs to whoever claimed it most recently in their log.

## Asking for something

In your own log, append a block. Do not edit the other log.

    REQUEST: <one line, imperative>
      to: agent-wordbook
      why: <one line>
      blocks: <what you cannot do until it is answered>
      needs-by: <rough, or "no rush">

The owner replies in their own log:

    ANSWER: <the same one line>
      from: agent-wordbook
      decision: <what was decided>
      note: <anything the asker must know>

The asker is responsible for re-reading the other log on its next turn. There is
no notification.

## House conventions both agents follow

- The site is **build-free**. `package.json` exists only for `node --test`;
  there is no build script and there must not be one unless both agents agree.
  Browser code is plain ES modules served as-is.
- Tests live in `tests/` and run with `npm test` (`node --test tests/*.test.js`).
  Use `fake-indexeddb` and `jsdom`, both already present as devDependencies.
- Because `package.json` has `"type": "module"`, **any Node helper script in
  this repository must use the `.cjs` extension**. This has already bitten one
  of us.
- The deploy mirrors the repository root, so `src/` and `tests/` are
  published. That is fine and intended. `node_modules` must stay in
  `.gitignore` so it is never committed and therefore never mirrored.
- Temporary fixtures get deleted once the question they answer is settled.

## If the protocol fails

Escalate to the human. Do not "fix" the other agent's territory to resolve a
conflict; that turns one conflict into two.
