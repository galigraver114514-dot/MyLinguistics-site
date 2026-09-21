/* Japanese text segmentation for candidate mining.
 *
 * This is deliberately not a morphological analyser. A real one (kuromoji, or
 * the shared dictionary's own index) is the phase-2 plan, and the design says
 * so. What lives here is the honest fallback that still works with no
 * dictionary and no build step:
 *
 *   1. scriptRuns  - split on script boundaries. A kanji run absorbs a short
 *      hiragana tail so that 食べる and 読みます stay whole, but stops at a
 *      particle so that 本を does not become one token. Consecutive kanji
 *      cannot be split correctly without a lexicon; see (2).
 *   2. longestMatch - greedy maximal matching against a known-lemma set. Once
 *      a frequency list or a lexicon of any size is imported this is used
 *      instead, and 毎日本 resolves to 毎日 + 本.
 *
 * Both return tokens with UTF-16 offsets, so a candidate can always be traced
 * back to the sentence it came from.
 */

var MAX_OKURIGANA = 4;
var MAX_MATCH = 12;

/* Particles and copular fragments that end a kanji stem's hiragana tail. */
var TAIL_STOP = new Set([
  'を', 'は', 'が', 'に', 'で', 'と', 'も', 'の', 'へ', 'や', 'か', 'ね', 'よ', 'な', 'ぞ', 'ぜ', 'さ'
]);

/* Pure-kana function words. High frequency and known to any N1+ reader, so
 * they are noise in a candidate list. The list is deliberately small and
 * easy to edit. */
export var STOPWORDS = new Set([
  'これ', 'それ', 'あれ', 'どれ', 'この', 'その', 'あの', 'どの',
  'ここ', 'そこ', 'あそこ', 'どこ', 'こと', 'もの', 'とき', 'ところ',
  'する', 'いる', 'ある', 'なる', 'できる', 'ください', 'です', 'ます',
  'ました', 'ません', 'ている', 'てる', 'から', 'まで', 'より', 'だけ',
  'しか', 'でも', 'しかし', 'そして', 'また', 'まだ', 'もう', 'ので',
  'のに', 'けど', 'けれど', 'ながら', 'たり', 'ばかり', 'ほど', 'くらい',
  'ぐらい', 'ごろ', 'らしい', 'そう', 'どう', 'とても', '少し', 'ちょっと',
  'いつも', '時々', 'まず', 'すぐ', 'よく', 'もっと', 'すべて', '全部', 'みんな'
]);

/* One code point, its class, and its UTF-16 offsets. */
export function classOf(codePoint) {
  if (codePoint === 0x3005 || codePoint === 0x3006) return 'kanji';
  if (codePoint >= 0x3400 && codePoint <= 0x4dbf) return 'kanji';
  if (codePoint >= 0x4e00 && codePoint <= 0x9fff) return 'kanji';
  if (codePoint >= 0xf900 && codePoint <= 0xfaff) return 'kanji';
  if (codePoint >= 0x3041 && codePoint <= 0x309f) return 'hiragana';
  if (codePoint >= 0x30a1 && codePoint <= 0x30ff) return 'katakana';
  if ((codePoint >= 65 && codePoint <= 90) || (codePoint >= 97 && codePoint <= 122)) return 'latin';
  if ((codePoint >= 48 && codePoint <= 57) || (codePoint >= 0xff10 && codePoint <= 0xff19)) return 'digit';
  return 'other';
}

export function walk(text) {
  var value = String(text == null ? '' : text);
  var out = [];
  var i = 0;
  while (i < value.length) {
    var cp = value.codePointAt(i);
    var size = cp > 0xffff ? 2 : 1;
    out.push({ cp: cp, start: i, end: i + size, ch: value.slice(i, i + size) });
    i += size;
  }
  return out;
}

/* The dominant script of a surface, kanji first. Used to filter tokens. */
export function classify(surface) {
  var seen = {};
  var order = ['kanji', 'katakana', 'hiragana', 'latin', 'digit', 'other'];
  for (var i = 0; i < surface.length; i++) {
    var cp = surface.codePointAt(i);
    seen[classOf(cp)] = true;
    if (cp > 0xffff) i += 1;
  }
  for (var k = 0; k < order.length; k++) {
    if (seen[order[k]]) return order[k];
  }
  return 'other';
}

/* Script-run segmentation. Fast, no lexicon needed, and the fallback. */
export function scriptRuns(text) {
  var value = String(text == null ? '' : text);
  var chars = walk(value);
  var tokens = [];
  var i = 0;
  while (i < chars.length) {
    var cls = classOf(chars[i].cp);
    var j = i + 1;
    while (j < chars.length && classOf(chars[j].cp) === cls) j += 1;

    if (cls === 'kanji') {
      var k = j;
      var extra = 0;
      while (k < chars.length && classOf(chars[k].cp) === 'hiragana' && extra < MAX_OKURIGANA && !TAIL_STOP.has(chars[k].ch)) {
        k += 1;
        extra += 1;
      }
      j = k;
    }

    var last = j > i ? j - 1 : i;
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

/* Greedy maximal matching against a Set of known forms. Falls back to a script
 * run wherever nothing in the lexicon matches at the current position. */
export function longestMatch(text, lexicon) {
  var value = String(text == null ? '' : text);
  var known = lexicon || new Set();
  var tokens = [];
  var i = 0;
  while (i < value.length) {
    var matched = null;
    var max = Math.min(MAX_MATCH, value.length - i);
    for (var len = max; len >= 1; len -= 1) {
      var slice = value.slice(i, i + len);
      if (known.has(slice.normalize('NFKC'))) {
        matched = slice;
        break;
      }
    }
    if (matched) {
      tokens.push({ surface: matched, start: i, end: i + matched.length, cls: classify(matched) });
      i += matched.length;
      continue;
    }
    var run = scriptRuns(value.slice(i));
    var first = run[0];
    if (!first) break;
    tokens.push({ surface: first.surface, start: i + first.start, end: i + first.end, cls: first.cls });
    i += first.end;
  }
  return tokens;
}

/* Demonstratives with an optional trailing particle. Script runs keep the
 * particle attached, so これは arrives as one token even though これ is already
 * a stopword. */
var DEMONSTRATIVE = /^(これ|それ|あれ|どれ|ここ|そこ|あそこ|どこ)(は|が|を|に|で|と|も|の|へ|や|か)?$/;

export function isContent(surface) {
  if (!surface) return false;
  var cls = classify(surface);
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

/* Segmented tokens, filtered to content words. options.lexicon, when present
 * and non-empty, switches on maximal matching. Returns string surfaces. */
export function contentTokens(text, options) {
  var opts = options || {};
  var lexicon = opts.lexicon;
  var tokens = lexicon && lexicon.size ? longestMatch(text, lexicon) : scriptRuns(text);
  return tokens
    .map(function (token) { return token; })
    .filter(function (token) {
      if (opts.keepClass) return true;
      return isContent(token.surface);
    })
    .map(function (token) { return token.surface; });
}

/* Sentences with offsets. Terminators are kept, trailing whitespace is not. */
export function splitSentences(text) {
  var value = String(text == null ? '' : text);
  var out = [];
  var start = 0;
  var TERMINATORS = '。！？!?';
  for (var i = 0; i < value.length; i += 1) {
    var ch = value[i];
    if (TERMINATORS.indexOf(ch) < 0 && ch !== '\n' && ch !== '\r') continue;
    var end = i + 1;
    while (end < value.length && TERMINATORS.indexOf(value[end]) >= 0) end += 1;
    pushSentence(out, value, start, end);
    start = end;
    i = end - 1;
  }
  pushSentence(out, value, start, value.length);
  return out;
}

function pushSentence(out, value, start, end) {
  var raw = value.slice(start, end);
  var trimmed = raw.replace(/^\s+/, '');
  var lead = raw.length - trimmed.length;
  var body = trimmed.replace(/\s+$/, '');
  if (body) out.push({ text: body, start: start + lead, end: start + lead + body.length });
}
