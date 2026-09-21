/**
 * Yomitan structured-content rendering.
 *
 * Contract: docs/coordination/interface-dict.md, "Structured content".
 *
 * A monolingual dictionary's glossary is not a string. It is a tree of
 * { tag, style, data, content, href } nodes, and this is the only file under
 * src/dict/ allowed to touch a DOM.
 *
 * Three things here are not optional for a Japanese-Japanese dictionary:
 *
 *   Cross-references. Looking up one word leads to the next, so a dead <a>
 *   makes the dictionary useless. Every reference is a focusable element that
 *   calls options.onReference(href, event, text) and fires a bubbling
 *   'dictionary-reference' CustomEvent carrying the same href.
 *
 *   data.name. 大辞林 tags 見出部, 見出仮名, 標準表記 and others. They are
 *   semantic, so they survive as data-name and per-dictionary CSS can target
 *   them. They are never discarded.
 *
 *   Per-dictionary styles.css. Scoped to the dictionary's own container and
 *   injected once, so importing a second dictionary cannot restyle the first.
 *
 * The module never fetches anything. Images are marked with data-path and
 * resolved by the caller, which is the only party that knows the zip; see
 * hydrateImages for the asynchronous second pass.
 */

const REQUIRED_TAGS = [
  'span', 'div', 'p', 'ol', 'ul', 'li',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'ruby', 'rb', 'rt', 'br', 'img', 'a'
];

const TAG_SET = new Set(REQUIRED_TAGS);

// Tags the module will not reproduce even when a dictionary asks for them. The
// element is dropped but its text is kept, so a glossary never renders as
// markup and never silently loses words.
const DROPPED_TAGS = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'base',
  'form', 'input', 'button', 'select', 'textarea', 'svg', 'math',
  'template', 'noscript', 'frame', 'frameset', 'applet', 'portal'
]);

// At-rules whose block is a list of rules that must themselves be scoped.
// Everything else with a block - @font-face, @keyframes, @page - is emitted
// untouched, because its inner preludes are not selectors.
const NESTING_AT_RULES = new Set([
  'media', 'supports', 'document', 'layer', 'container', 'scope', 'when'
]);

const UNSAFE_STYLE_VALUE = /url\s*\(|expression\s*\(|javascript:|@import|behavior\s*:/i;
const SAFE_PROPERTY = /^[-a-zA-Z][-a-zA-Z0-9]*$/;

function pickDocument(options) {
  const doc = (options && (options.document || options.ownerDocument))
    || (typeof globalThis !== 'undefined' ? globalThis.document : null);
  if (!doc || typeof doc.createElement !== 'function') {
    throw new Error('structured content needs a document; pass options.document outside a browser');
  }
  return doc;
}

/** camelCase CSS property names -> kebab-case, which is what setProperty wants. */
function kebab(name) {
  return String(name).replace(/[A-Z]/g, function (m) { return '-' + m.toLowerCase(); });
}

function applyStyle(el, style) {
  if (!style || typeof style !== 'object') return;
  const keys = Object.keys(style);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const value = style[key];
    if (value === null || value === undefined) continue;
    const text = String(value);
    // A dictionary stylesheet is not attacker-controlled, but a gloss that can
    // pull in a network resource is still a bad gloss. Drop the declaration
    // rather than the node.
    if (UNSAFE_STYLE_VALUE.test(text)) continue;
    if (!SAFE_PROPERTY.test(key)) continue;
    try {
      el.style.setProperty(kebab(key), text);
    } catch (error) {
      // One bad declaration must not cost the whole gloss.
    }
  }
}

/**
 * data.name is semantic and must survive. Any other data key is preserved too,
 * because dictionaries use them for colour keys and image metadata.
 */
function applyData(el, data) {
  if (!data || typeof data !== 'object') return;
  const keys = Object.keys(data);
  for (let i = 0; i < keys.length; i++) {
    const value = data[keys[i]];
    if (value === null || value === undefined || typeof value === 'object') continue;
    el.setAttribute('data-' + kebab(keys[i]), String(value));
  }
}

function applySpans(el, item) {
  if (item.colSpan !== undefined) el.setAttribute('colspan', String(item.colSpan));
  if (item.rowSpan !== undefined) el.setAttribute('rowspan', String(item.rowSpan));
}

function resolveImage(path, options) {
  if (!options || typeof options.resolveImage !== 'function') return null;
  try {
    const url = options.resolveImage(path);
    return typeof url === 'string' && url ? url : null;
  } catch (error) {
    return null;
  }
}

function buildImage(doc, item, options) {
  const img = doc.createElement('img');
  img.setAttribute('loading', 'lazy');
  img.setAttribute('decoding', 'async');
  const alt = item.alt !== undefined ? item.alt : item.title;
  if (alt !== undefined && alt !== null) img.setAttribute('alt', String(alt));
  if (item.width !== undefined) img.setAttribute('width', String(item.width));
  if (item.height !== undefined) img.setAttribute('height', String(item.height));
  const path = typeof item.path === 'string' ? item.path
    : (typeof item.src === 'string' ? item.src : '');
  if (path) {
    const url = resolveImage(path, options);
    if (url) img.setAttribute('src', url);
    else img.setAttribute('data-path', path);
  }
  applyData(img, item.data);
  return img;
}

/**
 * A cross-reference. Deliberately not a real href: a dictionary reference is a
 * lookup, not a navigation, and letting the browser follow it would push the
 * wrong thing onto the history stack. The caller owns history.
 */
function buildReference(doc, el, item, options) {
  const href = typeof item.href === 'string' ? item.href : '';
  el.className = (options && options.referenceClass) || 'dict-ref';
  el.setAttribute('role', 'link');
  el.setAttribute('tabindex', '0');
  if (href) el.setAttribute('data-href', href);

  const win = doc.defaultView;

  function activate(event) {
    const text = el.textContent || '';
    if (options && typeof options.onReference === 'function') options.onReference(href, event, text);
    if (win && typeof win.CustomEvent === 'function') {
      el.dispatchEvent(new win.CustomEvent('dictionary-reference', {
        bubbles: true,
        cancelable: true,
        detail: { href: href, text: text }
      }));
    }
  }

  el.addEventListener('click', function (event) {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    activate(event);
  });
  el.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      if (typeof event.preventDefault === 'function') event.preventDefault();
      activate(event);
    }
  });

  appendContent(doc, el, item.content, options);
  return el;
}

function buildNode(doc, item, options) {
  if (item === null || item === undefined) return null;
  if (typeof item === 'string' || typeof item === 'number') return doc.createTextNode(String(item));
  if (Array.isArray(item)) return buildFragment(doc, item, options);
  if (typeof item !== 'object') return null;

  const requested = typeof item.tag === 'string' ? item.tag.toLowerCase() : null;

  if (!requested) {
    const content = item.content !== undefined ? item.content : item.text;
    return content === undefined ? null : buildFragment(doc, [content], options);
  }

  if (DROPPED_TAGS.has(requested)) return buildFragment(doc, [item.content], options);

  const tag = TAG_SET.has(requested) ? requested : 'span';

  if (tag === 'br') return doc.createElement('br');
  if (tag === 'img') return buildImage(doc, item, options);

  const el = doc.createElement(tag);
  // An unknown but harmless tag becomes a span, and remembers what it was so
  // per-dictionary CSS still has something to aim at.
  if (requested !== tag) el.setAttribute('data-tag', requested);
  applyData(el, item.data);
  applyStyle(el, item.style);
  if (typeof item.title === 'string') el.setAttribute('title', item.title);
  if (typeof item.lang === 'string') el.setAttribute('lang', item.lang);
  if (tag === 'th' || tag === 'td') applySpans(el, item);
  if (tag === 'a') return buildReference(doc, el, item, options);

  appendContent(doc, el, item.content, options);
  return el;
}

function appendContent(doc, target, content, options) {
  if (content === null || content === undefined) return;
  if (Array.isArray(content)) {
    for (let i = 0; i < content.length; i++) appendContent(doc, target, content[i], options);
    return;
  }
  if (typeof content === 'string' || typeof content === 'number') {
    target.appendChild(doc.createTextNode(String(content)));
    return;
  }
  const node = buildNode(doc, content, options);
  if (node) target.appendChild(node);
}

function buildFragment(doc, content, options) {
  const frag = doc.createDocumentFragment();
  appendContent(doc, frag, content, options);
  return frag;
}

/**
 * One node from a structured-content tree, or null if it carries nothing.
 *
 * @param {object|string} node
 * @param {{document?: Document, onReference?: Function, resolveImage?: Function,
 *          referenceClass?: string}} [options]
 * @returns {Node|null}
 */
export function renderNode(node, options = {}) {
  return buildNode(pickDocument(options), node, options);
}

/**
 * A whole glossary - a structured-content tree, an array of nodes, or a plain
 * string - as one DocumentFragment ready to append. A string source (JMdict)
 * and a tree source (Yomitan) both work, so a caller does not branch.
 */
export function renderGloss(gloss, options = {}) {
  return buildFragment(pickDocument(options), gloss, options);
}

/**
 * Resolve every img[data-path] under root through an asynchronous reader.
 * Rendering stays synchronous; only the images cost a round trip.
 *
 * @param {Node} root
 * @param {(path: string) => Promise<string|null>|string|null} resolveImage
 * @returns {Promise<number>} how many images were resolved
 */
export async function hydrateImages(root, resolveImage) {
  if (!root || typeof resolveImage !== 'function' || typeof root.querySelectorAll !== 'function') return 0;
  const images = root.querySelectorAll('img[data-path]');
  let resolved = 0;
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const path = img.getAttribute('data-path');
    try {
      const url = await resolveImage(path);
      if (url) {
        img.setAttribute('src', url);
        img.removeAttribute('data-path');
        resolved++;
      }
    } catch (error) {
      // A missing image is a cosmetic loss, never a failed definition.
    }
  }
  return resolved;
}

/**
 * Flatten a structured gloss to text. This exists because a wordbook that only
 * accepts strings would otherwise have to skip every monolingual sense.
 */
export function plainText(gloss) {
  if (gloss === null || gloss === undefined) return '';
  if (typeof gloss === 'string') return gloss;
  if (typeof gloss === 'number') return String(gloss);
  if (Array.isArray(gloss)) {
    let out = '';
    for (let i = 0; i < gloss.length; i++) out += plainText(gloss[i]);
    return out;
  }
  if (typeof gloss === 'object') {
    if (gloss.tag === 'br') return '\n';
    if (gloss.tag === 'img') return gloss.alt || gloss.title || '';
    const content = gloss.content !== undefined ? gloss.content : gloss.text;
    return content === undefined ? '' : plainText(content);
  }
  return '';
}

/** The selector every scoped rule is written under. */
export function dictionaryScope(id) {
  return '[data-dict="' + String(id).replace(/["\\]/g, '\\$&') + '"]';
}

function readString(css, start) {
  const quote = css[start];
  let i = start + 1;
  while (i < css.length) {
    if (css[i] === '\\') { i += 2; continue; }
    if (css[i] === quote) return { text: css.slice(start, i + 1), next: i + 1 };
    i++;
  }
  return { text: css.slice(start), next: css.length };
}

function matchBrace(css, open) {
  let depth = 0;
  let i = open;
  while (i < css.length) {
    const ch = css[i];
    if (ch === '"' || ch === "'") { i = readString(css, i).next; continue; }
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end < 0 ? css.length : end + 2;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return css.length;
}

function splitSelectors(list) {
  const parts = [];
  let current = '';
  let depth = 0;
  for (let i = 0; i < list.length; i++) {
    const ch = list[i];
    if (ch === '"' || ch === "'") {
      const s = readString(list, i);
      current += s.text;
      i = s.next - 1;
      continue;
    }
    if (ch === '/' && list[i + 1] === '*') {
      const end = list.indexOf('*/', i + 2);
      const stop = end < 0 ? list.length : end + 2;
      current += list.slice(i, stop);
      i = stop - 1;
      continue;
    }
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

function scopeSelector(selector, scope) {
  let s = selector.trim();
  if (!s) return scope;
  // Drop leading root-ish selectors: the scope selector already names the
  // container they were trying to reach, and "html body .x" matches nothing
  // once the sheet is scoped.
  let stripped = true;
  while (stripped) {
    stripped = false;
    const match = s.match(/^(?::root|html|body)(?![-\w])/i);
    if (match) {
      s = s.slice(match[0].length).replace(/^[\s>+~]+/, '');
      stripped = true;
    }
  }
  if (!s) return scope;
  return scope + ' ' + s;
}

function scopeSelectors(list, scope) {
  const parts = splitSelectors(list);
  const out = [];
  for (let i = 0; i < parts.length; i++) out.push(scopeSelector(parts[i], scope));
  return out.join(', ');
}

function scopeBlock(css, scope) {
  let out = '';
  let prelude = '';
  let i = 0;
  while (i < css.length) {
    const ch = css[i];
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      const stop = end < 0 ? css.length : end + 2;
      prelude += css.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const s = readString(css, i);
      prelude += s.text;
      i = s.next;
      continue;
    }
    if (ch === '{') {
      const close = matchBrace(css, i);
      const inner = css.slice(i + 1, close);
      const head = prelude;
      prelude = '';
      const trimmed = head.trim();
      if (trimmed.charAt(0) === '@') {
        const name = (trimmed.match(/^@([-\w]+)/) || [null, ''])[1].toLowerCase();
        if (NESTING_AT_RULES.has(name)) {
          out += head + '{' + scopeBlock(inner, scope) + '}';
        } else {
          out += head + '{' + inner + '}';
        }
      } else {
        // Keep comments and whitespace outside the rewritten selector, at both
        // ends, so scoping a sheet does not reformat it.
        const lead = (head.match(/^(?:\s|\/\*[\s\S]*?\*\/)*/) || [''])[0];
        const rest = head.slice(lead.length);
        const trail = (rest.match(/\s+$/) || [''])[0];
        out += lead + scopeSelectors(rest.slice(0, rest.length - trail.length), scope) + trail + '{' + inner + '}';
      }
      i = close + 1;
      continue;
    }
    prelude += ch;
    i++;
  }
  out += prelude;
  return out;
}

/**
 * Rewrite a stylesheet so every rule only matches under scope. Small and
 * conservative on purpose: conditional at-rules are descended into, everything
 * else with a block (@font-face, @keyframes, @page) is left byte-for-byte
 * alone.
 */
export function scopeStyles(css, scope) {
  if (typeof css !== 'string' || css.length === 0 || !scope) return '';
  return scopeBlock(css, scope);
}

/**
 * Scope a dictionary's styles.css and inject it once. Calling it again with the
 * same id is a no-op, so a re-import cannot double every rule.
 */
export function ensureStyles(doc, sourceId, css) {
  if (!doc || typeof doc.createElement !== 'function') return null;
  if (!sourceId || typeof css !== 'string' || css.trim() === '') return null;
  const id = 'dict-style-' + String(sourceId).replace(/[^A-Za-z0-9_-]/g, '-');
  const existing = doc.getElementById(id);
  if (existing) return existing;
  const style = doc.createElement('style');
  style.id = id;
  style.setAttribute('data-dict-style', String(sourceId));
  style.textContent = scopeStyles(css, dictionaryScope(sourceId));
  (doc.head || doc.documentElement).appendChild(style);
  return style;
}

export { REQUIRED_TAGS, DROPPED_TAGS };
export default {
  renderNode: renderNode,
  renderGloss: renderGloss,
  hydrateImages: hydrateImages,
  plainText: plainText,
  scopeStyles: scopeStyles,
  dictionaryScope: dictionaryScope,
  ensureStyles: ensureStyles
};
