/**
 * Word lookup for the reader, with no DOM of its own.
 *
 * The reader is the only place that knows pixels; this module is the only place
 * that knows how a tap becomes a word and how one word leads to the next. It is
 * separate so both halves can be tested without a browser.
 *
 * Three things it owns:
 *
 *   Word under a tap. The chapter is tokenised against the loaded dictionary, so
 *   a tap anywhere inside a word selects the whole word and never a character.
 *   Tokenising is deferred until the first lookup, because a reader who never
 *   taps should not pay for it on every chapter.
 *
 *   Cross-reference history. A monolingual definition is full of links to other
 *   words, and following one must not lose the word you came from. Resolved
 *   views are kept on a stack, so going back is instant and needs no second
 *   lookup.
 *
 *   Neighbouring words. A fingertip is wider than a kanji, so the wrong word is
 *   occasionally picked; stepping to the previous or next word is one tap rather
 *   than a careful re-aim, which is what makes the mistake cheap.
 */
import { segment, tokenAt, isContent } from '../../src/dict/tokenize.js?v=5';

const MAX_HISTORY = 50;

/**
 * The word a cross-reference points at.
 *
 * Yomitan hrefs are not uniform: most are the headword itself, some are
 * "?query=..." or "#...", and a few are percent-encoded. Nothing here trusts the
 * href to be a word, so a caller that gets an empty string should render the
 * link as plain text rather than swallowing it.
 */
export function referenceTarget(href) {
  if (typeof href !== 'string') return '';
  let text = href.trim();
  if (!text) return '';
  if (text.charAt(0) === '?') {
    try {
      const params = new URLSearchParams(text.slice(1));
      text = params.get('query') || params.get('term') || params.get('q') || params.get('word') || '';
    } catch (error) {
      text = '';
    }
  } else if (text.charAt(0) === '#') {
    return '';
  }
  if (!text) return '';
  try {
    return decodeURIComponent(text).trim();
  } catch (error) {
    return text.trim();
  }
}

/**
 * @param {{ dictionary?: object }} [options]
 */
export function createLookup(options = {}) {
  const dictionary = options.dictionary || null;

  let text = '';
  let tokens = null;
  let history = [];
  let position = -1;

  function lexicon() {
    if (!dictionary || typeof dictionary.lexicon !== 'function') return null;
    const view = dictionary.lexicon();
    if (!view || typeof view.count !== 'function' || view.count() === 0) return null;
    return view;
  }

  /** Set the chapter text. Tokens are rebuilt on the next lookup, not now. */
  function setText(value) {
    text = typeof value === 'string' ? value : '';
    tokens = null;
    history = [];
    position = -1;
    return text.length;
  }

  function allTokens() {
    if (tokens === null) {
      const lex = lexicon();
      tokens = segment(text, lex ? { lexicon: lex } : undefined);
    }
    return tokens;
  }

  /** Indices worth offering as a word: content words, or everything if none. */
  function pickable() {
    const list = allTokens();
    const out = [];
    for (let i = 0; i < list.length; i++) {
      if (isContent(list[i].surface)) out.push(i);
    }
    if (out.length > 0) return out;
    for (let i = 0; i < list.length; i++) out.push(i);
    return out;
  }

  function wordAt(offset) {
    return tokenAt(allTokens(), offset);
  }

  function tokenIndexAt(offset) {
    const list = allTokens();
    for (let i = 0; i < list.length; i++) {
      if (offset >= list[i].start && offset < list[i].end) return i;
    }
    return -1;
  }

  /** The pickable index nearest to an offset, preferring one that contains it. */
  function nearestPickable(offset) {
    const list = allTokens();
    const indexes = pickable();
    if (indexes.length === 0) return -1;
    const containing = indexes.filter(function (i) {
      return offset >= list[i].start && offset < list[i].end;
    });
    if (containing.length > 0) return containing[0];
    for (let k = 0; k < indexes.length; k++) {
      if (list[indexes[k]].start >= offset) return indexes[k];
    }
    return indexes[indexes.length - 1];
  }

  async function look(surface, token, reason) {
    let entries = [];
    if (dictionary && typeof dictionary.lookup === 'function') {
      try {
        entries = await dictionary.lookup(surface);
      } catch (error) {
        entries = [];
      }
    }
    let candidates = [surface];
    if (dictionary && typeof dictionary.candidates === 'function') {
      try {
        const list = dictionary.candidates(surface);
        if (Array.isArray(list) && list.length > 0) candidates = list;
      } catch (error) {
        candidates = [surface];
      }
    }
    return {
      surface: surface,
      token: token || null,
      entries: entries || [],
      candidates: candidates,
      reason: reason || 'word',
      found: !!(entries && entries.length)
    };
  }

  function push(view) {
    history.push(view);
    if (history.length > MAX_HISTORY) history.shift();
    position = history.length - 1;
    return view;
  }

  /** Look up the word the offset falls in. */
  async function atOffset(offset) {
    const list = allTokens();
    if (list.length === 0) return null;
    const token = wordAt(offset);
    let surface = token ? token.surface : '';
    if (!surface) {
      const clamped = Math.max(0, Math.min(text.length - 1, offset));
      surface = text.slice(clamped, clamped + 1);
    }
    if (!surface) return null;
    return push(await look(surface, token, 'word'));
  }

  /** Step to the previous (-1) or next (+1) content word and look it up. */
  async function stepOffset(offset, direction) {
    const list = allTokens();
    const indexes = pickable();
    if (indexes.length === 0) return null;
    const current = nearestPickable(offset);
    let at = indexes.indexOf(current);
    if (at < 0) at = 0;
    let next = at + direction;
    if (next < 0 || next >= indexes.length) return null;
    const token = list[indexes[next]];
    return push(await look(token.surface, token, 'word'));
  }

  /** Follow a cross-reference from inside a definition. */
  async function follow(href) {
    const target = referenceTarget(href);
    if (!target) return null;
    return push(await look(target, null, 'reference'));
  }

  function back() {
    if (position <= 0) return null;
    position -= 1;
    return history[position];
  }

  function forward() {
    if (position < 0 || position >= history.length - 1) return null;
    position += 1;
    return history[position];
  }

  return {
    setText: setText,
    text: function () { return text; },
    tokenCount: function () { return allTokens().length; },
    wordAt: wordAt,
    tokenIndexAt: tokenIndexAt,
    atOffset: atOffset,
    stepOffset: stepOffset,
    follow: follow,
    back: back,
    forward: forward,
    canGoBack: function () { return position > 0; },
    canGoForward: function () { return position >= 0 && position < history.length - 1; },
    current: function () { return position >= 0 ? history[position] : null; },
    history: function () { return history.slice(); },
    clear: function () { history = []; position = -1; }
  };
}

export default { createLookup, referenceTarget };
