/* Turning a brick's structured group into a display name.
 *
 * The engine keeps groups as data and never holds a translated string; the
 * caller passes its own translate function, so the wordbook and the overview
 * name the same brick the same way.
 */

export function brickGroup(brick) {
  return brick && brick.group ? brick.group : { kind: 'mixed', value: '' };
}

export function brickGroupKey(group) {
  if (!group || group.kind === 'source') return 'wb.brick.source';
  if (group.kind === 'pos' && group.value) return null;
  if (group.kind === 'band') {
    if (group.value === 'common') return 'wb.brick.common';
    if (group.value === 'mid') return 'wb.brick.mid';
    if (group.value === 'rare') return 'wb.brick.rare';
    return 'wb.brick.unknown';
  }
  return 'wb.brick.mixed';
}

export function brickSequence(brick) {
  var id = brick && brick.id ? String(brick.id) : '';
  return id ? id.split('-').pop() : '';
}

export function brickLabel(brick, translate) {
  var t = translate || function (key) { return key; };
  /* A brick the learner named keeps its name; the group is only a default. */
  if (brick && typeof brick.name === 'string' && brick.name) return brick.name;
  var group = brickGroup(brick);
  var key = brickGroupKey(group);
  var label = key ? t(key) : group.value;
  var seq = brickSequence(brick);
  return seq ? label + ' ' + seq : label;
}
