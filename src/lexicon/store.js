/* High-level lexicon operations over IndexedDB.
 *
 * This is the only place the UI and the reader talk to. It hides the object
 * stores and turns them into the operations the design describes: seed and
 * migrate, queue a review session, grade, record an encounter, record a
 * passive exposure, build the digest, and report statistics.
 */

import * as idb from './db.js';
import { STORES } from './db.js';
import {
  fromLegacyJaItem, makeCard, makeSense, makeWord, newSrsState,
  cardId, senseId, wordId, normalizeKey
} from './schema.js';
import { schedule, DEFAULT_PARAMS } from './srs.js';
import { buildDigest, bumpFamiliarity, currentFamiliarity, KNOWN_THRESHOLD } from './digest.js';
/* The tokeniser is the shared one in src/dict: its lexicon is the loaded
 * dictionary index, so segmentation stops being a heuristic the moment a
 * dictionary (or a frequency list) is present. */
import { contentTokens, splitSentences } from '../dict/tokenize.js';
import { selectCandidates } from './select.js';
import { parseFrequencyList } from './frequency.js';
import { modesForSense, definitionFromEntry } from './authoring.js';

export const SETTINGS = Object.freeze({
  newPerSession: 12,
  desiredRetention: 0.9,
  digestPerDay: 20,
  band: { lo: 12000, hi: 40000 }
});

const DAY_MS = 24 * 60 * 60 * 1000;

const MODE_ORDER = {
  recognize: 0,
  reading: 1,
  cloze: 2,
  produce: 3,
  fill: 4,
  sentence: 5,
  nuance: 6,
  collocation: 7,
  register: 8
};

export class Lexicon {
  constructor(db, options) {
    this.db = db;
    var opts = options || {};
    this.params = opts.params || DEFAULT_PARAMS;
    this.retention = opts.retention || SETTINGS.desiredRetention;
    this.band = opts.band || SETTINGS.band;
  }

  scheduleOptions() {
    return { params: this.params, retention: this.retention };
  }

  async isSeeded() {
    var meta = await idb.get(this.db, STORES.meta, 'seeded');
    return !!(meta && meta.value);
  }

  /* One-time migration of the legacy data.js Japanese vocab into schema v2. */
  /* Declarative upsert, run every boot.
   *
   * Definitions, readings, and parts of speech follow the seed; card schedules
   * and recognition survive. This is what repairs a database seeded by an older
   * build (romaji readings, English glosses) without a reset, and it is where a
   * dictionary module will eventually take over the definition field. */
  async seedFromLegacy(items, defs) {
    var previousSenses = await this.listSenses();
    var previousCards = await this.listCards();
    var senseById = {};
    previousSenses.forEach(function (sense) { senseById[sense.id] = sense; });
    var knownCard = {};
    previousCards.forEach(function (card) { knownCard[card.id] = true; });

    var words = [];
    var senses = [];
    var newCards = [];
    (items || []).forEach(function (item) {
      var mapped = fromLegacyJaItem(item, defs ? defs[item.id] : null);
      if (!mapped) return;

      var previous = senseById[mapped.sense.id];
      if (previous) {
        mapped.sense.recognition = previous.recognition || mapped.sense.recognition;
        mapped.sense.production = previous.production || mapped.sense.production;
        mapped.sense.notes = previous.notes || mapped.sense.notes;
        mapped.sense.createdAt = previous.createdAt || mapped.sense.createdAt;
      }

      words.push(mapped.word);
      senses.push(mapped.sense);

      if (!knownCard[mapped.card.id]) newCards.push(mapped.card);
      var outputId = mapped.sense.id + ':produce';
      if (!knownCard[outputId]) {
        newCards.push(makeCard({
          id: outputId,
          senseId: mapped.sense.id,
          wordId: mapped.word.id,
          mode: 'produce',
          context: mapped.sense.source
        }));
      }
    });

    await idb.putAll(this.db, STORES.words, words);
    await idb.putAll(this.db, STORES.senses, senses);
    await idb.putAll(this.db, STORES.cards, newCards);
    await idb.put(this.db, STORES.meta, { key: 'seeded', value: true, at: Date.now(), words: words.length });
    return { seeded: true, words: words.length, senses: senses.length, cards: newCards.length };
  }

  async listWords() { return idb.all(this.db, STORES.words); }
  async listSenses() { return idb.all(this.db, STORES.senses); }
  async listCards() { return idb.all(this.db, STORES.cards); }
  async listEncounters() { return idb.all(this.db, STORES.encounters); }
  async listExposures() { return idb.all(this.db, STORES.exposures); }

  async queue(now, newLimit) {
    var time = now || Date.now();
    var cards = await this.listCards();
    var due = cards.filter(function (c) { return c.srs.phase !== 'new' && (c.srs.due || 0) <= time; });
    due.sort(function (a, b) { return (a.srs.due || 0) - (b.srs.due || 0); });
    var fresh = cards.filter(function (c) { return c.srs.phase === 'new'; });
    /* Introduce recognition before production for the same word. */
    fresh.sort(function (a, b) {
      var ma = MODE_ORDER[a.mode] == null ? 9 : MODE_ORDER[a.mode];
      var mb = MODE_ORDER[b.mode] == null ? 9 : MODE_ORDER[b.mode];
      if (ma !== mb) return ma - mb;
      if (a.senseId !== b.senseId) return a.senseId < b.senseId ? -1 : 1;
      return 0;
    });
    var limit = newLimit == null ? SETTINGS.newPerSession : newLimit;
    return {
      due: due,
      fresh: limit > 0 ? fresh.slice(0, limit) : fresh,
      totalDue: due.length,
      totalFresh: fresh.length
    };
  }

  async grade(cardIdValue, rating, now) {
    var card = await idb.get(this.db, STORES.cards, cardIdValue);
    if (!card) return null;
    var time = now || Date.now();
    card.srs = schedule(card.srs, rating, time, this.scheduleOptions());
    await idb.put(this.db, STORES.cards, card);
    await this.recordExposure(card.senseId, 'lookup', time);
    return card;
  }

  /* Passive exposure: grows recognition familiarity, never writes FSRS. */
  async recordExposure(senseIdValue, channel, now) {
    var time = now || Date.now();
    var sense = await idb.get(this.db, STORES.senses, senseIdValue);
    if (!sense) return null;
    var familiarity = bumpFamiliarity(currentFamiliarity(sense.recognition, time), channel);
    sense.recognition = Object.assign({}, sense.recognition, {
      familiarity: familiarity,
      familiarityAt: time,
      level: Math.round(familiarity * 100)
    });
    await idb.put(this.db, STORES.senses, sense);
    await idb.put(this.db, STORES.exposures, { senseId: senseIdValue, ts: time, channel: channel });
    return sense;
  }

  /* Passive 'already know it': drop the word out of the digest without a
   * graded review. Recognition only; FSRS is untouched. */
  async markKnown(senseIdValue, now) {
    var time = now || Date.now();
    var sense = await idb.get(this.db, STORES.senses, senseIdValue);
    if (!sense) return null;
    sense.recognition = Object.assign({}, sense.recognition, { familiarity: 1, familiarityAt: time, level: 100 });
    await idb.put(this.db, STORES.senses, sense);
    return sense;
  }

  /* Lookup telemetry. A word looked up in three distinct sentences becomes a
   * capture candidate; this is what lets capture be optional. */
  async recordEncounter(wordKey, context, now) {
    var time = now || Date.now();
    var key = String(wordKey);
    var rec = await idb.get(this.db, STORES.encounters, key);
    if (!rec) rec = { wordKey: key, count: 0, contexts: [], state: 'new' };
    if (!rec.contexts) rec.contexts = [];
    var ja = context && context.ja ? context.ja : null;
    var duplicate = false;
    if (ja) {
      duplicate = rec.contexts.some(function (c) { return c.ja === ja; });
    }
    /* The count is distinct sentences, which is what the capture threshold in
     * the design is stated in. A repeat of the same sentence refreshes
     * lastSeen and changes nothing else. */
    if (ja && !duplicate) {
      rec.count = (rec.count || 0) + 1;
      rec.contexts = rec.contexts.concat([{ ja: ja, source: (context && context.source) || null, ts: time }]).slice(-10);
    } else if (!ja) {
      rec.count = (rec.count || 0) + 1;
    }
    rec.firstSeen = rec.firstSeen || time;
    rec.lastSeen = time;
    if (rec.state === 'new' && rec.count >= 3) rec.state = 'inbox';
    await idb.put(this.db, STORES.encounters, rec);
    return rec;
  }

  async setEncounterState(wordKey, state) {
    var rec = await idb.get(this.db, STORES.encounters, String(wordKey));
    if (!rec) return null;
    rec.state = state;
    await idb.put(this.db, STORES.encounters, rec);
    return rec;
  }

  /* The passive digest: context-rich, no prompt, no grade. */
  async digest(now, limit) {
    var time = now || Date.now();
    var limitValue = limit || SETTINGS.digestPerDay;
    var words = await this.listWords();
    var senses = await this.listSenses();
    var encounters = await this.listEncounters();
    var byId = {};
    words.forEach(function (w) { byId[w.id] = w; });
    var byLemma = {};
    encounters.forEach(function (e) { byLemma[e.wordKey] = e; });
    var items = senses.map(function (sense) {
      var word = byId[sense.wordId] || { id: sense.wordId, lemma: sense.wordId, reading: '' };
      var encounter = byLemma[word.lemma];
      return {
        sense: sense,
        word: word,
        recurrence: encounter ? encounter.count : 1,
        source: sense.source || null
      };
    });
    return buildDigest(items, { now: time, limit: limitValue, band: this.band });
  }

  async stats(now) {
    var time = now || Date.now();
    var start = new Date(time);
    start.setHours(0, 0, 0, 0);
    var cards = await this.listCards();
    var exposures = await this.listExposures();
    var encounters = await this.listEncounters();
    var senses = await this.listSenses();
    var reviews = cards.filter(function (c) { return c.srs.phase === 'review'; });
    var mature = cards.filter(function (c) { return (c.srs.stability || 0) >= 21; });
    var familiaritySum = senses.reduce(function (sum, s) {
      return sum + currentFamiliarity(s.recognition, time);
    }, 0);
    return {
      words: (await this.listWords()).length,
      senses: senses.length,
      cards: cards.length,
      fresh: cards.length - reviews.length - cards.filter(function (c) { return c.srs.phase === 'relearning'; }).length,
      due: cards.filter(function (c) { return c.srs.phase !== 'new' && (c.srs.due || 0) <= time; }).length,
      learning: cards.filter(function (c) { return c.srs.phase === 'relearning'; }).length,
      review: reviews.length,
      mature: mature.length,
      inbox: encounters.filter(function (e) { return e.state === 'inbox'; }).length,
      exposuresToday: exposures.filter(function (e) { return e.ts >= start.getTime(); }).length,
      recognition: senses.length ? Math.round(familiaritySum / senses.length * 100) : 0
    };
  }

  /* --------------------------------------------------- mining and capture
   *
   * Everything below is the capture half of the loop: text becomes candidates,
   * a candidate becomes a sense and its cards, and the learner's own fields go
   * in unchanged. None of it writes a review grade.
   */

  async frequencyMap() {
    var rows = await idb.all(this.db, STORES.frequency);
    var map = new Map();
    rows.forEach(function (row) { map.set(row.lemma, row.rank); });
    return map;
  }

  async listFrequency() {
    return idb.all(this.db, STORES.frequency);
  }

  /* Import a frequency list. It both weights candidates toward the mid band
   * and upgrades segmentation to maximal matching. */
  async importFrequency(text) {
    var rows = parseFrequencyList(text);
    await idb.putAll(this.db, STORES.frequency, rows);
    var rankByLemma = new Map();
    rows.forEach(function (row) { rankByLemma.set(row.lemma, row.rank); });
    var words = await this.listWords();
    var touched = [];
    words.forEach(function (word) {
      var rank = rankByLemma.get(word.lemma);
      if (rank == null) return;
      word.frequency = { rank: rank, source: 'imported' };
      touched.push(word);
    });
    if (touched.length) await idb.putAll(this.db, STORES.words, touched);
    return { rows: rows.length, words: touched.length };
  }

  async ignoreList() {
    var record = await idb.get(this.db, STORES.meta, 'ignore');
    return record && Array.isArray(record.value) ? record.value.slice() : [];
  }

  async setIgnore(list) {
    var unique = Array.from(new Set((list || []).filter(Boolean)));
    await idb.put(this.db, STORES.meta, { key: 'ignore', value: unique });
    return unique;
  }

  async ignore(lemma) {
    var list = await this.ignoreList();
    if (list.indexOf(lemma) < 0) list.push(lemma);
    return this.setIgnore(list);
  }

  /* Mine a passage: tokenise it, drop what is already handled, and leave the
   * survivors in the inbox as candidates. Nothing becomes a card here. */
  async importText(text, options) {
    var opts = options || {};
    var now = opts.now || Date.now();
    var source = opts.source || null;
    var sentences = splitSentences(text || '');
    var words = await this.listWords();
    var encounters = await this.listEncounters();
    var frequency = await this.frequencyMap();
    var ignore = await this.ignoreList();
    var localLexicon = new Set();
    words.forEach(function (word) { localLexicon.add(normalizeKey(word.lemma)); });
    frequency.forEach(function (rank, lemma) { localLexicon.add(lemma); });
    var externalLexicon = opts.lexicon && typeof opts.lexicon.has === 'function' ? opts.lexicon : null;
    var lexicon = externalLexicon ? {
      has: function (form) { return localLexicon.has(form) || externalLexicon.has(form); }
    } : localLexicon;

    var known = new Set();
    words.forEach(function (word) { known.add(normalizeKey(word.lemma)); });
    var blocked = new Set();
    encounters.forEach(function (record) {
      if (record.state === 'dismissed' || record.state === 'carded') blocked.add(record.wordKey);
    });
    ignore.forEach(function (lemma) { blocked.add(lemma); });

    var all = [];
    var sentenceIndex = {};
    sentences.forEach(function (sentence) {
      var local = contentTokens(sentence.text, { lexicon: lexicon });
      local.forEach(function (lemma) {
        all.push(lemma);
        if (!sentenceIndex[lemma]) sentenceIndex[lemma] = [];
        if (sentenceIndex[lemma].length < 3 && sentenceIndex[lemma].indexOf(sentence.text) < 0) {
          sentenceIndex[lemma].push(sentence.text);
        }
      });
    });

    var candidates = selectCandidates(all, {
      known: known,
      ignore: blocked,
      band: this.band,
      minRecurrence: opts.minRecurrence == null ? 2 : opts.minRecurrence,
      cap: opts.cap == null ? 200 : opts.cap,
      rankOf: function (lemma) { return frequency.get(lemma) || null; },
      sentencesFor: function (lemma) { return (sentenceIndex[lemma] || []).slice(); }
    });

    var records = [];
    for (var i = 0; i < candidates.length; i += 1) {
      var candidate = candidates[i];
      var record = await idb.get(this.db, STORES.encounters, candidate.lemma);
      if (!record) record = { wordKey: candidate.lemma, count: 0, contexts: [], state: 'inbox' };
      record.count = Math.max(record.count || 0, candidate.count);
      record.contexts = candidate.sentences.map(function (ja) {
        return { ja: ja, source: source, ts: now };
      });
      record.firstSeen = record.firstSeen || now;
      record.lastSeen = now;
      record.rank = candidate.rank || null;
      if (record.state !== 'carded' && record.state !== 'dismissed') record.state = 'inbox';
      records.push(record);
    }
    await idb.putAll(this.db, STORES.encounters, records);
    return {
      sentences: sentences.length,
      tokens: all.length,
      candidates: candidates.length,
      items: candidates
    };
  }

  async listInbox() {
    var encounters = await this.listEncounters();
    return encounters
      .filter(function (record) { return record.state === 'inbox'; })
      .sort(function (a, b) {
        if ((b.count || 0) !== (a.count || 0)) return (b.count || 0) - (a.count || 0);
        var ra = a.rank || Infinity;
        var rb = b.rank || Infinity;
        if (ra !== rb) return ra - rb;
        return a.wordKey < b.wordKey ? -1 : 1;
      });
  }

  async rejectCandidate(lemma) {
    await this.setEncounterState(lemma, 'dismissed');
    await this.ignore(lemma);
    return lemma;
  }

  /* Turn a candidate into a sense and its cards. The word gains a sense; it
   * never gains a duplicate one, so approving twice is safe. */
  async approveCandidate(lemma, details) {
    var opts = details || {};
    var now = opts.now || Date.now();
    var key = normalizeKey(lemma);
    if (!key) return null;

    var words = await this.listWords();
    var senses = await this.listSenses();
    var word = null;
    for (var i = 0; i < words.length; i += 1) {
      if (words[i].lemma === key) { word = words[i]; break; }
    }
    var record = await idb.get(this.db, STORES.encounters, key);
    var contextSentences = opts.sentence
      ? [opts.sentence]
      : (record && record.contexts ? record.contexts.map(function (c) { return c.ja; }) : []);

    var id = word ? word.id : wordId(key);
    var index = 0;
    senses.forEach(function (sense) { if (sense.wordId === id) index += 1; });

    var definition = null;
    if (opts.definition) {
      definition = { lang: 'ja', text: opts.definition, dictId: 'user' };
    } else if (opts.dictionary) {
      try {
        var entries = await opts.dictionary.lookup(key);
        for (var e = 0; e < (entries || []).length; e += 1) {
          var found = definitionFromEntry(entries[e]);
          if (found) { definition = found; break; }
        }
      } catch (err) { definition = null; }
    }

    if (!word) {
      word = makeWord({
        lemma: key,
        reading: opts.reading || '',
        pos: opts.pos || [],
        frequency: record && record.rank ? { rank: record.rank, source: 'imported' } : null
      });
    } else if (record && record.rank && !word.frequency) {
      word.frequency = { rank: record.rank, source: 'imported' };
    }

    var source = contextSentences.length
      ? { ja: contextSentences[0], source: (record && record.contexts && record.contexts[0] && record.contexts[0].source) || null }
      : null;
    var sense = makeSense({
      id: senseId(id, index),
      wordId: id,
      definition: definition || { lang: 'ja', text: '', dictId: null, pending: true },
      gloss: null,
      register: opts.register || [],
      source: source,
      createdAt: now
    });
    word.senseIds = (word.senseIds || []).concat([sense.id]);

    var modes = modesForSense(word, sense);
    var cards = modes.map(function (mode) {
      return makeCard({
        id: cardId(sense.id, mode),
        senseId: sense.id,
        wordId: word.id,
        mode: mode,
        context: sense.source,
        createdAt: now
      });
    });

    await idb.put(this.db, STORES.words, word);
    await idb.put(this.db, STORES.senses, sense);
    await idb.putAll(this.db, STORES.cards, cards);
    if (record) {
      record.state = 'carded';
      record.lastSeen = now;
      await idb.put(this.db, STORES.encounters, record);
    }
    return { word: word, sense: sense, cards: cards, modes: modes };
  }

  /* Manual capture, using the learner's own fields. */
  async capture(input) {
    var opts = input || {};
    if (!opts.lemma) return null;
    return this.approveCandidate(opts.lemma, {
      reading: opts.reading,
      definition: opts.definition,
      sentence: opts.sentence,
      pos: opts.pos,
      register: opts.register,
      now: opts.now,
      dictionary: opts.dictionary
    });
  }

  /* Fill in senses that are still pending from a loaded dictionary. Seeded
   * senses already carry their definition (dictId 'seed:ja'), so this only
   * touches mined and captured words that had no definition yet. */
  async enrichFromDictionary(dictionary, now) {
    if (!dictionary || typeof dictionary.lookup !== 'function') return { updated: 0 };
    var time = now || Date.now();
    var words = await this.listWords();
    var wordById = {};
    words.forEach(function (word) { wordById[word.id] = word; });
    var senses = await this.listSenses();
    var updated = [];
    for (var i = 0; i < senses.length; i += 1) {
      var sense = senses[i];
      var definition = sense.definition || {};
      if (!definition.pending) continue;
      if (definition.text && definition.text.length) continue;
      var word = wordById[sense.wordId];
      if (!word) continue;
      var found = null;
      try {
        var entries = await dictionary.lookup(word.lemma);
        for (var e = 0; e < (entries || []).length && !found; e += 1) {
          found = definitionFromEntry(entries[e]);
        }
      } catch (err) {
        found = null;
      }
      if (!found) continue;
      sense.definition = found;
      updated.push(sense);
    }
    if (updated.length) await idb.putAll(this.db, STORES.senses, updated);
    return { updated: updated.length, at: time };
  }

  /* Restore a backup produced by exportAll. Additive: it overwrites by id and
   * never clears what is already there. */
  async importJson(data) {
    if (!data || typeof data !== 'object') throw new Error('not a lexicon backup');
    var words = Array.isArray(data.words) ? data.words : [];
    var senses = Array.isArray(data.senses) ? data.senses : [];
    var cards = Array.isArray(data.cards) ? data.cards : [];
    var encounters = Array.isArray(data.encounters) ? data.encounters : [];
    var exposures = Array.isArray(data.exposures) ? data.exposures : [];
    await idb.putAll(this.db, STORES.words, words);
    await idb.putAll(this.db, STORES.senses, senses);
    await idb.putAll(this.db, STORES.cards, cards);
    await idb.putAll(this.db, STORES.encounters, encounters);
    await idb.putAll(this.db, STORES.exposures, exposures);
    if (Array.isArray(data.frequency)) {
      await idb.putAll(this.db, STORES.frequency, data.frequency);
    }
    if (Array.isArray(data.ignore)) {
      await this.setIgnore(data.ignore);
    }
    return { words: words.length, senses: senses.length, cards: cards.length };
  }

  async exportAll() {
    return {
      schema: 2,
      exportedAt: new Date().toISOString(),
      words: await this.listWords(),
      senses: await this.listSenses(),
      cards: await this.listCards(),
      encounters: await this.listEncounters(),
      exposures: await this.listExposures(),
      frequency: await this.listFrequency(),
      ignore: await this.ignoreList()
    };
  }

  async reset() {
    var stores = [
      STORES.words, STORES.senses, STORES.cards, STORES.encounters,
      STORES.exposures, STORES.frequency, STORES.meta
    ];
    for (var i = 0; i < stores.length; i++) {
      await idb.clear(this.db, stores[i]);
    }
  }
}
