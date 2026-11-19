// Sends a sample ESC/POS receipt to a printer, exactly like a POS would.
//   npm run demo                 → Counter (127.0.0.1:9100)
//   npm run demo -- 9101         → Kitchen
//   npm run demo -- 9100 192.168.1.20
import net from 'node:net';

const port = Number(process.argv[2] ?? 9100);
const host = process.argv[3] ?? '127.0.0.1';

const ESC = 0x1b;
const GS = 0x1d;
const cmd = (...bytes: number[]) => Buffer.from(bytes);
const text = (s: string) => Buffer.from(s + '\n', 'utf8');
const COLS = 48;
const row = (left: string, right: string) => text(left + right.padStart(COLS - left.length));

// 96x96 ring logo as a GS v 0 raster image
function logo(): Buffer {
  const size = 96;
  const rowBytes = size / 8;
  const bits = Buffer.alloc(rowBytes * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = Math.hypot(x - size / 2, y - size / 2);
      if (Math.abs(r - 38) < 6 || r < 14) bits[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return Buffer.concat([cmd(GS, 0x76, 0x30, 0, rowBytes, 0, size, 0), bits]);
}

const items: [string, number, number][] = [
  ['Flat white', 2, 3.8],
  ['Croissant', 1, 3.2],
  ['Avocado toast', 1, 9.5],
];
const total = items.reduce((sum, [, qty, price]) => sum + qty * price, 0);

const job = Buffer.concat([
  cmd(ESC, 0x40), // init
  cmd(ESC, 0x61, 1), // center
  logo(),
  cmd(GS, 0x21, 0x11, ESC, 0x45, 1), // double size + bold
  text('THE CORNER CAFE'),
  cmd(GS, 0x21, 0x00, ESC, 0x45, 0),
  text('12 Market Street · Tel 555-0100'),
  text(new Date().toLocaleString()),
  cmd(ESC, 0x61, 0), // left
  text('-'.repeat(COLS)),
  ...items.map(([name, qty, price]) => row(`${qty}x ${name}`, (qty * price).toFixed(2))),
  text('-'.repeat(COLS)),
  cmd(ESC, 0x45, 1),
  row('TOTAL', `€${total.toFixed(2)}`),
  cmd(ESC, 0x45, 0),
  cmd(ESC, 0x61, 1, ESC, 0x2d, 1), // center + underline
  text('Thank you, come again!'),
  cmd(ESC, 0x2d, 0),
  cmd(ESC, 0x64, 3), // feed 3 lines
  cmd(GS, 0x56, 0x42, 0), // feed & cut
]);

const socket = net.connect(port, host, () => socket.end(job));
socket.on('close', () => console.log(`sent ${job.length} bytes to ${host}:${port}`));
socket.on('error', (err) => {
  console.error(`could not print to ${host}:${port} — ${err.message}`);
  process.exitCode = 1;
});
