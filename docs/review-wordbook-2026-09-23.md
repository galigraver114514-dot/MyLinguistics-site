# Vocabulary review · 2026-09-23

Written while you were away, for you on return. This is the **behaviour and
engine** side of the redesign; agent-visual wrote the visual-layer review at
`designs/review-2026-09-23.md`, and where the two overlap theirs is about how it
looks and this one is about what it does.

**If you read one line**: open `study.html` on the iPad and walk 壁 → 川 → 池 →
海 once. Everything below is verified by tests, not by eye - there is no browser
or headless renderer in this session - so the only claims I would not sign are
the ones about how it looks.

---

## 1. What landed

| Commit | What it is | Tests |
| --- | --- | --- |
| `ef1ab6d` | The engine seams the design needs: a hand-picked selection and a settings object for brick packing, a brick's modes honoured by its queue, one word removable from a brick, three pure modules (relative time, the pool log, the lookup trail, the dictionary view model) and 130 i18n keys. Additive: nothing consumed them yet. | 337 → 364 |
| `d43dc6b` | The information architecture, in one commit: the floating capsule on all three pages, 語彙 with 壁 / 川 / 池 / 海, the route as the navigation, the passive view deleted with 57 dead keys, and the eight test files that assert those names. | 364 → 373 |
| `db95847` | 池 packs in the two sheets (`選ぶ` → `設定` → `この設定で作る`), 辞書 gets its rail (each dictionary by its own title, the eye that hides one, storage, the source's own licence), and 壁 marks the brick being stacked. | 373 → 375 |

The other agents' work in the same window: the state and motion tokens
(`d3ab44e`), the capsule styled (`8caaad6`), the vocabulary app styled
(`b13f075`), the design artifact in git with the exports kept out
(`cb37a32`), the motion tokens applied (`534611d`), and the reader's page
tokens and progress rail (`4d1d9a9`, `b35e0de`, `aa5727f`).

## 2. What to look at first

1. **The capsule.** Three destinations, and on 語彙 four sub-items appear in
   place. No bottom bar, no large title. Tap through ホーム / 読書 / 語彙 and back.
2. **A refresh keeps its place.** Open `study.html#sea/dict` directly, or press
   back after moving between views: the destination survives, which it did not
   before (the old route forgot the view).
3. **壁.** Every brick is a row of ten words you can read. Tap a row in the left
   column to take that brick, or `海から次のブリックを掴む`; the bottom pair
   should take you into the drill at `1 / 10`.
4. **池.** `ブリックを作る` → `自動で組む` should preselect ten and refuse an
   eleventh; `手で選ぶ` should start empty. Then `設定`: give it a name, turn 産出
   off, choose 3日後, and build. The brick should keep that name in 海 › ブリック総覧
   and appear on the wall with no empty cell.
5. **辞書.** Import a Yomitan dictionary from `辞書を追加する`, then look a word
   up: one block per dictionary, the trail on the left with relative times, and
   the eye in the rail hiding a dictionary's block without breaking the lookup.
   JMdict's own line should read `JMdict © EDRDG · CC BY-SA 4.0` wherever its
   entries appear.

## 3. What is verified, and how

`npm test` is **375 passing**, from a 337 baseline. The tests drive the real
page in jsdom: they boot `study.html`, import the real controller, mine real
text, click real buttons and read the real DOM. The new ones worth knowing about:

- `tests/wordbook-views.test.js` - every route lands on its panel, the capsule's
  active item follows, an unknown route is the wall and never a blank page.
- `tests/wordbook-pool.test.js` - both sheets end to end, then 海 and 壁 are
  checked against what was packed, including that the ten cells carry the words.
- `tests/wordbook-dict-view.test.js` - the pure view model: source titles, the
  国語 / 英和 badge, hidden sources, and that a source's licence line is its own.

What the tests **cannot** see: pixel layout, colour, type, spacing, the real
canvas river, and the JMdict pack (there is no HTTP server in a test, so the
英和 block is exercised only through the imported dictionary).

## 4. Decisions still waiting for you

1. **`designs/exports/`** - 2.4 MB of PNGs, untracked. The `.pen` and the
   checker are in git and kept out of the published site; the exports are not.
   Commit them or drop them.
2. **The candidate inbox.** 池 shows ブリック待ち by default and keeps 候補 behind a
   filter, where `Make cards` still works. The design gives candidates no screen,
   and deleting an approval step is your call, so I kept it reachable rather than
   silent.
3. **`#wbData`** - text mining, frequency lists, export/restore and the Yomitan
   import still live in a hidden panel reachable from the 池 header. The design
   does not draw a settings surface; say where it should go and I will move it.
4. **The kana exception.** The dictionary entry header shows `水 / みず`. That is
   the one place the no-furigana rule is broken, and it is deliberate: a reading
   is a field you search by, not a gloss on a word you already have.

## 5. Known gaps and risks

- **JMdict is only fetched over http(s).** The wordbook asks for the bundled
  common pack, and in a test environment (no server) the pack fails and is
  recorded as a problem rather than throwing. On the iPad it should load from
  `dict/`; if the 英和 block is empty there, that is the first place to look.
- **明鏡 has no first-run path yet.** The board draws 明鏡 and JMdict side by side;
  明鏡 is a commercial dictionary we cannot ship, so it is a Yomitan import. With
  nothing imported the rail says so and the block is simply absent, but there is
  no dedicated "import it once" prompt yet - `辞書を追加する` is the way in.
- **`wb.inbox.*` keys keep the word "inbox".** The UI says 池 and 候補; the key
  names are historical. Renaming them is safe but touches three languages, so it
  waits for a quiet moment.
- **The 単語総覧 search box stays.** The board does not draw one, but a list of
  your whole vocabulary with no filter is unusable, so it is there below the
  segmented control. Say the word and it goes.
- **One incident, recovered.** A bulk rewrite of `src/lexicon/entry.js` truncated
  the file's tail; it was rebuilt from the same source, `node --check` and the
  full suite were green before the commit, and nothing broken was ever pushed.

## 6. How to check it yourself

    npm test                                  # 375 passing
    python3 -m http.server 8000               # then http://localhost:8000/study.html

The four destinations are `#wall`, `#river`, `#pool` and `#sea`; the drill is
`#wall/review`, and the three parts of 海 are `#sea`, `#sea/bricks` and
`#sea/dict`.
