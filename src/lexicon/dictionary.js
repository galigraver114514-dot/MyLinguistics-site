/* Seam onto the shared dictionary module.
 *
 * The contract is docs/coordination/interface-dict.md v1, which agent-reader
 * owns and which lives in src/dict/. That module does not exist yet, so this
 * resolves to null and callers keep whatever definition they already hold.
 * When src/dict/index.js lands, this starts returning a Dictionary with no
 * change at the call sites, and the wordbook switches its definition source
 * without ever touching agent-reader's files.
 */
export async function loadDictionary(options) {
  try {
    var mod = await import('../dict/index.js');
    if (mod && typeof mod.createDictionary === 'function') {
      return await mod.createDictionary(options || {});
    }
  } catch (err) {
    return null;
  }
  return null;
}
