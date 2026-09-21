/**
 * Turning what is on the page into what the dictionary contains.
 *
 * Text carries inflected words: 食べました, 読んでいる, 行われた. Dictionaries
 * carry the plain form. This module produces an ordered list of candidate
 * dictionary forms for a surface string.
 *
 * Two deliberate choices:
 *
 * 1. **Over-generation is safe.** Every rewrite that could apply is emitted,
 *    even ones that produce nonsense, because the dictionary lookup itself is
 *    the filter: 書きる simply will not be found. Trying to be clever about
 *    which rewrite is correct would reject valid forms far more often than it
 *    removes noise.
 *
 * 2. **Only the longest matching ending is rewritten at each step.** 書きます
 *    must become 書く via きます and never 書きる via ます. Within that longest
 *    match every rule with the same ending is tried, because endings are
 *    genuinely ambiguous: って is 買って (う), 待って (つ) or 帰って (る), and
 *    します is both 話します (す) and します (する).
 *
 * Only the tail of a word matters, so a kanji stem is carried through
 * untouched: 行われた becomes 行う without needing to know the reading.
 */

const KATAKANA_START = 0x30a1;
const KATAKANA_END = 0x30f6;
const HIRAGANA_START = 0x3041;

/** Katakana to hiragana, by block offset. */
export function toHiragana(text) {
  if (!text) return '';
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code >= KATAKANA_START && code <= KATAKANA_END) {
      out += String.fromCodePoint(code - KATAKANA_START + HIRAGANA_START);
    } else {
      out += ch;
    }
  }
  return out;
}

/** Hiragana to katakana, by block offset. */
export function toKatakana(text) {
  if (!text) return '';
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code >= HIRAGANA_START && code <= HIRAGANA_START + (KATAKANA_END - KATAKANA_START)) {
      out += String.fromCodePoint(code - HIRAGANA_START + KATAKANA_START);
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Endings, as [inflected tail, plain tail].
 *
 * Order is irrelevant: rules are selected by the length of the match, not by
 * their position in this list. Rules whose tails are both long and specific
 * (ませんでした) exist to normalise toward ます in one step, after which the
 * ます rules do the rest.
 */
const RAW_RULES = [
  // Politeness and tense, normalised toward ます and then toward the plain form.
  ['ませんでした', 'ます'],
  ['ませんで', 'ます'],
  ['ません', 'ます'],
  ['ました', 'ます'],
  ['まして', 'ます'],
  ['ます', 'る'],

  // The polite stem, where the kana before ます decides the plain ending.
  ['きます', 'く'], ['ぎます', 'ぐ'], ['します', 'す'], ['ちます', 'つ'],
  ['にます', 'ぬ'], ['びます', 'ぶ'], ['みます', 'む'], ['ります', 'る'], ['います', 'う'],
  ['します', 'する'], ['きます', 'くる'],
  // います is also the polite auxiliary いる, as in 読んでいます.
  ['います', 'いる'],

  // Progressive and preparatory auxiliaries, which chain into the te form.
  // Both voices exist: 書いている takes て, but 読んでいる takes で, because the
  // te form of a む, ぶ or ぬ verb is voiced. Without the で-series, 読んでいます
  // rewrites to 読んでう and the chain never reaches 読む.
  ['ていました', 'て'], ['ています', 'て'], ['ている', 'て'], ['てる', 'て'], ['ていた', 'て'], ['てた', 'て'],
  ['ておく', 'て'], ['てしまう', 'て'], ['てしまった', 'て'], ['てしまい', 'て'], ['ちゃった', 'て'], ['ちゃう', 'て'],
  ['でいました', 'で'], ['でいます', 'で'], ['でいる', 'で'], ['でる', 'で'], ['でいた', 'で'], ['でた', 'で'],
  ['でおく', 'で'], ['でしまう', 'で'], ['でしまった', 'で'], ['でしまい', 'で'], ['じゃった', 'で'], ['じゃう', 'で'],

  // Te form. って also covers 行って, the one verb whose te form is irregular.
  ['いて', 'く'], ['いで', 'ぐ'], ['して', 'す'],
  ['って', 'う'], ['って', 'つ'], ['って', 'る'], ['って', 'く'],
  ['んで', 'ぬ'], ['んで', 'ぶ'], ['んで', 'む'],
  ['て', 'る'],

  // Ta form. った also covers 行った.
  ['いた', 'く'], ['いだ', 'ぐ'], ['した', 'す'],
  ['った', 'う'], ['った', 'つ'], ['った', 'る'], ['った', 'く'],
  ['んだ', 'ぬ'], ['んだ', 'ぶ'], ['んだ', 'む'],
  ['た', 'る'],

  // Negative.
  ['くなかった', 'い'], ['なかった', 'る'],
  ['かない', 'く'], ['がない', 'ぐ'], ['さない', 'す'], ['たない', 'つ'],
  ['なない', 'ぬ'], ['ばない', 'ぶ'], ['まない', 'む'], ['らない', 'る'], ['わない', 'う'],
  ['ない', 'る'], ['ず', 'る'],

  // Potential and passive.
  ['かれる', 'く'], ['がれる', 'ぐ'], ['される', 'す'], ['たれる', 'つ'],
  ['なれる', 'ぬ'], ['ばれる', 'ぶ'], ['まれる', 'む'], ['られる', 'る'], ['われる', 'う'],
  ['れる', 'る'],

  // Causative.
  ['かせる', 'く'], ['がせる', 'ぐ'], ['させる', 'す'], ['たせる', 'つ'],
  ['なせる', 'ぬ'], ['ばせる', 'ぶ'], ['ませる', 'む'], ['らせる', 'る'], ['わせる', 'う'],
  ['させる', 'る'],

  // Desiderative.
  ['きたい', 'く'], ['ぎたい', 'ぐ'], ['したい', 'す'], ['ちたい', 'つ'],
  ['にたい', 'ぬ'], ['びたい', 'ぶ'], ['みたい', 'む'], ['りたい', 'る'], ['いたい', 'う'],
  ['たい', 'る'],

  // Conditional, imperative and the i-adjective forms.
  ['ければ', 'い'], ['れば', 'る'],
  ['けば', 'く'], ['げば', 'ぐ'], ['せば', 'す'], ['てば', 'つ'],
  ['ねば', 'ぬ'], ['べば', 'ぶ'], ['めば', 'む'], ['えば', 'う'],
  ['かった', 'い'], ['くて', 'い'], ['くない', 'い'], ['く', 'い'],
  ['ろ', 'る'],

  // Copula.
  ['でした', 'だ'], ['です', 'だ'],

  // する and 来る are irregular: their stems do not follow the kana patterns,
  // so each form is listed rather than derived.
  ['しなかった', 'する'], ['しない', 'する'], ['した', 'する'],
  ['して', 'する'], ['しろ', 'する'],
  ['こなかった', 'くる'], ['こない', 'くる'], ['きた', 'くる'], ['こい', 'くる']
];

const RULES = [];
const SEEN_RULES = new Set();
for (const rule of RAW_RULES) {
  const key = rule[0] + '\u0000' + rule[1];
  if (SEEN_RULES.has(key)) continue;
  SEEN_RULES.add(key);
  RULES.push({ from: rule[0], to: rule[1], length: rule[0].length });
}

const DEFAULT_MAX_DEPTH = 4;
const DEFAULT_CAP = 64;

/** Every rule whose ending is the longest one matching this word. */
function longestMatchingRules(word) {
  let best = 0;
  for (let i = 0; i < RULES.length; i++) {
    const rule = RULES[i];
    if (rule.length > best && word.endsWith(rule.from)) best = rule.length;
  }
  if (best === 0) return [];
  const out = [];
  for (let i = 0; i < RULES.length; i++) {
    const rule = RULES[i];
    if (rule.length === best && word.endsWith(rule.from)) out.push(rule);
  }
  return out;
}

/**
 * Candidate plain forms, breadth first, so that shallower rewrites come first.
 * The original word is never included; the caller decides where it belongs.
 */
export function deinflect(word, options = {}) {
  if (!word) return [];
  const maxDepth = options.maxDepth || DEFAULT_MAX_DEPTH;
  const cap = options.cap || DEFAULT_CAP;

  const seen = new Set([word]);
  const out = [];
  let frontier = [word];

  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const next = [];
    for (let i = 0; i < frontier.length; i++) {
      const current = frontier[i];
      const rules = longestMatchingRules(current);
      for (let r = 0; r < rules.length; r++) {
        const rule = rules[r];
        const candidate = current.slice(0, current.length - rule.length) + rule.to;
        if (!candidate || seen.has(candidate)) continue;
        seen.add(candidate);
        out.push(candidate);
        next.push(candidate);
        if (out.length >= cap) return out;
      }
    }
    frontier = next;
  }
  return out;
}

/**
 * The ordered candidate list for a surface string.
 *
 * A tokeniser's basic_form comes first when there is one, because the tokeniser
 * has already done this job with knowledge of the sentence. The surface comes
 * next so that a word already in dictionary form is found without any guessing.
 * Rewrites and kana variants follow.
 */
export function candidates(surface, token) {
  const out = [];
  const seen = new Set();

  function push(value) {
    if (!value || typeof value !== 'string') return;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    out.push(trimmed);
  }

  const basic = token && token.basic_form && token.basic_form !== '*' ? token.basic_form : '';

  push(basic);
  push(surface);

  const seeds = [];
  if (basic) seeds.push(basic);
  if (surface) seeds.push(surface);

  for (let i = 0; i < seeds.length; i++) {
    const forms = deinflect(seeds[i]);
    for (let j = 0; j < forms.length; j++) push(forms[j]);
  }

  const soFar = out.slice();
  for (let i = 0; i < soFar.length; i++) {
    push(toHiragana(soFar[i]));
    push(toKatakana(soFar[i]));
  }

  return out;
}

export default { candidates, deinflect, toHiragana, toKatakana };
