/* Overview: the word pool and the bricks.
 *
 * P1 makes the page real with live pool and brick state; the two-section
 * reorganisation is P3. It reads the same IndexedDB as the wordbook.
 */
import { openDb } from '../../src/lexicon/db.js';
import { Lexicon } from '../../src/lexicon/store.js';
import { brickLabel } from '../../src/lexicon/brick-label.js';

function t(key, vars) {
  return window.ML && window.ML.t ? window.ML.t(key, vars) : key;
}

function esc(value) {
  return String(value == null ? '' : value)
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
    .split('"').join('&quot;');
}

function dueText(ms) {
  if (!ms) return t('overview.dueNow');
  var days = Math.round((ms - Date.now()) / 86400000);
  if (days <= 0) return t('overview.dueNow');
  return t('overview.dueIn', { n: days });
}

function rows(items) {
  return '<div class="ios-list">' + items.map(function (item) {
    return '<div class="ios-row"><span>' + item.left + '</span>' +
      '<span class="muted small" style="margin-left:auto;text-align:right">' + item.right + '</span></div>';
  }).join('') + '</div>';
}

async function render(lex) {
  var pool = await lex.listPool();
  var bricks = await lex.listBricks();
  var now = Date.now();
  var carded = pool.filter(function (entry) { return entry.state === 'carded'; });
  var open = bricks.filter(function (brick) { return brick.phase !== 'retired'; });
  var due = open.filter(function (brick) { return (brick.due || 0) <= now; });

  document.getElementById('ovPoolCount').textContent = t('overview.poolCount', { n: carded.length });
  document.getElementById('ovBrickCount').textContent = t('overview.brickCount', { n: open.length });
  document.getElementById('ovDueCount').textContent = t('overview.dueCount', { n: due.length });

  var poolNode = document.getElementById('ovPool');
  poolNode.innerHTML = pool.length
    ? rows(pool.map(function (entry) {
        return {
          left: '<strong>' + esc(entry.wordKey) + '</strong>',
          right: esc(t('overview.state.' + entry.state))
        };
      }))
    : '<p class="muted mb-0">' + esc(t('overview.poolEmpty')) + '</p>';

  var brickNode = document.getElementById('ovBricks');
  brickNode.innerHTML = bricks.length
    ? rows(bricks.map(function (brick) {
        return {
          left: '<strong>' + esc(brickLabel(brick, t)) + '</strong> <span class="muted small">' + esc(t('overview.brickSize', { n: brick.size })) + '</span>',
          right: esc(t('overview.phase.' + brick.phase)) + ' \u00b7 ' + esc(dueText(brick.due || 0))
        };
      }))
    : '<p class="muted mb-0">' + esc(t('overview.bricksEmpty')) + '</p>';
}

async function init() {
  try {
    var db = await openDb();
    var lex = new Lexicon(db);
    await render(lex);
    var build = document.getElementById('ovBuild');
    if (build) {
      build.addEventListener('click', async function () {
        await lex.buildBricks();
        await render(lex);
      });
    }
  } catch (err) {
    var main = document.querySelector('main');
    if (main) {
      main.insertAdjacentHTML('afterbegin', '<section class="section"><div class="container"><p class="notice">' +
        esc(err && err.message ? err.message : err) + '</p></div></section>');
    }
  }
}

init();
