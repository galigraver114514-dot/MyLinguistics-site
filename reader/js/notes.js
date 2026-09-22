/**
 * Notes on a passage.
 *
 * A note is an annotation with text: the same { start, end } anchor as a
 * highlight, plus what the reader wrote. Two things make it usable rather than
 * merely stored.
 *
 * The anchor is a baseText range, so a note survives a font change, a writing
 * mode change and a reload, exactly like a highlight.
 *
 * The marker is an overlay element positioned from the range's bounding box,
 * never a node inserted into the text. Inserting one would split the text nodes
 * the text model is built from, and that model is the one thing every other
 * annotation depends on. The overlay costs a reposition on scroll - a
 * frame-aligned pass - and buys a text model that is never mutated.
 *
 * Pure helpers only; app.js owns the DOM and the store.
 */

export function isNote(annotation) {
  return !!annotation && typeof annotation.note === 'string' && annotation.note.trim() !== '';
}

export function notesOf(annotations) {
  const list = annotations || [];
  const out = [];
  for (let i = 0; i < list.length; i++) {
    if (isNote(list[i])) out.push(list[i]);
  }
  return out;
}

/** The note whose range is exactly this range, if there is one. */
export function findNote(annotations, span) {
  if (!span) return null;
  const list = notesOf(annotations);
  for (let i = 0; i < list.length; i++) {
    if (list[i].start === span.start && list[i].end === span.end) return list[i];
  }
  return null;
}

/**
 * Where a marker sits for a range, in viewport coordinates.
 *
 * Vertical Japanese reads right to left, so its gutter is the left edge; a
 * horizontal page puts the marker on the right, clear of the text. The range's
 * own top keeps the marker beside its text, clamped so it never leaves the
 * visible box.
 */
export function markerPlacement(rect, view, options = {}) {
  if (!rect || !view) return null;
  if (!(rect.width > 0 || rect.height > 0)) return null;
  const size = options.size || 18;
  const pad = options.pad == null ? 6 : options.pad;
  const vertical = options.mode === 'vertical';
  const top = Math.max(view.top + pad, Math.min(rect.top, view.bottom - size - pad));
  const left = vertical ? view.left + pad : view.right - size - pad;
  return { left: Math.round(left), top: Math.round(top) };
}

export function previewNote(note, limit) {
  const value = String(note == null ? '' : note).replace(/\s+/g, ' ').trim();
  const max = limit || 40;
  return value.length > max ? value.slice(0, max) + '…' : value;
}

export default {
  isNote: isNote,
  notesOf: notesOf,
  findNote: findNote,
  markerPlacement: markerPlacement,
  previewNote: previewNote
};
