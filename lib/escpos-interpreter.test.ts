import assert from 'node:assert';
import { EscPosInterpreter, PrintEvent } from './escpos-interpreter';

function run(...chunks: (string | number[])[]): PrintEvent[] {
  const events: PrintEvent[] = [];
  const it = new EscPosInterpreter((e) => events.push(e));
  for (const c of chunks) it.write(typeof c === 'string' ? Buffer.from(c) : Buffer.from(c));
  return events;
}

const E = 0x1b;
const G = 0x1d;

// init + centered bold double-size line + cut
let ev = run([E, 0x40], [E, 0x61, 1], [E, 0x45, 1], [G, 0x21, 0x11], 'ACME\n', [G, 0x56, 0]);
assert.deepStrictEqual(ev[0], { type: 'init' });
assert.deepStrictEqual(ev[1], {
  type: 'line',
  text: 'ACME',
  bold: true,
  underline: false,
  align: 'center',
  size: 2,
});
assert.deepStrictEqual(ev[2], { type: 'cut' });
assert.strictEqual(ev.length, 3);

// state resets on ESC @
ev = run([E, 0x45, 1], [E, 0x40], 'x\n');
assert.deepStrictEqual(ev.map((e) => e.type), ['init', 'line']);
assert.strictEqual((ev[1] as any).bold, false);

// underline off via '0', align out of range falls back to left
ev = run([E, 0x2d, 0x30], [E, 0x61, 9], 'y\n');
assert.strictEqual((ev[0] as any).underline, false);
assert.strictEqual((ev[0] as any).align, 'left');

// commands split across chunks must not corrupt the stream
ev = run([E], [0x61], [2], 'R\n');
assert.strictEqual((ev[0] as any).align, 'right');
ev = run('A', [G], [0x56, 65], [0x10]);
assert.deepStrictEqual(ev.map((e) => e.type), ['line', 'cut']);

// unknown ESC/GS sequences are swallowed, params never printed as text
ev = run([E, 0x74, 16], [G, 0x4c, 0x00], 'ok\n');
assert.strictEqual((ev[0] as any).text, 'ok');

// ESC d 2 prints the buffer then feeds 2 blank lines
ev = run('hi', [E, 0x64, 2]);
assert.deepStrictEqual(ev.map((e) => (e as any).text), ['hi', '', '']);

// end() flushes a dangling line and cuts; no phantom blank line
ev = [];
let it = new EscPosInterpreter((e) => ev.push(e));
it.write(Buffer.from('tail'));
it.end();
assert.deepStrictEqual(ev.map((e) => e.type), ['line', 'cut']);

// end() after an explicit cut does not cut twice
ev = [];
it = new EscPosInterpreter((e) => ev.push(e));
it.write(Buffer.from('hi\n'));
it.write(Buffer.from([G, 0x56, 0]));
it.end();
assert.deepStrictEqual(ev.map((e) => e.type), ['line', 'cut']);

// UTF-8 multibyte survives chunk splits
ev = run([0xe2], [0x82, 0xac], '9\n');
assert.strictEqual((ev[0] as any).text, '€9');

// GS v 0 raster image: header parsed, payload never leaks into text
ev = run([G, 0x76, 0x30, 0, 2, 0, 2, 0, 0x80, 0x01, 0xff, 0x00], 'after\n');
assert.deepStrictEqual(ev[0], {
  type: 'image',
  width: 16,
  height: 2,
  align: 'left',
  data: Buffer.from([0x80, 0x01, 0xff, 0x00]).toString('base64'),
});
assert.strictEqual((ev[1] as any).text, 'after');

// ...even when the bitmap is split across TCP chunks, and it keeps the current align
ev = run([E, 0x61, 1], [G, 0x76, 0x30, 0, 2, 0], [2, 0, 0x80], [0x01, 0xff, 0x00], 'after\n');
assert.strictEqual((ev[0] as any).type, 'image');
assert.strictEqual((ev[0] as any).align, 'center');
assert.strictEqual((ev[1] as any).text, 'after');

// ESC * column format is transposed to row-major
ev = run([E, 0x2a, 0, 2, 0, 0x80, 0x01], 'after\n');
const raster = Buffer.from((ev[0] as any).data, 'base64');
assert.strictEqual((ev[0] as any).width, 2);
assert.strictEqual((ev[0] as any).height, 8);
assert.strictEqual(raster[0], 0x80); // col 0, top row
assert.strictEqual(raster[7], 0x40); // col 1, bottom row
assert.strictEqual((ev[1] as any).text, 'after');

// barcode + QR payloads are consumed, not printed
ev = run([G, 0x6b, 2], '123', [0x00], 'after\n');
assert.deepStrictEqual(ev.map((e) => (e as any).text), ['after']);
ev = run([G, 0x6b, 73, 3], 'abc', 'after\n');
assert.deepStrictEqual(ev.map((e) => (e as any).text), ['after']);
ev = run([G, 0x28, 0x6b, 3, 0, 49, 65, 50], 'after\n');
assert.deepStrictEqual(ev.map((e) => (e as any).text), ['after']);

console.log('escpos-interpreter: all checks passed');
