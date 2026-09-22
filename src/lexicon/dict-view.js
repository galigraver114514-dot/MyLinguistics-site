/* Turning Dictionary.lookupGrouped() output into the 辞書 column's view model.
 *
 * Grouping, ordering and attribution are the dictionary module's business
 * (interface-dict.md 1.7); this file only decides what a column renders, and
 * it is pure, so the column can be tested without a dictionary.
 */

import { plainText } from '../dict/structured.js';

export const HIDDEN_KEY = 'ml.dictHidden';

/* The source's own title, never a translated stand-in: a learner who imported
 * 明鏡国語辞典 has to see that name to know which dictionary answered. */
export function sourceTitle(info) {
  if (!info) return '';
  return info.title || info.id || '';
}

/* 国語 / 英和 - the badge the design puts beside each dictionary's name. */
export function languageBadge(info) {
  var languages = info && Array.isArray(info.languages) ? info.languages : [];
  if (languages.indexOf('ja') !== -1) return 'dict.lang.ja';
  if (languages.length > 0) return 'dict.lang.en';
  return null;
}

/* A source's own licence or attribution, which must travel with its data: a
 * JMdict entry shown without "JMdict © EDRDG" is a licence breach, not a
 * cosmetic omission. Empty is allowed only for a source that declares none. */
export function creditLine(info) {
  if (!info) return '';
  return info.attribution || info.licence || '';
}

export function sourceOrder(groups) {
  return (groups || []).map(function (group) { return group && group.id; })
    .filter(function (id) { return !!id; });
}

export function hiddenFrom(value) {
  var list = Array.isArray(value) ? value : [];
  var out = {};
  list.forEach(function (id) { if (id) out[id] = true; });
  return out;
}

export function hiddenTo(hidden) {
  return Object.keys(hidden || {}).filter(function (id) { return hidden[id]; }).sort();
}

export function toggleHidden(hidden, id) {
  var next = Object.assign({}, hidden || {});
  if (next[id]) delete next[id];
  else next[id] = true;
  return next;
}

/* Hiding a dictionary hides its block; the word is still looked up, because
 * the trail and the state panel do not depend on what is on screen. */
export function visibleGroups(groups, hidden) {
  var off = hidden || {};
  return (groups || []).filter(function (group) {
    return group && !off[group.id] && Array.isArray(group.entries) && group.entries.length > 0;
  });
}

export function entryHeadline(entry) {
  return {
    headword: (entry && (entry.headword || entry.id)) || '',
    reading: (entry && entry.reading) || ''
  };
}

/* Parts of speech come from the source's own tags and are shown untranslated;
 * a priority tag becomes a chip only for the four JMdict knows. */
export function entryChips(entry, sense) {
  var chips = [];
  var pos = sense && Array.isArray(sense.pos) ? sense.pos : [];
  pos.forEach(function (tag) {
    if (tag) chips.push({ kind: 'pos', text: String(tag) });
  });
  var priority = entry && Array.isArray(entry.priority) ? entry.priority : [];
  priority.forEach(function (tag) {
    var key = { ichi1: 'dict.priority.ichi', news1: 'dict.priority.news', spec1: 'dict.priority.spec', gai1: 'dict.priority.gai' }[tag];
    if (key) chips.push({ kind: 'priority', text: null, key: key });
  });
  return chips;
}

/* One block per sense. A Japanese source is read as numbered lines; any other
 * language is a gloss list, which is how JMdict reads. */
export function senseBlocks(entry) {
  var senses = entry && Array.isArray(entry.senses) ? entry.senses : [];
  return senses.map(function (sense) {
    var glosses = Array.isArray(sense && sense.glosses) ? sense.glosses : [];
    var lines = glosses.map(function (gloss) {
      return plainText(gloss).replace(/\s+/g, ' ').trim();
    }).filter(function (text) { return text.length > 0; });
    return {
      language: (sense && sense.language) || 'en',
      pos: (sense && Array.isArray(sense.pos)) ? sense.pos.slice() : [],
      numbered: (sense && sense.language) === 'ja',
      lines: lines
    };
  }).filter(function (block) { return block.lines.length > 0; });
}

/* The first Japanese definition available, for the 調べた語 row's one-line
 * gloss. Falls back to the first gloss in any language. */
export function firstGloss(groups) {
  var fallback = null;
  (groups || []).forEach(function (group) {
    (group.entries || []).forEach(function (entry) {
      senseBlocks(entry).forEach(function (block) {
        if (!block.lines.length) return;
        if (fallback === null) fallback = block.lines[0];
        if (block.language === 'ja' && block.lines[0]) fallback = block.lines[0];
      });
    });
  });
  return fallback;
}

/* 1.4 MB / 12.1 GB - the dictionaries card's usage line. */
export function usageLabel(bytes, quota) {
  return { bytes: Number(bytes) || 0, quota: Number(quota) || 0 };
}

export function formatBytes(value) {
  var bytes = Number(value) || 0;
  if (bytes < 1024) return bytes + ' B';
  var units = ['KB', 'MB', 'GB', 'TB'];
  var n = bytes / 1024;
  var i = 0;
  while (n >= 1024 && i < units.length - 1) { n = n / 1024; i += 1; }
  /* One decimal up to 99.9, so 12.1 GB reads as the design drew it. */
  return (n >= 100 ? Math.round(n) : Math.round(n * 10) / 10) + ' ' + units[i];
}
