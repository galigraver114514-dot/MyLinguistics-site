/**
 * Japanese segmentation over the shared dictionary, for both apps.
 *
 * Contract: docs/coordination/interface-dict.md. One implementation, called by
 * the reader (tap to look up) and by the wordbook (candidate mining). The
 * wordbook's own src/lexicon/tokenize.js is the predecessor of this file and is
 * deleted once this one is wired.
 *
 * What makes this the real tokeniser rather than a heuristic: the lexicon is
 * the dictionary itself. A dictionary index already holds every headword and
 * every reading - JMdict has 499,121 keys and an imported Yomitan dictionary
 * has one key per spelling per row - so maximal matching against it needs no
 * new data and no model download. When no dictionary is loaded at all, the
 * script-run fallback still produces usable offsets.
 *
 * The fallback shape: a kanji run takes the whole following hiragana run, then
 * gives a trailing particle back, so 食べる keeps its okurigana while 食べるまで
 * is 食べる + まで. Deciding during absorption failed in both directions - まで
 * was eaten as ま + で, and 食べさせられた split at さ - which is why the boundary
 * is found from the end of the run. Consecutive kanji still cannot be split
 * without a lexicon, which is what longestMatch is for: with one, 毎日本
 * becomes 毎日 + 本.
 *
 * Every token carries UTF-16 offsets into the original string, so a lookup can
 * always be traced back to the text the learner actually tapped.
 */

// A kanji run absorbs its okurigana, and an inflection can be long before the
// boundary is visible: 食べさせられた is six kana. Ten covers the longest common
// auxiliary chain, and a trailing particle is given back afterwards.
const MAX_OKURIGANA = 10;
const MAX_MATCH = 12;

// Suffixes that are never part of the word a kanji run started. Longest match
// wins, so まで is tried before で and から before か.
//
// The previous version decided during absorption and stopped at single-char
// particles, which failed in both directions: 食べるまで became 食べるま + で
// because まで only reveals itself at its end, and 食べさせられた split at さ
// because さ is a particle in 本さ and okurigana in させられた. Taking the whole
// okurigana run and giving a trailing particle back fixes both.
const PARTICLE_SUFFIX = new Set([
  'は', 'が', 'を', 'に', 'で', 'と', 'も', 'の', 'へ', 'や', 'か', 'ね', 'よ', 'な', 'ぞ', 'ぜ', 'さ',
  'まで', 'だけ', 'ほど', 'くらい', 'ぐらい', 'ごろ', 'ばかり', 'こそ', 'って',
  'けど', 'けれど', 'けれども', 'ので', 'のに', 'から', 'より', 'でも', 'では',
  'には', 'とは', 'へは', 'にも', 'とも', 'かも', 'とか', 'だの', 'など',
  'なんか', 'なんて', 'やら', 'きり', 'っきり', 'しか', 'ずつ', 'ため', 'ために',
  'よう', 'ように', 'として', 'について', 'によって', 'にとって', 'において',
  'です', 'でした', 'でしょう', 'である', 'であります', 'じゃない', 'ではない',
  'かもしれない', 'だろう'
]);

// だ and だった are the copula after a bare kanji (学生だ) and the past
// auxiliary after ん (読んだ). Only the first is a boundary, so they are given
// back only when they start the tail.
const BARE_COPULA = new Set(['だ', 'だった']);

// Pure-kana function words. High frequency and known to any N1+ reader, so
// they are noise in a candidate list. Deliberately small and easy to edit.
export const STOPWORDS = new Set([
  'これ', 'それ', 'あれ', 'どれ', 'この', 'その', 'あの', 'どの',
  'ここ', 'そこ', 'あそこ', 'どこ', 'こと', 'もの', 'とき', 'ところ',
  'する', 'いる', 'ある', 'なる', 'できる', 'ください', 'です', 'ます',
  'ました', 'ません', 'した', 'して', 'ている', 'てる', 'から', 'まで', 'より', 'だけ',
  'しか', 'でも', 'しかし', 'そして', 'また', 'まだ', 'もう', 'ので',
  'のに', 'けど', 'けれど', 'ながら', 'たり', 'ばかり', 'ほど', 'くらい',
  'ぐらい', 'ごろ', 'らしい', 'そう', 'どう', 'とても', '少し', 'ちょっと',
  'いつも', '時々', 'まず', 'すぐ', 'よく', 'もっと', 'すべて', '全部', 'みんな'
]);

// Every particle is a function word and none of them is content. Kept in step
// with the suffixes scriptRuns gives back rather than written out twice.
PARTICLE_SUFFIX.forEach(function (particle) { STOPWORDS.add(particle); });

/** One code point, its script class. */
export function classOf(codePoint) {
  if (codePoint === 0x3005 || codePoint === 0x3006) return 'kanji';
  if (codePoint >= 0x3400 && codePoint <= 0x4dbf) return 'kanji';
  if (codePoint >= 0x4e00 && codePoint <= 0x9fff) return 'kanji';
  if (codePoint >= 0xf900 && codePoint <= 0xfaff) return 'kanji';
  if (codePoint >= 0x20000 && codePoint <= 0x2ffff) return 'kanji';
  if (codePoint >= 0x3041 && codePoint <= 0x309f) return 'hiragana';
  if (codePoint >= 0x30a1 && codePoint <= 0x30ff) return 'katakana';
  if ((codePoint >= 65 && codePoint <= 90) || (codePoint >= 97 && codePoint <= 122)) return 'latin';
  if ((codePoint >= 48 && codePoint <= 57) || (codePoint >= 0xff10 && codePoint <= 0xff19)) return 'digit';
  return 'other';
}

/**
 * Code points with UTF-16 offsets. Iterating code points rather than UTF-16
 * units is what keeps a supplementary-plane kanji from splitting a token and
 * shifting every offset after it.
 */
export function walk(text) {
  const value = String(text == null ? '' : text);
  const out = [];
  let i = 0;
  while (i < value.length) {
    const cp = value.codePointAt(i);
    const size = cp > 0xffff ? 2 : 1;
    out.push({ cp: cp, start: i, end: i + size, ch: value.slice(i, i + size) });
    i += size;
  }
  return out;
}

/** The dominant script of a surface, kanji first. */
export function classify(surface) {
  const seen = Object.create(null);
  const order = ['kanji', 'katakana', 'hiragana', 'latin', 'digit', 'other'];
  for (let i = 0; i < surface.length; i++) {
    const cp = surface.codePointAt(i);
    seen[classOf(cp)] = true;
    if (cp > 0xffff) i += 1;
  }
  for (let k = 0; k < order.length; k++) {
    if (seen[order[k]]) return order[k];
  }
  return 'other';
}

/**
 * How many trailing code points of a hiragana run are a particle or copula.
 * chars[from..to) is the run, and the result is always at most to - from.
 */
function trailingSuffixLength(chars, value, from, to) {
  for (let len = to - from; len >= 1; len--) {
    const start = to - len;
    const surface = value.slice(chars[start].start, chars[to - 1].end);
    if (PARTICLE_SUFFIX.has(surface)) return len;
    if (start === from && BARE_COPULA.has(surface)) return len;
  }
  return 0;
}

/**
 * Script-run segmentation. No lexicon needed, and the fallback.
 *
 * A kanji run takes the whole following hiragana run - up to the cap - and then
 * gives back a trailing particle, so 食べるまで is 食べる + まで rather than
 * 食べるま + で, while 食べる keeps its okurigana and 食べさせられた survives さ.
 */
export function scriptRuns(text) {
  const value = String(text == null ? '' : text);
  const chars = walk(value);
  const tokens = [];
  let i = 0;
  while (i < chars.length) {
    const cls = classOf(chars[i].cp);
    let j = i + 1;
    while (j < chars.length && classOf(chars[j].cp) === cls) j += 1;

    if (cls === 'kanji') {
      let k = j;
      let extra = 0;
      while (k < chars.length && classOf(chars[k].cp) === 'hiragana' && extra < MAX_OKURIGANA) {
        k += 1;
        extra += 1;
      }
      const stop = k - trailingSuffixLength(chars, value, j, k);
      const last = stop - 1;
      tokens.push({
        surface: value.slice(chars[i].start, chars[last].end),
        start: chars[i].start,
        end: chars[last].end,
        cls: cls
      });
      i = stop;
      continue;
    }

    const last = j > i ? j - 1 : i;
    tokens.push({
      surface: value.slice(chars[i].start, chars[last].end),
      start: chars[i].start,
      end: chars[last].end,
      cls: cls
    });
    i = j;
  }
  return tokens;
}

function normalizeForm(value) {
  try {
    return value.normalize('NFKC');
  } catch (error) {
    return value;
  }
}

/** The longest lexicon form starting at index, or 0. */
function matchLength(value, index, lexicon, maxLength) {
  const max = Math.min(maxLength, value.length - index);
  for (let len = max; len >= 1; len -= 1) {
    const slice = value.slice(index, index + len);
    if (lexicon.has(slice) || lexicon.has(normalizeForm(slice))) return len;
  }
  return 0;
}

/**
 * Greedy maximal matching against a lexicon - anything with has(form).
 *
 * A dictionary index is the intended lexicon and exposes has() directly, so
 * this consults the index already in memory instead of copying half a million
 * strings into a Set.
 *
 * The one non-obvious part: when nothing matches at the current position the
 * next match may start one or two characters later, because a hiragana run
 * holds both an inflection and a following particle. 犬がいます must become
 * 犬 + が + います, so the gap up to the next match is script-run segmented
 * rather than the whole remaining run being swallowed.
 */
export function longestMatch(text, lexicon, options) {
  const value = String(text == null ? '' : text);
  const opts = options || {};
  if (!lexicon || typeof lexicon.has !== 'function') return scriptRuns(value);
  const maxLength = opts.maxLength || MAX_MATCH;
  const maxGap = opts.maxGap || 24;
  const tokens = [];
  let i = 0;
  while (i < value.length) {
    const len = matchLength(value, i, lexicon, maxLength);
    if (len > 0) {
      const surface = value.slice(i, i + len);
      tokens.push({ surface: surface, start: i, end: i + len, cls: classify(surface) });
      i += len;
      continue;
    }
    let j = i + 1;
    const limit = Math.min(value.length, i + maxGap);
    while (j < limit && matchLength(value, j, lexicon, maxLength) === 0) j += 1;
    const gap = scriptRuns(value.slice(i, j));
    for (let g = 0; g < gap.length; g++) {
      tokens.push({ surface: gap[g].surface, start: i + gap[g].start, end: i + gap[g].end, cls: gap[g].cls });
    }
    i = j;
  }
  return tokens;
}

/**
 * Tokens for a passage. Uses the dictionary when one is available and the
 * script runs when it is not, so a caller never branches on it.
 *
 * @param {string} text
 * @param {{lexicon?: {has: Function}, maxLength?: number}} [options]
 * @returns {Array<{surface: string, start: number, end: number, cls: string}>}
 */
export function segment(text, options) {
  const opts = options || {};
  if (opts.lexicon && typeof opts.lexicon.has === 'function') {
    return longestMatch(text, opts.lexicon, opts);
  }
  return scriptRuns(text);
}

// Demonstratives with an optional trailing particle. Script runs keep the
// particle attached, so これは arrives as one token even though これ is already
// a stopword.
const DEMONSTRATIVE = /^(これ|それ|あれ|どれ|ここ|そこ|あそこ|どこ)(は|が|を|に|で|と|も|の|へ|や|か)?$/;

/** Is this surface worth a learner's attention? */
export function isContent(surface) {
  if (!surface) return false;
  const cls = classify(surface);
  if (cls === 'latin' || cls === 'digit' || cls === 'other') return false;
  if (cls === 'hiragana') {
    if (surface.length < 2) return false;
    if (STOPWORDS.has(surface)) return false;
    if (DEMONSTRATIVE.test(surface)) return false;
    return true;
  }
  if (cls === 'katakana') return surface.length >= 2;
  if (cls === 'kanji') return true;
  return false;
}

/** Content surfaces only, which is what candidate mining wants. */
export function contentTokens(text, options) {
  const opts = options || {};
  const tokens = segment(text, opts);
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    if (opts.keepClass || isContent(tokens[i].surface)) out.push(tokens[i].surface);
  }
  return out;
}

/** The token containing a UTF-16 offset, or null. This is tap to look up. */
export function tokenAt(tokens, offset) {
  if (!tokens || typeof offset !== 'number') return null;
  for (let i = 0; i < tokens.length; i++) {
    if (offset >= tokens[i].start && offset < tokens[i].end) return tokens[i];
  }
  return null;
}

/* Sentences with offsets. Terminators are kept, trailing whitespace is not. */
const TERMINATORS = '。！？!?';

export function splitSentences(text) {
  const value = String(text == null ? '' : text);
  const out = [];
  let start = 0;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (TERMINATORS.indexOf(ch) < 0 && ch !== '\n' && ch !== '\r') continue;
    let end = i + 1;
    while (end < value.length && TERMINATORS.indexOf(value[end]) >= 0) end += 1;
    pushSentence(out, value, start, end);
    start = end;
    i = end - 1;
  }
  pushSentence(out, value, start, value.length);
  return out;
}

function pushSentence(out, value, start, end) {
  const raw = value.slice(start, end);
  const trimmed = raw.replace(/^\s+/, '');
  const lead = raw.length - trimmed.length;
  const body = trimmed.replace(/\s+$/, '');
  if (body) out.push({ text: body, start: start + lead, end: start + lead + body.length });
}

export { MAX_MATCH, MAX_OKURIGANA };

export default {
  segment: segment,
  longestMatch: longestMatch,
  scriptRuns: scriptRuns,
  contentTokens: contentTokens,
  splitSentences: splitSentences,
  isContent: isContent,
  classify: classify,
  classOf: classOf,
  walk: walk,
  tokenAt: tokenAt,
  STOPWORDS: STOPWORDS
};
