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

import { openEpub } from './epub.js?v=4';
import { buildChapter } from './text-model.js?v=4';
import { prepareAndMount } from './render.js?v=4';
import { SAMPLE_BOOK } from './sample.js?v=4';

/**
 * Bumped together with the query strings above.
 *
 * GitHub Pages serves static files with cache-control: max-age=600, so for ten
 * minutes after a deploy a plain reload can still run the previous module. The
 * query strings are what actually defeat that; this constant exists so the
 * running version is visible on screen, which is the only way to tell a stale
 * cache apart from a real bug from a bug report.
 */
const APP_VERSION = 'js r4';

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
  fileInput: document.getElementById('file-input')
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
  chromeHidden: false
};

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
    applyLayout();
    paginate();

    progress('位置を復元中', 0.97);
    await nextFrame();
    if (offset && offset > 0) restoreOffset(offset);
    else goToPage(0);
    updatePageInfo();
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

/* --------------------------------------------------------------- wiring */

function toggleChrome() {
  state.chromeHidden = !state.chromeHidden;
  document.body.classList.toggle('chrome-hidden', state.chromeHidden);
}

let pointerStart = null;

els.viewport.addEventListener('pointerdown', function (event) {
  pointerStart = { x: event.clientX, y: event.clientY };
});

els.viewport.addEventListener('pointerup', function (event) {
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
if (buildEl) buildEl.textContent = 'html r4 · ' + APP_VERSION;

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
