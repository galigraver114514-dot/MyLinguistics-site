/* Building the word river's pool.
 *
 * Two sources, kept deliberately apart:
 *
 *   the learner's own lexicon - every item carries a sense id, so the river can
 *     record an exposure and grow familiarity;
 *   the loaded dictionary     - sampled forms with no sense, shown but never
 *     recorded against. This is what lets the river be large without either
 *     auto-creating senses or flooding the inbox.
 *
 * Kept out of entry.js so the pool can be tested without a DOM.
 */

import { definitionFromEntry } from './authoring.js';

export function lexiconItems(senses, wordById) {
  var pool = [];
  (senses || []).forEach(function (sense) {
    var word = wordById ? wordById[sense.wordId] : null;
    if (!word) return;
    pool.push({
      term: word.lemma,
      reading: word.reading || '',
      definition: (sense.definition && sense.definition.text) || '',
      senseId: sense.id
    });
  });
  return pool;
}

export async function dictionaryItems(dictionary, limit, skip) {
  if (!dictionary || typeof dictionary.lexicon !== 'function' || typeof dictionary.lookup !== 'function') return [];
  var lexicon = dictionary.lexicon();
  if (!lexicon || typeof lexicon.sample !== 'function' || typeof lexicon.count !== 'function') return [];
  if (!lexicon.count()) return [];

  var forms = lexicon.sample(limit) || [];
  var items = await Promise.all(forms.map(async function (form) {
    if (skip && skip[form]) return null;
    var entry = null;
    try {
      var entries = await dictionary.lookup(form);
      entry = entries && entries.length ? entries[0] : null;
    } catch (err) {
      entry = null;
    }
    return {
      term: form,
      reading: entry && entry.reading ? entry.reading : '',
      definition: entry ? ((definitionFromEntry(entry) || {}).text || '') : '',
      senseId: null
    };
  }));
  return items.filter(Boolean);
}

export async function collectRiverPool(options) {
  var opts = options || {};
  var pool = lexiconItems(opts.senses, opts.wordById);
  var skip = {};
  pool.forEach(function (item) { skip[item.term] = true; });
  var extra = await dictionaryItems(opts.dictionary, opts.limit == null ? 60 : opts.limit, skip);
  return pool.concat(extra);
}
