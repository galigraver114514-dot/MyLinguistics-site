/**
 * Minimal ZIP reader, enough for EPUB.
 *
 * Reads the central directory rather than scanning local headers, because local
 * headers are allowed to carry zero sizes when a data descriptor is used. Only
 * "stored" and "deflate" are supported; those are the only methods an EPUB is
 * allowed to use.
 *
 * Inflation uses DecompressionStream('deflate-raw'), which Safari has had since
 * 16.4 and Node since 18, so this module needs no dependency in either.
 */

const EOCD_SIG = 0x06054b50;
const CDFH_SIG = 0x02014b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;

function findEndOfCentralDirectory(view, length) {
  // The comment can be up to 65535 bytes, so the EOCD sits within the last
  // 65557 bytes. Scan backwards for the signature.
  const floor = Math.max(0, length - 65557);
  for (let i = length - 22; i >= floor; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) return i;
  }
  return -1;
}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * @param {ArrayBuffer|Uint8Array} input
 * @returns {Promise<ZipArchive>}
 */
export async function openZip(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = bytes.byteLength;

  const eocd = findEndOfCentralDirectory(view, length);
  if (eocd < 0) throw new Error('not a zip file: no end-of-central-directory record');

  if (eocd >= 20 && view.getUint32(eocd - 20, true) === ZIP64_LOCATOR_SIG) {
    throw new Error('zip64 archives are not supported');
  }

  const entryCount = view.getUint16(eocd + 10, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  const commentLength = view.getUint16(eocd + 20, true);
  const comment = commentLength
    ? new TextDecoder('utf-8').decode(bytes.subarray(eocd + 22, eocd + 22 + commentLength))
    : '';

  const decoder = new TextDecoder('utf-8');
  const entries = [];
  const byName = new Map();

  let p = cdOffset;
  for (let i = 0; i < entryCount; i++) {
    if (p + 46 > length) throw new Error('truncated central directory');
    if (view.getUint32(p, true) !== CDFH_SIG) throw new Error('bad central directory entry at ' + p);

    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const crc = view.getUint32(p + 16, true);
    const compSize = view.getUint32(p + 20, true);
    const uncompSize = view.getUint32(p + 24, true);
    const nameLength = view.getUint16(p + 28, true);
    const extraLength = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);

    if (compSize === 0xffffffff || uncompSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new Error('zip64 entry sizes are not supported: this archive is too large for the reader');
    }

    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLength));
    const entry = {
      name: name,
      method: method,
      compressedSize: compSize,
      uncompressedSize: uncompSize,
      crc32: crc,
      localOffset: localOffset,
      encrypted: (flags & 0x0001) !== 0,
      isDirectory: name.endsWith('/'),
      // EBU/EPUB uses UTF-8 names; bit 11 only matters for legacy encodings and
      // in practice every EPUB in circulation sets it.
      utf8: (flags & 0x0800) !== 0
    };

    entries.push(entry);
    if (!byName.has(name)) byName.set(name, entry);
    p += 46 + nameLength + extraLength + commentLen;
  }

  function localDataStart(entry) {
    const lp = entry.localOffset;
    if (lp + 30 > length) throw new Error('truncated local header for ' + entry.name);
    if (view.getUint32(lp, true) !== 0x04034b50) throw new Error('bad local header for ' + entry.name);
    const nameLength = view.getUint16(lp + 26, true);
    const extraLength = view.getUint16(lp + 28, true);
    return lp + 30 + nameLength + extraLength;
  }

  const archive = {
    entries: entries,
    comment: comment,

    has(name) {
      return byName.has(name);
    },

    entry(name) {
      return byName.get(name) || null;
    },

    find(pattern) {
      return entries.filter(function (e) { return pattern.test(e.name); });
    },

    /** Decompressed bytes for one entry. */
    async read(name) {
      const entry = byName.get(name);
      return entry ? archive.readEntry(entry) : null;
    },

    async readEntry(entry) {
      if (entry.encrypted) throw new Error('entry is encrypted: ' + entry.name);
      if (entry.isDirectory) return new Uint8Array(0);
      const start = localDataStart(entry);
      const slice = bytes.subarray(start, start + entry.compressedSize);
      if (entry.method === 0) return slice.slice();
      if (entry.method !== 8) throw new Error('unsupported compression method ' + entry.method + ' for ' + entry.name);
      return inflateRaw(slice);
    },

    /** Decompressed text for one entry, or null if it is absent. */
    async readText(name) {
      const data = await archive.read(name);
      if (data === null) return null;
      return new TextDecoder('utf-8').decode(data);
    }
  };

  return archive;
}

export default { openZip };
