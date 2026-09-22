/**
 * Turning an offset into a range worth acting on.
 *
 * Pure functions over offsets and small provider callbacks, so the granularity
 * rules can be tested without a DOM. The reader supplies the providers: the
 * tokeniser for words, the sentence splitter for sentences, and the text model
 * for paragraphs - and paragraphs have to come from the DOM, because baseText
 * joins them with no separator at all.
 */

export const GRANULARITIES = ['word', 'sentence', 'paragraph'];

export function normalizeRange(a, b) {
  return { start: Math.min(a, b), end: Math.max(a, b) };
}

export function wordRange(offset, wordAt) {
  if (typeof wordAt !== 'function') return null;
  const token = wordAt(offset);
  if (!token) return null;
  return { start: token.start, end: token.end };
}

/** The sentence containing an offset, or the last one starting before it. */
export function sentenceRange(offset, sentences) {
  if (!Array.isArray(sentences) || sentences.length === 0) return null;
  let best = null;
  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    if (offset >= sentence.start && offset < sentence.end) {
      return { start: sentence.start, end: sentence.end };
    }
    if (sentence.start <= offset) best = sentence;
  }
  if (best) return { start: best.start, end: best.end };
  return { start: sentences[0].start, end: sentences[0].end };
}

/**
 * The range for a granularity at an offset. Providers are tried in order and
 * the word is the floor: a caller always gets something, so an action can never
 * be offered with nothing selected.
 */
export function rangeFor(granularity, offset, providers = {}) {
  // Widening is a chain, not a switch: a paragraph that the DOM cannot identify
  // must still yield its sentence rather than dropping straight to one word.
  const order = granularity === 'paragraph'
    ? ['paragraph', 'sentence', 'word']
    : (granularity === 'sentence' ? ['sentence', 'word'] : ['word']);

  for (let i = 0; i < order.length; i++) {
    const level = order[i];
    if (level === 'paragraph' && typeof providers.paragraphAt === 'function') {
      const paragraph = providers.paragraphAt(offset);
      if (paragraph) return paragraph;
    }
    if (level === 'sentence') {
      const sentence = sentenceRange(offset, providers.sentences);
      if (sentence) return sentence;
    }
    if (level === 'word') {
      const word = wordRange(offset, providers.wordAt);
      if (word) return word;
    }
  }
  return { start: offset, end: offset + 1 };
}

/** sentence -> paragraph -> sentence: what a repeated double tap cycles. */
export function cycleGranularity(current) {
  return current === 'sentence' ? 'paragraph' : 'sentence';
}

/**
 * A range for a Pencil drag. Snaps outward to word boundaries so a hand-drawn
 * line does not begin or end in the middle of a word, which is what makes it
 * look deliberate rather than sloppy.
 */
export function dragRange(a, b, wordAt) {
  const range = normalizeRange(a, b);
  if (typeof wordAt !== 'function') return range;
  const first = wordAt(range.start);
  const last = wordAt(Math.max(range.start, range.end - 1));
  return {
    start: first ? first.start : range.start,
    end: last ? last.end : range.end
  };
}

export function isRange(value) {
  return !!value
    && typeof value.start === 'number'
    && typeof value.end === 'number'
    && value.end > value.start;
}

/** Shorten a passage for a button label. */
export function preview(text, limit) {
  const value = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  const max = limit || 24;
  return value.length > max ? value.slice(0, max) + '…' : value;
}

export default {
  GRANULARITIES: GRANULARITIES,
  normalizeRange: normalizeRange,
  wordRange: wordRange,
  sentenceRange: sentenceRange,
  rangeFor: rangeFor,
  cycleGranularity: cycleGranularity,
  dragRange: dragRange,
  isRange: isRange,
  preview: preview
};
