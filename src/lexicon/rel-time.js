/* Relative time as a key plus its number.
 *
 * The engine never holds UI copy: the caller translates the key. The buckets
 * are the ones the 調べた語 column drew (さっき / 5分前 / 昨日 / 1週間前).
 */

export function relativeTime(ms, now) {
  var t = now == null ? Date.now() : now;
  var diff = Math.max(0, t - (ms || 0));
  var minutes = Math.floor(diff / 60000);
  if (minutes < 1) return { key: 'time.now', vars: {} };
  if (minutes < 60) return { key: 'time.minutes', vars: { n: minutes } };
  var hours = Math.floor(minutes / 60);
  if (hours < 24) return { key: 'time.hours', vars: { n: hours } };
  var days = Math.floor(hours / 24);
  if (days === 1) return { key: 'time.yesterday', vars: {} };
  if (days < 7) return { key: 'time.days', vars: { n: days } };
  if (days < 30) return { key: 'time.weeks', vars: { n: Math.floor(days / 7) } };
  return { key: 'time.months', vars: { n: Math.floor(days / 30) } };
}
