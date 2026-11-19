const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

export type Align = 'left' | 'center' | 'right';

export type PrintEvent =
  | { type: 'init' }
  | {
      type: 'line';
      text: string;
      bold: boolean;
      underline: boolean;
      align: Align;
      size: 1 | 2;
    }
  | {
      type: 'image';
      width: number; // dots
      height: number; // dots
      align: Align;
      data: string; // base64, 1bpp row-major, rows padded to whole bytes
    }
  | { type: 'cut' };

// ponytail: every ESC/GS command we don't know is assumed to take exactly one
// parameter byte (true for most of them). Zero-arg ones are listed explicitly.
const ESC_NO_ARG = new Set([0x40, 0x69, 0x6d, 0x32, 0x0c, 0x3d]);
const GS_NO_ARG = new Set<number>([]);

const ALIGNS: Align[] = ['left', 'center', 'right'];

/** ESC * ships vertical 8/24-dot columns; transpose to the row-major 1bpp the UI draws. */
function columnsToRaster(data: Buffer, width: number, bytesPerCol: number): Buffer {
  const rowBytes = Math.ceil(width / 8);
  const out = Buffer.alloc(rowBytes * bytesPerCol * 8);
  for (let col = 0; col < width; col++) {
    for (let k = 0; k < bytesPerCol; k++) {
      const byte = data[col * bytesPerCol + k];
      for (let bit = 0; bit < 8; bit++) {
        if (byte & (0x80 >> bit)) out[(k * 8 + bit) * rowBytes + (col >> 3)] |= 0x80 >> (col & 7);
      }
    }
  }
  return out;
}

export class EscPosInterpreter {
  private pending: Buffer = Buffer.alloc(0);
  private line: number[] = [];
  private bold = false;
  private underline = false;
  private align: Align = 'left';
  private size: 1 | 2 = 1;
  private printed = false;

  constructor(private readonly onEvent: (event: PrintEvent) => void) {}

  write(chunk: Buffer): void {
    this.pending = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
    this.pending = this.pending.subarray(this.parse(this.pending));
  }

  /**
   * Socket closed: flush whatever is half-printed and cut, like a real printer would.
   * No-op if the job already ended with an explicit cut — otherwise every receipt
   * would show two dividers.
   */
  end(): void {
    if (this.printed || this.line.length) this.cut();
  }

  /** Returns how many bytes were consumed; the rest is an incomplete command. */
  private parse(buf: Buffer): number {
    let i = 0;
    while (i < buf.length) {
      const b = buf[i];

      if (b === ESC || b === GS) {
        const consumed = b === ESC ? this.esc(buf, i) : this.gs(buf, i);
        if (consumed === 0) return i; // need more bytes
        i += consumed;
        continue;
      }

      if (b === LF) {
        this.flush();
      } else if (b >= 0x20) {
        this.line.push(b);
      }
      // everything else (CR, TAB, NUL, ...) is dropped
      i++;
    }
    return i;
  }

  private esc(buf: Buffer, i: number): number {
    if (i + 1 >= buf.length) return 0;
    const cmd = buf[i + 1];

    if (cmd === 0x2a) {
      // ESC * m nL nH d...  column-format bit image
      if (i + 5 > buf.length) return 0;
      const m = buf[i + 2];
      const width = buf[i + 3] | (buf[i + 4] << 8);
      const bytesPerCol = m === 0 || m === 1 ? 1 : 3;
      const len = width * bytesPerCol;
      if (i + 5 + len > buf.length) return 0;
      this.emitImage(columnsToRaster(buf.subarray(i + 5, i + 5 + len), width, bytesPerCol), width, bytesPerCol * 8);
      return 5 + len;
    }

    const argc = ESC_NO_ARG.has(cmd) ? 0 : 1;
    if (i + 2 + argc > buf.length) return 0;
    const n = buf[i + 2];

    switch (cmd) {
      case 0x40: // ESC @  initialize
        this.reset();
        this.onEvent({ type: 'init' });
        break;
      case 0x61: // ESC a n  align
        this.align = ALIGNS[n] ?? 'left';
        break;
      case 0x45: // ESC E n  bold
        this.bold = (n & 1) === 1;
        break;
      case 0x2d: // ESC - n  underline
        this.underline = n !== 0 && n !== 0x30;
        break;
      case 0x64: // ESC d n  print buffer, then feed n lines
        this.flush(false);
        for (let k = 0; k < n; k++) this.flush();
        break;
      case 0x69: // ESC i / ESC m  cut
      case 0x6d:
        this.cut();
        break;
      // default: recognised as a command, ignored
    }
    return 2 + argc;
  }

  private gs(buf: Buffer, i: number): number {
    if (i + 1 >= buf.length) return 0;
    const cmd = buf[i + 1];

    if (cmd === 0x56) {
      // GS V m  /  GS V m n  (the 65/66 forms carry a feed byte)
      if (i + 2 >= buf.length) return 0;
      const m = buf[i + 2];
      const len = m >= 65 ? 4 : 3;
      if (i + len > buf.length) return 0;
      this.cut();
      return len;
    }

    if (cmd === 0x76) {
      // GS v 0 m xL xH yL yH d...  raster bit image (what most POS libs emit)
      if (i + 8 > buf.length) return 0;
      const rowBytes = buf[i + 4] | (buf[i + 5] << 8);
      const height = buf[i + 6] | (buf[i + 7] << 8);
      const len = rowBytes * height;
      if (i + 8 + len > buf.length) return 0;
      // ponytail: mode byte (double width/height) ignored — preview shows 1:1 dots
      this.emitImage(buf.subarray(i + 8, i + 8 + len), rowBytes * 8, height);
      return 8 + len;
    }

    if (cmd === 0x28) {
      // GS ( X pL pH ...  (raster in page mode, QR codes, ...) — consume, don't render
      if (i + 5 > buf.length) return 0;
      const len = buf[i + 3] | (buf[i + 4] << 8);
      if (i + 5 + len > buf.length) return 0;
      return 5 + len;
    }

    if (cmd === 0x38) {
      // GS 8 L p1..p4 ...  large raster block — consume, don't render
      if (i + 7 > buf.length) return 0;
      const len = buf[i + 3] | (buf[i + 4] << 8) | (buf[i + 5] << 16) | (buf[i + 6] << 24);
      if (i + 7 + len > buf.length) return 0;
      return 7 + len;
    }

    if (cmd === 0x6b) {
      // GS k m ...  barcode: m<65 is NUL-terminated, m>=65 carries a length byte
      if (i + 3 > buf.length) return 0;
      const m = buf[i + 2];
      if (m >= 65) {
        const n = buf[i + 3];
        return i + 4 + n > buf.length ? 0 : 4 + n;
      }
      const nul = buf.indexOf(0, i + 3);
      return nul === -1 ? 0 : nul - i + 1;
    }

    if (cmd === 0x2a) {
      // GS * x y d...  define downloaded bit image
      if (i + 4 > buf.length) return 0;
      const len = buf[i + 2] * buf[i + 3] * 8;
      return i + 4 + len > buf.length ? 0 : 4 + len;
    }

    const argc = GS_NO_ARG.has(cmd) ? 0 : 1;
    if (i + 2 + argc > buf.length) return 0;

    if (cmd === 0x21) {
      // GS ! n  character size; either nibble set = double
      const n = buf[i + 2];
      this.size = (n & 0xf0) !== 0 || (n & 0x0f) !== 0 ? 2 : 1;
    }
    return 2 + argc;
  }

  private emitImage(bits: Buffer, width: number, height: number): void {
    if (width === 0 || height === 0) return;
    this.flush(false);
    this.printed = true;
    this.onEvent({
      type: 'image',
      width,
      height,
      align: this.align,
      data: bits.toString('base64'),
    });
  }

  private cut(): void {
    this.flush(false);
    this.printed = false;
    this.onEvent({ type: 'cut' });
  }

  /** force=false skips an empty line (used when cutting, so no phantom blank line). */
  private flush(force = true): void {
    if (!force && this.line.length === 0) return;
    // ponytail: bytes decoded as UTF-8. Add a codepage table if your POS sends CP437/CP850.
    const text = Buffer.from(this.line).toString('utf8');
    this.line = [];
    this.printed = true;
    this.onEvent({
      type: 'line',
      text,
      bold: this.bold,
      underline: this.underline,
      align: this.align,
      size: this.size,
    });
  }

  private reset(): void {
    this.line = [];
    this.bold = false;
    this.underline = false;
    this.align = 'left';
    this.size = 1;
  }
}
