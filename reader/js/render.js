/**
 * Mounting a chapter into the page.
 *
 * This is separate from app.js purely so it can be tested, because it is the
 * one place where a plausible-looking line can hang the browser forever:
 *
 *     while (body.firstChild) container.appendChild(document.importNode(body.firstChild, true));
 *
 * importNode copies a node, it does not move it, so body.firstChild never
 * changes and the loop never ends. That bug shipped once and froze the reader
 * on the loading screen. The test for it lives in tests/reader-render.test.js.
 */

const DROP_SELECTOR = 'script, style, link, meta, title, base, object, iframe, embed, noscript';

/** Parse chapter source. HTML parsing is used even for XHTML because it is
 *  more forgiving, and the result is only ever rendered, never re-serialised. */
export function parseChapter(html, domParser) {
  const Parser = domParser || globalThis.DOMParser;
  if (!Parser) throw new Error('parseChapter needs a DOMParser');
  return new Parser().parseFromString(String(html == null ? '' : html), 'text/html');
}

/** Remove anything that must not run or must not affect layout. */
export function stripNonContent(doc) {
  const found = doc.querySelectorAll(DROP_SELECTOR);
  let removed = 0;
  for (let i = 0; i < found.length; i++) {
    const node = found[i];
    if (node.parentNode) {
      node.parentNode.removeChild(node);
      removed++;
    }
  }
  return removed;
}

/**
 * Move every child of the parsed body into the container.
 *
 * Removal happens first and is what makes the loop terminate; the import is
 * only there to bring the nodes into the container's document.
 *
 * @returns {number} how many nodes were moved
 */
export function mountBody(doc, container) {
  const target = container.ownerDocument;
  const body = doc.body;
  if (!body) return 0;
  let moved = 0;
  while (body.firstChild) {
    const child = body.removeChild(body.firstChild);
    container.appendChild(target.importNode(child, true));
    moved++;
  }
  return moved;
}

/** Parse, strip and mount in one step. */
export function prepareAndMount(html, container, domParser) {
  const doc = parseChapter(html, domParser);
  const stripped = stripNonContent(doc);
  const moved = mountBody(doc, container);
  return { stripped: stripped, moved: moved, doc: doc };
}

export default { parseChapter, stripNonContent, mountBody, prepareAndMount };
