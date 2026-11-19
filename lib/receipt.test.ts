import assert from 'node:assert';
import { fileStamp, groupReceipts, Row, wrapColumns } from './receipt';

let k = 0;
const line = (text: string): Row => ({
  key: k++,
  at: 0,
  type: 'line',
  text,
  bold: false,
  underline: false,
  align: 'left',
  size: 1,
});
const cut = (): Row => ({ key: k++, at: 0, type: 'cut' });
const texts = (rows: Row[]) =>
  groupReceipts(rows).map((r) => [r.rows.map((x) => (x.type === 'line' ? x.text : '#')), r.cut]);

// cuts split the roll; a double cut is an empty receipt; the tail is still printing
assert.deepStrictEqual(texts([line('a'), line('b'), cut(), cut(), line('c')]), [
  [['a', 'b'], true],
  [[], true],
  [['c'], false],
]);

// a receipt keeps its key when its cut arrives (no remount, no flicker)
const a = line('a');
const b = line('b');
assert.strictEqual(groupReceipts([a, b])[0].key, groupReceipts([a, b, cut()])[0].key);

assert.deepStrictEqual(groupReceipts([]), []);

// fixed-column wrap, multibyte safe
assert.deepStrictEqual(wrapColumns('abcdefg', 3), ['abc', 'def', 'g']);
assert.deepStrictEqual(wrapColumns('', 3), ['']);
assert.deepStrictEqual(wrapColumns('€€€€', 2), ['€€', '€€']);

assert.match(fileStamp(Date.now()), /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/);

console.log('receipt: all checks passed');
