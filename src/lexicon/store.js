/* High-level lexicon operations over IndexedDB.
 *
 * This is the only place the UI and the reader talk to. It hides the object
 * stores and turns them into the operations the design describes: seed and
 * migrate, queue a review session, grade, record an encounter, record a
 * passive exposure, build the digest, and report statistics.
 */

import * as idb from './db.js';
import { STORES } from './db.js';
import { fromLegacyJaItem, makeCard, newSrsState } from './schema.js';
import { schedule, DEFAULT_PARAMS } from './srs.js';
import { buildDigest, bumpFamiliarity, currentFamiliarity } from './digest.js';

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
    if (ja && !duplicate) {
      rec.count = (rec.count || 0) + 1;
      rec.contexts = rec.contexts.concat([{ ja: ja, source: (context && context.source) || null, ts: time }]).slice(-10);
    } else {
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

  async exportAll() {
    return {
      schema: 2,
      exportedAt: new Date().toISOString(),
      words: await this.listWords(),
      senses: await this.listSenses(),
      cards: await this.listCards(),
      encounters: await this.listEncounters(),
      exposures: await this.listExposures()
    };
  }

  async reset() {
    var stores = [STORES.words, STORES.senses, STORES.cards, STORES.encounters, STORES.exposures, STORES.meta];
    for (var i = 0; i < stores.length; i++) {
      await idb.clear(this.db, stores[i]);
    }
  }
}
