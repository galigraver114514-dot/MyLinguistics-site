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
import { formBricks, modesForKinds, BRICK_SIZE } from './brick.js';
import { POOL_EVENT, push as pushPoolLog, list as readPoolLog } from './pool-log.js';
import { record as recordLookup, list as readLookupLog } from './lookup-log.js';
import { relativeTime } from './rel-time.js';
import {
  sourceTitle, languageBadge, hiddenFrom, hiddenTo, toggleHidden, visibleGroups,
  entryHeadline, entryChips, senseBlocks, firstGloss, formatBytes, creditLine
} from './dict-view.js';

/* The four 語彙 destinations and 海's three parts. One hash drives both the
 * panel and the capsule's active pill (see ROUTES below). */
var state = {
  lex: null,
  view: 'wall',
  scope: 'words',
  entryKey: null,
  poolFilter: 'waiting',
  pickMode: 'auto',
  pickedMap: {},
  setKeys: [],
  setPos: null,
  setKinds: { recognize: true, produce: true },
  setDue: 0,
  setName: null,
  wordByLemma: {},
  posByLemma: {},
  encounterByKey: {},
  waiting: [],
  bricks: [],
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
  'wb.known': 'Already know it',
  'wb.empty.browse': 'No match.',
  'wall.grab': 'Take the next brick from the sea',
  'wall.reviewNow': 'Review this tier',
  'wall.items': '{n} bricks',
  'wall.tiers': '{n} tiers',
  'wall.empty': 'The wall is empty. Take a brick from the sea.',
  'pool.lede': '{n} words waiting for a brick.',
  'pool.pick.note': 'Ten words to a brick.',
  'pool.built': 'Built {name} from {n} words.',
  'entry.empty': 'Pick a word from the list.',
  'dict.empty': 'Look a word up to see its entries.',
  'dict.searching': 'Looking it up...',
  'dict.history': 'Looked up',
  'time.now': 'just now',
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
  var node = el('wbDataDictResult');
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
  await renderSources();
  await renderDict();
}

async function forgetDictionaries() {
  var dict = state.dictionary;
  if (!dict || typeof dict.removeSource !== 'function' || typeof dict.sources !== 'function') return;
  var loaded = dict.sources() || [];
  for (var i = 0; i < loaded.length; i += 1) {
    if (loaded[i].kind !== 'yomitan') continue;
    try { await dict.removeSource(loaded[i].id); } catch (err) { /* ignore */ }
  }
  var node = el('wbDataDictResult');
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
  var pool = await state.lex.listPool();
  state.wordById = {};
  state.senseById = {};
  state.cardsBySense = {};
  state.wordByLemma = {};
  state.posByLemma = {};
  state.encounterByKey = {};
  words.forEach(function (word) {
    state.wordById[word.id] = word;
    state.wordByLemma[word.lemma] = word;
  });
  senses.forEach(function (sense) { state.senseById[sense.id] = sense; });
  cards.forEach(function (card) {
    if (!state.cardsBySense[card.senseId]) state.cardsBySense[card.senseId] = [];
    state.cardsBySense[card.senseId].push(card);
  });
  /* The part of speech a word shows as comes from its own tag, and falls back
   * to the first sense's, because a mined word has no tag of its own. */
  words.forEach(function (word) {
    var tag = word.tag || null;
    if (!tag) {
      var sids = word.senseIds || [];
      for (var i = 0; i < sids.length && !tag; i += 1) {
        var sense = state.senseById[sids[i]];
        if (sense && sense.pos && sense.pos.length) tag = sense.pos[0];
      }
    }
    state.posByLemma[word.lemma] = tag;
  });
  pool.forEach(function (item) { state.encounterByKey[item.wordKey] = item; });
  state.pool = pool;
  state.cardCount = cards.length;
  state.stats = await state.lex.stats();
  renderStats();
  renderSeaStats();
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

/* 既知 - the word leaves the ladder for good. The passive track that used to
 * own this action is gone; the entry card and the 辞書 column call it now. */
async function markKnown(senseIdValue) {
  await state.lex.markKnown(senseIdValue, Date.now());
  await refresh();
  await renderEntry();
}

/* ------------------------------------------------------------------ inbox
 * Two ways in: candidates the miner left behind, and the learner's own
 * capture. Approving is the only action that creates cards; nothing in the
 * inbox is scheduled by FSRS until then.
 */

/* 池 - the packing workshop. The default list is the words waiting for a
 * brick; candidates keep their own list behind the filter, because the design
 * gives them no screen and dropping the approval step is not this commit's
 * call (see the open question in log-wordbook.md). */
async function renderPool() {
  state.pool = await state.lex.listPool();
  state.inbox = await state.lex.listInbox();
  var waiting = state.pool.filter(function (item) { return item.state === 'carded'; });
  state.waiting = waiting;

  var lede = el('wbPoolLede');
  if (lede) lede.textContent = tText('pool.lede', { n: waiting.length });
  var count = el('wbPoolCount');
  if (count) count.textContent = String(waiting.length);
  var brickCount = el('wbBrickCount');
  if (brickCount) brickCount.textContent = tText('wb.inbox.bricks', { n: state.stats ? (state.stats.bricks || 0) : 0 });

  var list = el('wbPoolList');
  if (list) {
    list.innerHTML = waiting.length ? waiting.map(function (item) {
      return '<article class="wb-inbox-item" data-word="' + esc(item.wordKey) + '">' +
        '<div class="wb-inbox-head">' + monogram(item.wordKey) + '<strong>' + esc(item.wordKey) + '</strong>' +
        '<span class="wb-chip">' + esc(tText('sea.state.waiting')) + '</span></div>' +
      '</article>';
    }).join('') : '<p class="muted">' + esc(tText('wb.inbox.empty')) + '</p>';
  }
  renderCandidates();
  renderPoolLog();
  applyPoolFilter();
}

async function renderCandidates() {
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

/* 池の流れ - what happened to the pool recently, and today's net direction. */
function renderPoolLog() {
  var rows = readPoolLog();
  var since = Date.now() - 86400000;
  var delta = 0;
  rows.forEach(function (row) {
    if ((row.at || 0) < since) return;
    if (row.event === POOL_EVENT.toBrick) delta -= (row.size || 0);
    else if (row.event === POOL_EVENT.fromRiver) delta += 1;
  });
  var head = el('wbPoolToday');
  if (head) head.textContent = tText('pool.log.today') + ' +' + Math.max(0, delta) + ' / -' + Math.max(0, -delta);
  var list = el('wbPoolLog');
  if (!list) return;
  list.innerHTML = rows.length ? rows.map(function (row) {
    var title = row.event === POOL_EVENT.fromRiver ? tText('pool.log.fromRiver')
      : row.event === POOL_EVENT.toBrick ? tText('pool.log.toBrick') : tText('pool.log.stayed');
    return '<div class="wb-log-row"><span class="wb-log-time">' + esc(tRel(row.at)) + '</span>' +
      '<span class="wb-log-main"><strong>' + esc(title) + '</strong>' +
      '<span class="muted small">' + esc(row.word || row.name || '') + '</span></span></div>';
  }).join('') : '<p class="muted small">' + esc(tText('pool.pick.empty')) + '</p>';
}

function applyPoolFilter() {
  var buttons = document.querySelectorAll('#wbPoolFilter [data-pool-filter]');
  for (var i = 0; i < buttons.length; i += 1) {
    var on = buttons[i].getAttribute('data-pool-filter') === state.poolFilter;
    buttons[i].classList.toggle('is-active', on);
    buttons[i].setAttribute('aria-selected', on ? 'true' : 'false');
  }
  var pool = el('wbPoolList');
  var inbox = el('wbInboxList');
  if (pool) show(pool, state.poolFilter !== 'candidates');
  if (inbox) show(inbox, state.poolFilter !== 'waiting');
  var build = el('wbPoolBuild');
  if (build) show(build, state.poolFilter !== 'candidates');
  var enrol = el('wbEnrol');
  if (enrol) show(enrol, state.poolFilter === 'candidates');
}

async function approveCandidate(wordKey) {
  var created = await state.lex.approveCandidate(wordKey, { dictionary: state.dictionary });
  var note = el('wbInboxNote');
  if (note && created) {
    note.textContent = tText('wb.inbox.approved', { word: wordKey, n: created.cards.length });
    show(note, true);
  }
  await refresh();
  await renderPool();
}

async function rejectCandidate(wordKey) {
  await state.lex.rejectCandidate(wordKey);
  await renderPool();
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
  await renderPool();
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
  await renderPool();
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
    await renderPool();
  } catch (err) {
    node.textContent = tText('wb.restore.failed');
    show(node, true);
  }
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
  await renderPool();
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
  await renderPool();
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

/* ------------------------------------------------------------------- 語彙 */

/* The six parts of speech the design colours, as token-safe names. */
var POS_GROUP = {
  '動詞': 'verb', '名詞': 'noun', '挨拶': 'greet',
  '副詞': 'adv', '表現': 'expr', '接続詞': 'conj'
};

var STATE_KEY = {
  new: 'sea.state.candidate', inbox: 'sea.state.candidate', carded: 'sea.state.waiting',
  bricked: 'sea.state.bricked', known: 'sea.state.known', dismissed: 'sea.state.ignored'
};

function tRel(ms) {
  var rel = relativeTime(ms, Date.now());
  return tText(rel.key, rel.vars);
}

function posOf(wordKey) {
  return state.posByLemma[wordKey] || null;
}

function groupOf(pos) {
  return (pos && POS_GROUP[pos]) || 'mixed';
}

function monogram(wordKey) {
  var pos = posOf(wordKey) || '';
  return '<span class="wb-monogram" data-pos="' + esc(groupOf(pos)) + '" aria-hidden="true">' + esc(pos.charAt(0)) + '</span>';
}

function stateKeyOf(wordKey) {
  var record = state.encounterByKey[wordKey];
  return STATE_KEY[record ? record.state : 'new'] || STATE_KEY.new;
}

function dueLabel(brick) {
  if (brick.phase === 'retired') return tText('wall.graduated');
  if (!brick.due || brick.phase === 'sealed') return tText('wall.nextNow');
  var days = Math.max(0, Math.round((brick.due - Date.now()) / 86400000));
  return days <= 0 ? tText('wall.nextNow') : tText('wall.nextIn', { n: days });
}

function phaseKey(brick) {
  var phase = brick && brick.phase ? brick.phase : 'sealed';
  return 'wall.state.' + phase;
}

/* Changing the route through the app rather than the address bar, so a button
 * and a pasted link land in the same place. route() is idempotent, so the
 * hashchange that follows a real assignment does not double anything. */
function go(hash) {
  try { window.location.hash = hash; } catch (err) { /* a sandbox without one */ }
  route();
}

/* 壁 - the wall. One row per brick and ten readable cells per row: a colour
 * block nobody can read is not an information carrier. */
async function renderWall() {
  var bricks = await state.lex.listBricks();
  state.bricks = bricks;
  var order = { review: 0, learning: 1, sealed: 2, retired: 3 };
  var sorted = bricks.slice().sort(function (a, b) {
    var oa = order[a.phase] == null ? 9 : order[a.phase];
    var ob = order[b.phase] == null ? 9 : order[b.phase];
    if (oa !== ob) return oa - ob;
    return (a.due || 0) - (b.due || 0);
  });

  var tiers = el('wbWallTiers');
  if (tiers) tiers.textContent = tText('wall.tiers', { n: sorted.length });
  var count = el('wbWallCount');
  if (count) count.textContent = tText('wall.items', { n: sorted.length });

  var grid = el('wbWallGrid');
  if (grid) {
    if (!sorted.length) {
      grid.innerHTML = '<p class="muted">' + esc(tText('wall.empty')) + '</p>';
    } else {
      grid.innerHTML = sorted.map(function (brick) {
        var keys = brick.wordKeys || [];
        var cells = [];
        for (var i = 0; i < Math.max(10, keys.length); i += 1) {
          var key = keys[i];
          if (key) {
            cells.push('<span class="wb-wall-cell" data-word="' + esc(key) + '" data-pos="' + esc(groupOf(posOf(key))) + '">' + esc(key) + '</span>');
          } else {
            cells.push('<span class="wb-wall-cell wb-wall-cell-empty" aria-hidden="true"></span>');
          }
        }
        var active = state.brick && state.brick.id === brick.id ? ' is-active' : '';
        return '<section class="wb-wall-row' + active + '" data-brick="' + esc(brick.id) + '" data-phase="' + esc(brick.phase) + '">' +
          '<header class="wb-wall-head">' +
            '<span class="wb-wall-tab" data-pos="' + esc(groupOf(brick.pos)) + '" aria-hidden="true"></span>' +
            '<strong>' + esc(formatBrickLabel(brick, tText)) + '</strong>' +
            '<span class="muted small">' + esc(tText('overview.brickSize', { n: brick.size })) + '</span>' +
            '<span class="muted small wb-wall-due">' + esc(brick.phase === 'sealed' ? tText('wall.current') : dueLabel(brick)) + '</span>' +
          '</header>' +
          '<div class="wb-wall-cells">' + cells.join('') + '</div>' +
        '</section>';
      }).join('');
    }
  }
  renderWallRail(sorted);

  var reviewNow = el('wbWallReviewNow');
  if (reviewNow) reviewNow.disabled = !state.brick;
}

/* The left column: every brick, with its ten cells at a glance. Each row is
 * also how a specific brick is taken off the wall. */
function renderWallRail(bricks) {
  var list = el('wbWallList');
  if (!list) return;
  if (!bricks.length) { list.innerHTML = ''; return; }
  list.innerHTML = bricks.map(function (brick) {
    var cells = (brick.wordKeys || []).map(function (key) {
      return '<span class="wb-mini-cell" data-pos="' + esc(groupOf(posOf(key))) + '"></span>';
    }).join('');
    var active = state.brick && state.brick.id === brick.id;
    return '<button class="wb-rail-row' + (active ? ' is-active' : '') + '" type="button" data-grab="' + esc(brick.id) + '">' +
      '<span class="wb-mini" data-phase="' + esc(brick.phase) + '">' + cells + '</span>' +
      '<span class="wb-rail-main"><strong>' + esc(formatBrickLabel(brick, tText)) + '</strong>' +
      '<span class="muted small">' + esc(tText(phaseKey(brick))) + ' · ' + esc(dueLabel(brick)) + '</span></span>' +
    '</button>';
  }).join('');
}

/* Take a brick off the wall and start its session. */
async function grabBrick(brickIdValue) {
  var brick = brickIdValue ? await state.lex.getBrick(brickIdValue) : await state.lex.nextBrick(Date.now());
  var note = el('wbPoolNote');
  if (!brick) {
    if (note) { note.textContent = tText('wall.empty'); show(note, true); }
    return;
  }
  state.brick = brick;
  state.queue = await state.lex.brickQueue(brick.id, Date.now());
  state.index = 0;
  state.flipped = false;
  state.brickPaced = false;
  state.brickResult = null;
  state.sessionAgains = 0;
  state.view = 'review';
  renderCard();
  go('#wall/review');
}

/* 海 - the entry card. The board's middle column: what the word is, where it
 * sits on the ladder, the brick it is in, its cards, and where it came from. */
function entrySense(wordKey) {
  var word = state.wordByLemma[wordKey];
  if (!word) return null;
  var sids = word.senseIds || [];
  for (var i = 0; i < sids.length; i += 1) {
    if (state.senseById[sids[i]]) return state.senseById[sids[i]];
  }
  return null;
}

function brickOf(wordKey) {
  for (var i = 0; i < state.bricks.length; i += 1) {
    if ((state.bricks[i].wordKeys || []).indexOf(wordKey) >= 0) return state.bricks[i];
  }
  return null;
}

async function renderEntry() {
  var node = el('wbEntry');
  if (!node) return;
  var key = state.entryKey;
  if (!key || !state.wordByLemma[key]) {
    node.innerHTML = '<p class="muted">' + esc(tText('entry.empty')) + '</p>';
    return;
  }
  var word = state.wordByLemma[key];
  var sense = entrySense(key);
  var definition = sense && sense.definition ? (sense.definition.text || '') : '';
  var record = state.encounterByKey[key] || null;
  var brick = brickOf(key);
  var cards = sense ? (state.cardsBySense[sense.id] || []) : [];

  var html = '<header class="wb-entry-head">' +
    '<h2 class="wb-entry-term">' + esc(word.lemma) + '</h2>' +
    (word.reading ? '<span class="card-reading">' + esc(word.reading) + '</span>' : '') +
    '<span class="wb-chips">' +
      '<span class="wb-chip">' + esc(posOf(key) || '') + '</span>' +
      '<span class="wb-chip">' + esc(tText(stateKeyOf(key))) + '</span>' +
    '</span>' +
  '</header>';
  if (definition) html += '<p class="wb-definition">' + esc(definition) + '</p>';

  var steps = [
    ['sea.state.candidate', 'new'],
    ['sea.state.waiting', 'carded'],
    ['sea.state.bricked', 'bricked']
  ];
  var reached = record ? record.state : 'new';
  var at = { new: 0, inbox: 0, carded: 1, bricked: 2, known: 3, dismissed: 3 }[reached];
  html += '<section class="wb-entry-block"><h3>' + esc(tText('entry.state')) + '</h3><div class="wb-bars">' +
    steps.map(function (step, index) {
      return '<div class="wb-bar-row' + (at != null && index <= at ? ' is-reached' : '') + '">' +
        '<span class="wb-bar-label">' + esc(tText(step[0])) + '</span></div>';
    }).join('') +
  '</div></section>';

  if (brick) {
    html += '<section class="wb-entry-block"><h3>' + esc(tText('entry.brick')) + '</h3>' +
      '<p><strong>' + esc(formatBrickLabel(brick, tText)) + '</strong> ' +
      '<span class="muted small">' + esc(tText('overview.brickSize', { n: brick.size })) + ' · ' + esc(dueLabel(brick)) + '</span>' +
      '<button class="btn btn-ghost btn-small" type="button" data-entry-brick="' + esc(brick.id) + '">' + esc(tText('entry.seeInWall')) + '</button></p></section>';
  }

  if (cards.length) {
    html += '<section class="wb-entry-block"><h3>' + esc(tText('entry.modes')) + '</h3>' +
      cards.map(function (card) {
        var due = card.srs && card.srs.due ? card.srs.due - Date.now() : 0;
        return '<div class="wb-card-row"><span>' + esc(modeLabel(card.mode)) + '</span>' +
          '<span class="muted small">' + esc(formatDue(due)) + '</span></div>';
      }).join('') + '</section>';
  }

  var contexts = record && Array.isArray(record.contexts) ? record.contexts : [];
  if (contexts.length) {
    var context = contexts[0];
    html += '<section class="wb-entry-block"><h3>' + esc(tText('entry.origin')) + '</h3>' +
      '<p class="muted small">' + esc(context.source || '') + ' · ' + esc(tRel(context.ts)) + ' · ' + esc(String(record.count || 0)) + '</p>' +
      (context.ja ? '<p class="card-example">' + esc(context.ja) + '</p>' : '') +
    '</section>';
  }

  html += '<div class="row-actions">' +
    '<button class="btn btn-primary btn-small" type="button" data-entry-review="' + esc(key) + '">' + esc(tText('entry.reviewInWall')) + '</button>' +
    (brick ? '<button class="btn btn-ghost btn-small" type="button" data-entry-return="' + esc(key) + '">' + esc(tText('entry.returnToPool')) + '</button>' : '') +
    (sense ? '<button class="btn btn-ghost btn-small" type="button" data-entry-known="' + esc(sense.id) + '">' + esc(tText('dict.known')) + '</button>' : '') +
  '</div>';
  node.innerHTML = html;
}

/* 海 - 単語総覧. The left list is the learner's own vocabulary, filtered by the
 * search box above it. */
async function renderBrowse() {
  var filter = state.browseFilter.normalize('NFKC').toLowerCase();
  var keys = Object.keys(state.wordByLemma);
  var rows = [];
  keys.forEach(function (key) {
    var word = state.wordByLemma[key];
    var sense = entrySense(key);
    var definition = sense && sense.definition ? (sense.definition.text || '') : '';
    var haystack = (key + ' ' + (word.reading || '') + ' ' + definition).toLowerCase();
    if (filter && haystack.indexOf(filter) < 0) return;
    rows.push('<button class="wb-row" type="button" data-word="' + esc(key) + '"' + (key === state.entryKey ? ' aria-current="true"' : '') + '>' +
      monogram(key) +
      '<span class="wb-row-main"><strong>' + esc(key) + '</strong>' +
      '<span class="muted small">' + esc(definition) + '</span></span>' +
      '<span class="wb-row-meta">' + esc(tText(stateKeyOf(key))) + '</span>' +
    '</button>');
  });
  var body = el('wbBrowseBody');
  if (body) body.innerHTML = rows.length ? rows.join('') : '<p class="muted">' + esc(tText('wb.empty.browse')) + '</p>';
  if (state.entryKey && !state.wordByLemma[state.entryKey]) state.entryKey = null;
  if (!state.entryKey && keys.length) state.entryKey = keys[0];
  await renderEntry();
}

/* 海 - 辞書. One block per dictionary, in lookupGrouped()'s order; the lookup
 * trail beside it is what makes the column a dictionary rather than a list. */
async function renderDict(term) {
  var blocks = el('wbDictBlocks');
  var result = el('wbDictResult');
  if (!blocks) return;
  var query = (term == null ? (el('wbDictSearch') ? el('wbDictSearch').value : '') : term).trim();
  if (result) show(result, false);
  if (!query) {
    blocks.innerHTML = '<p class="muted">' + esc(tText('dict.empty')) + '</p>';
    return;
  }
  var dict = state.dictionary;
  if (!dict || typeof dict.lookupGrouped !== 'function') {
    blocks.innerHTML = '<p class="muted">' + esc(tText('wb.dict.unavailable')) + '</p>';
    return;
  }
  blocks.innerHTML = '<p class="muted">' + esc(tText('dict.searching')) + '</p>';
  var groups = [];
  try { groups = await dict.lookupGrouped(query); } catch (err) { groups = []; }
  var shown = visibleGroups(groups, hiddenFrom(readHidden()));
  if (!shown.length) {
    blocks.innerHTML = '<p class="muted">' + esc(tText('wb.empty.browse')) + '</p>';
    return;
  }
  blocks.innerHTML = shown.map(function (group) {
    var badge = languageBadge(group);
    var head = '<header class="wb-dict-head"><strong>' + esc(sourceTitle(group)) + '</strong>' +
      (badge ? '<span class="wb-chip">' + esc(tText(badge)) + '</span>' : '') +
      '<span class="muted small">' + esc(String(group.entryCount || 0)) + '</span></header>';
    var body = group.entries.map(function (entry) {
      var headline = entryHeadline(entry);
      var first = entry.senses && entry.senses.length ? entry.senses[0] : null;
      var chips = entryChips(entry, first).map(function (chip) {
        return '<span class="wb-chip">' + esc(chip.text || tText(chip.key)) + '</span>';
      }).join('');
      var blocksOfSenses = senseBlocks(entry).map(function (block, index) {
        return '<div class="wb-sense"><span class="wb-sense-no">' + esc(block.numbered ? String(index + 1) : '') + '</span>' +
          '<span class="wb-sense-text">' + block.lines.map(esc).join('<br>') + '</span></div>';
      }).join('');
      return '<article class="wb-dict-entry"><h3 class="wb-entry-term">' + esc(headline.headword) + '</h3>' +
        (headline.reading ? '<span class="card-reading">' + esc(headline.reading) + '</span>' : '') +
        '<span class="wb-chips">' + chips + '</span>' + blocksOfSenses + '</article>';
    }).join('');
    return '<section class="wb-dict-block" data-dict="' + esc(group.id) + '">' + head + body +
      '<p class="muted small">' + esc(creditLine(group)) + '</p></section>';
  }).join('');
  state.dictGroups = shown;
  renderDictHistory();
  await renderSources();
}

function readHidden() {
  try { return JSON.parse(window.localStorage.getItem('ml.dictHidden') || '[]'); } catch (err) { return []; }
}

function writeHidden(list) {
  try { window.localStorage.setItem('ml.dictHidden', JSON.stringify(list)); } catch (err) { /* full or blocked */ }
}

/* 出典 - every loaded dictionary, in the order lookupGrouped() reads them, with
 * the eye that hides one. Hiding is a display choice: the lookup still happens,
 * and the trail and the state panel do not depend on what is on screen. */
async function renderSources() {
  var list = el('wbSourcesList');
  var dict = state.dictionary;
  var loaded = (dict && typeof dict.sources === 'function') ? (dict.sources() || []) : [];
  var hidden = hiddenFrom(readHidden());
  if (list) {
    list.innerHTML = loaded.length ? loaded.map(function (info) {
      var badge = languageBadge(info);
      var off = !!hidden[info.id];
      return '<div class="wb-source-row" data-source="' + esc(info.id) + '">' +
        '<span class="wb-source-main"><strong>' + esc(sourceTitle(info)) + '</strong>' +
        (badge ? '<span class="wb-chip">' + esc(tText(badge)) + '</span>' : '') +
        '<span class="muted small">' + esc(String(info.entryCount || 0)) + '</span></span>' +
        '<button class="btn btn-ghost btn-small" type="button" data-source-toggle="' + esc(info.id) + '" aria-pressed="' + (off ? 'false' : 'true') + '">' +
          esc(off ? tText('dict.show') : tText('dict.hide')) + '</button>' +
        '<span class="muted small wb-source-credit">' + esc(creditLine(info)) + '</span>' +
      '</div>';
    }).join('') : '<p class="muted small">' + esc(tText('dict.empty')) + '</p>';
  }
  var usage = el('wbSourceUsage');
  if (usage) {
    if (dict && typeof dict.usage === 'function') {
      try {
        var value = await dict.usage();
        usage.textContent = tText('dict.usage') + ' ' + formatBytes(value && value.bytes) + ' / ' + formatBytes(value && value.quota);
      } catch (err) {
        usage.textContent = '';
      }
    } else {
      usage.textContent = '';
    }
  }
}

async function toggleSource(id) {
  var next = toggleHidden(hiddenFrom(readHidden()), id);
  writeHidden(hiddenTo(next));
  await renderSources();
  await renderDict();
}

function renderDictHistory() {
  var list = el('wbDictHistory');
  if (!list) return;
  var rows = readLookupLog();
  list.innerHTML = rows.length ? rows.map(function (row) {
    return '<button class="wb-row" type="button" data-dict-term="' + esc(row.term) + '">' +
      monogram(row.term) +
      '<span class="wb-row-main"><strong>' + esc(row.term) + '</strong>' +
      '<span class="muted small">' + esc(row.gloss || row.reading || '') + '</span></span>' +
      '<span class="wb-row-meta">' + esc(tRel(row.at)) + '</span>' +
    '</button>';
  }).join('') : '<p class="muted small">' + esc(tText('dict.empty')) + '</p>';
}

/* 海 - the right column's counts and the state ladder. */
function renderBreakdown(node, rows) {
  if (!node) return;
  var max = 1;
  rows.forEach(function (row) { if (row[1] > max) max = row[1]; });
  node.innerHTML = rows.map(function (row) {
    return '<div class="wb-bar-row"><span class="wb-bar-label">' + esc(row[0]) + '</span>' +
      '<span class="wb-bar" data-pos="' + esc(row[3] || 'mixed') + '"><span style="width:' + esc(String(Math.round((row[1] / max) * 100))) + '%"></span></span>' +
      '<span class="wb-bar-value">' + esc(String(row[1])) + '</span></div>';
  }).join('');
}

function renderSeaStats() {
  var s = state.stats || {};
  var cells = [
    [tText('sea.stats.keys'), state.dictCount || 0],
    [tText('sea.stats.mine'), s.words || 0],
    [tText('sea.stats.cards'), state.cardCount || 0],
    [tText('sea.stats.bricks'), s.bricks || 0]
  ];
  var stats = el('wbSeaStats');
  if (stats) {
    stats.innerHTML = cells.map(function (cell) {
      return '<div class="wb-stat"><span>' + esc(cell[0]) + '</span><strong>' + esc(cell[1]) + '</strong></div>';
    }).join('');
  }
  var byState = {};
  (state.pool || []).forEach(function (item) {
    byState[item.state] = (byState[item.state] || 0) + 1;
  });
  renderBreakdown(el('wbSeaBreakdown'), [
    [tText('sea.state.candidate'), (state.inbox || []).length, null, 'mixed'],
    [tText('sea.state.waiting'), byState.carded || 0, null, 'verb'],
    [tText('sea.state.bricked'), byState.bricked || 0, null, 'noun'],
    [tText('sea.state.known'), byState.known || 0, null, 'mixed'],
    [tText('sea.state.ignored'), byState.dismissed || 0, null, 'mixed']
  ].map(function (row) { return [row[0], row[1], null, row[3]]; }));
}

/* ------------------------------------------------------------------- view */

/* The route is the view, and 海's three parts are in the route too, so a link
 * to the dictionary and a tap on the dictionary segment land in the same place,
 * and a refresh no longer forgets where the learner was.
 *
 *   #wall   #wall/review   #river   #pool
 *   #sea    #sea/bricks    #sea/dict
 */
var VIEWS = {
  wall: { panel: 'wbWall' },
  review: { panel: 'wbReview' },
  river: { panel: 'wbRiver' },
  pool: { panel: 'wbPool' },
  words: { panel: 'wbSea', scope: 'words' },
  bricks: { panel: 'wbSea', scope: 'bricks' },
  dict: { panel: 'wbSea', scope: 'dict' },
  data: { panel: 'wbData' }
};

var ROUTES = {
  '#wall': 'wall',
  '#wall/review': 'review',
  '#river': 'river',
  '#pool': 'pool',
  '#sea': 'words',
  '#sea/bricks': 'bricks',
  '#sea/dict': 'dict',
  '#data': 'data'
};

/* Which capsule sub-item owns a view. 壁's drill and the settings sheet have no
 * destination of their own. */
var CAPSULE_VIEW = {
  wall: 'wall', review: 'wall', river: 'river', pool: 'pool',
  words: 'sea', bricks: 'sea', dict: 'sea', data: 'pool'
};

function routeView(hash) {
  return ROUTES[hash] || 'wall';
}

function scopeHash(scope) {
  if (scope === 'bricks') return '#sea/bricks';
  if (scope === 'dict') return '#sea/dict';
  return '#sea';
}

/* The capsule is static markup on every page; this only says which item is the
 * current one. The wordbook does it here because only it knows the sub-route. */
function markCapsule(view) {
  var key = CAPSULE_VIEW[view] || 'wall';
  var subs = document.querySelectorAll('.tabbar-sub[data-view]');
  for (var i = 0; i < subs.length; i += 1) {
    var on = subs[i].getAttribute('data-view') === key;
    subs[i].classList.toggle('is-active', on);
    if (on) subs[i].setAttribute('aria-current', 'page');
    else subs[i].removeAttribute('aria-current');
  }
  var tops = document.querySelectorAll('.tabbar-item[data-tab]');
  for (var j = 0; j < tops.length; j += 1) {
    var here = tops[j].getAttribute('data-tab') === 'vocab';
    tops[j].classList.toggle('is-active', here);
    if (here) tops[j].setAttribute('aria-current', 'page');
  }
}

function markSeaScope(scope) {
  state.scope = scope;
  var segments = document.querySelectorAll('#wbSeaSeg [data-scope]');
  for (var i = 0; i < segments.length; i += 1) {
    var on = segments[i].getAttribute('data-scope') === scope;
    segments[i].classList.toggle('is-active', on);
    segments[i].setAttribute('aria-selected', on ? 'true' : 'false');
  }
  var blocks = document.querySelectorAll('#wbSea [data-scope-block]');
  for (var j = 0; j < blocks.length; j += 1) {
    show(blocks[j], blocks[j].getAttribute('data-scope-block') === scope);
  }
}

function setView(view) {
  if (!VIEWS[view]) view = 'wall';
  state.view = view;
  var panel = VIEWS[view].panel;
  Object.keys(VIEWS).forEach(function (key) {
    show(el(VIEWS[key].panel), VIEWS[key].panel === panel);
  });
  if (VIEWS[view].scope) markSeaScope(VIEWS[view].scope);
  markCapsule(view);

  if (view === 'wall') renderWall();
  if (view === 'review') renderCard();
  if (view === 'pool') renderPool();
  if (view === 'words') renderBrowse();
  if (view === 'bricks') renderBricks();
  if (view === 'dict') renderDict();
  if (view === 'river') startRiver();
  else stopRiver();
}

function route() {
  setView(routeView(window.location.hash));
}

async function renderBricks() {
  var bricks = await state.lex.listBricks();
  state.bricks = bricks;
  var note = el('wbBricksNote');
  if (note) note.textContent = tText('sea.bricks.lede', { n: bricks.length });

  var list = el('wbBricksList');
  if (list) {
    list.innerHTML = bricks.length ? bricks.map(function (brick) {
      var words = (brick.wordKeys || []).map(function (key) {
        return '<span class="wb-brick-word" data-pos="' + esc(groupOf(posOf(key))) + '">' + esc(key) + '</span>';
      }).join('');
      return '<article class="wb-inbox-item" data-brick="' + esc(brick.id) + '">' +
        '<div class="wb-inbox-head"><strong>' + esc(brickLabel(brick)) + '</strong>' +
        '<span class="wb-inbox-seen">' + esc(tText('overview.brickSize', { n: brick.size })) + '</span>' +
        '<span class="muted small">' + esc(tText(phaseKey(brick))) + ' · ' + esc(dueLabel(brick)) + '</span></div>' +
        '<p class="wb-brick-words">' + words + '</p>' +
        '<div class="wb-inbox-actions">' +
        '<button class="btn btn-primary btn-small" type="button" data-grab-brick="' + esc(brick.id) + '">' + esc(tText('sea.bricks.grab')) + '</button>' +
        '<button class="btn btn-ghost btn-small" type="button" data-brick-dissolve="' + esc(brick.id) + '">' + esc(tText('wb.bricks.dissolve')) + '</button>' +
        '</div></article>';
    }).join('') : '<p class="muted mb-0">' + esc(tText('wb.bricks.empty')) + '</p>';
  }

  var grid = el('wbBricksGrid');
  if (grid) {
    grid.innerHTML = bricks.map(function (brick) {
      var cells = (brick.wordKeys || []).map(function (key) {
        return '<span class="wb-mini-cell" data-pos="' + esc(groupOf(posOf(key))) + '"></span>';
      }).join('');
      return '<div class="wb-mini-row" data-phase="' + esc(brick.phase) + '" aria-hidden="true">' + cells + '</div>';
    }).join('');
  }
}

/* 池へ戻す - one word leaves its brick; the cards and the schedule stay. */
async function returnFromBrick(wordKey) {
  if (!brickOf(wordKey)) return;
  await state.lex.removeFromBrick(wordKey);
  await refresh();
  await renderWall();
  await renderBricks();
  await renderEntry();
}

/* ---------------------------------------------------------------- the sheets
 * 池 packs in two floating sheets over the pool, never on a screen of its own:
 * 選ぶ says which words, 設定 says how. The engine has taken a hand-picked
 * selection and a settings object since P0, so these two are the only place
 * they meet. */

function closeSheets() {
  show(el('wbPickSheet'), false);
  show(el('wbSetSheet'), false);
  var backdrop = el('wbSheetBackdrop');
  if (backdrop) show(backdrop, false);
}

function openSheet(id) {
  var backdrop = el('wbSheetBackdrop');
  if (backdrop) show(backdrop, true);
  show(el(id), true);
}

/* 自動で組む means "the next ten the greedy rule would take", so it asks the
 * packer rather than inventing a second order; 手で選ぶ starts empty. */
function defaultPick() {
  var drafts = formBricks(state.waiting || [], { size: BRICK_SIZE, partial: false });
  if (drafts.length) return drafts[0].entries.map(function (entry) { return entry.wordKey; });
  return (state.waiting || []).slice(0, BRICK_SIZE).map(function (item) { return item.wordKey; });
}

function pickedKeys() {
  return (state.waiting || []).map(function (item) { return item.wordKey; })
    .filter(function (key) { return state.pickedMap[key]; });
}

/* The part of speech a hand-picked brick is offered as: shared when every word
 * agrees, empty when they do not. */
function sharedPos(keys) {
  var pos = null;
  for (var i = 0; i < keys.length; i += 1) {
    var one = posOf(keys[i]);
    if (!one) return '';
    if (pos === null) pos = one;
    else if (pos !== one) return '';
  }
  return pos || '';
}

function openPickSheet(mode) {
  state.pickMode = mode || 'auto';
  state.pickedMap = {};
  var initial = state.pickMode === 'auto' ? defaultPick() : [];
  initial.forEach(function (key) { state.pickedMap[key] = true; });
  renderPickSheet();
  openSheet('wbPickSheet');
}

/* Switching between 自動で組む and 手で選ぶ resets the list: the automatic
 * choice is not something to hand-edit, and an empty manual list is the point
 * of choosing by hand. */
function setPickMode(mode) {
  state.pickMode = mode === 'manual' ? 'manual' : 'auto';
  state.pickedMap = {};
  if (state.pickMode === 'auto') {
    defaultPick().forEach(function (key) { state.pickedMap[key] = true; });
  }
  renderPickSheet();
}

function renderPickSheet() {
  var pick = el('wbPickSheet');
  if (!pick) return;
  var buttons = pick.querySelectorAll('#wbPickMode [data-pick-mode]');
  for (var i = 0; i < buttons.length; i += 1) {
    var on = buttons[i].getAttribute('data-pick-mode') === state.pickMode;
    buttons[i].classList.toggle('is-active', on);
    buttons[i].setAttribute('aria-selected', on ? 'true' : 'false');
  }

  var list = el('wbPickList');
  var waiting = state.waiting || [];
  if (list) {
    list.innerHTML = waiting.length ? waiting.map(function (item) {
      var checked = state.pickedMap[item.wordKey] ? ' checked' : '';
      return '<label class="wb-pick-row">' +
        '<input type="checkbox" data-pick="' + esc(item.wordKey) + '"' + checked + '>' +
        monogram(item.wordKey) +
        '<span class="wb-pick-word">' + esc(item.wordKey) + '</span>' +
        '<span class="wb-chip">' + esc(posOf(item.wordKey) || '') + '</span>' +
      '</label>';
    }).join('') : '<p class="muted">' + esc(tText('pool.pick.empty')) + '</p>';
  }

  var count = pickedKeys().length;
  var countNode = el('wbPickCount');
  if (countNode) countNode.textContent = tText('pool.pick.count', { n: count, total: waiting.length });
  var posNode = el('wbPickPos');
  var pos = sharedPos(pickedKeys());
  if (posNode) posNode.textContent = pos ? tText('pool.pick.pos', { pos: pos }) : '';
  var next = el('wbPickNext');
  if (next) next.disabled = count === 0;
}

/* Ten words is what a brick is, so the eleventh box is refused rather than
 * silently dropped when the packer caps the draft. */
function togglePick(wordKey, on) {
  if (on && pickedKeys().length >= BRICK_SIZE) {
    renderPickSheet();
    return false;
  }
  if (on) state.pickedMap[wordKey] = true;
  else delete state.pickedMap[wordKey];
  renderPickSheet();
  return true;
}

var ALL_POS = ['動詞', '名詞', '挨拶', '副詞', '表現', '接続詞'];

function defaultBrickName(keys) {
  var pos = state.setPos || sharedPos(keys);
  var group = pos ? { kind: 'pos', value: pos } : { kind: 'mixed', value: '' };
  return formatBrickLabel({ id: 'brick:x-' + ((state.bricks || []).length + 1), group: group }, tText);
}

function openSetSheet() {
  var keys = pickedKeys();
  if (!keys.length) return;
  state.setKeys = keys;
  state.setPos = sharedPos(keys) || null;
  state.setKinds = { recognize: true, produce: true };
  state.setDue = 0;
  state.setName = null;
  renderSetSheet();
  show(el('wbPickSheet'), false);
  openSheet('wbSetSheet');
}

function renderSetSheet() {
  var body = el('wbSetBody');
  if (!body) return;
  var kinds = state.setKinds;
  body.innerHTML =
    '<label class="wb-field wb-field-wide"><span>' + esc(tText('pool.set.name')) + '</span>' +
      '<input id="wbSetName" type="text" autocomplete="off" value="' + esc(state.setName || defaultBrickName(state.setKeys)) + '"></label>' +
    '<p class="muted small">' + esc(tText('pool.set.pos')) + ' ・ ' + esc(tText('pool.set.autoFromPick')) + '</p>' +
    '<div class="wb-segmented wb-segmented-chips" id="wbSetPos" role="tablist">' + ALL_POS.map(function (pos) {
      return '<button class="wb-seg' + (pos === state.setPos ? ' is-active' : '') + '" type="button" data-set-pos="' + esc(pos) + '">' + esc(pos) + '</button>';
    }).join('') + '</div>' +
    '<div class="wb-set-row"><span>' + esc(tText('pool.set.size')) + '</span>' +
      '<strong>' + esc(tText('overview.brickSize', { n: BRICK_SIZE })) + '</strong>' +
      '<span class="muted small">' + esc(tText('pool.set.sizeFixed')) + '</span></div>' +
    '<p class="muted small">' + esc(tText('pool.set.modes')) + '</p>' +
    '<div class="wb-segmented wb-segmented-chips" id="wbSetModes">' +
      '<label class="wb-pick-row"><input type="checkbox" data-set-mode="recognize"' + (kinds.recognize ? ' checked' : '') + '>' +
        '<span class="wb-pick-word">' + esc(tText('pool.mode.recognize')) + '</span></label>' +
      '<label class="wb-pick-row"><input type="checkbox" data-set-mode="produce"' + (kinds.produce ? ' checked' : '') + '>' +
        '<span class="wb-pick-word">' + esc(tText('pool.mode.produce')) + '</span></label>' +
    '</div>' +
    '<p class="muted small">' + esc(tText('pool.set.first')) + '</p>' +
    '<div class="wb-segmented wb-segmented-chips" id="wbSetDue" role="tablist">' +
      [['0', 'pool.due.today'], ['1', 'pool.due.tomorrow'], ['3', 'pool.due.in3']].map(function (pair) {
        var on = String(state.setDue) === pair[0];
        return '<button class="wb-seg' + (on ? ' is-active' : '') + '" type="button" data-set-due="' + pair[0] + '" aria-selected="' + (on ? 'true' : 'false') + '">' + esc(tText(pair[1])) + '</button>';
      }).join('') + '</div>';
  renderSetSummary();
}

function renderSetSummary() {
  var node = el('wbSetSummary');
  if (!node) return;
  var labels = [];
  if (state.setKinds.recognize) labels.push(tText('pool.mode.recognize'));
  if (state.setKinds.produce) labels.push(tText('pool.mode.produce'));
  var modes = labels.length === 2 ? tText('pool.summary.both') : (labels[0] || '');
  var dueKey = state.setDue === 1 ? 'pool.due.tomorrow' : (state.setDue === 3 ? 'pool.due.in3' : 'pool.due.today');
  var nameNode = el('wbSetName');
  node.textContent = tText('pool.summary.line', {
    name: (nameNode && nameNode.value) || state.setName || defaultBrickName(state.setKeys),
    size: BRICK_SIZE,
    modes: modes,
    due: tText(dueKey)
  });
}

async function createBrickFromSheet() {
  var keys = (state.setKeys || []).slice();
  if (!keys.length) return;
  var nameNode = el('wbSetName');
  var name = (nameNode && nameNode.value.trim()) || defaultBrickName(keys);
  var modes = modesForKinds(Object.keys(state.setKinds).filter(function (kind) { return state.setKinds[kind]; }));
  var built = await state.lex.buildBricks({
    selection: keys,
    name: name,
    pos: state.setPos,
    modes: modes,
    firstDueDays: state.setDue
  });
  closeSheets();
  pushPoolLog({ event: POOL_EVENT.toBrick, name: name, size: keys.length, at: Date.now() });
  /* The brick the learner just built is the one they mean to study, so it
   * becomes the current brick: 壁's 復習 has something to take. */
  if (built.length) {
    state.brick = built[0];
    state.queue = await state.lex.brickQueue(built[0].id, Date.now());
    state.index = 0;
    state.flipped = false;
    state.brickPaced = false;
    state.brickResult = null;
    state.sessionAgains = 0;
  }
  var note = el('wbPoolNote');
  if (note) {
    note.textContent = built.length ? tText('pool.built', { name: name, n: keys.length }) : tText('pool.pick.empty');
    show(note, true);
  }
  await refresh();
  await renderPool();
  await renderWall();
  await renderBricks();
}

async function dissolveBrick(id) {
  await state.lex.dissolveBrick(id);
  await refresh();
  await renderBricks();
  await renderPool();
}

function bind() {
  var seaSegments = document.querySelectorAll('#wbSeaSeg [data-scope]');
  for (var s = 0; s < seaSegments.length; s += 1) {
    seaSegments[s].addEventListener('click', function (event) {
      go(scopeHash(event.currentTarget.getAttribute('data-scope')));
    });
  }
  var poolFilters = document.querySelectorAll('#wbPoolFilter [data-pool-filter]');
  for (var f = 0; f < poolFilters.length; f += 1) {
    poolFilters[f].addEventListener('click', function (event) {
      state.poolFilter = event.currentTarget.getAttribute('data-pool-filter');
      applyPoolFilter();
    });
  }
  el('wbWallGrab').addEventListener('click', function () { grabBrick(null); });
  el('wbWallReviewNow').addEventListener('click', function () {
    grabBrick(state.brick ? state.brick.id : null);
  });
  el('wbWallList').addEventListener('click', function (event) {
    var target = event.target;
    var id = target && target.getAttribute ? target.getAttribute('data-grab') : null;
    if (id) grabBrick(id);
  });
  el('wbPoolBuild').addEventListener('click', function () { openPickSheet('auto'); });
  var pickModes = document.querySelectorAll('#wbPickMode [data-pick-mode]');
  for (var m = 0; m < pickModes.length; m += 1) {
    pickModes[m].addEventListener('click', function (event) {
      setPickMode(event.currentTarget.getAttribute('data-pick-mode'));
    });
  }
  el('wbPickList').addEventListener('change', function (event) {
    var target = event.target;
    if (!target || !target.getAttribute) return;
    var key = target.getAttribute('data-pick');
    if (key) togglePick(key, !!target.checked);
  });
  el('wbPickNext').addEventListener('click', openSetSheet);
  el('wbPickBack').addEventListener('click', closeSheets);
  el('wbPickClose').addEventListener('click', closeSheets);
  el('wbSetClose').addEventListener('click', closeSheets);
  el('wbSetBack').addEventListener('click', function () {
    show(el('wbSetSheet'), false);
    openSheet('wbPickSheet');
  });
  el('wbSheetBackdrop').addEventListener('click', closeSheets);
  el('wbSetBody').addEventListener('click', function (event) {
    var target = event.target;
    if (!target || !target.getAttribute) return;
    var pos = target.getAttribute('data-set-pos');
    var due = target.getAttribute('data-set-due');
    if (pos) {
      state.setPos = pos;
      renderSetSheet();
    } else if (due) {
      state.setDue = Number(due);
      renderSetSheet();
    }
  });
  el('wbSetBody').addEventListener('change', function (event) {
    var target = event.target;
    if (!target || !target.getAttribute) return;
    var kind = target.getAttribute('data-set-mode');
    if (!kind) return;
    state.setKinds[kind] = !!target.checked;
    renderSetSummary();
  });
  el('wbSetCreate').addEventListener('click', createBrickFromSheet);
  /* The name input is rendered on open, so its listener is delegated. */
  el('wbSetBody').addEventListener('input', function (event) {
    var target = event.target;
    if (target && target.id === 'wbSetName') state.setName = target.value;
    renderSetSummary();
  });
  el('wbCard').addEventListener('click', function () {
    if (state.lookOnly) nextLookOnly();
    else if (!state.flipped) flip();
  });
  el('wbFlip').addEventListener('click', flip);
  el('wbLookOnly').addEventListener('click', toggleLookOnly);
  el('wbNext').addEventListener('click', nextLookOnly);
  el('wbPoolRefresh').addEventListener('click', renderPool);
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
  el('wbSearch').addEventListener('input', function (event) {
    state.browseFilter = event.target.value;
    renderBrowse();
  });
  el('wbDictSearch').addEventListener('input', function (event) {
    renderDict(event.target.value);
  });
  el('wbDictHistory').addEventListener('click', function (event) {
    var target = event.target;
    var term = target && target.getAttribute ? target.getAttribute('data-dict-term') : null;
    if (!term) return;
    var input = el('wbDictSearch');
    if (input) input.value = term;
    renderDict(term);
  });
  el('wbSourcesList').addEventListener('click', function (event) {
    var target = event.target;
    var id = target && target.getAttribute ? target.getAttribute('data-source-toggle') : null;
    if (id) toggleSource(id);
  });
  el('wbDictAdd').addEventListener('click', function () {
    /* One import path: the rail's button drives the data sheet's file input, so
     * there is no second place where a dictionary can enter. */
    var input = el('wbDictFile');
    if (input) input.click();
  });
  el('wbBrowseBody').addEventListener('click', function (event) {
    var target = event.target;
    var key = target && target.getAttribute ? target.getAttribute('data-word') : null;
    if (!key) return;
    state.entryKey = key;
    renderBrowse();
  });
  el('wbEntry').addEventListener('click', function (event) {
    var target = event.target;
    if (!target || !target.getAttribute) return;
    var review = target.getAttribute('data-entry-review');
    var back = target.getAttribute('data-entry-return');
    var known = target.getAttribute('data-entry-known');
    var brick = target.getAttribute('data-entry-brick');
    if (review) {
      var own = brickOf(review);
      grabBrick(own ? own.id : null);
    } else if (brick) grabBrick(brick);
    else if (back) returnFromBrick(back);
    else if (known) markKnown(known);
  });
  el('wbExport').addEventListener('click', exportJson);
  el('wbReset').addEventListener('click', resetAll);
  el('wbRiverPause').addEventListener('click', toggleRiver);
  el('wbRiverShuffle').addEventListener('click', startRiver);
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
    if (!target || !target.getAttribute) return;
    var grab = target.getAttribute('data-grab-brick');
    var id = target.getAttribute('data-brick-dissolve');
    if (grab) grabBrick(grab);
    else if (id) dissolveBrick(id);
  });
  window.addEventListener('hashchange', route);
}

async function init() {
  try {
    /* The shared dictionary module ships JMdict common out of dict/ and
     * restores any Yomitan dictionary the learner imported earlier. A test
     * environment has no fetch, so the pack is only asked for where it can be
     * fetched; the Yomitan path does not depend on the pack at all. */
    state.dictionary = await loadDictionary({ packs: typeof fetch === 'function' ? ['common'] : [] });
    await restoreDictionaries();
    await refreshDictionary();

    var db = await openDb();
    state.lex = new Lexicon(db);
    await state.lex.seedFromLegacy(window.ML_DATA ? window.ML_DATA.vocab : [], SEED_DEFS);
    await state.lex.enrichFromDictionary(state.dictionary);
    state.entryKey = null;
    await refresh();
    await startReview();
    bind();
    await renderPool();
    await renderWall();
    await renderBricks();
    route();
  } catch (err) {
    var main = document.querySelector('main');
    if (main) {
      main.insertAdjacentHTML('afterbegin', '<div class="container"><p class="pill pill-warn">Wordbook failed to start: ' + esc(err && err.message ? err.message : err) + '</p></div>');
    }
  }
}

init();
