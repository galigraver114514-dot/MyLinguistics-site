/* Seam onto the shared dictionary module.
 *
 * The contract is docs/coordination/interface-dict.md, which agent-reader owns
 * and which lives in src/dict/; createDictionary() is what this resolves to.
 * The import is dynamic and the failure is swallowed on purpose: a page whose
 * dictionary module cannot load must still run, on the built-in seed, and this
 * seam is the one place that decides it. Callers keep whatever definition they
 * already hold, so the wordbook changes its definition source without ever
 * touching agent-reader's files.
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
