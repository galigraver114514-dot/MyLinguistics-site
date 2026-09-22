/* MyLinguistics iOS shell behaviour.
 *
 * The markup (navigation bar, tab bar) is written statically into each page, so
 * the site still navigates without JavaScript. This file adds the parts a
 * static page cannot: the active tab, the collapsing large title, the bottom
 * sheet behind the "more" button, and edge-swipe back.
 */
(function () {
  'use strict';

  function t(key) {
    return window.ML && window.ML.t ? window.ML.t(key) : key;
  }

  /* The route and the markup agree on these names. The static capsule carries
   * data-tab on its level-one items and data-view on its level-two items, and
   * it is also the navigation a page has when JavaScript never runs - so the
   * keys here are read off the markup rather than invented. */
  function tabKey() {
    var path = window.location.pathname;
    if (path.indexOf('/reader/') >= 0) return 'reader';
    var file = path.split('/').pop() || 'index.html';
    if (file === 'study.html') {
      /* The capsule calls this section vocab; the tab bar it replaces called it
       * learn. Ask the page which one it has rather than pick a version to be
       * right about - both markups are in the tree for one release. */
      return document.querySelector('.tabbar-item[data-tab="vocab"]') ? 'vocab' : 'learn';
    }
    if (file === 'index.html') return 'home';
    return '';
  }

  /* study.html is one page with four routes in the hash; a bare study.html
   * lands on the wall, which is the first of the four. */
  function viewKey() {
    var hash = window.location.hash || '';
    if (hash === '#river' || hash === '#pool' || hash === '#sea') return hash.slice(1);
    return 'wall';
  }

  function markActiveTab() {
    var key = tabKey();
    var items = document.querySelectorAll('.tabbar-item');
    for (var i = 0; i < items.length; i++) {
      var active = items[i].getAttribute('data-tab') === key;
      items[i].classList.toggle('is-active', active);
      if (active) items[i].setAttribute('aria-current', 'page');
      else items[i].removeAttribute('aria-current');
    }
    var view = viewKey();
    var subs = document.querySelectorAll('.tabbar-sub');
    for (var j = 0; j < subs.length; j++) {
      var current = subs[j].getAttribute('data-view') === view;
      subs[j].classList.toggle('is-active', current);
      if (current) subs[j].setAttribute('aria-current', 'page');
      else subs[j].removeAttribute('aria-current');
    }
  }

  /* A page with a large title starts with a hidden compact title and reveals it
   * once the large one scrolls under the bar, which is the iOS pattern. */
  function collapseTitle() {
    var navbar = document.getElementById('navbar');
    var large = document.querySelector('.navbar-large');
    if (!navbar || !large) return;
    navbar.classList.add('has-large');
    function sync() {
      navbar.classList.toggle('is-scrolled', window.scrollY > 20);
    }
    sync();
    window.addEventListener('scroll', sync, { passive: true });
  }

  var sheetParts = null;

  function buildSheet() {
    var backdrop = document.createElement('div');
    backdrop.className = 'sheet-backdrop';
    var sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.innerHTML =
      '<div class="sheet-grabber" data-sheet-grab></div>' +
      '<h2 class="sheet-title"></h2>' +
      '<div class="sheet-body"></div>';
    document.body.appendChild(backdrop);
    document.body.appendChild(sheet);
    backdrop.addEventListener('click', closeSheet);
    wireDrag(sheet, sheet.querySelector('[data-sheet-grab]'));
    return { backdrop: backdrop, sheet: sheet };
  }

  function wireDrag(sheet, handle) {
    if (!handle) return;
    var startY = null;
    handle.addEventListener('pointerdown', function (event) {
      startY = event.clientY;
      sheet.style.transition = 'none';
      if (handle.setPointerCapture) handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove', function (event) {
      if (startY === null) return;
      var dy = Math.max(0, event.clientY - startY);
      sheet.style.transform = 'translateY(' + dy + 'px)';
    });
    function end() {
      if (startY === null) return;
      var dy = parseFloat(String(sheet.style.transform).replace(/[^0-9.]/g, '')) || 0;
      startY = null;
      sheet.style.transition = '';
      sheet.style.transform = '';
      if (dy > 80) closeSheet();
    }
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  function setTheme(value) {
    if (window.ML && typeof window.ML.setTheme === 'function') window.ML.setTheme(value);
  }

  /* A sheet may carry one segmented control above its list. The appearance
   * switch lives here because the capsule has room for the interface language
   * and the more button and nothing else, and the navigation bar that used to
   * hold it is gone. It is deliberately not an `.ios-row`, so a sheet's list
   * stays exactly as long as its data. */
  function buildSegments(spec) {
    var track = document.createElement('div');
    track.className = 'sheet-seg';
    (spec.items || []).forEach(function (item) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'sheet-seg-item';
      button.textContent = item.label;
      button.setAttribute('aria-pressed', item.selected ? 'true' : 'false');
      if (item.selected) button.classList.add('is-active');
      button.addEventListener('click', function () {
        var nodes = track.querySelectorAll('.sheet-seg-item');
        for (var i = 0; i < nodes.length; i++) {
          var on = nodes[i] === button;
          nodes[i].classList.toggle('is-active', on);
          nodes[i].setAttribute('aria-pressed', on ? 'true' : 'false');
        }
        item.onSelect();
      });
      track.appendChild(button);
    });
    return track;
  }

  function openSheet(options) {
    if (!sheetParts) sheetParts = buildSheet();
    var opts = options || {};
    sheetParts.sheet.querySelector('.sheet-title').textContent = opts.title || '';
    var body = sheetParts.sheet.querySelector('.sheet-body');
    body.innerHTML = '';
    if (opts.segments) body.appendChild(buildSegments(opts.segments));
    var list = document.createElement('div');
    list.className = 'ios-list';
    (opts.items || []).forEach(function (item) {
      var row;
      if (item.href) {
        row = document.createElement('a');
        row.href = item.href;
      } else {
        row = document.createElement('button');
        row.type = 'button';
      }
      row.className = 'ios-row';
      row.textContent = item.label;
      if (item.onClick) row.addEventListener('click', function () { closeSheet(); item.onClick(); });
      list.appendChild(row);
    });
    body.appendChild(list);
    var raf = window.requestAnimationFrame || function (fn) { window.setTimeout(fn, 16); };
    raf(function () {
      sheetParts.backdrop.classList.add('is-open');
      sheetParts.sheet.classList.add('is-open');
    });
  }

  function closeSheet() {
    if (!sheetParts) return;
    sheetParts.sheet.classList.remove('is-open');
    sheetParts.backdrop.classList.remove('is-open');
  }

  function wireMore() {
    var more = document.getElementById('shellMore');
    if (!more) return;
    more.addEventListener('click', function () {
      var theme = window.ML && window.ML.currentTheme ? window.ML.currentTheme() : 'light';
      openSheet({
        title: t('shell.more'),
        segments: {
          items: [
            { label: t('theme.toLight'), selected: theme === 'light', onSelect: function () { setTheme('light'); } },
            { label: t('theme.toDark'), selected: theme === 'dark', onSelect: function () { setTheme('dark'); } }
          ]
        },
        items: [
          { label: t('shell.home'), href: 'index.html' },
          { label: t('shell.about'), href: 'about.html' }
        ]
      });
    });
  }

  /* Edge swipe back, the iOS navigation gesture. Only fires from the left edge
   * and only when there is somewhere to go back to. */
  function edgeSwipeBack() {
    var startX = null;
    document.addEventListener('touchstart', function (event) {
      var touch = event.touches && event.touches[0];
      if (!touch) return;
      startX = touch.clientX <= 24 ? touch.clientX : null;
    }, { passive: true });
    document.addEventListener('touchend', function (event) {
      if (startX === null) return;
      var touch = event.changedTouches && event.changedTouches[0];
      var dx = touch ? touch.clientX - startX : 0;
      startX = null;
      if (dx > 64 && window.history.length > 1) window.history.back();
    }, { passive: true });
  }

  /* The reader watches for this and stands its own bars down. It is set before
   * any other work so the reader never paints both sets of bars. */
  function markShell() {
    document.documentElement.setAttribute('data-shell', 'on');
    document.body.classList.add('has-shell');
    /* Which navigation this page actually has. The capsule is at the top and
     * reserves space above the content; the tab bar this replaced was at the
     * bottom. Both markups exist in the tree for one release, so the class is
     * read from the document rather than assumed from a version. */
    if (document.querySelector('.capsule')) document.body.classList.add('has-capsule');
  }

  /* The reader owns its toolbar; the shell only renders what it declares
   * (docs/coordination/interface-shell.md, contract item 3). */
  function wireReader() {
    var reader = window.Reader;
    if (!reader || typeof reader.actions !== 'function') return;
    /* The reader's actions land in the capsule's right-hand controls, before
     * the interface-language slot. The navigation bar they used to land in is
     * gone, and a hidden bar would have swallowed them without a sound. */
    var bar = document.querySelector('.capsule-inner') || document.getElementById('navbar');
    if (!bar) return;

    var host = document.createElement('div');
    host.className = 'navbar-reader-actions';
    var slot = bar.querySelector('.capsule-lang') || bar.querySelector('#siteUiLangWrap');
    var actionsHost = bar.querySelector('.navbar-actions');
    if (slot && slot.parentNode) slot.parentNode.insertBefore(host, slot);
    else if (actionsHost && actionsHost.parentNode) actionsHost.parentNode.insertBefore(host, actionsHost);
    else bar.appendChild(host);

    (reader.actions() || []).forEach(function (action) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'icon-btn';
      button.textContent = action.label;
      button.addEventListener('click', function () { reader.run(action.id); });
      host.appendChild(button);
    });

    function applyTitle() {
      if (typeof reader.title !== 'function') return;
      var value = reader.title();
      var titles = document.querySelectorAll('.navbar-compact-title, .large-title');
      for (var i = 0; i < titles.length; i++) {
        titles[i].removeAttribute('data-i18n');
        titles[i].textContent = value;
      }
    }
    applyTitle();
    if (typeof reader.on === 'function') reader.on('title', applyTitle);
  }

  function init() {
    markShell();
    markActiveTab();
    window.addEventListener('hashchange', markActiveTab);
    collapseTitle();
    wireMore();
    wireReader();
    edgeSwipeBack();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  var api = { openSheet: openSheet, closeSheet: closeSheet };
  window.ML = window.ML || {};
  window.ML.shell = api;
  window.Shell = api;
})();
