/* Card authoring.
 *
 * A sense gets cards by rule, not by hand. Recognition always comes first;
 * every card after that is added only when the data it needs exists, so a card
 * is never a bare word with an empty back. This is what keeps the card count
 * honest: cloze and fill need a real source sentence, reading needs a reading
 * that is not the orthography.
 */

import { normalizeKey } from './schema.js';
import { plainText } from '../dict/structured.js';

/* Order matches MODE_ORDER in store.js: recognition before production. */
export function modesForSense(word, sense) {
  var modes = ['recognize'];
  if (word && word.reading && normalizeKey(word.reading) !== normalizeKey(word.lemma)) {
    modes.push('reading');
  }
  var sentence = sense && sense.source && sense.source.ja ? sense.source.ja : '';
  var anchored = !!sentence && sentence.indexOf(normalizeKey(word && word.lemma)) >= 0;
  if (anchored) modes.push('cloze');
  modes.push('produce');
  if (anchored) modes.push('fill');
  return modes;
}

/* Pull a JP-JP definition out of a shared-dictionary Entry. Glosses are
 * structured content for a Yomitan source and plain strings for JMdict, so
 * they go through the shared plainText() rather than a local flattener.
 * Returns null when the entry holds no usable Japanese. */
export function definitionFromEntry(entry) {
  if (!entry || !Array.isArray(entry.senses)) return null;
  for (var i = 0; i < entry.senses.length; i += 1) {
    var sense = entry.senses[i];
    if (!sense || sense.language !== 'ja') continue;
    var glosses = Array.isArray(sense.glosses) ? sense.glosses : [];
    var parts = glosses.map(function (gloss) {
      return plainText(gloss).replace(/\s+/g, ' ').trim();
    }).filter(function (text) { return text.length > 0; });
    if (!parts.length) continue;
    return {
      lang: 'ja',
      text: parts.join('。'),
      dictId: entry.source || null,
      entryId: entry.id || null
    };
  }
  return null;
}
