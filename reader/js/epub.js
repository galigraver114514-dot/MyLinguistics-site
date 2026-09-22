/**
 * EPUB 3 structure, enough to read a novel.
 *
 * Deliberately narrow: it resolves the container to the package document,
 * reads metadata and the spine in order, and can hand back chapter source and
 * packaged resources. It does not interpret CSS, does not lay anything out, and
 * holds no opinion about typography. The caller decides how a chapter is
 * rendered.
 *
 * Namespaced XML is matched on local name rather than prefixed tag names,
 * because the same element can appear as <dc:title>, <title> or with any other
 * prefix depending on how the book was produced.
 */
import { openZip } from '../../src/zip.js?v=6';

const XHTML_TYPES = new Set([
  'application/xhtml+xml',
  'text/html',
  'application/xml',
  'text/xml'
]);

function localName(node) {
  return node.localName || String(node.nodeName || '').replace(/^.*:/, '');
}

function findAll(root, name) {
  const out = [];
  const all = root.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) {
    if (localName(all[i]) === name) out.push(all[i]);
  }
  return out;
}

function findFirst(root, name) {
  const all = findAll(root, name);
  return all.length ? all[0] : null;
}

function attr(node, name) {
  if (!node || !node.getAttribute) return null;
  return node.getAttribute(name);
}

function textOf(node) {
  return node ? String(node.textContent || '').trim() : '';
}

function dirname(path) {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

function decodePart(part) {
  try {
    return decodeURIComponent(part);
  } catch (e) {
    return part;
  }
}

/**
 * Resolve a relative href against a base directory, in zip-path space.
 * Handles ".", "..", absolute URLs and percent-encoding.
 */
export function resolvePath(baseDir, href) {
  if (!href) return '';
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href)) return href;
  const withoutFragment = href.split('#')[0];
  const stack = baseDir ? baseDir.split('/').filter(Boolean) : [];
  const parts = withoutFragment.split('/');
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(decodePart(part));
  }
  return stack.join('/');
}

function parseXml(source, fileName, domParser) {
  const parser = new domParser();
  const doc = parser.parseFromString(source, 'application/xml');
  const error = findFirst(doc, 'parsererror');
  if (error) {
    throw new Error('could not parse ' + fileName + ': ' + textOf(error).slice(0, 200));
  }
  return doc;
}

/**
 * @param {ArrayBuffer|Uint8Array} input
 * @param {{domParser?: typeof DOMParser}} [options]
 * @returns {Promise<Epub>}
 */
export async function openEpub(input, options = {}) {
  const domParser = options.domParser || globalThis.DOMParser;
  if (!domParser) throw new Error('openEpub needs a DOMParser; pass options.domParser');

  const zip = await openZip(input);

  // 1. container.xml points at the package document.
  const containerSource = await zip.readText('META-INF/container.xml');
  if (!containerSource) throw new Error('not an EPUB: META-INF/container.xml is missing');

  const container = parseXml(containerSource, 'META-INF/container.xml', domParser);
  const rootfile = findFirst(container, 'rootfile');
  const opfPath = attr(rootfile, 'full-path');
  if (!opfPath) throw new Error('container.xml does not name a rootfile');

  // 2. The package document.
  const opfSource = await zip.readText(opfPath);
  if (opfSource === null) throw new Error('package document is missing from the archive: ' + opfPath);

  const opf = parseXml(opfSource, opfPath, domParser);
  const opfDir = dirname(opfPath);

  const metadataNode = findFirst(opf, 'metadata');
  const metadata = {
    title: textOf(findFirst(metadataNode || opf, 'title')),
    author: textOf(findFirst(metadataNode || opf, 'creator')),
    language: textOf(findFirst(metadataNode || opf, 'language')),
    identifier: textOf(findFirst(metadataNode || opf, 'identifier')),
    publisher: textOf(findFirst(metadataNode || opf, 'publisher')),
    modified: textOf(findFirst(metadataNode || opf, 'meta') ? findFirst(metadataNode, 'meta') : null)
  };

  const spineNode = findFirst(opf, 'spine');
  metadata.direction = attr(spineNode, 'page-progression-direction') || 'ltr';

  // 3. Manifest: id -> item.
  const manifest = new Map();
  const mediaByPath = new Map();
  findAll(opf, 'item').forEach(function (item) {
    const id = attr(item, 'id');
    const href = attr(item, 'href');
    if (!id || !href) return;
    const path = resolvePath(opfDir, href);
    const entry = {
      id: id,
      href: href,
      path: path,
      mediaType: attr(item, 'media-type') || '',
      properties: attr(item, 'properties') || ''
    };
    manifest.set(id, entry);
    if (!mediaByPath.has(path)) mediaByPath.set(path, entry);
  });

  // 4. Spine: reading order.
  const chapters = [];
  findAll(opf, 'itemref').forEach(function (itemref) {
    const idref = attr(itemref, 'idref');
    const item = manifest.get(idref);
    if (!item) return;
    const linear = attr(itemref, 'linear');
    const looksLikeText = XHTML_TYPES.has(item.mediaType) || /\.x?html?$/i.test(item.path);
    if (!looksLikeText) return;
    chapters.push({
      id: item.id,
      index: chapters.length,
      href: item.href,
      path: item.path,
      mediaType: item.mediaType || 'application/xhtml+xml',
      linear: linear !== 'no',
      properties: item.properties,
      idref: idref
    });
  });

  if (chapters.length === 0) throw new Error('the spine contains no readable documents');

  const epub = {
    zip: zip,
    opfPath: opfPath,
    opfDir: opfDir,
    metadata: metadata,
    chapters: chapters,
    manifest: manifest,
    resources: mediaByPath,

    /** Raw XHTML source for a chapter. */
    async readChapter(index) {
      const chapter = chapters[index];
      if (!chapter) throw new Error('no such chapter: ' + index);
      return zip.readText(chapter.path);
    },

    /** Resolve a relative reference found inside a chapter. */
    resolveHref(fromPath, relative) {
      return resolvePath(dirname(fromPath), relative);
    },

    /** Packaged bytes for a resource path, or null if it is not in the archive. */
    async resource(path) {
      const resolved = path.indexOf('/') === 0 ? path.slice(1) : path;
      const data = await zip.read(resolved);
      if (data === null) return null;
      const known = mediaByPath.get(resolved);
      return {
        path: resolved,
        mediaType: known ? known.mediaType : guessMediaType(resolved),
        data: data
      };
    },

    close() {
      epub.zip = null;
    }
  };

  return epub;
}

const MEDIA_BY_EXTENSION = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  svg: 'image/svg+xml', webp: 'image/webp', css: 'text/css',
  xhtml: 'application/xhtml+xml', html: 'text/html', ncx: 'application/x-dtbncx+xml'
};

function guessMediaType(path) {
  const i = path.lastIndexOf('.');
  if (i < 0) return 'application/octet-stream';
  return MEDIA_BY_EXTENSION[path.slice(i + 1).toLowerCase()] || 'application/octet-stream';
}

export { guessMediaType };
export default { openEpub, resolvePath, guessMediaType };
