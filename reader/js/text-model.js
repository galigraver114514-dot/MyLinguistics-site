/**
 * Base-text offset model for one chapter of a book.
 *
 * This is the foundation every other reader feature sits on. Bookmarks, highlights
 * and notes are stored as { start, end } offsets into \`baseText\`, never as pixel
 * positions and never as DOM paths, so that changing the font size, toggling
 * furigana or switching between vertical and horizontal typesetting cannot
 * invalidate a single annotation.
 *
 * Two rules make that work:
 *
 *   1. The mapping between baseText and the DOM is exact within each text node.
 *      Text is never collapsed, because collapsing would break the inverse
 *      mapping and anchoring matters more than tidy text. The only adjustment
 *      is trimming ASCII whitespace from the two edges of a node that also holds
 *      text; how much was trimmed is recorded in segment.nodeStart, so the
 *      mapping stays exact.
 *
 *   2. Ruby annotations are excluded from baseText and recorded separately in
 *      \`ruby\`. If the reading lived in baseText, turning furigana on would shift
 *      every offset after the first annotated word.
 *
 * Whitespace: a text node that is nothing but whitespace is dropped when it is
 * indentation - that is, when its parent is a block element, or when it contains
 * a newline. Meaningful inline spacing between two inline elements is kept. This
 * is tuned for Japanese, where XHTML indentation must not become visible spaces;
 * pass { dropIndentationWhitespace: false } to keep everything verbatim.
 *
 * No globals are touched: the document is taken from root.ownerDocument, so this
 * runs unchanged under Node with jsdom.
 */

const SKIP_TAGS = new Set(['RT', 'RP', 'SCRIPT', 'STYLE', 'HEAD', 'TITLE', 'META', 'LINK']);

const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'BODY', 'DD', 'DIV', 'DL', 'DT',
  'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4',
  'H5', 'H6', 'HEADER', 'HR', 'HTML', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE',
  'SECTION', 'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL'
]);

const WHITESPACE_ONLY = /^\s+$/;

/** ASCII whitespace only. U+3000 and other Japanese spaces are content. */
function isAsciiSpace(code) {
  return code === 32 || (code >= 9 && code <= 13);
}

/**
 * Build the offset model for a chapter.
 *
 * @param {Element} root      the element holding the chapter's text
 * @param {object} [options]
 * @param {boolean} [options.dropIndentationWhitespace=true]
 * @returns {ChapterModel}
 */
export function buildChapter(root, options = {}) {
  if (!root) throw new TypeError('buildChapter needs a root element');

  const dropIndentationWhitespace = options.dropIndentationWhitespace !== false;

  const segments = [];      // ordered, non-overlapping, contiguous in baseText
  const segmentByNode = new Map();
  const ruby = [];
  const parts = [];
  let length = 0;

  function isIndentation(node) {
    if (!dropIndentationWhitespace) return false;
    if (!WHITESPACE_ONLY.test(node.data)) return false;

    const parent = node.parentNode;
    const parentIsBlock = !!parent && parent.nodeType === 1 && BLOCK_TAGS.has(parent.tagName);
    const hasNewline = node.data.indexOf('\n') !== -1;

    let prev = node.previousSibling;
    while (prev && prev.nodeType === 3 && WHITESPACE_ONLY.test(prev.data)) prev = prev.previousSibling;
    let next = node.nextSibling;
    while (next && next.nodeType === 3 && WHITESPACE_ONLY.test(next.data)) next = next.nextSibling;

    const prevIsBlockOrNothing = !prev || (prev.nodeType === 1 && BLOCK_TAGS.has(prev.tagName));
    const nextIsBlockOrNothing = !next || (next.nodeType === 1 && BLOCK_TAGS.has(next.tagName));

    // Whitespace sitting between two block siblings, or alone in its parent:
    // that is pretty-printing, never text.
    if (prevIsBlockOrNothing && nextIsBlockOrNothing) return true;

    // Leading or trailing indentation inside a block, e.g. "<p>\n  text\n</p>".
    if (hasNewline && parentIsBlock && (!prev || !next)) return true;

    // Anything else is kept, including a single space between two inline
    // elements and a wrapped line inside a paragraph. Keeping it verbatim is
    // what preserves the exact 1:1 offset mapping.
    return false;
  }

  function emit(node, from, to) {
    const start = length;
    const text = node.data.slice(from, to);
    const end = start + text.length;
    const segment = { start: start, end: end, node: node, nodeStart: from };
    segments.push(segment);
    segmentByNode.set(node, segment);
    parts.push(text);
    length = end;
  }

  function walk(node) {
    if (node.nodeType === 3) {
      if (isIndentation(node)) return;
      if (WHITESPACE_ONLY.test(node.data)) {
        emit(node, 0, node.data.length);
        return;
      }
      const data = node.data;
      let from = 0;
      let to = data.length;
      while (from < to && isAsciiSpace(data.charCodeAt(from))) from++;
      while (to > from && isAsciiSpace(data.charCodeAt(to - 1))) to--;
      emit(node, from, to);
      return;
    }
    if (node.nodeType !== 1) return;

    const tag = node.tagName;
    if (SKIP_TAGS.has(tag)) return;

    if (tag === 'RUBY') {
      const start = length;
      let reading = '';
      const children = node.childNodes;
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (child.nodeType === 1 && (child.tagName === 'RT' || child.tagName === 'RP')) {
          if (child.tagName === 'RT' && !reading) reading = child.textContent.trim();
          continue;
        }
        walk(child);
      }
      if (length > start && reading) {
        ruby.push({ start: start, end: length, reading: reading, authored: true });
      }
      return;
    }

    const children = node.childNodes;
    for (let i = 0; i < children.length; i++) walk(children[i]);
  }

  walk(root);

  const baseText = parts.join('');

  /** Index of the last segment whose start is <= offset, or -1. */
  function segmentIndexAt(offset) {
    let lo = 0;
    let hi = segments.length - 1;
    let best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (segments[mid].start <= offset) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return best;
  }

  /** A { node, offset } pair usable with Range.setStart / setEnd. */
  function locate(offset) {
    if (segments.length === 0) return null;
    const clamped = Math.max(0, Math.min(offset, length));
    const i = segmentIndexAt(clamped);
    if (i < 0) return { node: segments[0].node, offset: 0 };
    const segment = segments[i];
    const local = Math.min(clamped - segment.start, segment.end - segment.start);
    return { node: segment.node, offset: (segment.nodeStart || 0) + local };
  }

  function offsetOf(node, offsetInNode) {
    const segment = segmentByNode.get(node);
    if (!segment) return -1;
    const size = segment.end - segment.start;
    const local = Math.max(0, Math.min(offsetInNode - (segment.nodeStart || 0), size));
    return segment.start + local;
  }

  return {
    root: root,
    baseText: baseText,
    length: length,
    segments: segments,
    ruby: ruby,

    /** Substring of baseText. */
    slice(start, end) {
      return baseText.slice(start, end);
    },

    /** baseText offset for a position inside a tracked text node, or -1. */
    offsetAt: offsetOf,

    /** { start, end } for a DOM Range, or null if either end is untracked. */
    offsetForRange(range) {
      const start = offsetOf(range.startContainer, range.startOffset);
      const end = offsetOf(range.endContainer, range.endOffset);
      if (start < 0 || end < 0) return null;
      return { start: Math.min(start, end), end: Math.max(start, end) };
    },

    /** A DOM Range for a baseText range, or null if there is no text at all. */
    rangeFor(start, end) {
      const a = locate(start);
      const b = locate(end);
      if (!a || !b) return null;
      const doc = root.ownerDocument;
      const range = doc.createRange();
      range.setStart(a.node, a.offset);
      range.setEnd(b.node, b.offset);
      return range;
    },

    /** The tracked text node containing an offset, and the local offset in it. */
    nodeAt(offset) {
      return locate(offset);
    },

    /** Every segment overlapping [start, end), in order. */
    segmentsFor(start, end) {
      const out = [];
      for (let i = 0; i < segments.length; i++) {
        const s = segments[i];
        if (s.end <= start) continue;
        if (s.start >= end) break;
        out.push(s);
      }
      return out;
    },

    /** The authored ruby annotation covering an offset, if any. */
    rubyAt(offset) {
      for (let i = 0; i < ruby.length; i++) {
        if (offset >= ruby[i].start && offset < ruby[i].end) return ruby[i];
      }
      return null;
    },

    /** Every ruby annotation overlapping [start, end). */
    rubyFor(start, end) {
      const out = [];
      for (let i = 0; i < ruby.length; i++) {
        const r = ruby[i];
        if (r.end <= start) continue;
        if (r.start >= end) break;
        out.push(r);
      }
      return out;
    }
  };
}

export default { buildChapter };
