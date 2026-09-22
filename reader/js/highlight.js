/**
 * Painting ranges with the CSS Custom Highlight API.
 *
 * The API paints ranges without touching the DOM, so an annotation can never
 * invalidate the offsets it is anchored to, and a range may cross element
 * boundaries. It has one footgun that cost three spike rounds to find:
 * registering a highlight whose subtree has no layout boxes - a display: none
 * stage, for instance - fails silently and permanently, while the JS API
 * reports success and the range still has geometry.
 *
 * So every range is measured for client rects before it is registered, and a
 * highlight with no visible range is removed instead. Callers should still
 * paint after the content is visible and laid out; the painter never registers
 * blind, and it never leaves behind a highlight it could not see.
 *
 * The registry and the constructor are injected rather than reached for, so the
 * whole thing is testable under jsdom, which has neither.
 */

export function createPainter(env = {}) {
  const highlights = env.highlights || null;
  const HighlightCtor = env.Highlight || null;
  const supported = !!(
    highlights
    && typeof highlights.set === 'function'
    && typeof highlights.delete === 'function'
    && typeof HighlightCtor === 'function'
  );

  function measurable(range) {
    if (!range || typeof range.getClientRects !== 'function') return false;
    try {
      const rects = range.getClientRects();
      return !!rects && rects.length > 0;
    } catch (error) {
      return false;
    }
  }

  function paint(name, ranges, options = {}) {
    const list = Array.isArray(ranges) ? ranges : (ranges ? [ranges] : []);
    if (!supported) return { supported: false, painted: 0, skipped: list.length };

    const visible = [];
    let skipped = 0;
    for (let i = 0; i < list.length; i++) {
      if (measurable(list[i])) visible.push(list[i]);
      else skipped++;
    }

    if (visible.length === 0) {
      try { highlights.delete(name); } catch (error) { /* nothing to remove */ }
      return { supported: true, painted: 0, skipped: skipped };
    }

    const highlight = new HighlightCtor(...visible);
    if (options.priority !== undefined) highlight.priority = options.priority;
    highlights.set(name, highlight);
    return { supported: true, painted: visible.length, skipped: skipped };
  }

  function clear(name) {
    if (!supported) return false;
    try {
      highlights.delete(name);
      return true;
    } catch (error) {
      return false;
    }
  }

  function has(name) {
    if (!highlights || typeof highlights.has !== 'function') return false;
    try { return highlights.has(name); } catch (error) { return false; }
  }

  return { supported: supported, paint: paint, clear: clear, has: has };
}

export default { createPainter: createPainter };
