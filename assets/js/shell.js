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

  function tabKey() {
    var path = window.location.pathname;
    if (path.indexOf('/reader/') >= 0) return 'reader';
    var file = path.split('/').pop() || 'index.html';
    if (file === 'study.html') return 'learn';
    if (file === 'overview.html') return 'overview';
    return '';
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

  function openSheet(options) {
    if (!sheetParts) sheetParts = buildSheet();
    var opts = options || {};
    sheetParts.sheet.querySelector('.sheet-title').textContent = opts.title || '';
    var body = sheetParts.sheet.querySelector('.sheet-body');
    body.innerHTML = '';
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
      openSheet({
        title: t('shell.more'),
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
  }

  /* The reader owns its toolbar; the shell only renders what it declares
   * (docs/coordination/interface-shell.md, contract item 3). */
  function wireReader() {
    var reader = window.Reader;
    if (!reader || typeof reader.actions !== 'function') return;
    var navbar = document.getElementById('navbar');
    if (!navbar) return;

    var host = document.createElement('div');
    host.className = 'navbar-reader-actions';
    var actionsHost = navbar.querySelector('.navbar-actions');
    if (actionsHost && actionsHost.parentNode) actionsHost.parentNode.insertBefore(host, actionsHost);
    else navbar.querySelector('.navbar-inner').appendChild(host);

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
