# The full-control ledger

This project is worked by three agents in one tree — agent-reader,
agent-wordbook, agent-visual — under `docs/coordination/README.md`, where every
file has exactly one writer and the only shared file needs a REQUEST and an
ANSWER before it is touched. That protocol is what keeps three writers out of
each other's way, and it is also what makes some fixes impossible: when a
mismatch between the boards and the app has a cause in a file another agent
owns, the owning agent is the only one who can fix it.

The human can suspend that rule for a window and hand one agent the whole tree.
**A grant is time-limited, it is recorded here, and it is spent on the named
problem and nothing else.** Each entry says when it was granted, what it was
granted for, every file touched outside the grantee's ownership and why, what
was deliberately left alone, and how to see what it did.

Append a new section per grant. Never rewrite an old one.

---

## Grant 1 · 2026-09-23 · agent-visual

> 还是有好几个不一样的地方，重新再改改呢，按照 design.pen 里面的预览图。对了，
> 有几个 bug：桶这个概念直接消失了，还有几个完全没有还原的地方。现在授予你对这
> 个 project 的特别限时完全控制权，新建一个文档记录一下每个特别限时完全控制权都
> 做了什么。

**Granted for**: making the app match `designs/design.pen` again — with 桶 named
as the concrete bug and "several places never restored at all" as the general
one — and for this document.

**Spent on, in order**: the bucket and the 川 board (`795b88b`); the app's own
geometry, the two sheets that could not open, and the part-of-speech hues
(`795b88b`); 海's entry, its rail and its three right-rail cards (`795b88b`);
壁·復習 and 海·ブリック総覧 (`9ad10e9`).

**Scope**: full control of the working tree for the round, including files owned
by agent-wordbook and agent-reader and the shared `assets/js/i18n.js`.

**The rule the grant was spent under**: full control is not a licence to
rewrite. Every edit outside agent-visual's ownership had to be (a) necessary to
the named problem, (b) as small as the fix allowed, and (c) written down below
with its reason. Nothing was reformatted, renamed or restructured on the way
past, and no other agent's architecture was re-decided.

### The named bug: 桶

The cycle the boards draw (`gRwYR`) is 海 → 川 → 桶 → 池 → ブリック → 海 → 壁.
"桶" — the words you have caught now, held until you decide what they are —
existed nowhere in the app. A catch in 川 went straight into 池 and was carded on
the way, so the one stage where the *learner* decides rather than the engine was
missing, and the 川 view's right column was an empty white card where the board
draws the bucket.

`src/lexicon/entry.js` now holds `RIVER.bucket`; `池へ` hands the caught words to
the pool and leaves them waiting for a brick; `取消` puts them back in the river;
`流速` is the stream's own pace. `study.html` and `assets/css/wordbook.css` draw
the board's two columns — river narrow on the left, bucket wide on the right.

### Files touched outside agent-visual's ownership

| File | Owner | What and why |
| --- | --- | --- |
| `study.html` | agent-wordbook | The 川 view was rebuilt around the bucket (the board's two columns, the bucket's head, surface and action row). The 池 filter and its two actions moved under the working column. 海's right rail was split into the four cards the boards draw and scoped, and ブリック総覧's rail gained its stage filter and 段階の内訳. 壁's totals strip went, and came back on 復習, which is the board that draws it. 復習 was rebuilt: the wall's rail, the progress strip, the page-sized card and the four grade cards. |
| `src/lexicon/entry.js` | agent-wordbook | The bucket and its five actions; `renderEntry` rebuilt to the board (状態 as a three-rung meter, 入っているブリック, カード rows with 次回); one-line browse rows; `renderSeaStats`/`renderBreakdown`/`renderLegend` to the boards' three right-rail cards; `renderBricks` to the board's courses and matrix; `renderStats` onto 復習's rail; `show()` fixed to clear the `hidden` **attribute** as well as the class; the part-of-speech tag read from `word.pos`. |
| `assets/js/i18n.js` | **shared** | Fourteen new keys for the bucket and the river's speed, `entry.next`, `sea.breakdown.brick`, and the ja/en/zh for each. This is the file the protocol requires a REQUEST and ANSWER for; it was edited under the grant instead, and the REQUEST is recorded in `docs/coordination/log-visual.md`. |
| `tests/ui.test.js`, `tests/pages.test.js`, `tests/wordbook-monolingual.test.js` | agent-wordbook | These three assert on the wall's totals strip, which the boards do not draw and which is gone. They now assert on the counts 海 draws. |
| `tests/wordbook-dictionary.test.js` | agent-wordbook | It observed an imported definition through 海's list rows; the board's rows are one line per word and carry no definition, so it now selects the word and reads the entry beside it. The assertion's intent — the imported definition reached the word — is unchanged. |
| `.gitignore` | agent-wordbook | `designs/exports/` added. R4 of the visual log asked for it; the PNGs are derived from `design.pen` and would be rewritten every round. |

### Files touched inside agent-visual's ownership

- `assets/css/wordbook.css` — the 川 grid and the bucket; the 20px/22px layout
  corrections; the notice as a floating message; the 海 components the first
  render showed were missing (meters, brick block, mode rows, stat rows, legend,
  the 内訳 bar fill); the pool's bottom bar; a one-line word row.
- `assets/js/app.js` — the notice takes itself away after six seconds.
- `designs/verify/` — `run.mjs` and `routes.json` learned to drive the app, so
  the screens that only exist after something has been packed can be seen.

### Continued (same grant, later the same day)

Two commits `71dcea5` and `638c2f6`, still inside grant 1.

**海 › 辞書 was the part of the grant that was left unfinished**, and it is no
longer the gap it was. `PXk00`'s column is there - the word and who answered,
the entries, what the book knows about it (the same three-rung meter 海 draws),
the sentence it was met in, and 池へ入れる / カードにする / 既知にする with the
entries scrolling behind them. `ob2Y0`'s landing state is there too: 最近引いた語,
最近の漢字 and 今日の語.

**Five more bugs, four of them older than this grant.**

- `recordLookup` was imported into `entry.js` and **never called**, so
  `ml.lookupLog` never filled. The rail's trail, 最近引いた語 and 最近の漢字 read
  that log and were all permanently empty - the boards' lookup history could not
  appear in any build.
- `stateKeyOf` read only the encounter record, and a word can have cards without
  one: every seeded word does. All eighteen showed 候補 while carrying two cards
  and a schedule. `ladderState()` now reads record, then brick, then cards.
- 復習's rail was inert and empty - the course list is drawn twice and only 壁's
  copy had a handler, and opening `#wall/review` directly never rendered it.
- The 出典 row shared one flex line with the licence, so it wrapped into the
  middle of the name and the badge. The attribution is a line of its own.
- `.wb-row-main` was a `<span>` with flex properties and no `display`, so the
  trail read 「本origin」.

Tooling: one browser context served all routes, so the tenth screenshot was
taken over the data the first nine left behind - a context per route now. And the
runner's notice-hide raced the engine's async boot, so the notice came back into
the shot; it is hidden again immediately before the screenshot.

Routes are 16 now (`sea-dict-word`, `sea-dict-landing`).

### Deliberately left alone

- **The bucket's chips are buttons, not drag targets.** The board's lede says
  the words can be dragged back to the river; pressing a chip returns that word
  and `取消` returns all of them. Dragging river words *into* the bucket is the
  rod, which is the same gesture the board's other line describes. A pointer
  drag between the two columns is unimplemented, and the board's promise is kept
  by the shorter gesture rather than the longer one.
- **D1–D5 are still the human's.** The wall's phase tab (D1), icons on the
  capsule (D2), exports in git (D3, now answered as excluded), 池's candidate
  approval step (D4) and `#wbData`'s ownership (D5) were not decided here. The
  candidate filter and its approval list still exist on 池 because dropping them
  is D4's call, not this round's.
- **Nothing in `reader/**`, `src/dict/**`, `src/lexicon/store.js`,
  `src/lexicon/schema.js` or the deploy workflow was touched.**

### What this grant did not fix

- **海 · 辞書 is missing its kanji detail card.** `ob2Y0` draws 音読み / 訓読み /
  画数 / 部首 / 漢検, the 熟語 chips, and この漢字を使う語. Nothing in the build has
  that data - JMdict carries glosses, not character metadata - so the card is not
  drawn rather than drawn with blanks. Everything else on those two boards is in:
  see "Continued" above.
- 関連 chips on `PXk00` are the same kind of gap: the board's related words came
  from the same character data.
- `ホーム` and `読書` have no boards, and `index.html` is still a marketing hero.
- The 川 mask axis and the night-mode highlight alphas in `reader/reader.css`
  still want eyes on a rendered page.
- `#wbDictNotice` is still one English-free string written by the engine; it
  floats and fades, which is a layout answer, not a copy one.

### How to see what it did

    node designs/check-overlap.cjs              # the boards are still clean
    sh designs/verify/setup.sh                  # once
    node designs/verify/run.mjs --out /tmp/look # 14 routes, measured
    npm test                                    # 376

`wall-brick`, `pool-pick`, `pool-set`, `river-bucket`, `wall-review` and
`sea-bricks-filled` do not exist on a fresh profile: the runner drives the app
there (`catch:auto:30` → `toPool` → `click:#wbPoolBuild` → …) because 壁, the two
sheets and the drill only exist once something has been caught and packed.

Entry point: commits `795b88b` (the bucket, the geometry, 海), `9ad10e9`
(復習 and ブリック総覧), `71dcea5` (the 辞書 column and three bugs) and `638c2f6`
(the 辞書 landing and two more). Tests: 376/376. Board rules: 0. Routes: 16/16.
