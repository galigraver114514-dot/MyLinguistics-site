/* MyLinguistics - shared runtime: interface language, theme, and chrome.
 *
 * The study engine lives in src/lexicon/ and the reader in reader/. This file
 * owns only the parts every page shares. The old Leitner engine is gone.
 */
window.ML = (function () {
  'use strict';

  var UI_LANG_KEY = 'ml.uilang';
  var THEME_KEY = 'ml.theme';
  var UI_LANG_NAMES = { en: 'English', zh: '中文', ja: '日本語' };

  function $(id) { return document.getElementById(id); }

  function setText(id, value) {
    var el = $(id);
    if (el) el.textContent = String(value);
  }

  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function uiLang() {
    var stored = null;
    try { stored = window.localStorage.getItem(UI_LANG_KEY); } catch (err) { stored = null; }
    var i18n = window.ML_I18N;
    if (i18n && i18n.supported(stored)) return i18n.normalize(stored);
    return i18n ? i18n.detect() : 'en';
  }

  function setUiLang(code, options) {
    var i18n = window.ML_I18N;
    if (!i18n || !i18n.supported(code)) return false;
    try { window.localStorage.setItem(UI_LANG_KEY, i18n.normalize(code)); } catch (err) { return false; }
    if (!options || options.reload !== false) window.location.reload();
    return true;
  }

  function t(key, vars) {
    var i18n = window.ML_I18N;
    if (!i18n) return key;
    return i18n.translate(uiLang(), key, vars);
  }

  function applyI18n(root) {
    var scope = root || document;
    var nodes = scope.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].textContent = t(nodes[i].getAttribute('data-i18n'));
    }
    var attrs = [
      ['data-i18n-aria', 'aria-label'],
      ['data-i18n-title', 'title'],
      ['data-i18n-placeholder', 'placeholder']
    ];
    attrs.forEach(function (pair) {
      var list = scope.querySelectorAll('[' + pair[0] + ']');
      for (var j = 0; j < list.length; j++) {
        list[j].setAttribute(pair[1], t(list[j].getAttribute(pair[0])));
      }
    });
  }

  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  /* One place decides what the theme is and remembers it. The capsule has room
   * for the interface language and the more button and nothing else, so the
   * appearance control lives in the more sheet and calls this. */
  function setTheme(next) {
    var value = next === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', value);
    try { window.localStorage.setItem(THEME_KEY, value); } catch (err) { /* ignore */ }
    return value;
  }

  function buildUiLangSwitch() {
    /* The capsule has a slot for this; `.header-inner` is what older pages have
     * and what tests/lang-switch.test.js builds its fixture from. */
    var header = $('siteUiLangWrap') || document.querySelector('.header-inner');
    if (!header) return null;
    var i18n = window.ML_I18N;
    var codes = i18n ? i18n.SUPPORTED : ['en'];
    var select = document.createElement('select');
    select.id = 'siteUiLangSelect';
    select.setAttribute('aria-label', t('lang.uiLabel'));
    select.title = t('lang.uiLabel');
    codes.forEach(function (code) {
      var option = document.createElement('option');
      option.value = code;
      option.textContent = UI_LANG_NAMES[code] || code;
      select.appendChild(option);
    });
    select.value = uiLang();
    select.addEventListener('change', function () { setUiLang(select.value); });
    var wrap = document.createElement('div');
    wrap.className = 'lang-switch';
    wrap.appendChild(select);
    var toggle = $('themeToggle');
    if (toggle && toggle.parentNode === header) header.insertBefore(wrap, toggle);
    else header.appendChild(wrap);
    return select;
  }

  function initChrome() {
    var root = document.documentElement;
    var toggle = $('themeToggle');
    var stored = null;
    try { stored = window.localStorage.getItem(THEME_KEY); } catch (err) { stored = null; }
    if (stored === 'dark' || stored === 'light') root.setAttribute('data-theme', stored);

    if (window.ML_I18N) {
      root.setAttribute('lang', uiLang());
      applyI18n(document);
    }

    function syncToggle() {
      if (!toggle) return;
      var dark = root.getAttribute('data-theme') === 'dark';
      toggle.textContent = dark ? t('theme.toLight') : t('theme.toDark');
      toggle.setAttribute('aria-label', dark ? t('theme.ariaLight') : t('theme.ariaDark'));
      toggle.setAttribute('title', dark ? t('theme.ariaLight') : t('theme.ariaDark'));
    }

    if (toggle) {
      syncToggle();
      toggle.addEventListener('click', function () {
        setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
        syncToggle();
      });
    }

    var navToggle = $('navToggle');
    var nav = $('siteNav');
    if (navToggle && nav) {
      navToggle.addEventListener('click', function () {
        var open = nav.classList.toggle('is-open');
        navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    }

    var page = window.location.pathname.split('/').pop() || 'index.html';
    var links = document.querySelectorAll('.site-nav a');
    for (var i = 0; i < links.length; i++) {
      if (links[i].getAttribute('href') === page) links[i].classList.add('is-active');
    }

    buildUiLangSwitch();
    setText('year', new Date().getFullYear());
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initChrome);
  else initChrome();

  return {
    UI_LANG_KEY: UI_LANG_KEY,
    THEME_KEY: THEME_KEY,
    $: $,
    setText: setText,
    escapeHtml: escapeHtml,
    uiLang: uiLang,
    setUiLang: setUiLang,
    currentTheme: currentTheme,
    setTheme: setTheme,
    t: t,
    applyI18n: applyI18n
  };
})();
