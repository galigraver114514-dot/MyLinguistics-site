/**
 * The reader page.
 *
 * Position is stored as { chapter, offset } where offset indexes the chapter's
 * baseText, never a scroll value and never a pixel. That is what lets the font
 * size, the writing mode and the furigana setting all change without losing the
 * reader's place: after any relayout the offset is looked up again and the
 * viewport is scrolled to put it back where it was.
 *
 * Vertical layout is paginated by scrolling, not by multi-column layout, which
 * was measured on the device: in a vertical writing mode multi-column pushes its
 * columns down the vertical axis. Plain flow overflows horizontally instead, and
 * stepping scrollLeft by exactly one clientWidth moves exactly one page.
 */

import { openEpub } from './epub.js?v=6';
import { buildChapter } from './text-model.js?v=6';
import { prepareAndMount } from './render.js?v=6';
import { SAMPLE_BOOK } from './sample.js?v=6';
import { createLookup } from './lookup.js?v=6';
import { createDictionary } from '../../src/dict/index.js?v=6';
import { renderGloss, ensureStyles, hydrateImages } from '../../src/dict/structured.js?v=6';
import { createPainter } from './highlight.js?v=6';
import { openAnnotations } from './annotations.js?v=6';
import { rangeFor, dragRange, cycleGranularity, isRange, preview } from './selection.js?v=6';

/**
 * Bumped together with the query strings above.
 *
 * GitHub Pages serves static files with cache-control: max-age=600, so for ten
 * minutes after a deploy a plain reload can still run the previous module. The
 * query strings are what actually defeat that; this constant exists so the
 * running version is visible on screen, which is the only way to tell a stale
 * cache apart from a real bug from a bug report.
 */
const APP_VERSION = 'js r6';

const SETTINGS_KEY = 'reader.settings.v2';
const POSITIONS_KEY = 'reader.positions.v2';
const STAGE_KEY = 'reader.stage.v1';

// The site stores a two-way theme in ml.theme; the reader has three schemes of
// its own. Bridging them means switching to night on the wordbook does not open
// a glaring white reader, and choosing night here does not leave the site light.
const SITE_THEME_KEY = 'ml.theme';
const THEME_FROM_SITE = { dark: 'night', light: 'paper' };
const THEME_TO_SITE = { night: 'dark', paper: 'light', white: 'light' };
const SAVE_DELAY = 500;

const els = {
  viewport: document.getElementById('viewport'),
  content: document.getElementById('content'),
  empty: document.getElementById('empty'),
  title: document.getElementById('book-title'),
  pageInfo: document.getElementById('page-info'),
  prev: document.getElementById('btn-prev'),
  next: document.getElementById('btn-next'),
  smaller: document.getElementById('btn-smaller'),
  larger: document.getElementById('btn-larger'),
  open: document.getElementById('btn-open'),
  sample: document.getElementById('btn-sample'),
  toc: document.getElementById('btn-toc'),
  settings: document.getElementById('btn-settings'),
  overlay: document.getElementById('overlay'),
  sheetTitle: document.getElementById('sheet-title'),
  sheetBody: document.getElementById('sheet-body'),
  closeSheet: document.getElementById('btn-close-sheet'),
  fileInput: document.getElementById('file-input'),
  dict: document.getElementById('dict'),
  dictSurface: document.getElementById('dict-surface'),
  dictReading: document.getElementById('dict-reading'),
  dictBody: document.getElementById('dict-body'),
  dictBack: document.getElementById('dict-back'),
  dictPrev: document.getElementById('dict-prev'),
  dictNext: document.getElementById('dict-next'),
  dictClose: document.getElementById('dict-close'),
  dictButton: document.getElementById('btn-dict'),
  dictInput: document.getElementById('dict-input'),
  hoverBubble: document.getElementById('hover-bubble'),
  hoverWord: document.getElementById('hover-word'),
  hoverReading: document.getElementById('hover-reading'),
  selectBar: document.getElementById('select-bar'),
  selectInfo: document.getElementById('select-info'),
  selectHighlight: document.getElementById('select-highlight'),
  selectCopy: document.getElementById('select-copy'),
  selectDict: document.getElementById('select-dict'),
  selectClear: document.getElementById('select-clear')
};

const state = {
  book: null,
  epub: null,
  index: 0,
  model: null,
  page: 0,
  pages: 1,
  objectUrls: [],
  settings: { mode: 'vertical', fontSize: 19, theme: 'paper' },
  saveTimer: 0,
  chromeHidden: false,
  dictionary: null,
  dictPromise: null,
  lookup: null,
  lookupPromise: null,
  dictOffset: -1,
  dictStyles: new Set(),
  sourceTitles: new Map(),
  annotations: [],
  selection: null,
  draftRange: null,
  hoverRange: null,
  annotationStore: null
};

// Created once, at module load. Where the Custom Highlight API is missing the
// annotation layer degrades to a no-op rather than throwing on every repaint.
state.painter = createPainter({
  highlights: typeof CSS !== 'undefined' ? CSS.highlights : null,
  Highlight: typeof Highlight !== 'undefined' ? Highlight : null
});

const busyEl = document.createElement('div');
busyEl.id = 'busy';
busyEl.innerHTML = '<div class="busy-inner">' +
  '<div class="spin"></div>' +
  '<div class="busy-text">読み込み中...</div>' +
  '<div class="busy-bar"><i></i></div>' +
  '<button type="button" class="busy-retry" hidden>再読み込み</button>' +
  '</div>';
els.viewport.appendChild(busyEl);

const busyTextEl = busyEl.querySelector('.busy-text');
const busyBarEl = busyEl.querySelector('.busy-bar i');
const busyBarWrap = busyEl.querySelector('.busy-bar');
const busyRetryEl = busyEl.querySelector('.busy-retry');

busyRetryEl.addEventListener('click', function () { location.reload(); });

let watchdogTimer = 0;

function busy(on) {
  busyEl.classList.toggle('on', !!on);
  clearTimeout(watchdogTimer);
  busyRetryEl.hidden = true;
  if (!on) {
    writeJson(STAGE_KEY, { label: 'done', at: Date.now() });
    return;
  }
  // A spinner that never resolves and a spinner that is simply slow look
  // identical, so after a while say which it is and offer a way out.
  watchdogTimer = setTimeout(function () {
    if (!busyEl.classList.contains('on')) return;
    busyTextEl.textContent = busyTextEl.textContent + ' — まだ処理中です。大きなファイルでは時間がかかります';
    busyRetryEl.hidden = false;
  }, 12000);
}

/**
 * Report which stage the loader is in. Every stage name here exists to make a
 * stall obvious: if the reader ever freezes again, the label says where.
 */
function progress(label, fraction) {
  busyTextEl.textContent = label;
  // Written before the work, not after, so that if the page has to be reloaded
  // the stage it died in is still there to be read.
  writeJson(STAGE_KEY, { label: label, at: Date.now() });
  if (typeof fraction === 'number' && isFinite(fraction)) {
    busyBarWrap.style.visibility = 'visible';
    busyBarEl.style.width = Math.round(Math.max(0, Math.min(1, fraction)) * 100) + '%';
  } else {
    busyBarWrap.style.visibility = 'hidden';
  }
}

function nextFrame() {
  return new Promise(function (resolve) {
    let settled = false;
    const finish = function () {
      if (settled) return;
      settled = true;
      resolve();
    };
    // The timer is the guarantee, not the fallback: requestAnimationFrame does
    // not fire while the document is hidden or the compositor is stalled, and a
    // loader that waits on it forever is indistinguishable from a hang.
    setTimeout(finish, 50);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(finish);
  });
}

/* ------------------------------------------------------------- storage */

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) { /* storage unavailable or full */ }
}

function loadSettings() {
  const saved = readJson(SETTINGS_KEY, null);
  let chosen = false;
  if (saved) {
    if (saved.mode === 'vertical' || saved.mode === 'horizontal') state.settings.mode = saved.mode;
    if (typeof saved.fontSize === 'number') state.settings.fontSize = Math.max(14, Math.min(34, saved.fontSize));
    if (typeof saved.theme === 'string') {
      state.settings.theme = saved.theme;
      chosen = true;
    }
  }
  // Only inherit while the reader has no opinion of its own; after that the
  // reader is the authority and pushes its choice back out.
  if (!chosen) {
    let siteTheme = null;
    try { siteTheme = localStorage.getItem(SITE_THEME_KEY); } catch (error) { siteTheme = null; }
    if (siteTheme && THEME_FROM_SITE[siteTheme]) state.settings.theme = THEME_FROM_SITE[siteTheme];
  }
}

function saveSettings() {
  writeJson(SETTINGS_KEY, state.settings);
  const siteTheme = THEME_TO_SITE[state.settings.theme];
  if (siteTheme) {
    try { localStorage.setItem(SITE_THEME_KEY, siteTheme); } catch (error) { /* ignore */ }
  }
}

function positions() {
  return readJson(POSITIONS_KEY, {});
}

function savePositionNow() {
  if (!state.book || !state.model) return;
  let offset = -1;
  try {
    offset = offsetAtPoint(sampleX(), sampleY());
  } catch (error) {
    return;   // a background save must never surface as an uncaught error
  }
  if (offset < 0) return;
  const all = positions();
  all[state.book.key] = { chapter: state.index, offset: offset, at: Date.now() };
  writeJson(POSITIONS_KEY, all);
}

function queueSave() {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(savePositionNow, SAVE_DELAY);
}

/* ------------------------------------------------------------ geometry */

function sampleX() {
  const rect = els.viewport.getBoundingClientRect();
  return state.settings.mode === 'vertical' ? rect.right - 8 : rect.left + 26;
}

function sampleY() {
  const rect = els.viewport.getBoundingClientRect();
  return state.settings.mode === 'vertical' ? rect.top + 26 : rect.top + 8;
}

function caretAt(x, y) {
  if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    if (p && p.offsetNode) return { node: p.offsetNode, offset: p.offset };
  }
  if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y);
    if (r && r.startContainer) return { node: r.startContainer, offset: r.startOffset };
  }
  return null;
}

/**
 * baseText offset for a viewport point.
 *
 * The caret API is tried first because it is cheap, but it is not trusted: it
 * can land on untracked nodes such as an rt reading. When it does, this falls
 * back to geometry, which is slower but always right.
 */
let rectCache = null;

function invalidateRects() {
  rectCache = null;
}

/**
 * Bounding rectangles for every tracked text node, computed once per layout.
 * A Range per segment forces layout each time, so building this is only worth
 * doing when the caret API has already failed, and never more than once per
 * layout change.
 */
function segmentRects() {
  if (rectCache) return rectCache;
  const out = [];
  const segments = state.model ? state.model.segments : [];
  const doc = els.content.ownerDocument;
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (!segment.node || !segment.node.isConnected) continue;
    let rect;
    try {
      const range = doc.createRange();
      range.setStart(segment.node, 0);
      range.setEnd(segment.node, segment.node.data.length);
      rect = range.getBoundingClientRect();
    } catch (error) {
      continue;
    }
    if (!rect || (rect.width === 0 && rect.height === 0)) continue;
    out.push({ start: segment.start, end: segment.end, rect: rect });
  }
  rectCache = out;
  return out;
}

function offsetAtPoint(x, y) {
  if (!state.model || state.model.length === 0) return -1;

  const hit = caretAt(x, y);
  if (hit) {
    const offset = state.model.offsetAt(hit.node, hit.offset);
    if (offset >= 0) return offset;
  }

  const rects = segmentRects();
  let nearest = -1;
  let nearestDistance = Infinity;
  for (let i = 0; i < rects.length; i++) {
    const item = rects[i];
    const rect = item.rect;
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
      const size = item.end - item.start;
      const along = state.settings.mode === 'vertical'
        ? (y - rect.top) / Math.max(1, rect.height)
        : (x - rect.left) / Math.max(1, rect.width);
      return item.start + Math.round(Math.max(0, Math.min(1, along)) * size);
    }
    const dx = Math.max(rect.left - x, 0, x - rect.right);
    const dy = Math.max(rect.top - y, 0, y - rect.bottom);
    const distance = dx * dx + dy * dy;
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = item.start;
    }
  }
  return nearest;
}

/* --------------------------------------------------------------- layout */

function applyLayout() {
  const vertical = state.settings.mode === 'vertical';
  els.viewport.classList.toggle('vertical', vertical);
  els.viewport.classList.toggle('horizontal', !vertical);
  document.documentElement.setAttribute('data-theme', state.settings.theme);
  document.documentElement.style.setProperty('--reader-size', state.settings.fontSize + 'px');
  invalidateRects();
  scheduleRepaint();
}

function paginate() {
  if (state.settings.mode !== 'vertical') {
    state.pages = 1;
    return;
  }
  const width = els.viewport.clientWidth || 1;
  state.pages = Math.max(1, Math.round(els.viewport.scrollWidth / width));
}

function updatePageInfo() {
  if (!state.book) {
    els.pageInfo.textContent = '- / -';
    return;
  }
  if (state.settings.mode === 'vertical') {
    els.pageInfo.textContent = (state.page + 1) + ' / ' + state.pages;
  } else {
    const max = els.viewport.scrollHeight - els.viewport.clientHeight;
    const percent = max > 0 ? Math.round((els.viewport.scrollTop / max) * 100) : 100;
    els.pageInfo.textContent = percent + '%';
  }
  els.prev.disabled = state.settings.mode === 'vertical' ? state.page <= 0 : els.viewport.scrollTop <= 0;
  els.next.disabled = state.settings.mode === 'vertical' ? state.page >= state.pages - 1 : false;
}

function goToPage(page) {
  paginate();
  state.page = Math.max(0, Math.min(state.pages - 1, page));
  if (state.settings.mode === 'vertical') {
    els.viewport.scrollLeft = -state.page * els.viewport.clientWidth;
  }
  updatePageInfo();
  queueSave();
}

function scrollByScreen(direction) {
  if (state.settings.mode === 'vertical') {
    goToPage(state.page + direction);
  } else {
    els.viewport.scrollTop += direction * els.viewport.clientHeight * 0.9;
    updatePageInfo();
    queueSave();
  }
}

function restoreOffset(offset) {
  if (!state.model || state.model.length === 0) return;
  const clamped = Math.max(0, Math.min(state.model.length, offset));
  const range = state.model.rangeFor(clamped, clamped);
  if (!range) return;

  const rect = range.getBoundingClientRect();
  const view = els.viewport.getBoundingClientRect();

  if (state.settings.mode === 'vertical') {
    els.viewport.scrollLeft = -(view.right - rect.right);
    const width = els.viewport.clientWidth || 1;
    state.page = Math.max(0, Math.min(state.pages - 1, Math.round(-els.viewport.scrollLeft / width)));
    els.viewport.scrollLeft = -state.page * width;
  } else {
    els.viewport.scrollTop += rect.top - view.top - 12;
  }
  updatePageInfo();
}

/* --------------------------------------------------------------- content */

function revokeUrls() {
  state.objectUrls.forEach(function (url) { URL.revokeObjectURL(url); });
  state.objectUrls = [];
}

async function inlineImages(container, chapterPath) {
  if (!state.epub) return;
  const images = Array.prototype.slice.call(container.querySelectorAll('img'));
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const src = img.getAttribute('src');
    if (!src) { img.remove(); continue; }
    const path = state.epub.resolveHref(chapterPath, src);
    const resource = await state.epub.resource(path);
    if (!resource) { img.remove(); continue; }
    const url = URL.createObjectURL(new Blob([resource.data], { type: resource.mediaType }));
    state.objectUrls.push(url);
    img.setAttribute('src', url);
    img.removeAttribute('width');
    img.removeAttribute('height');

    progress('画像を読み込み中 (' + (i + 1) + ' / ' + images.length + ')', 0.72 + 0.24 * ((i + 1) / images.length));
    await nextFrame();
  }
}

async function renderInto(html) {
  els.content.replaceChildren();
  // Mounting lives in render.js because a wrong version of this loop hangs the
  // browser forever, and the tested version cannot.
  prepareAndMount(html, els.content, window.DOMParser);
  invalidateRects();
  const chapter = state.epub ? state.epub.chapters[state.index] : null;
  await inlineImages(els.content, chapter ? chapter.path : '');
}

async function showChapter(index, offset) {
  if (!state.book) return;
  state.index = Math.max(0, Math.min(state.book.count - 1, index));
  busy(true);
  try {
    progress('本文を展開中 (' + (state.index + 1) + ' / ' + state.book.count + ')', 0.5);
    await nextFrame();

    const html = await state.book.read(state.index);

    progress('本文を配置中', 0.7);
    await nextFrame();
    revokeUrls();
    await renderInto(html);

    state.model = buildChapter(els.content);
    await loadAnnotations();
    refreshLookupText();
    closeDict();
    clearSelection();
    applyLayout();
    paginate();

    progress('位置を復元中', 0.97);
    await nextFrame();
    if (offset && offset > 0) restoreOffset(offset);
    else goToPage(0);
    updatePageInfo();
    repaintHighlights();
  } finally {
    busy(false);
  }
}

/* ----------------------------------------------------------------- books */

async function loadBook(book) {
  state.book = book;
  state.epub = book.epub || null;
  els.title.textContent = book.title + (book.author ? ' — ' + book.author : '');
  els.empty.classList.add('hidden');

  const saved = positions()[book.key];
  if (saved && typeof saved.chapter === 'number') {
    await showChapter(saved.chapter, saved.offset || 0);
  } else {
    await showChapter(0, 0);
  }
  if (els.epub) els.epub = book.epub;
}

/**
 * Read a File, reporting progress. A 31 MB EPUB is the slowest thing the reader
 * does, so it gets a real byte counter rather than an indeterminate spinner.
 */
async function readFileWithProgress(file, onProgress) {
  const total = file.size || 0;
  if (!file.stream || !total) return new Uint8Array(await file.arrayBuffer());

  const reader = file.stream().getReader();
  const chunks = [];
  let received = 0;
  let lastYield = 0;

  for (;;) {
    const step = await reader.read();
    if (step.done) break;
    chunks.push(step.value);
    received += step.value.byteLength;
    if (typeof onProgress === 'function') onProgress(received, total);
    const now = Date.now();
    if (now - lastYield > 120) {
      lastYield = now;
      await nextFrame();
    }
  }

  const out = new Uint8Array(received);
  let at = 0;
  for (let i = 0; i < chunks.length; i++) {
    out.set(chunks[i], at);
    at += chunks[i].byteLength;
  }
  return out;
}

function fail(error) {
  busy(false);
  const message = error && error.message ? error.message : String(error);
  els.title.textContent = 'リーダー';
  alert('エラー: ' + message);
}

async function openFile(file) {
  if (!file) return;
  busy(true);
  els.empty.classList.remove('hidden');
  try {
    progress('ファイルを読み込み中', 0);
    await nextFrame();
    const bytes = await readFileWithProgress(file, function (received, total) {
      progress('ファイルを読み込み中  ' + Math.round(received / 1048576) + ' / ' + Math.round(total / 1048576) + ' MB', received / total);
    });

    progress('目次を解析中', 0.45);
    await nextFrame();
    const epub = await openEpub(bytes);
    const key = 'epub:' + (epub.metadata.identifier || epub.metadata.title || file.name) + ':' + file.size;
    await loadBook({
      key: key,
      title: epub.metadata.title || file.name,
      author: epub.metadata.author || '',
      count: epub.chapters.length,
      epub: epub,
      read: function (i) { return epub.readChapter(i); }
    });
  } catch (error) {
    els.empty.classList.remove('hidden');
    fail(error);
  } finally {
    busy(false);
  }
}

function openSample() {
  return loadBook({
    key: 'sample',
    title: SAMPLE_BOOK.title,
    author: SAMPLE_BOOK.author,
    count: SAMPLE_BOOK.chapters.length,
    epub: null,
    read: function (i) { return Promise.resolve(SAMPLE_BOOK.chapters[i] || ''); }
  });
}

/* ---------------------------------------------------------------- sheets */

function openSheet(title, build) {
  els.sheetTitle.textContent = title;
  els.sheetBody.replaceChildren();
  build(els.sheetBody);
  els.overlay.hidden = false;
}

function closeSheet() {
  els.overlay.hidden = true;
}

function buildToc(body) {
  if (!state.book) {
    body.appendChild(document.createTextNode('本が開かれていません。'));
    return;
  }
  const list = document.createElement('ol');
  for (let i = 0; i < state.book.count; i++) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = state.book.chapterTitle ? state.book.chapterTitle(i) : '第 ' + (i + 1) + ' 章';
    if (i === state.index) button.className = 'current';
    button.addEventListener('click', function () {
      closeSheet();
      showChapter(i, 0);
    });
    item.appendChild(button);
    list.appendChild(item);
  }
  body.appendChild(list);
}

function buildSettings(body) {
  function row(label) {
    const wrap = document.createElement('div');
    wrap.className = 'row';
    const heading = document.createElement('div');
    heading.className = 'row-label';
    heading.textContent = label;
    wrap.appendChild(heading);
    body.appendChild(wrap);
    return wrap;
  }

  function option(parent, text, isOn, onPick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    if (isOn) button.className = 'on';
    button.addEventListener('click', function () {
      onPick();
      applyLayout();
      closeSheet();
      repaginateKeepingPlace();
    });
    parent.appendChild(button);
  }

  const mode = row('組み方向');
  option(mode, '縦書き', state.settings.mode === 'vertical', function () { state.settings.mode = 'vertical'; saveSettings(); });
  option(mode, '横書き', state.settings.mode === 'horizontal', function () { state.settings.mode = 'horizontal'; saveSettings(); });

  const theme = row('配色');
  [['paper', '生成り'], ['white', '白'], ['night', '夜']].forEach(function (pair) {
    option(theme, pair[1], state.settings.theme === pair[0], function () { state.settings.theme = pair[0]; saveSettings(); });
  });

  const size = row('文字サイズ');
  option(size, 'A−', false, function () { state.settings.fontSize = Math.max(14, state.settings.fontSize - 2); saveSettings(); });
  option(size, 'A＋', false, function () { state.settings.fontSize = Math.min(34, state.settings.fontSize + 2); saveSettings(); });

  const note = document.createElement('p');
  note.style.fontSize = '0.8rem';
  note.style.color = 'var(--muted)';
  note.textContent = '現在: ' + state.settings.fontSize + 'px';
  body.appendChild(note);
}

/** Reflow without losing the reader's place. */
function repaginateKeepingPlace() {
  if (!state.model) return;
  const offset = offsetAtPoint(sampleX(), sampleY());
  paginate();
  if (offset >= 0) restoreOffset(offset);
  updatePageInfo();
  queueSave();
}

/* -------------------------------------------------------------- dictionary */

// There is no bundled dictionary: a JP-JP dictionary is the one the reader
// actually owns, it must never be published, and it is imported from a local
// Yomitan zip. Until then the panel says so instead of failing silently.
const DICT_STORAGE = 'ml-dict';

function getDictionary() {
  if (state.dictPromise) return state.dictPromise;
  state.dictPromise = (async function () {
    const dict = createDictionary({ packs: [], storageName: DICT_STORAGE });
    await dict.ready;
    try {
      const stored = await dict.stored();
      for (let i = 0; i < stored.length; i++) {
        try {
          await dict.restore(stored[i].id);
        } catch (error) {
          // A stored dictionary that cannot be reopened is reported through
          // problems(); it must not stop the reader from opening.
        }
      }
    } catch (error) {
      // No IndexedDB, or nothing stored: both are fine.
    }
    state.dictionary = dict;
    return dict;
  })();
  return state.dictPromise;
}

async function getLookup() {
  if (state.lookup) return state.lookup;
  if (!state.lookupPromise) {
    state.lookupPromise = (async function () {
      const dict = await getDictionary();
      state.lookup = createLookup({ dictionary: dict });
      if (state.model) state.lookup.setText(state.model.baseText);
      return state.lookup;
    })();
  }
  return state.lookupPromise;
}

/** A new chapter invalidates the tokens, so hand the controller the new text. */
function refreshLookupText() {
  if (state.lookup && state.model) state.lookup.setText(state.model.baseText);
}

/**
 * baseText offset for a tap, but only when the tap actually landed on text.
 *
 * offsetAtPoint snaps to the nearest text, which is right for restoring a
 * reading position and wrong for lookup: every tap in the margin would look up
 * whatever word happened to be closest. The margins are navigation, so the
 * geometry has to agree with the gesture map.
 */
function textOffsetAt(x, y) {
  if (!state.model || state.model.length === 0) return -1;
  const element = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(x, y) : null;
  if (!element || !els.content.contains(element)) return -1;
  const rects = segmentRects();
  const slack = 6;
  for (let i = 0; i < rects.length; i++) {
    const rect = rects[i].rect;
    if (x >= rect.left - slack && x <= rect.right + slack && y >= rect.top - slack && y <= rect.bottom + slack) {
      return offsetAtPoint(x, y);
    }
  }
  return -1;
}

function closeDict() {
  els.dict.hidden = true;
  state.dictOffset = -1;
}

async function showLookupAt(offset) {
  let lookup;
  try {
    lookup = await getLookup();
  } catch (error) {
    fail(error);
    return;
  }
  state.dictOffset = offset;
  const view = await lookup.atOffset(offset);
  if (view) renderDict(view);
}

async function stepDict(direction) {
  if (!state.lookup || state.dictOffset < 0) return;
  const view = await state.lookup.stepOffset(state.dictOffset, direction);
  if (!view) return;
  if (view.token) state.dictOffset = Math.floor((view.token.start + view.token.end) / 2);
  renderDict(view);
}

async function followReference(href) {
  if (!state.lookup) return;
  try {
    const view = await state.lookup.follow(href);
    if (view) renderDict(view);
  } catch (error) {
    // A dead cross-reference must not take the definition down with it.
  }
}

function sourceTitle(sourceId) {
  if (state.sourceTitles.has(sourceId)) return state.sourceTitles.get(sourceId);
  let title = sourceId;
  if (state.dictionary && typeof state.dictionary.sources === 'function') {
    const list = state.dictionary.sources();
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === sourceId) { title = list[i].title || sourceId; break; }
    }
  }
  state.sourceTitles.set(sourceId, title);
  return title;
}

/** Inject a dictionary's own stylesheet once, scoped to that dictionary. */
async function ensureDictionaryStyles(sourceId) {
  if (!sourceId || state.dictStyles.has(sourceId)) return;
  state.dictStyles.add(sourceId);
  try {
    const dict = await getDictionary();
    if (!dict || typeof dict.dictionaryStyles !== 'function') return;
    const css = await dict.dictionaryStyles(sourceId);
    if (css) ensureStyles(document, sourceId, css);
  } catch (error) {
    // CSS is presentation only; a dictionary without it is still readable.
  }
}

function entryCard(entry) {
  const card = document.createElement('section');
  card.className = 'dict-entry';
  card.setAttribute('data-dict', entry.source);

  const heading = document.createElement('h3');
  const reading = entry.reading && entry.reading !== entry.headword ? '（' + entry.reading + '）' : '';
  heading.textContent = entry.headword + reading;
  card.appendChild(heading);

  const source = document.createElement('div');
  source.className = 'src';
  source.textContent = sourceTitle(entry.source);
  card.appendChild(source);

  const senses = Array.isArray(entry.senses) ? entry.senses : [];
  for (let s = 0; s < senses.length; s++) {
    const sense = senses[s];
    const wrap = document.createElement('div');
    wrap.className = 'dict-sense';

    if (sense.pos && sense.pos.length) {
      const pos = document.createElement('span');
      pos.className = 'pos';
      pos.textContent = sense.pos.join('・');
      wrap.appendChild(pos);
    }

    const gloss = document.createElement('div');
    gloss.className = 'dict-gloss';
    const items = Array.isArray(sense.glosses) ? sense.glosses : [sense.glosses];
    for (let g = 0; g < items.length; g++) {
      const item = items[g];
      if (item === null || item === undefined) continue;
      if (typeof item === 'string') {
        const line = document.createElement('div');
        line.textContent = item;
        gloss.appendChild(line);
      } else {
        gloss.appendChild(renderGloss(item, {
          document: document,
          onReference: function (href) { followReference(href); }
        }));
      }
    }
    wrap.appendChild(gloss);
    card.appendChild(wrap);
  }

  ensureDictionaryStyles(entry.source);
  if (state.dictionary) {
    hydrateImages(card, function (path) { return state.dictionary.assetUrl(entry.source, path); }).catch(function () {});
  }
  return card;
}

function renderDict(view) {
  if (!view) return;
  els.dictSurface.textContent = view.surface;
  els.dictReading.textContent = view.entries.length && view.entries[0].reading ? view.entries[0].reading : '';
  els.dictBack.hidden = !(state.lookup && state.lookup.canGoBack());

  const body = els.dictBody;
  body.replaceChildren();

  if (!view.entries.length) {
    const message = document.createElement('p');
    message.className = 'dict-notfound';
    message.textContent = '「' + view.surface + '」の項目が見つかりません。';
    body.appendChild(message);

    const candidates = (view.candidates || []).filter(function (form) { return form && form !== view.surface; });
    if (candidates.length) {
      const row = document.createElement('div');
      row.className = 'dict-candidates';
      const limit = Math.min(candidates.length, 8);
      for (let i = 0; i < limit; i++) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = candidates[i];
        button.addEventListener('click', (function (form) {
          return function () { followReference(form); };
        })(candidates[i]));
        row.appendChild(button);
      }
      body.appendChild(row);
    }

    if (!state.dictionary || !state.dictionary.sources || state.dictionary.sources().length === 0) {
      const hint = document.createElement('p');
      hint.className = 'dict-hint';
      hint.textContent = '「辞書」から Yomitan 形式の辞書（.zip）を読み込むと、ここに語釈が出ます。';
      body.appendChild(hint);
    }
    els.dict.hidden = false;
    return;
  }

  const limit = Math.min(view.entries.length, 8);
  for (let i = 0; i < limit; i++) body.appendChild(entryCard(view.entries[i]));
  els.dict.hidden = false;
}

/* ------------------------------------------------------- dictionary import */

async function buildDictionarySheet(body) {
  const dict = await getDictionary();

  const intro = document.createElement('p');
  intro.className = 'dict-hint';
  intro.textContent = 'Yomitan 形式の辞書（.zip）をこの端末に保存します。外部には送信されません。';
  body.appendChild(intro);

  const actions = document.createElement('div');
  actions.className = 'row';
  const importButton = document.createElement('button');
  importButton.type = 'button';
  importButton.textContent = '辞書を読み込む（.zip）';
  importButton.addEventListener('click', function () { els.dictInput.click(); });
  actions.appendChild(importButton);
  body.appendChild(actions);

  const list = document.createElement('ul');
  list.className = 'dict-list';

  const sources = dict.sources ? dict.sources() : [];
  const loaded = new Set();
  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    loaded.add(source.id);
    const item = document.createElement('li');
    const title = document.createElement('strong');
    title.textContent = source.title || source.id;
    item.appendChild(title);
    const meta = document.createElement('span');
    meta.className = 'meta';
    const bits = [];
    if (source.entryCount) bits.push(source.entryCount + ' 項目');
    if (source.languages && source.languages.length) bits.push(source.languages.join('/'));
    if (source.banks) {
      bits.push('term ' + source.banks.termBanks + (source.banks.metaBanks ? ' · meta ' + source.banks.metaBanks : ' · meta なし'));
    }
    meta.textContent = bits.join(' · ');
    item.appendChild(meta);
    list.appendChild(item);
  }

  let stored = [];
  try {
    stored = await dict.stored();
  } catch (error) {
    stored = [];
  }
  for (let i = 0; i < stored.length; i++) {
    if (loaded.has(stored[i].id)) continue;
    const source = stored[i];
    const item = document.createElement('li');
    const title = document.createElement('strong');
    title.textContent = source.title || source.id;
    item.appendChild(title);
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = '保存済み・未読み込み';
    item.appendChild(meta);
    const load = document.createElement('button');
    load.type = 'button';
    load.textContent = '読み込む';
    load.style.marginTop = '6px';
    load.addEventListener('click', async function () {
      load.disabled = true;
      try {
        await dict.restore(source.id);
        state.sourceTitles.clear();
        refreshLookupText();
        openSheet('辞書', buildDictionarySheet);
      } catch (error) {
        load.disabled = false;
        alert('読み込めませんでした: ' + (error && error.message ? error.message : error));
      }
    });
    item.appendChild(load);
    list.appendChild(item);
  }

  if (list.children.length === 0) {
    const empty = document.createElement('li');
    empty.textContent = 'まだ辞書がありません。';
    list.appendChild(empty);
  }
  body.appendChild(list);

  const usage = await dict.usage().catch(function () { return null; });
  if (usage && usage.supported && usage.bytes !== null && usage.bytes !== undefined) {
    const note = document.createElement('p');
    note.className = 'dict-hint';
    note.textContent = '使用量: ' + Math.round(usage.bytes / 1048576) + ' MB' +
      (usage.quota ? ' / ' + Math.round(usage.quota / 1048576) + ' MB' : '');
    body.appendChild(note);
  }

  const problems = dict.problems ? dict.problems() : [];
  if (problems.length) {
    const note = document.createElement('p');
    note.className = 'dict-hint';
    note.textContent = '問題: ' + problems.map(function (item) { return item.id + ' (' + item.stage + ')'; }).join('、');
    body.appendChild(note);
  }
}

function openDictionarySheet() {
  openSheet('辞書', function (body) {
    body.textContent = '読み込み中…';
    buildDictionarySheet(body).catch(function (error) {
      body.textContent = '辞書の状態を読めませんでした: ' + (error && error.message ? error.message : error);
    });
  });
}

async function importDictionary(file) {
  if (!file) return;
  closeSheet();
  busy(true);
  try {
    progress('辞書を読み込み中', 0.05);
    await nextFrame();
    const dict = await getDictionary();
    const result = await dict.importYomitan(file, function (event) {
      if (!event) return;
      if (event.stage === 'read') progress('辞書を読み込み中', 0.1);
      else if (event.stage === 'walk') progress('解析中 (' + event.bank + ' / ' + event.banks + ')', 0.1 + 0.7 * (event.bank / Math.max(1, event.banks)));
      else if (event.stage === 'sort') progress('索引を作成中', 0.85);
      else if (event.stage === 'persist') progress('端末に保存中', 0.92);
    });
    state.sourceTitles.clear();
    refreshLookupText();
    const title = result && result.source ? (result.source.title || result.source.id) : '辞書';
    alert(title + ' を読み込みました（' + (result ? result.entries : 0) + ' 項目）。本文をタップすると語釈が出ます。');
  } catch (error) {
    fail(error);
  } finally {
    busy(false);
  }
}

/* ------------------------------------------------------------- annotations */

function getAnnotationStore() {
  if (!state.annotationStore) {
    state.annotationStore = openAnnotations().catch(function () { return null; });
  }
  return state.annotationStore;
}

async function loadAnnotations() {
  state.annotations = [];
  state.selection = null;
  state.draftRange = null;
  state.hoverRange = null;
  if (!state.book) return;
  try {
    const store = await getAnnotationStore();
    if (store) state.annotations = await store.list(state.book.key, state.index);
  } catch (error) {
    state.annotations = [];
  }
}

function repaintHighlights() {
  const painter = state.painter;
  const model = state.model;
  if (!painter || !model) return;

  function paintOne(name, span, priority) {
    if (!span || !isRange(span)) {
      painter.clear(name);
      return;
    }
    const range = model.rangeFor(span.start, span.end);
    if (range) painter.paint(name, [range], { priority: priority });
    else painter.clear(name);
  }

  const marks = [];
  for (let i = 0; i < state.annotations.length; i++) {
    const annotation = state.annotations[i];
    const range = model.rangeFor(annotation.start, annotation.end);
    if (range) marks.push(range);
  }
  painter.paint('reader-highlight', marks, { priority: 1 });
  paintOne('reader-selection', state.selection, 3);
  paintOne('reader-draft', state.draftRange, 2);
  paintOne('reader-hover', state.hoverRange, 2);
}

/**
 * Highlights are painted on the next frame, after the content has been laid
 * out. Registering one against a subtree with no boxes is the failure the spike
 * found: it is silent and permanent.
 */
function scheduleRepaint() {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(function () { repaintHighlights(); });
  } else {
    repaintHighlights();
  }
}

async function addAnnotation(span) {
  if (!state.book || !state.model || !isRange(span)) return null;
  const record = {
    id: 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    book: state.book.key,
    chapter: state.index,
    start: span.start,
    end: span.end,
    text: state.model.slice(span.start, span.end).slice(0, 120),
    color: 'yellow',
    createdAt: new Date().toISOString()
  };
  state.annotations.push(record);
  repaintHighlights();
  try {
    const store = await getAnnotationStore();
    if (store) await store.put(record);
  } catch (error) {
    // It is already visible; only persistence is lost.
  }
  return record;
}

function wordRangeAtOffset(offset) {
  if (!state.lookup) return null;
  const token = state.lookup.wordAt(offset);
  return token ? { start: token.start, end: token.end } : null;
}

/**
 * The paragraph around an offset. Only the DOM can answer this: baseText joins
 * paragraphs with nothing at all, so a text-only heuristic would return the
 * whole chapter as one paragraph.
 */
function paragraphRangeAt(offset) {
  if (!state.model || !state.model.length) return null;
  const located = state.model.nodeAt(offset);
  if (!located || !located.node) return null;
  let block = located.node;
  if (block.nodeType === 3) block = block.parentNode;
  while (block && block.parentNode && block.parentNode !== els.content) block = block.parentNode;
  if (!block || block === els.content || block.parentNode !== els.content) return null;

  const walker = document.createTreeWalker(block, 4);
  let start = -1;
  let end = -1;
  let node = walker.nextNode();
  while (node) {
    const first = state.model.offsetAt(node, 0);
    const last = state.model.offsetAt(node, node.data.length);
    if (first >= 0 && last >= 0) {
      if (start < 0 || first < start) start = first;
      if (last > end) end = last;
    }
    node = walker.nextNode();
  }
  if (start < 0 || end <= start) return null;
  return { start: start, end: end };
}

function enterSelection(offset) {
  if (!state.model) return;
  if (!state.lookup) {
    getLookup().then(function () { enterSelection(offset); }).catch(function () {});
    return;
  }
  closeDict();
  const granularity = cycleGranularity(state.selection ? state.selection.granularity : null);
  const span = rangeFor(granularity, offset, {
    wordAt: wordRangeAtOffset,
    sentences: state.lookup.sentences(),
    paragraphAt: paragraphRangeAt
  });
  if (!isRange(span)) return;
  state.selection = { start: span.start, end: span.end, granularity: granularity };
  repaintHighlights();
  showSelectBar();
}

function clearSelection() {
  state.selection = null;
  if (els.selectBar) els.selectBar.hidden = true;
  repaintHighlights();
}

function showSelectBar() {
  if (!state.selection || !state.model) {
    els.selectBar.hidden = true;
    return;
  }
  const label = state.selection.granularity === 'paragraph' ? '段落' : '文';
  const text = state.model.slice(state.selection.start, state.selection.end);
  els.selectInfo.textContent = label + '：' + preview(text, 20);
  els.selectBar.hidden = false;
}

async function copySelection() {
  if (!state.selection || !state.model) return;
  const text = state.model.slice(state.selection.start, state.selection.end);
  try {
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
      throw new Error('no clipboard API');
    }
    await navigator.clipboard.writeText(text);
  } catch (error) {
    // The textarea trick still works inside a user gesture, which this is.
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      document.body.removeChild(area);
    } catch (inner) {
      alert('コピーできませんでした');
    }
  }
}

/* ------------------------------------------------------------- Pencil */

function hideHover() {
  clearTimeout(hoverTimer);
  hoverTimer = 0;
  hoverToken = null;
  const had = !!state.hoverRange;
  state.hoverRange = null;
  if (had && state.painter) repaintHighlights();
  els.hoverBubble.hidden = true;
}

/** Keep the bubble inside the visual viewport, and clear of the Pencil tip. */
function moveHoverBubble(x, y) {
  const size = els.hoverBubble.getBoundingClientRect();
  const view = typeof window !== 'undefined' ? window.visualViewport : null;
  const width = (view && view.width) || (typeof window !== 'undefined' ? window.innerWidth : 0) || 0;
  const height = (view && view.height) || (typeof window !== 'undefined' ? window.innerHeight : 0) || 0;
  const left = Math.max(8, Math.min(x + 14, width - size.width - 8));
  let top = y - size.height - 14;
  if (top < 8) top = y + 18;
  if (top + size.height > height - 8) top = Math.max(8, height - size.height - 8);
  els.hoverBubble.style.left = Math.round(left) + 'px';
  els.hoverBubble.style.top = Math.round(top) + 'px';
}

/**
 * Pencil hover: preview the reading of the word under the tip.
 *
 * The lookup is delayed until the tip has rested on one word, because a moving
 * Pencil crosses several words a second and a dictionary hit per move would
 * inflate banks for words the reader only passed over.
 */
function onHoverMove(x, y) {
  if (!state.model) return;
  if (!state.lookup) {
    getLookup().catch(function () {});
    return;
  }
  const offset = offsetAtPoint(x, y);
  const token = offset >= 0 ? state.lookup.wordAt(offset) : null;
  if (!token) { hideHover(); return; }

  if (hoverToken && token.start === hoverToken.start && token.end === hoverToken.end) {
    moveHoverBubble(x, y);
    return;
  }
  hoverToken = token;
  state.hoverRange = { start: token.start, end: token.end };
  repaintHighlights();
  clearTimeout(hoverTimer);
  hoverTimer = setTimeout(function () { showHoverReading(token, x, y); }, 120);
}

async function showHoverReading(token, x, y) {
  if (!state.lookup) return;
  try {
    const view = await state.lookup.peek(token.surface);
    if (!hoverToken || hoverToken.start !== token.start) return;
    const entry = view.entries.length ? view.entries[0] : null;
    const reading = entry && entry.reading ? entry.reading : '';
    if (!reading) { els.hoverBubble.hidden = true; return; }
    els.hoverWord.textContent = token.surface;
    els.hoverReading.textContent = reading;
    els.hoverBubble.hidden = false;
    moveHoverBubble(x, y);
  } catch (error) {
    els.hoverBubble.hidden = true;
  }
}

function startPencil(event) {
  if (!state.model) return;
  const offset = offsetAtPoint(event.clientX, event.clientY);
  if (offset < 0) return;
  hideHover();
  pencil = { start: offset, last: offset, moved: false };
  state.draftRange = null;
}

function movePencil(event) {
  if (!pencil) return;
  const offset = offsetAtPoint(event.clientX, event.clientY);
  if (offset < 0) return;
  if (offset !== pencil.last) pencil.moved = true;
  pencil.last = offset;
  if (!pencil.moved) return;
  state.draftRange = dragRange(pencil.start, offset, wordRangeAtOffset);
  repaintHighlights();
}

/** A still Pencil is a precise tap-to-look-up; a moving one is a highlighter. */
async function endPencil() {
  const current = pencil;
  pencil = null;
  if (!current) return;
  if (!current.moved) {
    state.draftRange = null;
    repaintHighlights();
    await showLookupAt(current.start);
    return;
  }
  const span = state.draftRange;
  state.draftRange = null;
  if (isRange(span)) await addAnnotation(span);
  repaintHighlights();
}

/* --------------------------------------------------------------- wiring */

function toggleChrome() {
  state.chromeHidden = !state.chromeHidden;
  document.body.classList.toggle('chrome-hidden', state.chromeHidden);
}

let pointerStart = null;
let pencil = null;
let lastTap = { at: 0, x: 0, y: 0, offset: -1 };
let hoverToken = null;
let hoverTimer = 0;

els.viewport.addEventListener('pointerdown', function (event) {
  if (event.pointerType === 'pen') {
    startPencil(event);
    return;
  }
  pointerStart = { x: event.clientX, y: event.clientY };
});

els.viewport.addEventListener('pointermove', function (event) {
  if (event.pointerType === 'pen') {
    if (pencil) movePencil(event);
    else onHoverMove(event.clientX, event.clientY);
    return;
  }
  if (event.pointerType === 'mouse') onHoverMove(event.clientX, event.clientY);
});

els.viewport.addEventListener('pointercancel', function () {
  pencil = null;
  pointerStart = null;
  state.draftRange = null;
  repaintHighlights();
  hideHover();
});

els.viewport.addEventListener('pointerleave', hideHover);

els.viewport.addEventListener('pointerup', function (event) {
  if (event.pointerType === 'pen') {
    endPencil().catch(function (error) { fail(error); });
    return;
  }
  if (!pointerStart) return;
  const dx = event.clientX - pointerStart.x;
  const dy = event.clientY - pointerStart.y;
  pointerStart = null;

  if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) {
    if (state.settings.mode !== 'vertical') return;
    // In vertical Japanese the next page lies to the left, so dragging the
    // content rightward is what advances.
    scrollByScreen(dx > 0 ? 1 : -1);
    return;
  }

  if (Math.abs(dx) < 12 && Math.abs(dy) < 12) {
    // Text first: a tap that landed on a word is a lookup, and only a tap that
    // landed on nothing falls through to navigation or the chrome.
    const offset = textOffsetAt(event.clientX, event.clientY);
    if (offset >= 0) {
      const now = Date.now();
      const isDouble = now - lastTap.at < 320
        && Math.abs(event.clientX - lastTap.x) < 28
        && Math.abs(event.clientY - lastTap.y) < 28;
      lastTap = { at: now, x: event.clientX, y: event.clientY, offset: offset };
      if (isDouble) {
        enterSelection(offset);
        return;
      }
      showLookupAt(offset).catch(function (error) { fail(error); });
      return;
    }
    const rect = els.viewport.getBoundingClientRect();
    const fraction = (event.clientX - rect.left) / rect.width;
    if (state.settings.mode === 'vertical') {
      if (fraction < 0.28) scrollByScreen(1);
      else if (fraction > 0.72) scrollByScreen(-1);
      else toggleChrome();
    } else {
      toggleChrome();
    }
  }
});

els.selectHighlight.addEventListener('click', function () {
  if (state.selection) addAnnotation(state.selection).catch(function (error) { fail(error); });
  clearSelection();
});

els.selectCopy.addEventListener('click', function () {
  copySelection();
});

els.selectDict.addEventListener('click', function () {
  const span = state.selection;
  if (!span) return;
  clearSelection();
  showLookupAt(span.start).catch(function (error) { fail(error); });
});

els.selectClear.addEventListener('click', clearSelection);

els.viewport.addEventListener('scroll', function () {
  if (state.settings.mode === 'horizontal') {
    updatePageInfo();
    queueSave();
  }
}, { passive: true });

els.prev.addEventListener('click', function () { scrollByScreen(-1); });
els.next.addEventListener('click', function () { scrollByScreen(1); });

els.smaller.addEventListener('click', function () {
  state.settings.fontSize = Math.max(14, state.settings.fontSize - 1);
  applyLayout();
  saveSettings();
  repaginateKeepingPlace();
});

els.larger.addEventListener('click', function () {
  state.settings.fontSize = Math.min(34, state.settings.fontSize + 1);
  applyLayout();
  saveSettings();
  repaginateKeepingPlace();
});

els.open.addEventListener('click', function () { els.fileInput.click(); });
els.sample.addEventListener('click', function () {
  openSample().catch(function (error) { fail(error); });
});
els.toc.addEventListener('click', function () { openSheet('目次', buildToc); });
els.settings.addEventListener('click', function () { openSheet('表示', buildSettings); });
els.closeSheet.addEventListener('click', closeSheet);
els.overlay.addEventListener('click', function (event) { if (event.target === els.overlay) closeSheet(); });

els.dictClose.addEventListener('click', closeDict);
els.dictBack.addEventListener('click', function () {
  const view = state.lookup && state.lookup.back();
  if (view) renderDict(view);
});
els.dictPrev.addEventListener('click', function () { stepDict(-1).catch(function (error) { fail(error); }); });
els.dictNext.addEventListener('click', function () { stepDict(1).catch(function (error) { fail(error); }); });
els.dictButton.addEventListener('click', openDictionarySheet);
els.dictInput.addEventListener('change', function () {
  const file = els.dictInput.files && els.dictInput.files[0];
  els.dictInput.value = '';
  if (file) importDictionary(file);
});

els.fileInput.addEventListener('change', function () {
  const file = els.fileInput.files && els.fileInput.files[0];
  els.fileInput.value = '';
  openFile(file);
});

let resizeTimer = 0;
window.addEventListener('resize', function () {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(repaginateKeepingPlace, 180);
});

document.addEventListener('keydown', function (event) {
  if (event.key === 'Escape') {
    if (!els.dict.hidden) { closeDict(); event.preventDefault(); return; }
    if (!els.overlay.hidden) { closeSheet(); event.preventDefault(); return; }
  }
  if (event.key === 'ArrowLeft' || event.key === 'PageUp') { scrollByScreen(-1); event.preventDefault(); }
  else if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') { scrollByScreen(1); event.preventDefault(); }
});

window.addEventListener('pagehide', savePositionNow);

// A rejected promise used to leave the loading overlay up forever with nothing
// on screen to explain why. Now it says so.
window.addEventListener('unhandledrejection', function (event) {
  fail(event.reason);
});

/* ----------------------------------------------------------------- init */

loadSettings();
applyLayout();
updatePageInfo();

const buildEl = document.getElementById('build');
if (buildEl) buildEl.textContent = 'html r6 · ' + APP_VERSION;

// If the previous run never reached "done", its last stage is still in storage.
// Say so, instead of leaving the next run to reproduce the same freeze blind.
const lastStage = readJson(STAGE_KEY, null);
if (lastStage && lastStage.label && lastStage.label !== 'done') {
  const note = document.createElement('p');
  note.className = 'hint';
  note.textContent = '前回は「' + lastStage.label + '」で停止しました。';
  els.empty.appendChild(note);
}

if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().catch(function () {});
}
