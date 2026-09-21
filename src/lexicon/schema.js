/* MyLinguistics lexicon - schema v2.
 *
 * Shape of the advanced vocabulary system:
 *   Word   - one surface form (can also be a phrase, idiom, or pattern)
 *   Sense  - one meaning of a word; the unit that is learned and scheduled
 *   Card   - a sense plus a study mode; the unit the scheduler acts on
 *
 * Everything keys by id so IndexedDB object stores stay simple.
 * The legacy data.js vocab items migrate into this shape losslessly.
 */

export const SCHEMA_VERSION = 2;

export const MODES = Object.freeze([
  'recognize', 'produce', 'fill', 'cloze', 'nuance', 'collocation', 'reading', 'register', 'sentence'
]);

export const DEFAULT_MODES = Object.freeze(['recognize', 'produce']);

const OUTPUT_MODES = { produce: true, fill: true, sentence: true };

export function isOutputMode(mode) {
  return OUTPUT_MODES[mode] === true;
}

export function normalizeKey(value) {
  var text = value == null ? '' : String(value);
  return text.normalize('NFKC').trim();
}

export function wordId(lemma) {
  return 'ja:' + normalizeKey(lemma);
}

export function senseId(wordIdValue, index) {
  return wordIdValue + '#' + index;
}

export function cardId(senseIdValue, mode) {
  return senseIdValue + ':' + mode;
}

export function makeWord(input) {
  var lemma = normalizeKey(input.lemma);
  return {
    id: input.id || wordId(lemma),
    lang: input.lang || 'ja',
    lemma: lemma,
    reading: normalizeKey(input.reading || ''),
    pos: input.pos || [],
    forms: input.forms || [lemma],
    frequency: input.frequency || null,
    tags: input.tags || [],
    senseIds: input.senseIds || [],
    createdAt: input.createdAt || Date.now()
  };
}

export function makeSense(input) {
  var now = input.createdAt || Date.now();
  return {
    id: input.id,
    wordId: input.wordId,
    definition: input.definition || { lang: 'ja', text: '', dictId: null },
    gloss: input.gloss || null,
    register: input.register || [],
    synonyms: input.synonyms || [],
    collocations: input.collocations || [],
    notes: input.notes || '',
    source: input.source || null,
    recognition: input.recognition || { familiarity: 0, familiarityAt: now, level: 0 },
    production: input.production || { level: 0 },
    createdAt: now
  };
}

export function newSrsState() {
  return {
    phase: 'new',
    stability: 0,
    difficulty: 0,
    due: 0,
    last: 0,
    reps: 0,
    lapses: 0
  };
}

export function makeCard(input) {
  var now = input.createdAt || Date.now();
  return {
    id: input.id,
    senseId: input.senseId,
    wordId: input.wordId,
    mode: input.mode,
    isOutput: isOutputMode(input.mode),
    context: input.context || null,
    srs: input.srs || newSrsState(now),
    createdAt: now
  };
}

/* Migrate one legacy data.js vocab item into word + sense + card.
 * defs is an optional map of legacy id to a JP-JP definition string. */
export function fromLegacyJaItem(item, definition) {
  if (!item || !item.term) return null;
  var word = makeWord({
    lemma: item.term,
    reading: item.reading,
    pos: item.tag ? [item.tag] : [],
    tags: [],
    forms: [item.term]
  });
  /* Monolingual only. With no definition yet, the sense is marked pending and
   * rendered empty rather than falling back to another language. */
  var sense = makeSense({
    id: senseId(word.id, 0),
    wordId: word.id,
    definition: definition
      ? { lang: 'ja', text: definition, dictId: 'seed:ja' }
      : { lang: 'ja', text: '', dictId: null, pending: true },
    gloss: null,
    source: item.example ? { ja: item.example, source: { seed: item.id } } : null
  });
  word.senseIds = [sense.id];
  var card = makeCard({
    id: cardId(sense.id, 'recognize'),
    senseId: sense.id,
    wordId: word.id,
    mode: 'recognize',
    context: sense.source
  });
  return { word: word, sense: sense, card: card };
}
