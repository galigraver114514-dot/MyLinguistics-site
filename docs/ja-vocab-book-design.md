# Japanese Advanced Vocabulary Book - design

Status: **partly implemented**. The local engine and its capture pipeline are
built and tested; see Implementation status below and section 15.

For an N1+ learner working toward native reading and writing. Companion
documents: `ja-reader-design.md`, `ja-reader-dictionary.md`,
`ja-reader-ios-interaction.md`.

## Implementation status

A first vertical slice is implemented and tested:

| Concept in this document | Where it lives |
| --- | --- |
| Schema v2 (Word / Sense / Card) | `src/lexicon/schema.js` |
| JP-JP seed and legacy migration | `src/lexicon/seed-ja.js`, `Lexicon.seedFromLegacy` |
| FSRS-6 scheduling | `src/lexicon/srs.js` |
| Passive exposure and digest | `src/lexicon/digest.js`, `Lexicon.digest` |
| IndexedDB storage | `src/lexicon/db.js` |
| Capture telemetry and operations | `src/lexicon/store.js` |
| Word river (context-free stream) | `src/lexicon/river.js` |
| Text segmentation | `src/lexicon/tokenize.js` |
| Candidate funnel and frequency band | `src/lexicon/select.js` |
| Frequency-list import | `src/lexicon/frequency.js`, `Lexicon.importFrequency` |
| Automatic enrolment and inbox | `Lexicon.importText`, `Lexicon.listInbox` |
| Card authoring by mode | `src/lexicon/authoring.js` |
| Review, passive, river, inbox, browse UI | `src/lexicon/entry.js`, `study.html` |
| Tests, including a real page boot | `tests/*.test.js` |

Automatic enrolment, triage, manual capture, frequency import, backup
restore, and look-only review are implemented and tested end to end.

Still to build: a dictionary-backed morphological analyser (the current
segmenter is script runs plus maximal matching; the real one is agreed to live
at `src/dict/tokenize.js` and be shared with the reader), Yomitan dictionary
import into the wordbook (the module supports it; its structured-content
renderer is the last file), the self-built mid-band frequency list, the
reader-side guide mode, and the nuance, collocation and synonym data that
sections 7 and 18 mark as needing an external source.

## 0. Summary

Above N1 the bottleneck is not vocabulary *count* but vocabulary *depth*. A
conventional word list (word -> gloss) is close to useless at this level: an N1
learner already knows most of it, and reviewing it spends time without closing
the real gaps. This design is therefore not a book of words but a
**capture-and-review system whose smallest unit is a sense inside a real
sentence, whose definitions are Japanese, and whose schedule is shared with the
reader.**

Thesis:

> The vocabulary book is the back face of the reader. You read, you look up, the
> system captures, you review, and the word disappears from the reading aids.

Two constraints shape everything below:

1. **Reading volume is the engine; SRS only retains.** Any design that lets
   review crowd out reading is wrong.
2. **Motivation is finite.** There must be a mode that keeps accumulating
   vocabulary on days when the learner does not want to think. See section 5.

## 1. What an N1+ learner is actually missing

| Gap | Symptom | Needed data / card |
| --- | --- | --- |
| Mid- and low-frequency written words | Recur in editorials, 新書, and literary prose, yet are looked up every time | Context card + frequency band |
| Passive -> active vocabulary | Understood, but not produced in speech or writing | Production card |
| Synonym nuance | All the candidates seem usable, but not all sound natural | Discrimination (near-synonym cluster) card |
| Collocation and idioms | The word is known, the combination is not | Collocation card |
| Register | 漢語 / 和語 / 外来語, literary remnants, keigo | Register tags + contrasting examples |
| Set expressions | 四字熟語, 慣用句, オノマトペ, 副詞 | Curated decks |
| Irregular readings | 熟字訓, 当て字, names and place names | Reading card |
| Sense splitting | A polysemous word is known in only one or two senses | **One card per sense** |

Explicitly out of scope: JLPT lists, subtitle/anime frequency lists, and "N
words every N1 candidate must know". At this level they are mostly known and
they consume review budget.

The unit of study must also be allowed to be a phrase, an idiom, or a sentence
pattern, not only a single word: many "I cannot read this sentence" moments at
this level are collocation or set-phrase problems.

## 2. Design principles

1. **Context first.** Every card carries a real sentence, ideally from a text the
   learner is reading. A bare word with an English gloss is never shown.
2. **Monolingual first.** Definitions are Japanese (JP-JP). English is an
   optional, hidden fallback. See `ja-reader-dictionary.md` section 8.
3. **By sense, not by surface form.** One card is one `Sense`. Senses of a
   polysemous word are scheduled independently, because "can use sense 4 of
   掛ける" and "recognises sense 1" are different abilities.
4. **Recognition is not production is not choosing correctly.** One sense can
   spawn several card modes with independent schedules (section 7).
5. **Capture has a threshold.** Not every looked-up word becomes a card;
   encounter frequency gates it (section 6).
6. **Effort is a dial, not a gate.** The same lexicon is reachable at four
   levels of effort, from deliberate mining down to passive reading (section 5).

## 3. Decisions taken

| Question | Decision |
| --- | --- |
| Definitions | **JP-JP by default**; English only as a hidden fallback |
| Dictionaries | **User-imported Yomitan format is the primary source**; a bundled JMdict pack is the fallback |
| Direction | **Both input and output**: recognition and production are both required |
| Reading material | **Imported by the user** (EPUB, plain text, HTML, or pasted articles) |
| Build tooling | **A build step is accepted** (Vite); the current no-build site is not a constraint for this module |
| Storage | **IndexedDB is the primary store**; `localStorage` keeps only small preferences |
| Effort model | Must support **passive accumulation**, not only deliberate mining |
| Documentation | English |

Consequences:

- The Yomitan import path and its streaming parser are on the critical path, for
  the same reason set out in `ja-reader-dictionary.md`: a large term bank
  cannot be `JSON.parse`-ed on an iPad.
- Production cards need Japanese text entry (IME). This is a first-class UI
  concern, not an afterthought; see section 12.
- The reader must accept more than EPUB, because articles are imported too.
- The legacy 78-item site keeps working; it is migrated, not replaced
  (section 8).

## 4. Where words come from

| Priority | Source | Notes | Depends on |
| --- | --- | --- | --- |
| A (primary) | **The learner's own reading** | Highest value: the word was actually met in context | Reader text model + sharded dictionary |
| B | **Frequency mid-band**, self-built | Tokenise 青空文庫; keep rank ~12k-40k with adequate recurrence | One-off Node script |
| C | Curated lists | 四字熟語 / 慣用句 / オノマトペ / 副詞 / 文語 / keigo | Manual or imported |
| D | Import | Existing Anki exports, Yomitan banks | Parser (reuses the reader's streaming parser) |

Excluded: JLPT lists and subtitle-corpus frequency lists (skewed against
literary and expository prose).

Two notes on frequency data:

- **Prefer the self-built list.** 青空文庫 is public domain, so a derived list is
  licence-clean, and novels and essays match the reading target far better than
  subtitles do. This matches `ja-reader-dictionary.md` section 9.
- **BCCWJ word lists** (NINJAL,
  <https://clrd.ninjal.ac.jp/bccwj/en/freq-list.html>) are high quality but have
  redistribution restrictions: use them locally for cross-checking only, never
  ship them on the public site.

## 5. The engagement ladder: active to passive

This is the part that keeps the system usable on a bad day.

### 5.1 Why passive accumulation belongs here

For a near-native learner the scarce resource is often **exposure volume**, not
effort per word. Passive accumulation keeps the exposure rate high on days when
deliberate recall is not available.

It must be stated honestly: passive exposure builds recognition, reading
fluency, and priming cheaply; it does **not** build production or fine nuance.
The mastery model therefore tracks recognition and production separately, and a
passive day never counts as an output day.

### 5.2 Four rungs

| Rung | Effort | The learner does | The system does |
| --- | --- | --- | --- |
| Mine | high | Taps a word in the reader | Records an `Encounter`, opens the entry |
| Triage | low | Swipes approve / reject in the inbox | Proposes candidates auto-mined from imported text |
| Review | medium-high | Graded recall, typed output | FSRS scheduling per card |
| Passive | ~zero | Reads | Auto-digest, exposure tracking, ambient mode |

Any rung works alone. A purely passive day is a valid day: it updates
recognition state and never writes a grade into FSRS.

### 5.3 The passive digest

A daily, scrollable, context-rich list. No prompt and no grade; the reading and
the JP-JP definition are always visible.

Selection score per sense:

```
value = frequencyBandWeight * unfamiliarity * recurrence * notSuspended
```

- `frequencyBandWeight` - prefers the mid band: common enough to recur, rare
  enough to be worth learning.
- `unfamiliarity` - `1 - familiarity`, where familiarity is maintained by
  exposure events (5.5).
- `recurrence` - the number of distinct source sentences the word appeared in.
- `notSuspended` - excludes known, dismissed, and suspended items.

Each digest item shows the word, its reading, part of speech, register tags, the
JP-JP definition, one source sentence with the word highlighted, and a link back
to where it came from. Optional one-tap signals ("already know it", "show again
soon") reorder the digest; they do not grade.

### 5.4 Auto-enrollment: the system mines for you

Passive mode is only useful if the lexicon fills itself. On import of a text:

1. tokenise it (kuromoji) and drop known, suspended, and dismissed words;
2. keep tokens in the configured frequency band that occur at least twice in
   the corpus;
3. create one lexicon entry per surviving lemma, attach the best first source
   sentence, and set state `inbox`.

Triage is then optional: unapproved entries still feed the passive digest. Caps
apply per import and per day, the candidate count is shown, and bulk rejection
is one action. This is what makes "I did not have to hunt for words" true.

Implemented in `Lexicon.importText` with `src/lexicon/tokenize.js` and
`src/lexicon/select.js`. The segmenter is script runs upgraded to maximal
matching as soon as a frequency list or a dictionary's key index supplies a
lexicon; the real morphological analyser, which adds a reading and a basic form
per token, is agreed to live at `src/dict/tokenize.js` and serve both apps.
Nothing is scheduled by approving a candidate until the learner approves it.

### 5.5 Exposure, kept out of FSRS

Every passive view writes an `Exposure` event, never a `Review`. Exposures
update a decaying `familiarity` score used to order the digest and to decide
when a word may stop appearing. They never enter the FSRS parameter fit: FSRS
assumes graded recall, and look-only data would bias it. The two tracks meet only
in the mastery display and in the reader's furigana policy.

### 5.6 Look-only review

Due cards can be shown with the answer already visible, advanced by scrolling.
This is a fallback for a tired day, not a substitute for review. It logs
exposures, and demotes a card only if the learner explicitly asks it to.

### 5.7 Ambient mode

An optional slow carousel (about 8 s per item, pausable, honouring
`prefers-reduced-motion`) for half-attentive absorption. Same content as the
digest; purely exposure.

### 5.8 Reader-side passive

The strongest passive channel is reading itself. In **guide mode** the reader
shows a short JP gloss or furigana inline on words below the recognition
threshold, with no tap. Rendering a word logs an exposure (debounced), so
ordinary reading accumulates familiarity with no interaction at all. This is the
concrete link between the reader and the vocabulary book.

### 5.9 Fatigue-aware switching

- A persistent **"passive today"** toggle in the session header.
- After a run of *Again* ratings or a long session, offer - never force - a
  switch to the passive digest.
- Never downgrade silently. The learner chooses.

## 6. Encounter telemetry

Every lookup writes an `Encounter` quietly:

- A word looked up in three or more distinct sentences becomes a candidate for
  capture.
- After capture, thirty days without a lookup is treated as retained.
- "I know this" sets `dismissed` and stops the prompting permanently (manual
  capture from the text is still possible).
- A word seen once that is outside the frequency mid-band is not captured by
  default; proper nouns are not captured by default.

The vocabulary book is a by-product of reading behaviour, not a purchased list.

## 7. Card types

| Mode | Front | Back | Purpose |
| --- | --- | --- | --- |
| `cloze` | Source sentence with the target blanked | Word + reading + JP definition + source | Default workhorse: recognise the word in a sentence |
| `recognize` | The word as it appeared | Reading, POS, definition, register | Grow passive recognition quickly |
| `produce` | JP definition + blanked sentence (or a semantic cue) | The word, typed | Turn passive vocabulary active |
| `fill` | Source sentence with a typed gap | The word and the sentence rebuilt | Output in context |
| `nuance` | A sentence admitting only one candidate; or "what separates these words" | The right item + why the others are unnatural | Near-synonym clusters |
| `collocation` | Noun / verb + a gap | Common collocations with examples | Combinatorial ability |
| `reading` | The word | Reading + 熟字訓 / rendaku / exception note | Only when the reading is non-obvious |
| `register` | Two expressions | Which is more written / spoken, with examples | Optional |
| `sentence` | JP definition + a demand to use it | A model sentence, then self-assessment | Free production (see section 12) |

Rules:

- Every sense has at least one `cloze` anchored to a source sentence; output
  modes are added as needed.
- A `cloze` gap must not be a bare word with no cue: either give a POS or
  length hint, or blank the whole phrase.
- Source sentences are stored permanently as
  `{bookId, spineIndex, startOffset, endOffset}`, so they can be located in the
  book again. This reuses the reader's text model and is the technical basis of
  the loop in section 14.

## 8. Data model (schema v2)

The existing `data.js` fields (term, reading, translation, level, tag,
example) are too thin for this level. A new layer is added without breaking the
78 existing items.

```
// Lexeme: one surface form (may also be a phrase, idiom, or pattern)
Word {
  id: 'ja-kakeru',
  lang: 'ja',
  lemma: '掛ける',
  reading: 'かける',
  pitch: null,                           // deferred (licensing)
  pos: ['動詞', '下一段活用'],
  forms: ['掛ける', '掛けた', '掛けて'],  // for matching running text
  frequency: { rank: 812, source: 'aozora-v1' },  // may be null
  tags: ['常用', '多義'],
  senseIds: ['ja-kakeru#1', '...']
}

// Sense: the unit that is learned and scheduled
Sense {
  id: 'ja-kakeru#4',
  wordId: 'ja-kakeru',
  definition: { lang: 'ja', text: '...', dictId: 'yomitan:...', entryId: 123456 },
  gloss: null,                           // optional English fallback, hidden
  register: ['口語', '比喩的'],
  synonyms: [{ senseId: '...', relation: '類義', note: '...' }],
  collocations: [{ pattern: 'Nを掛ける', examples: ['...'] }],
  notes: '',                             // the learner's own usage notes
  recognition: { familiarity: 0, level: 0 },
  production: { level: 0 }
}

// Card: the scheduling unit, bound to one sense and one mode
Card {
  id: 'ja-kakeru#4:produce',
  senseId: 'ja-kakeru#4',
  mode: 'cloze',
  prompt: {}, answer: {},
  context: { ja: '...', source: { bookId, spineIndex, startOffset, endOffset } },
  created: 0,
  srs: {}                                // section 10
}

// Lookup telemetry
Encounter {
  wordKey: '掛ける',
  count: 3,
  firstSeen: 0, lastSeen: 0,
  contexts: [{ ja: '...', source: {}, ts: 0 }],
  state: 'new'                           // new|inbox|carded|dismissed
}

// Passive exposure, never fed to FSRS
Exposure {
  senseId: 'ja-kakeru#4',
  ts: 0,
  channel: 'digest'                      // lookup|digest|lookonly|reading|ambient
}
```

Migration from the current site:

- Each `data.js` vocab item maps losslessly to one `Word`, one `Sense`,
  and one `recognize` card. The box in `ml.cards.v1` becomes the card's
  initial `srs` state.
- The new system stores `lexicon` (Word / Sense), `cards`, `encounters`,
  and `exposures`. The old keys stay readable for a while before removal.

## 9. Build and storage

- **Build:** adopt Vite for the reader and vocabulary modules. The existing
  vocabulary and SRS pages keep working unchanged; the deploy workflow runs the
  build before mirroring.
- **Storage:** IndexedDB is the primary store. Object stores: imported books and
  assets, lexicon, cards, encounters, exposures, imported dictionaries, token
  cache, settings.
- `localStorage` keeps only small preferences (theme, active session). The
  existing `ml.cards.v1` / `ml.days.v1` / `ml.sessions.v1` keys are read
  once for migration.
- Imported dictionaries and books stay on the device. Nothing from a
  user-imported Yomitan dictionary is ever uploaded or shipped.

## 10. Scheduler

The current six-box Leitner scheduler (`assets/js/app.js`) is fine for 78
cards and inadequate for 5k-30k:

- only six intervals, too coarse for a long-term retention curve;
- no lapse concept;
- no per-card difficulty adaptation;
- no leech handling.

Recommendation: **FSRS-6**
(<https://github.com/open-spaced-repetition/awesome-fsrs>).

- Pure mathematics with no dependencies, vendorable into the app, and small.
- Default parameters are usable immediately; per-user optimisation becomes
  worthwhile after roughly 1000 reviews and can run as an offline script.
- If a more conservative step is wanted, start with SM-2 behind the same
  interface.

Rules:

- **New and review are separated**, each with its own daily cap.
- Four ratings (Again / Hard / Good / Easy) instead of the current three.
- **Leech:** a card with eight or more lapses is suspended with a prompt; the
  card face is usually the problem, not the memory.
- Schedule by `Card`, not `Word`. Mastery feeds back to the reader for the
  "unknown only" furigana policy.
- The passive track (section 5.5) is a **separate** familiarity model and never
  writes into FSRS.

## 11. Capture workflow

```
Reading (reader)
  |-- Tap a word -> lookup (sharded JMdict + local Yomitan)
  |     |-- shows: reading / JP definition / the form in this sentence
  |     |-- [add to inbox]  <- records an Encounter, does not create a card yet
  |     |-- [I know this]   <- records dismissed
Inbox (cleared weekly, 5-15 items; or ignored entirely)
  |-- per word: choose sense -> choose mode (default cloze) -> source sentence
  |     pre-filled -> edit -> create card
Review (daily)
  |-- due cards, keyboard or touch, sections 10 and 12
Passive (any day)
  |-- digest / ambient / reader guide mode, section 5
```

Anti-explosion gates:

- A daily **new-card cap** (5-15 suggested, adjustable).
- Inbox items that appeared only once, are low-frequency, and are not proper
  nouns are collapsed by default and must be expanded to capture.
- An **ignore list** for names, places, and author coinages.

## 12. Review interface

- Keyboard first (Space to flip, 1-4 to grade, arrows to go back), and usable
  one-handed on a touch device.
- **Output cards and IME.** Typing Japanese is a real cost, especially on an
  iPad. Production defaults to typed input, with a "think, reveal, self-grade"
  fallback; on iPadOS, Scribble allows handwriting into the field.
- **Grading tolerance.** Unicode normalisation (NFKC), old and variant glyphs
  (`學 / 学`), and okurigana differences (`表わす / 表す`) are accepted, with
  a "spelling differs" note rather than a failure.
- `sentence` cards are free writing: no automatic grade. The learner sees a
  model sentence afterwards and self-assesses. Heuristics (does the particle
  fit? does the collocation occur?) may be shown as hints, never as a score.
- The back always shows the full source sentence with the target highlighted;
  the source is a link back into the reader.

## 13. The book surface

Review is not the only way in; the lexicon must be browsable like a dictionary.

- **Volumes:** by source (the mining deck of a given book), by theme (副詞 /
  オノマトペ / 四字熟語 / 慣用句 / 文語), and by state (inbox / learning /
  known / suspended).
- **Entry view:** surface, reading, POS, register, JP definition, source
  sentences with provenance, personal notes, recognition and production levels,
  and linked synonyms.
- **Nothing is deleted when mastered**: it becomes a personal dictionary and
  search surface.
- Optional: export a self-contained static HTML snapshot (printable) as "my
  vocabulary book".

## 14. Relationship to the reader

Section 7 of `ja-reader-design.md` specifies an *Unknown only* furigana
policy, which needs the reader and the SRS to share one mastery model. This
vocabulary book is that SRS's **capture and review surface**:

- capture happens in the reader, the only place words are genuinely met;
- review happens here;
- the result feeds straight back into the reading experience (studied words lose
  their reading aids).

The three form one loop. A standalone vocabulary app would lose the loop and
most of its value. Guide mode (5.8) turns the reader itself into the passive
channel.

## 15. Phasing

| Phase | Contents | Depends on | Usable immediately |
| --- | --- | --- | --- |
| P0 | schema v2, IndexedDB layer, Vite scaffold, import (JSON / CSV / Anki / Yomitan dictionaries), static book browse, passive digest v0 over the lexicon | - | Yes (the 78 existing Japanese items) |
| P1 | per-sense cards, multi-mode review including output, FSRS-6, exposure track, fatigue-aware switching | P0 | Yes (manual and imported cards) |
| P2 | reader import (EPUB / text / HTML), tokenisation, auto-enrollment, mining, reader guide mode | reader P1 + sharded dictionary | No |
| P3 | nuance and collocation data, frequency banding, generated curated decks | imported JP-JP thesaurus | No |
| P4 | unknown-only furigana linkage, exported static book | P2, reader | No |

P0 and P1 depend on nothing in the reader and can be built first. P2 is where
the loop closes.

## 16. Anti-patterns

- English glosses or bare-word cards: they reinforce translation and hurt at
  this level.
- Capturing every word that was looked up: review crowds out reading.
- Recognition cards only: the vocabulary stays passive forever.
- One card per surface form: only the first sense is ever learned.
- Chasing card count: inflated by words that are already known.
- Subtitle or anime frequency lists: mismatched with literary and expository
  goals.
- Treating SRS as first exposure: first contact belongs in context; SRS only
  retains.
- **Letting passive mode write to FSRS**, or letting it become the only mode.
  It is a low-effort supplement; output still requires active work.

## 17. Word selection in detail

Vocabulary is never "whatever appeared". A candidate has to pass a funnel, and
the burden of proof grows with the cost of the card.

### 17.1 Where candidates come from

| Path | Trigger | Effort |
| --- | --- | --- |
| Manual capture | The learner taps a word in the reader | high |
| Encounter telemetry | A word looked up in three or more distinct sentences | none |
| Auto-enrolment | A word surviving the text-import filters | none |
| Frequency list | A mid-band word from the self-built Aozora list | none |
| Curated deck | A theme list (オノマトペ, 四字熟語, ...) | none |

### 17.2 The funnel

1. **Tokenise** the imported text (kuromoji) into lemmas.
2. **Drop what is already handled**: mastered senses (recognition familiarity at
   or above 0.95), words marked "already know it", and the ignore list (proper
   nouns, place names, author coinages).
3. **Keep the useful frequency band**: rank roughly 12,000-40,000.
   `frequencyBandWeight` is 1 inside the band, 0.35 below it (likely already
   known), and tapers above it.
4. **Require recurrence**: at least two occurrences in the imported corpus for
   auto-enrolment; for manual capture, a word must have been looked up in at
   least three distinct sentences before it reaches the inbox.
5. **Cap the volume**: a daily new-card cap (5-15) and a per-import enrolment
   cap. Overflow stays in the inbox; nothing is lost.
6. **Human triage is optional**: the inbox can be approved or rejected, but an
   unapproved word still feeds the passive digest.

### 17.3 The unit is a sense, not a surface form

掛ける has dozens of meanings. A candidate is a *sense* plus a source sentence,
so a polysemous word can be half learned and half unknown at the same time.
Multi-word units (idioms, collocations, sentence patterns) use the same shape.

### 17.4 Ranking what does get shown

The passive digest orders candidates by

    value = frequencyBandWeight * unfamiliarity * recurrence * notSuspended

- `unfamiliarity` is `1 - familiarity`, where familiarity decays with a
  14-day half-life and is only ever raised by exposure, never by an FSRS grade.
- `recurrence` is distinct source sentences, normalised so three or more is 1.
- `notSuspended` is false for known, dismissed, and suspended items.

### 17.5 Selection is a suggestion, not a verdict

Passive exposure shows a word without creating a card. Capture creates the sense
and its cards. The learner can ignore the inbox entirely and still make
progress, which is the whole point of the passive track.

### 17.6 What is implemented today

The whole funnel is live.

- `Lexicon.recordEncounter` counts **distinct** sentences and promotes a word
  to `inbox` at three.
- `Lexicon.importText` tokenises a passage, drops known, carded, dismissed and
  ignored words, keeps words that recur at least twice (configurable), applies
  the frequency-band weight, and writes the survivors to the inbox with their
  source sentences.
- `Lexicon.importFrequency` reads a word/rank list, stores it, and stamps the
  rank onto matching words. The same list is the lexicon for maximal matching,
  so segmentation sharpens the moment one is imported.
- `Lexicon.approveCandidate` authors the sense and its cards by rule
  (`src/lexicon/authoring.js`); `Lexicon.rejectCandidate` dismisses the
  candidate and adds it to the ignore list.
- `Lexicon.digest` applies the ranking in 17.4, and `Lexicon.markKnown`
  removes a word from it.

What is still missing is not the funnel but its inputs: a real morphological
analyser, and the self-built mid-band list itself (section 4, source B).

## 18. Card modes in detail

A mode is one prompt/answer shape. Every sense gets `recognize` first; output
and nuance modes are added per sense. Each mode is a separate `Card`, so the
schedules never interfere.

| Mode | Prompt | Answer | Trains | Input | Authored | Typical failure |
| --- | --- | --- | --- | --- | --- | --- |
| `recognize` | The word | Reading + POS + JP definition + source | Recognition | none | auto | "Seen it, cannot place it" |
| `cloze` | Source sentence with the target blanked | Word + reading + definition + source | Recognition in context | none | auto | Cannot parse the sentence |
| `reading` | The word | Reading + 熟字訓 / rendaku note | Orthography | none | when non-obvious | Wrong or missing reading |
| `produce` | JP definition (optionally a blanked context) | The word, typed | Retrieval / production | typed | auto | Cannot retrieve it |
| `fill` | Source sentence with a typed gap | The word and the rebuilt sentence | Morphosyntax in context | typed | semi-auto | Right word, wrong form or particle |
| `nuance` | A sentence allowing one near-synonym | The right item + why the others are unnatural | Discrimination | none | needs synonym data | All candidates "sound fine" |
| `collocation` | Noun / verb plus a gap | Collocations with examples | Combinatorial | none | needs collocation data | Knows the word, not the combinations |
| `register` | Two expressions | Which is written / spoken, with examples | Register | none | curated | Literary forms in speech |
| `sentence` | JP definition plus a demand to use it | A model sentence, then self-assessment | Free production | typed | self-review | No automatic grade |

### 18.1 The axes that actually differ

- **Recognition versus production.** `recognize`, `cloze`, and `reading`
  need recognition only. `produce`, `fill`, and `sentence` require
  retrieval. Recognition is queued first (`MODE_ORDER` in `store.js`),
  because output for an unread word is wasted effort.
- **Context anchoring.** `cloze` and `fill` are anchored to a real source
  sentence, stored as `{bookId, spineIndex, startOffset, endOffset}`.
  `recognize` and `reading` are not.
- **What failure means.** Each mode isolates a different failure: meaning
  (`recognize`), parsing (`cloze`), retrieval (`produce`), morphology
  (`fill`), semantics (`nuance`), combination (`collocation`), orthography
  (`reading`).
- **Author cost.** `recognize` and `produce` come straight from a sense.
  `cloze` and `fill` add a source sentence. `nuance` and
  `collocation` need dictionary data. `sentence` needs the learner's own
  judgement.
- **Scheduling.** Every active mode is its own FSRS card, rated 1-4 and
  scheduled independently. None of them writes to the passive familiarity
  score; that is a separate, decaying recognition model.

### 18.2 One sense, several independent claims

Because the schedules are independent, "recognises sense 4 of 掛ける" can be
strong while "can produce sense 4" is weak. The browse view reports both, and
the reader's furigana policy keys off recognition only.

## 19. Open questions

1. **Output scope.** Is typed word recall enough, or is sentence production (the
   `sentence` card) wanted from the first release?
2. **Existing assets.** Are there Yomitan dictionaries (JP-JP, thesaurus,
   frequency), Anki exports, or personal word lists already available? This can
   remove one or two phases.
3. **Reading genres.** Novels, editorials, 新書, technical material? It sets the
   frequency band and the auto-enrollment thresholds.
4. **Daily budget.** How many minutes and how many new cards per day? (Suggested
   cap: 10-15 new cards, about 30 minutes.)
5. **Curated decks.** Which theme decks matter first: 副詞, オノマトペ, 四字熟語,
   慣用句, or 文語?
6. **Legacy pages.** Migrate the existing trainer and vocabulary pages into the
   new system, or keep them as a separate beginner path?

## References

- BCCWJ word lists (NINJAL):
  <https://clrd.ninjal.ac.jp/bccwj/en/freq-list.html>
- FSRS algorithms and implementations:
  <https://github.com/open-spaced-repetition/awesome-fsrs>
