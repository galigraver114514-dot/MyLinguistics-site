# MyLinguistics

A personal, static workspace for reading Japanese and keeping the vocabulary:
an in-browser EPUB reader and a sense-level wordbook with monolingual
definitions. No backend, no build step, no third-party runtime dependencies.

The interface switches between English, Chinese, and Japanese.

## Features

- **Reader** - opens your own EPUBs, with vertical and horizontal typesetting,
  authored ruby, and reading position stored as a text offset.
- **Wordbook** - one card per sense, monolingual Japanese definitions, FSRS-6
  review with recognition before production, a passive exposure track, and a
  random word river.
- **Mining and triage** - paste a passage (or import a text file) and recurring
  unknown words are proposed as candidates. Approving one authors its cards;
  ignoring one retires it. A frequency list reorders candidates toward the
  useful middle band and sharpens word segmentation.
- **No English on Japanese words.** Readings are kana, parts of speech are
  Japanese, and a definition never falls back to another language.
- **Interface languages** - English, Chinese, Japanese.
- **Data ownership** - IndexedDB holds the lexicon and the reader's books;
  localStorage holds only the interface language and the theme.

## Project structure

    .
    |-- index.html            Home
    |-- study.html            The wordbook
    |-- about.html            How it fits together
    |-- 404.html              Fallback page
    |-- assets/
    |   |-- css/style.css     Shared stylesheet
    |   |-- css/wordbook.css  Wordbook styles
    |   |-- js/data.js        The Japanese seed
    |   |-- js/i18n.js        Interface strings (en / zh / ja)
    |   |-- js/app.js         Interface language, theme, chrome
    |   +-- favicon.svg
    |-- src/lexicon/          Wordbook engine (schema, FSRS-6, digest, river, tokeniser, IndexedDB)
    |-- src/dict/             Shared dictionary module (agent-reader)
    |-- reader/               EPUB reader (agent-reader)
    |-- tests/                Node test suite
    |-- docs/                 Design documents and agent coordination
    |-- .nojekyll             Serve the files as-is, without Jekyll processing
    |-- .github/workflows/    Automated deployment to the public Pages repository
    |-- LICENSE
    +-- README.md

## The wordbook

`study.html` is the whole study surface.

- **Review** schedules each sense with FSRS-6, recognition before production.
  A **Look only** toggle shows every answer and advances without grading.
- **Passive** is a context-rich digest you only read. It grows a decaying
  familiarity score and never writes into the FSRS schedule.
- **River** is a random, context-free stream of words. No grading and no
  sentences; it only nudges recognition, one exposure at a time.
- **Inbox** holds mined candidates. Approve one to author its cards, or ignore
  it to retire it. The same panel captures a word by hand.
- **Browse** lists the lexicon with recognition and card state.
- **Manage data** mines pasted text or a file, imports a frequency list (a word
  and a rank per line, either order), and exports or restores a JSON backup.
- Definitions come from the shared dictionary module (`src/dict`, specified by
  `docs/coordination/interface-dict.md`) once it lands; until then they come
  from the built-in seed in `src/lexicon/seed-ja.js`. English never appears.

Run the tests with Node 20 or newer:

    npm install
    npm test

## Languages

The header carries one switch: the **interface language**, English, Chinese, or
Japanese, stored under `ml.uilang`. The wordbook is Japanese only.

## Local preview

There is nothing to install. Any static file server works:

    python3 -m http.server 8000

Then open <http://localhost:8000>.

## Deployment

GitHub Pages cannot be built from a private repository on the free plan, so the
site is published from a second, public repository:

- `galigraver114514-dot/MyLinguistics` - this repository, private, and the
  source of truth for every file.
- `galigraver114514-dot/MyLinguistics-site` - public, and the deployment
  target that GitHub Pages actually serves.

The workflow in `.github/workflows/deploy-pages.yml` mirrors the site files
into the deployment repository on every push to `main`. It authenticates with
an SSH deploy key that has write access to that one repository and nothing
else; the private half is held in the `DEPLOY_KEY` repository secret. If a
file is deleted here, the next deploy deletes it there too.

Live site: <https://galigraver114514-dot.github.io/MyLinguistics-site/>

Because a published site is static, its HTML, CSS, and JavaScript are publicly
readable by anyone who visits the URL. What stays private is the source
repository - its history, issues, and settings.

### Rotating the deploy key

    ssh-keygen -t ed25519 -N "" -C "mylinguistics-actions-deploy" -f deploy_key
    gh repo deploy-key add deploy_key.pub --repo <owner>/MyLinguistics-site --title "GitHub Actions deploy" --allow-write
    gh secret set DEPLOY_KEY --repo <owner>/MyLinguistics < deploy_key
    rm -f deploy_key deploy_key.pub

Then remove the previous key from the deployment repository under
**Settings -> Deploy keys**.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| Space | Flip the current card, or advance in look-only mode |
| 1 | Grade *Again* |
| 2 | Grade *Hard* |
| 3 | Grade *Good* |
| 4 | Grade *Easy* |

## Browser support

Any current version of Chrome, Edge, Firefox, or Safari.

## License

Released under the MIT License. See `LICENSE` for the full text.
