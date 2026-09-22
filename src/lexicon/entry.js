/* Wordbook UI controller.
 *
 * A thin layer over Lexicon: it never talks to IndexedDB directly. The review
 * view uses FSRS; the passive view only records exposures. Keeping that split
 * visible in the code is the point.
 */

import { openDb } from './db.js';
import { loadDictionary } from './dictionary.js';
import { createRiverView } from './river-view.js';
import { Lexicon, SETTINGS } from './store.js';
import { SEED_DEFS } from './seed-ja.js';
import { schedule } from './srs.js';
import { isOutputMode } from './schema.js';
import { collectRiverPool } from './river-pool.js';
import { brickLabel as formatBrickLabel } from './brick-label.js';

var state = {
  lex: null,
  view: 'brick',
  queue: [],
  index: 0,
  flipped: false,
  wordById: {},
  senseById: {},
  cardsBySense: {},
  stats: null,
  digest: [],
  digestSeen: {},
  inbox: [],
  browseFilter: '',
  lookOnly: false,
  dictionary: null,
  dictCount: 0,
  brick: null,
  sessionAgains: 0,
  brickPaced: false,
  brickResult: null
};

/* English fallbacks keep the engine usable when loaded without the site runtime
 * (for example in a test). */
var FALLBACK = {
  'wb.stat.words': 'Words',
  'wb.stat.due': 'Due',
  'wb.stat.new': 'New',
  'wb.stat.recognition': 'Recognition',
  'wb.mode.recognition': 'Recognition',
  'wb.mode.output': 'Output',
  'wb.passive.count': '{n} items',
  'wb.passive.empty': 'Nothing to show yet. Words appear here as they enter the lexicon.',
  'wb.known': 'Already know it',
  'wb.empty.browse': 'No match.',
  'wb.river.note': 'A random, context-free stream.',
  'wb.river.pause': 'Pause',
  'wb.river.resume': 'Resume',
  'wb.river.shuffle': 'New course',
  'wb.river.empty': 'The river is empty. Words appear as they enter the lexicon.',
  'wb.typeOptional': 'Typed input is optional; grade from memory.',
  'wb.dictMissing': 'No dictionary source is loaded, so definitions come from the built-in seed.',
  'wb.confirmReset': 'Delete every word, card, and exposure stored in this browser?',
  'wb.flip': 'Flip',
  'wb.flipBack': 'Flip back',
  'wb.due.min': '{n}m',
  'wb.due.hour': '{n}h',
  'wb.due.day': '{n}d',
  'wb.due.month': '{n}mo',
  'wb.due.year': '{n}y',
  'wb.tab.inbox': 'Inbox',
  'wb.tab.brick': 'Brick',
  'wb.tab.pool': 'Pool',
  'wb.tab.bricks': 'Bricks',
  'wb.tab.data': 'Data',
  'wb.bricks.note': 'Ten words per brick.',
  'wb.bricks.empty': 'No bricks yet.',
  'wb.bricks.dissolve': 'Take apart',
  'wb.inbox.count': '{n} waiting',
  'wb.inbox.empty': 'Nothing waiting.',
  'wb.inbox.seen': '{n} sentences',
  'wb.inbox.approve': 'Make cards',
  'wb.inbox.reject': 'Ignore',
  'wb.inbox.approved': '{word}: {n} cards made.',
  'wb.mine.done': '{word} was added.',
  'wb.mine.missing': 'A word is needed.',
  'wb.import.result': '{n} candidates from {s} sentences.',
  'wb.freq.result': '{n} ranks imported.',
  'wb.restore.result': 'Restored {n} words.',
  'wb.restore.failed': 'That file could not be read.',
  'wb.lookOnly': 'Look only',
  'wb.lookOnly.on': 'Look only: the answer is always shown.',
  'wb.next': 'Next',
  'wb.mode.recognize': 'Recognition',
  'wb.mode.reading': 'Reading',
  'wb.mode.cloze': 'Cloze',
  'wb.mode.produce': 'Output',
  'wb.mode.fill': 'Fill in',
  'wb.mode.sentence': 'Sentence',
  'wb.match.exact': 'Exact match.',
  'wb.match.diff': 'You wrote {a}; the word is {b}.',
  'wb.dictLoaded': '{n} words from your imported dictionaries.',
  'wb.dict.importing': 'Importing...',
  'wb.dict.imported': '{n} entries imported.',
  'wb.dict.failed': 'That dictionary could not be imported.',
  'wb.dict.removed': 'Imported dictionaries removed.',
  'wb.dict.unavailable': 'The dictionary module is not available.',
  'wb.inbox.bricks': '{n} bricks',
  'wb.enrol': 'Enrol and build bricks',
  'wb.enrol.result': '{carded} cards, {bricks} bricks.',
  'wb.brick.chip': 'Brick {name} · {n} words',
  'wb.brick.source': 'Source',
  'wb.brick.common': 'Common',
  'wb.brick.mid': 'Mid band',
  'wb.brick.rare': 'Rare',
  'wb.brick.unknown': 'Ungraded',
  'wb.brick.mixed': 'Mixed',
  'wb.brick.done': 'Brick {name} done',
  'wb.brick.doneNote': '{n} cards were marked Again.',
  'wb.river.count': '{n} words in the river',
  'wb.river.note': 'Drag the rod; the first word it touches lands in the pool.',
  'wb.river.keptOne': '{word} added to the pool.',
  'wb.river.hadOne': '{word} is already in the pool.'
};

function formatDue(ms) {
  var minutes = ms / 60000;
  if (minutes < 60) return tText('wb.due.min', { n: Math.max(1, Math.round(minutes)) });
  var hours = minutes / 60;
  if (hours < 24) return tText('wb.due.hour', { n: Math.round(hours) });
  var days = hours / 24;
  if (days < 31) return tText('wb.due.day', { n: Math.round(days) });
  var months = days / 30;
  if (months < 12) return tText('wb.due.month', { n: Math.round(months) });
  return tText('wb.due.year', { n: (days / 365).toFixed(1) });
}

function tText(key, vars) {
  if (window.ML && window.ML.t) return window.ML.t(key, vars);
  var text = FALLBACK[key] || key;
  if (vars) {
    Object.keys(vars).forEach(function (name) {
      text = text.split('{' + name + '}').join(String(vars[name]));
    });
  }
  return text;
}

function el(id) {
  return document.getElementById(id);
}

function esc(value) {
  return String(value == null ? '' : value)
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
    .split('"').join('&quot;');
}

function show(node, visible) {
  if (!node) return;
  if (visible) node.classList.remove('hidden');
  else node.classList.add('hidden');
}

function percent(fraction) {
  if (!fraction || fraction < 0) return 0;
  if (fraction > 1) return 100;
  return Math.round(fraction * 100);
}

/* A brick group is structured data, so the interface makes the name. */
function brickLabel(brick) {
  return formatBrickLabel(brick, tText);
}

/* One label per card mode. Older builds only knew recognition and output; an
 * unknown mode falls back to those rather than showing its raw name. */
function modeLabel(mode) {
  var key = 'wb.mode.' + mode;
  var text = tText(key, null);
  if (text === key) {
    return isOutputMode(mode) ? tText('wb.mode.output') : tText('wb.mode.recognition');
  }
  return text;
}

/* -------------------------------------------------------------- dictionary
 * The dictionary is optional here. Every path degrades to the seed: no module,
 * no imported source, or no storage must not stop the wordbook from working.
 */

function dictLexicon() {
  var dict = state.dictionary;
  if (!dict || typeof dict.lexicon !== 'function') return null;
  try {
    var lexicon = dict.lexicon();
    if (lexicon && typeof lexicon.has === 'function' && typeof lexicon.count === 'function' && lexicon.count() > 0) {
      return lexicon;
    }
  } catch (err) { /* fall through to no lexicon */ }
  return null;
}

async function refreshDictionary() {
  var dict = state.dictionary;
  var count = 0;
  if (dict && typeof dict.lexicon === 'function') {
    try { count = dict.lexicon().count() || 0; } catch (err) { count = 0; }
  }
  state.dictCount = count;
  var notice = el('wbDictNotice');
  if (notice) {
    notice.textContent = count > 0 ? tText('wb.dictLoaded', { n: count }) : tText('wb.dictMissing');
    show(notice, true);
  }
}

/* An imported dictionary persists, so a normal boot restores it without the
 * file. A failure here is reported by the module and must not block the page. */
async function restoreDictionaries() {
  var dict = state.dictionary;
  if (!dict || typeof dict.stored !== 'function' || typeof dict.restore !== 'function') return;
  try {
    var stored = await dict.stored();
    for (var i = 0; i < (stored || []).length; i += 1) {
      try { await dict.restore(stored[i].id); } catch (err) { /* ignore one bad source */ }
    }
  } catch (err) { /* no storage is a normal state */ }
}

async function importDictionary(file) {
  var node = el('wbDictResult');
  var dict = state.dictionary;
  if (!dict || typeof dict.importYomitan !== 'function') {
    node.textContent = tText('wb.dict.unavailable');
    show(node, true);
    return;
  }
  node.textContent = tText('wb.dict.importing');
  show(node, true);
  try {
    var result = await dict.importYomitan(file, function (event) {
      if (event && event.stage === 'bank' && event.loaded && event.total) {
        node.textContent = tText('wb.dict.progress', { loaded: event.loaded, total: event.total });
      }
    });
    node.textContent = tText('wb.dict.imported', { n: (result && result.entries) || 0 });
    show(node, true);
  } catch (err) {
    node.textContent = tText('wb.dict.failed');
    show(node, true);
    return;
  }
  await refreshDictionary();
  if (state.lex) {
    await state.lex.enrichFromDictionary(state.dictionary);
    await refresh();
  }
}

async function forgetDictionaries() {
  var dict = state.dictionary;
  if (!dict || typeof dict.removeSource !== 'function' || typeof dict.sources !== 'function') return;
  var loaded = dict.sources() || [];
  for (var i = 0; i < loaded.length; i += 1) {
    if (loaded[i].kind !== 'yomitan') continue;
    try { await dict.removeSource(loaded[i].id); } catch (err) { /* ignore */ }
  }
  var node = el('wbDictResult');
  if (node) {
    node.textContent = tText('wb.dict.removed');
    show(node, true);
  }
  await refreshDictionary();
}

/* ------------------------------------------------------------------ stats */

function renderStats() {
  var s = state.stats || {};
  var cells = [
    [tText('wb.stat.words'), s.words || 0],
    [tText('wb.stat.due'), s.due || 0],
    [tText('wb.stat.new'), s.fresh || 0],
    [tText('wb.stat.recognition'), (s.recognition || 0) + '%']
  ];
  el('wbStats').innerHTML = cells.map(function (cell) {
    return '<div class="wb-stat"><span>' + esc(cell[0]) + '</span><strong>' + esc(cell[1]) + '</strong></div>';
  }).join('');
}

async function refresh() {
  var words = await state.lex.listWords();
  var senses = await state.lex.listSenses();
  var cards = await state.lex.listCards();
  state.wordById = {};
  state.senseById = {};
  state.cardsBySense = {};
  words.forEach(function (word) { state.wordById[word.id] = word; });
  senses.forEach(function (sense) { state.senseById[sense.id] = sense; });
  cards.forEach(function (card) {
    if (!state.cardsBySense[card.senseId]) state.cardsBySense[card.senseId] = [];
    state.cardsBySense[card.senseId].push(card);
  });
  state.stats = await state.lex.stats();
  renderStats();
}

/* ----------------------------------------------------------------- review */

function currentCard() {
  return state.queue[state.index] || null;
}

function buildContext(card, word, blankTerm) {
  var context = card.context;
  if (!context || !context.ja) return '';
  var text = context.ja;
  if (blankTerm && word.lemma) {
    text = text.split(word.lemma).join('［　　］');
  }
  return text;
}

function renderCard() {
  var card = currentCard();
  var cardNode = el('wbCard');
  var gradesNode = el('wbGrades');
  var doneNode = el('wbDone');

  if (!card) {
    show(cardNode, false);
    show(gradesNode, false);
    show(doneNode, true);
    el('wbCounter').textContent = '0 / 0';
    el('wbProgress').style.width = '100%';
    var emptyChip = el('wbBrickChip');
    if (emptyChip) show(emptyChip, false);
    if (state.brick && state.brickResult) {
      el('wbDoneTitle').textContent = tText('wb.brick.done', { name: brickLabel(state.brick) });
      el('wbDoneNote').textContent = tText('wb.brick.doneNote', { n: state.brickResult.agains });
    } else {
      el('wbDoneTitle').textContent = tText('wb.done.title');
      el('wbDoneNote').textContent = tText('wb.done.note');
    }
    return;
  }

  show(cardNode, true);
  show(gradesNode, true);
  show(doneNode, false);

  var sense = state.senseById[card.senseId] || { definition: {}, recognition: {} };
  var word = state.wordById[card.wordId] || { id: card.wordId, lemma: card.wordId, reading: '' };
  var definition = sense.definition || {};
  var mode = card.mode;
  var isOutput = isOutputMode(mode);
  var isCloze = mode === 'cloze';
  var lookOnly = state.lookOnly;
  var flipped = state.flipped || lookOnly;
  var fullSentence = card.context && card.context.ja ? card.context.ja : '';

  el('wbCounter').textContent = (state.index + 1) + ' / ' + state.queue.length;
  el('wbProgress').style.width = Math.round((state.index / state.queue.length) * 100) + '%';
  el('wbModeLabel').textContent = modeLabel(mode);

  var brickChip = el('wbBrickChip');
  if (brickChip) {
    show(brickChip, !!state.brick);
    brickChip.textContent = state.brick
      ? tText('wb.brick.chip', { name: brickLabel(state.brick), n: state.brick.size })
      : '';
  }

  if (isOutput) {
    el('wbPrompt').textContent = flipped ? word.lemma : (definition.text || word.lemma);
  } else if (isCloze && !flipped) {
    el('wbPrompt').textContent = buildContext(card, word, true);
  } else {
    el('wbPrompt').textContent = word.lemma;
  }
  el('wbReading').textContent = flipped ? (word.reading || '') : '';

  var typeWrap = el('wbTypeWrap');
  if (isOutput && !lookOnly) {
    show(typeWrap, true);
    el('wbInput').disabled = flipped;
  } else {
    show(typeWrap, false);
  }

  var definitionNode = el('wbDefinition');
  show(definitionNode, flipped && !isOutput);
  definitionNode.textContent = flipped ? (definition.text || '') : '';

  var contextNode = el('wbContext');
  var contextText = isCloze ? (flipped ? fullSentence : '') : buildContext(card, word, isOutput && !flipped);
  show(contextNode, !!contextText);
  contextNode.textContent = contextText;

  var toleranceNode = el('wbTolerance');
  if (isOutput && flipped && !lookOnly) {
    show(toleranceNode, true);
    toleranceNode.textContent = compareAnswer(el('wbInput').value, word.lemma);
  } else {
    show(toleranceNode, false);
  }

  var now = Date.now();
  var scheduleOptions = state.lex.scheduleOptions();
  [1, 2, 3, 4].forEach(function (grade) {
    var node = document.querySelector('.wb-when[data-when="' + grade + '"]');
    if (node) node.textContent = formatDue(schedule(card.srs, grade, now, scheduleOptions).due - now);
  });

  var gradeButtons = document.querySelectorAll('#wbGrades [data-rating]');
  for (var i = 0; i < gradeButtons.length; i++) {
    gradeButtons[i].disabled = !flipped || lookOnly;
  }
  show(el('wbNext'), lookOnly);
  show(el('wbFlip'), !lookOnly);
  el('wbFlip').textContent = flipped ? tText('wb.flipBack') : tText('wb.flip');

  var lookButton = el('wbLookOnly');
  if (lookButton) lookButton.setAttribute('aria-pressed', lookOnly ? 'true' : 'false');
  var lookNote = el('wbLookNote');
  if (lookNote) {
    show(lookNote, lookOnly);
    lookNote.textContent = lookOnly ? tText('wb.lookOnly.on') : '';
  }
}

function compareAnswer(typed, answer) {
  var value = String(typed == null ? '' : typed).normalize('NFKC').trim();
  var expected = String(answer == null ? '' : answer).normalize('NFKC').trim();
  if (!value) return tText('wb.typeOptional');
  if (value === expected) return tText('wb.match.exact');
  return tText('wb.match.diff', { a: value, b: expected });
}

/* Review is brick-first: if a brick is sealed or due, its ten words are the
 * session. Only when no brick is waiting does the flat card queue take over,
 * which is also what keeps a fresh install usable before any brick exists. */
async function startReview() {
  var now = Date.now();
  state.brick = await state.lex.nextBrick(now);
  state.sessionAgains = 0;
  state.brickPaced = false;
  state.brickResult = null;
  if (state.brick) {
    state.queue = await state.lex.brickQueue(state.brick.id, now);
  } else {
    var queue = await state.lex.queue(now, SETTINGS.newPerSession);
    state.queue = queue.due.concat(queue.fresh);
  }
  state.index = 0;
  state.flipped = false;
  renderCard();
}

function flip() {
  if (state.view !== 'brick' || !currentCard() || state.lookOnly) return;
  state.flipped = !state.flipped;
  renderCard();
  if (state.flipped) {
    var input = el('wbInput');
    if (input && !input.disabled) input.focus();
  }
}

async function grade(rating) {
  var card = currentCard();
  if (!card || !state.flipped) return;
  await state.lex.grade(card.id, rating, Date.now());
  if (rating === 1) state.sessionAgains += 1;
  state.index += 1;
  state.flipped = false;
  await refresh();
  if (!currentCard() && state.brick) await finishBrick();
  renderCard();
}

/* The cards already hold their FSRS schedules; this adds the brick's pacing on
 * top, and three or more Again ratings pull the whole brick forward. */
async function finishBrick() {
  if (!state.brick || state.brickPaced) return;
  state.brickPaced = true;
  var agains = state.sessionAgains;
  state.brickResult = { agains: agains };
  await state.lex.paceBrick(state.brick.id, { agains: agains, now: Date.now() });
  await refresh();
}

/* Look-only review: the answer is always visible and the card advances by
 * scrolling or tapping. It records an exposure and never a grade, which is
 * exactly the distinction the passive track exists for. */
function toggleLookOnly() {
  state.lookOnly = !state.lookOnly;
  state.flipped = state.lookOnly;
  renderCard();
}

async function nextLookOnly() {
  var card = currentCard();
  if (!card) return;
  await state.lex.recordExposure(card.senseId, 'lookonly', Date.now());
  state.index += 1;
  state.flipped = false;
  await refresh();
  if (!currentCard() && state.brick) await finishBrick();
  renderCard();
}

/* ---------------------------------------------------------------- passive */

async function renderDigest() {
  state.digest = await state.lex.digest(Date.now(), SETTINGS.digestPerDay);
  el('wbDigestCount').textContent = tText('wb.passive.count', { n: state.digest.length });
  var list = el('wbDigestList');
  if (!state.digest.length) {
    list.innerHTML = '<p class="muted">' + esc(tText('wb.passive.empty')) + '</p>';
    return;
  }
  list.innerHTML = state.digest.map(function (item) {
    var sense = item.sense;
    var word = item.word;
    var definition = sense.definition || {};
    var sentence = item.source && item.source.ja ? item.source.ja : '';
    return '<article class="wb-digest-item">' +
      '<div class="wb-digest-head"><strong>' + esc(word.lemma) + '</strong>' +
      '<span class="card-reading">' + esc(word.reading || '') + '</span>' +
'</div>' +
      '<p class="wb-definition">' + esc(definition.text || '') + '</p>' +
      (sentence ? '<p class="card-example">' + esc(sentence) + '</p>' : '') +
      '<div class="wb-digest-actions">' +
      '<button class="btn btn-ghost btn-small" data-known="' + esc(sense.id) + '" type="button">' + esc(tText('wb.known')) + '</button>' +
      '</div></article>';
  }).join('');

  for (var i = 0; i < state.digest.length; i++) {
    var id = state.digest[i].sense.id;
    if (state.digestSeen[id]) continue;
    state.digestSeen[id] = true;
    await state.lex.recordExposure(id, 'digest', Date.now());
  }
  await refresh();
}

async function markKnown(senseIdValue) {
  await state.lex.markKnown(senseIdValue, Date.now());
  await refresh();
  await renderDigest();
}

/* ------------------------------------------------------------------ inbox
 * Two ways in: candidates the miner left behind, and the learner's own
 * capture. Approving is the only action that creates cards; nothing in the
 * inbox is scheduled by FSRS until then.
 */

async function renderInbox() {
  state.inbox = await state.lex.listInbox();
  var count = el('wbInboxCount');
  if (count) count.textContent = tText('wb.inbox.count', { n: state.inbox.length });
  var brickCount = el('wbBrickCount');
  if (brickCount) brickCount.textContent = tText('wb.inbox.bricks', { n: state.stats ? (state.stats.bricks || 0) : 0 });
  var list = el('wbInboxList');
  if (!list) return;
  if (!state.inbox.length) {
    list.innerHTML = '<p class="muted">' + esc(tText('wb.inbox.empty')) + '</p>';
    return;
  }
  list.innerHTML = state.inbox.map(function (item) {
    var sentence = item.contexts && item.contexts[0] ? item.contexts[0].ja : '';
    var rank = item.rank ? '<span class="wb-inbox-rank">' + esc(String(item.rank)) + '</span>' : '';
    return '<article class="wb-inbox-item">' +
      '<div class="wb-inbox-head"><strong>' + esc(item.wordKey) + '</strong>' +
      '<span class="wb-inbox-seen">' + esc(tText('wb.inbox.seen', { n: item.count || 0 })) + '</span>' + rank + '</div>' +
      (sentence ? '<p class="card-example">' + esc(sentence) + '</p>' : '') +
      '<div class="wb-inbox-actions">' +
      '<button class="btn btn-primary btn-small" type="button" data-approve="' + esc(item.wordKey) + '">' + esc(tText('wb.inbox.approve')) + '</button>' +
      '<button class="btn btn-ghost btn-small" type="button" data-reject="' + esc(item.wordKey) + '">' + esc(tText('wb.inbox.reject')) + '</button>' +
      '</div></article>';
  }).join('');
}

async function approveCandidate(wordKey) {
  var created = await state.lex.approveCandidate(wordKey, { dictionary: state.dictionary });
  var note = el('wbInboxNote');
  if (note && created) {
    note.textContent = tText('wb.inbox.approved', { word: wordKey, n: created.cards.length });
    show(note, true);
  }
  await refresh();
  await renderInbox();
}

async function rejectCandidate(wordKey) {
  await state.lex.rejectCandidate(wordKey);
  await renderInbox();
}

/* Automatic enrolment: every inbox candidate becomes cards, then the pool is
 * packed into bricks of ten. Nothing here is filed by hand. */
async function enrolCandidates() {
  var result = await state.lex.enrol({ dictionary: state.dictionary });
  var note = el('wbInboxNote');
  if (note) {
    note.textContent = tText('wb.enrol.result', { carded: result.carded, bricks: result.bricks });
    show(note, true);
  }
  await refresh();
  await renderInbox();
  await startReview();
}

async function mineAdd() {
  var result = el('wbMineResult');
  var lemma = el('wbMineWord').value.trim();
  if (!lemma) {
    result.textContent = tText('wb.mine.missing');
    show(result, true);
    return;
  }
  await state.lex.capture({
    lemma: lemma,
    reading: el('wbMineReading').value.trim(),
    definition: el('wbMineDefinition').value.trim(),
    sentence: el('wbMineSentence').value.trim()
  });
  result.textContent = tText('wb.mine.done', { word: lemma });
  show(result, true);
  ['wbMineWord', 'wbMineReading', 'wbMineDefinition', 'wbMineSentence'].forEach(function (id) {
    el(id).value = '';
  });
  await refresh();
}

function readTextFile(file, done) {
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function () { done(String(reader.result == null ? '' : reader.result)); };
  reader.readAsText(file, 'utf-8');
}

async function runImport() {
  var text = el('wbImportText').value;
  if (!text || !text.trim()) return;
  var result = await state.lex.importText(text, { source: { kind: 'paste' }, lexicon: dictLexicon() });
  var node = el('wbImportResult');
  node.textContent = tText('wb.import.result', { n: result.candidates, s: result.sentences });
  show(node, true);
  await renderInbox();
}

async function runFrequency() {
  var text = el('wbFreqText').value;
  if (!text || !text.trim()) return;
  var result = await state.lex.importFrequency(text);
  var node = el('wbFreqResult');
  node.textContent = tText('wb.freq.result', { n: result.rows });
  show(node, true);
  await refresh();
}

async function runRestore(file) {
  var node = el('wbRestoreResult');
  try {
    var text = await new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result == null ? '' : reader.result)); };
      reader.onerror = function () { reject(reader.error || new Error('read failed')); };
      reader.readAsText(file, 'utf-8');
    });
    var result = await state.lex.importJson(JSON.parse(text));
    node.textContent = tText('wb.restore.result', { n: result.words });
    show(node, true);
    await refresh();
    await renderInbox();
  } catch (err) {
    node.textContent = tText('wb.restore.failed');
    show(node, true);
  }
}

/* ----------------------------------------------------------------- browse */

async function renderBrowse() {
  var filter = state.browseFilter.normalize('NFKC').toLowerCase();
  var rows = [];
  Object.keys(state.wordById).forEach(function (wordIdValue) {
    var word = state.wordById[wordIdValue];
    (word.senseIds || []).forEach(function (sid) {
      var sense = state.senseById[sid];
      if (!sense) return;
      var definition = sense.definition || {};
      var haystack = (word.lemma + ' ' + (word.reading || '') + ' ' + (definition.text || '')).toLowerCase();
      if (filter && haystack.indexOf(filter) < 0) return;
      rows.push('<tr><td><strong>' + esc(word.lemma) + '</strong></td>' +
        '<td class="card-reading">' + esc(word.reading || '') + '</td>' +
        '<td>' + esc(definition.text || '') + '</td>' +
        '<td>' + percent(sense.recognition && sense.recognition.familiarity) + '%</td></tr>');
    });
  });
  el('wbBrowseBody').innerHTML = rows.length
    ? rows.join('')
    : '<tr><td colspan="4" class="muted">' + esc(tText('wb.empty.browse')) + '</td></tr>';
}

/* ------------------------------------------------------------------- data */

async function exportJson() {
  var data = await state.lex.exportAll();
  var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var link = document.createElement('a');
  link.href = url;
  link.download = 'mylinguistics-lexicon.json';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function resetAll() {
  if (!window.confirm(tText('wb.confirmReset'))) return;
  await state.lex.reset();
  state.digestSeen = {};
  state.inbox = [];
  state.lookOnly = false;
  state.brick = null;
  state.brickPaced = false;
  state.brickResult = null;
  state.sessionAgains = 0;
  await state.lex.seedFromLegacy(window.ML_DATA ? window.ML_DATA.vocab : [], SEED_DEFS);
  await refresh();
  await startReview();
  await renderInbox();
}

/* ------------------------------------------------------------------ river
 * The word river: a field of words flowing in lanes, and a net. It never
 * writes to FSRS. A caught word goes into the pool and is carded mechanically;
 * a word that is already the learner's own keeps its sense and its schedule.
 */

var RIVER = { view: null, pool: [], cursor: 0, loading: false, token: null, paused: false, pending: null, sample: 60, count: 70 };

/* The pool: the learner's words, the captured candidates, and a dictionary
 * sample, in one shuffled list. It is refilled in the background before it runs
 * out, so the stream never waits. */
async function riverPool() {
  var senses = Object.keys(state.senseById).map(function (id) { return state.senseById[id]; });
  var candidates = [];
  if (state.lex && typeof state.lex.listPool === 'function') {
    try { candidates = await state.lex.listPool(); } catch (err) { candidates = []; }
  }
  return collectRiverPool({
    senses: senses,
    wordById: state.wordById,
    dictionary: state.dictionary,
    candidates: candidates,
    limit: RIVER.sample
  });
}

function nextRiverWord() {
  if (!RIVER.pool.length) return null;
  var item = RIVER.pool[RIVER.cursor % RIVER.pool.length];
  RIVER.cursor += 1;
  maybeRefillRiver();
  return { term: item.term, reading: item.reading || '' };
}

function maybeRefillRiver() {
  if (RIVER.loading) return;
  if (!RIVER.pool.length || RIVER.cursor < RIVER.pool.length * 0.7) return;
  RIVER.loading = true;
  riverPool().then(function (items) {
    if (items.length) {
      RIVER.pool = items;
      RIVER.cursor = 0;
    }
    RIVER.loading = false;
  }).catch(function () { RIVER.loading = false; });
}

function updateRiverCount() {
  var node = el('wbRiverCount');
  if (!node) return;
  var count = RIVER.view && RIVER.view.field ? RIVER.view.field.items().length : RIVER.pool.length;
  node.textContent = tText('wb.river.count', { n: count });
}

async function startRiver() {
  stopRiver();
  var token = {};
  RIVER.token = token;
  var canvas = el('wbRiverCanvas');
  if (!canvas) return;

  var pool = await riverPool();
  if (RIVER.token !== token) return;
  var empty = el('wbRiverEmpty');
  if (!pool.length) {
    if (empty) show(empty, true);
    return;
  }
  if (empty) show(empty, false);
  RIVER.pool = pool;
  RIVER.cursor = 0;
  RIVER.paused = false;
  RIVER.pending = null;
  RIVER.view = createRiverView(canvas, {
    fallback: el('wbRiverFallback'),
    count: RIVER.count,
    nextWord: nextRiverWord,
    onCatch: handleRiverCatch
  });
  RIVER.view.resize();
  RIVER.view.start();
  var pause = el('wbRiverPause');
  if (pause) pause.textContent = tText('wb.river.pause');
  updateRiverCount();
  /* A seam for the page tests, and a handle for debugging. */
  if (window.ML) window.ML.river = { field: RIVER.view.field, view: RIVER.view, pool: function () { return RIVER.pool; } };
}

function stopRiver() {
  RIVER.token = null;
  RIVER.pending = null;
  if (RIVER.view) {
    RIVER.view.stop();
    RIVER.view.release();
    RIVER.view = null;
  }
}

/* One cast, one word. The catch goes straight into the pool and is carded, so
 * nothing stands between the finger and the result; the note says what
 * happened, including when the word was already there. */
function handleRiverCatch(item) {
  if (!item || !item.term) return;
  RIVER.pending = item.term;
  collectRiverCatch();
}

async function collectRiverCatch() {
  var term = RIVER.pending;
  RIVER.pending = null;
  if (!term) return;
  var result = await state.lex.addToPool({ wordKey: term }, { dictionary: state.dictionary });
  if (result && result.state === 'carded') await state.lex.buildBricks();
  if (RIVER.view) RIVER.view.release();
  var note = el('wbRiverCatch');
  if (note) {
    note.textContent = result && result.state === 'carded'
      ? tText('wb.river.keptOne', { word: term })
      : tText('wb.river.hadOne', { word: term });
    show(note, true);
  }
  await refresh();
  await renderInbox();
}

function toggleRiver() {
  RIVER.paused = !RIVER.paused;
  if (RIVER.view) {
    if (RIVER.paused) RIVER.view.stop();
    else RIVER.view.start();
  }
  var button = el('wbRiverPause');
  if (button) button.textContent = RIVER.paused ? tText('wb.river.resume') : tText('wb.river.pause');
}

/* ------------------------------------------------------------------- view */

/* Two sections, hash-routed. Learn is the doing surface (brick, river,
 * passive); Overview is the lexis (pool, bricks, lexicon, data). The bottom tab
 * bar switches sections; the sub-tabs switch views inside one. */
var VIEWS = {
  brick: { section: 'learn', panel: 'wbReview' },
  river: { section: 'learn', panel: 'wbRiver' },
  passive: { section: 'learn', panel: 'wbDigest' },
  pool: { section: 'overview', panel: 'wbInbox' },
  bricks: { section: 'overview', panel: 'wbBricks' },
  lexicon: { section: 'overview', panel: 'wbBrowse' },
  data: { section: 'overview', panel: 'wbData' }
};

function setView(view) {
  if (!VIEWS[view]) view = 'brick';
  state.view = view;
  Object.keys(VIEWS).forEach(function (key) {
    show(el(VIEWS[key].panel), key === view);
  });
  var tabs = document.querySelectorAll('.wb-tab');
  for (var i = 0; i < tabs.length; i += 1) {
    if (tabs[i].getAttribute('data-view') === view) tabs[i].classList.add('is-active');
    else tabs[i].classList.remove('is-active');
  }
  if (view === 'passive') renderDigest();
  if (view === 'pool') renderInbox();
  if (view === 'bricks') renderBricks();
  if (view === 'lexicon') renderBrowse();
  if (view === 'river') startRiver();
  else stopRiver();
}

/* The hash is the route: #learn or #overview. A section switch lands on that
 * section's first view, so the two never show at once. */
function route() {
  var section = window.location.hash === '#overview' ? 'overview' : 'learn';
  state.section = section;
  var sections = document.querySelectorAll('.wb-section');
  for (var i = 0; i < sections.length; i += 1) {
    show(sections[i], sections[i].getAttribute('data-section') === section);
  }
  var current = VIEWS[state.view];
  if (!current || current.section !== section) {
    setView(section === 'overview' ? 'pool' : 'brick');
  }
}

async function renderBricks() {
  var list = el('wbBricksList');
  if (!list) return;
  var bricks = await state.lex.listBricks();
  if (!bricks.length) {
    list.innerHTML = '<p class="muted mb-0">' + esc(tText('wb.bricks.empty')) + '</p>';
    return;
  }
  list.innerHTML = bricks.map(function (brick) {
    var days = Math.max(0, Math.round(((brick.due || 0) - Date.now()) / 86400000));
    var due = days <= 0 ? tText('overview.dueNow') : tText('overview.dueIn', { n: days });
    return '<article class="wb-inbox-item">' +
      '<div class="wb-inbox-head"><strong>' + esc(brickLabel(brick)) + '</strong>' +
      '<span class="wb-inbox-seen">' + esc(tText('overview.brickSize', { n: brick.size })) + '</span></div>' +
      '<p class="muted small mb-0">' + esc(tText('overview.phase.' + brick.phase)) + ' · ' + esc(due) + '</p>' +
      '<div class="wb-inbox-actions">' +
      '<button class="btn btn-ghost btn-small" type="button" data-brick-dissolve="' + esc(brick.id) + '">' + esc(tText('wb.bricks.dissolve')) + '</button>' +
      '</div></article>';
  }).join('');
}

async function dissolveBrick(id) {
  await state.lex.dissolveBrick(id);
  await refresh();
  await renderBricks();
  await renderInbox();
}

function bind() {
  var tabs = document.querySelectorAll('.wb-tab');
  for (var i = 0; i < tabs.length; i += 1) {
    tabs[i].addEventListener('click', function (event) {
      setView(event.currentTarget.getAttribute('data-view'));
    });
  }
  el('wbCard').addEventListener('click', function () {
    if (state.lookOnly) nextLookOnly();
    else if (!state.flipped) flip();
  });
  el('wbFlip').addEventListener('click', flip);
  el('wbLookOnly').addEventListener('click', toggleLookOnly);
  el('wbNext').addEventListener('click', nextLookOnly);
  el('wbInboxRefresh').addEventListener('click', renderInbox);
  el('wbEnrol').addEventListener('click', enrolCandidates);
  el('wbMineAdd').addEventListener('click', mineAdd);
  el('wbImportRun').addEventListener('click', runImport);
  el('wbFreqRun').addEventListener('click', runFrequency);
  el('wbImportFile').addEventListener('change', function (event) {
    readTextFile(event.target.files && event.target.files[0], function (text) {
      el('wbImportText').value = text;
      runImport();
    });
  });
  el('wbFreqFile').addEventListener('change', function (event) {
    readTextFile(event.target.files && event.target.files[0], function (text) {
      el('wbFreqText').value = text;
      runFrequency();
    });
  });
  el('wbRestoreFile').addEventListener('change', function (event) {
    var file = event.target.files && event.target.files[0];
    if (file) runRestore(file);
  });
  el('wbDictFile').addEventListener('change', function (event) {
    var file = event.target.files && event.target.files[0];
    if (file) importDictionary(file);
  });
  el('wbDictForget').addEventListener('click', forgetDictionaries);
  var gradeButtons = document.querySelectorAll('#wbGrades [data-rating]');
  for (var g = 0; g < gradeButtons.length; g += 1) {
    gradeButtons[g].addEventListener('click', function (event) {
      grade(Number(event.currentTarget.getAttribute('data-rating')));
    });
  }
  document.addEventListener('keydown', function (event) {
    if (state.view !== 'brick') return;
    if (event.code === 'Space') {
      event.preventDefault();
      if (state.lookOnly) nextLookOnly();
      else flip();
      return;
    }
    if (state.flipped && ['1', '2', '3', '4'].indexOf(event.key) >= 0) {
      grade(Number(event.key));
    }
  });
  el('wbDigestRefresh').addEventListener('click', function () {
    state.digestSeen = {};
    renderDigest();
  });
  el('wbSearch').addEventListener('input', function (event) {
    state.browseFilter = event.target.value;
    renderBrowse();
  });
  el('wbExport').addEventListener('click', exportJson);
  el('wbReset').addEventListener('click', resetAll);
  el('wbRiverPause').addEventListener('click', toggleRiver);
  el('wbRiverShuffle').addEventListener('click', startRiver);
  el('wbDigestList').addEventListener('click', function (event) {
    var target = event.target;
    var known = target.getAttribute ? target.getAttribute('data-known') : null;
    if (known) markKnown(known);
  });
  el('wbInboxList').addEventListener('click', function (event) {
    var target = event.target;
    if (!target || !target.getAttribute) return;
    var approve = target.getAttribute('data-approve');
    var reject = target.getAttribute('data-reject');
    if (approve) approveCandidate(approve);
    else if (reject) rejectCandidate(reject);
  });
  el('wbBricksList').addEventListener('click', function (event) {
    var target = event.target;
    var id = target && target.getAttribute ? target.getAttribute('data-brick-dissolve') : null;
    if (id) dissolveBrick(id);
  });
  window.addEventListener('hashchange', route);
}

async function init() {
  try {
    /* Load the shared dictionary module with no bundled packs: there is no
     * pack host in this repository. A Yomitan dictionary that the learner
     * imported earlier is restored from IndexedDB, and definitions come from
     * it the moment it is available. */
    state.dictionary = await loadDictionary({ packs: [] });
    await restoreDictionaries();
    await refreshDictionary();

    var db = await openDb();
    state.lex = new Lexicon(db);
    await state.lex.seedFromLegacy(window.ML_DATA ? window.ML_DATA.vocab : [], SEED_DEFS);
    await state.lex.enrichFromDictionary(state.dictionary);
    await refresh();
    var activeTab = document.querySelector('.wb-tab.is-active');
    state.view = activeTab ? activeTab.getAttribute('data-view') : 'brick';
    await startReview();
    bind();
    route();
  } catch (err) {
    var main = document.querySelector('main');
    if (main) {
      main.insertAdjacentHTML('afterbegin', '<div class="container"><p class="pill pill-warn">Wordbook failed to start: ' + esc(err && err.message ? err.message : err) + '</p></div>');
    }
  }
}

init();