/* Wordbook UI controller.
 *
 * A thin layer over Lexicon: it never talks to IndexedDB directly. The review
 * view uses FSRS; the passive view only records exposures. Keeping that split
 * visible in the code is the point.
 */

import { openDb } from './db.js';
import { loadDictionary } from './dictionary.js';
import { createRiver } from './river.js';
import { Lexicon, SETTINGS } from './store.js';
import { SEED_DEFS } from './seed-ja.js';
import { schedule } from './srs.js';
import { isOutputMode } from './schema.js';

var state = {
  lex: null,
  view: 'review',
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
  lookOnly: false
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
  'wb.match.diff': 'You wrote {a}; the word is {b}.'
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

async function startReview() {
  var queue = await state.lex.queue(Date.now(), SETTINGS.newPerSession);
  state.queue = queue.due.concat(queue.fresh);
  state.index = 0;
  state.flipped = false;
  renderCard();
}

function flip() {
  if (state.view !== 'review' || !currentCard() || state.lookOnly) return;
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
  state.index += 1;
  state.flipped = false;
  await refresh();
  renderCard();
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
  var result = await state.lex.importText(text, { source: { kind: 'paste' } });
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
  await state.lex.seedFromLegacy(window.ML_DATA ? window.ML_DATA.vocab : [], SEED_DEFS);
  await refresh();
  await startReview();
  await renderInbox();
}

/* ------------------------------------------------------------------ river
 * A random, context-free stream. It never writes to FSRS; each word that
 * reaches the middle only records an exposure, so the passive familiarity
 * model learns from it like any other passive channel.
 */

var RIVER = { window: 5, itemHeight: 92, dwell: 2800, timer: null, feed: null, paused: false, items: [] };

function riverPool() {
  var pool = [];
  Object.keys(state.senseById).forEach(function (id) {
    var sense = state.senseById[id];
    var word = state.wordById[sense.wordId];
    if (word) pool.push({ sense: sense, word: word });
  });
  return pool;
}

function riverItemHtml(item, current) {
  var definition = (item.sense.definition && item.sense.definition.text) || '';
  return '<div class="wb-river-item' + (current ? ' is-current' : '') + '">' +
    '<p class="wb-river-term">' + esc(item.word.lemma) + '</p>' +
    '<p class="wb-river-reading">' + esc(item.word.reading || '') + '</p>' +
    '<p class="wb-river-definition">' + esc(definition) + '</p>' +
    '</div>';
}

function exposeRiver(index) {
  var item = RIVER.items[index];
  if (!item || !state.lex) return;
  var result = state.lex.recordExposure(item.sense.id, 'river', Date.now());
  if (result && result.catch) result.catch(function () { /* best effort */ });
}

function highlightRiverCenter() {
  var track = el('wbRiverTrack');
  if (!track) return;
  var nodes = track.children;
  var center = Math.floor(nodes.length / 2);
  for (var i = 0; i < nodes.length; i += 1) {
    if (i === center) nodes[i].classList.add('is-current');
    else nodes[i].classList.remove('is-current');
  }
  exposeRiver(center);
}

function startRiver() {
  stopRiver();
  var track = el('wbRiverTrack');
  if (!track) return;
  var pool = riverPool();
  if (!pool.length) {
    track.style.transform = 'translateY(0)';
    track.innerHTML = '<p class="muted" style="padding:24px;">' + esc(tText('wb.river.empty')) + '</p>';
    return;
  }
  RIVER.feed = createRiver(pool, { random: Math.random });
  RIVER.items = [];
  RIVER.paused = false;
  var center = Math.floor(RIVER.window / 2);
  var html = '';
  for (var i = 0; i < RIVER.window; i += 1) {
    var item = RIVER.feed.next();
    RIVER.items.push(item);
    html += riverItemHtml(item, i === center);
  }
  track.style.transition = 'none';
  track.style.transform = 'translateY(0)';
  track.innerHTML = html;
  exposeRiver(center);
  RIVER.timer = window.setInterval(riverStep, RIVER.dwell);
}

function riverStep() {
  if (RIVER.paused || document.hidden) return;
  var track = el('wbRiverTrack');
  if (!track || !RIVER.feed) return;

  function shift() {
    if (!RIVER.feed) return;
    var item = RIVER.feed.next();
    RIVER.items.shift();
    RIVER.items.push(item);
    if (track.firstChild) track.removeChild(track.firstChild);
    track.insertAdjacentHTML('beforeend', riverItemHtml(item, false));
    track.style.transition = 'none';
    track.style.transform = 'translateY(0)';
    highlightRiverCenter();
  }

  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) { shift(); return; }
  track.style.transition = 'transform 0.5s ease';
  track.style.transform = 'translateY(-' + RIVER.itemHeight + 'px)';
  window.setTimeout(shift, 520);
}

function stopRiver() {
  if (RIVER.timer) {
    window.clearInterval(RIVER.timer);
    RIVER.timer = null;
  }
  RIVER.feed = null;
  RIVER.items = [];
}

function toggleRiver() {
  RIVER.paused = !RIVER.paused;
  var button = el('wbRiverPause');
  if (button) button.textContent = RIVER.paused ? tText('wb.river.resume') : tText('wb.river.pause');
}

/* ------------------------------------------------------------------- view */

function setView(view) {
  state.view = view;
  var views = { review: 'wbReview', digest: 'wbDigest', river: 'wbRiver', inbox: 'wbInbox', browse: 'wbBrowse' };
  Object.keys(views).forEach(function (key) {
    show(el(views[key]), key === view);
  });
  var tabs = document.querySelectorAll('.wb-tab');
  for (var i = 0; i < tabs.length; i += 1) {
    if (tabs[i].getAttribute('data-view') === view) tabs[i].classList.add('is-active');
    else tabs[i].classList.remove('is-active');
  }
  if (view === 'digest') renderDigest();
  if (view === 'inbox') renderInbox();
  if (view === 'browse') renderBrowse();
  if (view === 'river') startRiver();
  else stopRiver();
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
  var gradeButtons = document.querySelectorAll('#wbGrades [data-rating]');
  for (var g = 0; g < gradeButtons.length; g += 1) {
    gradeButtons[g].addEventListener('click', function (event) {
      grade(Number(event.currentTarget.getAttribute('data-rating')));
    });
  }
  document.addEventListener('keydown', function (event) {
    if (state.view !== 'review') return;
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
}

async function init() {
  try {
    /* Load the shared dictionary module with no bundled packs: there is no
     * pack host in this repository, and definitions still come from the seed
     * until a Yomitan dictionary is imported in a later phase. This keeps the
     * seam warm without any network access. */
    state.dictionary = await loadDictionary({ packs: [] });
    var dictNotice = el('wbDictNotice');
    if (dictNotice) {
      dictNotice.textContent = tText('wb.dictMissing');
      show(dictNotice, true);
    }
    var db = await openDb();
    state.lex = new Lexicon(db);
    await state.lex.seedFromLegacy(window.ML_DATA ? window.ML_DATA.vocab : [], SEED_DEFS);
    await refresh();
    await startReview();
    bind();
  } catch (err) {
    var main = document.querySelector('main');
    if (main) {
      main.insertAdjacentHTML('afterbegin', '<div class="container"><p class="pill pill-warn">Wordbook failed to start: ' + esc(err && err.message ? err.message : err) + '</p></div>');
    }
  }
}

init();