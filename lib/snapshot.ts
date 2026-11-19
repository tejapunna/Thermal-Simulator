import type { Align } from './escpos-interpreter';
import { InkRow, wrapColumns } from './receipt';

// 80mm paper on a 203 dpi head = 576 printable dots. Font A is 12x24 dots → 48 columns.
const HEAD = 576;
const MARGIN = 24;
const CHAR_W = 12;
const CHAR_H = 24;
const LINE_GAP = 6;
const PAPER = '#fdf6e3';
const INK = '#111111';
const FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

type Bits = { width: number; height: number; data: string };

/** 1bpp row-major bitmap → RGBA. Off-dots stay transparent so the paper shows through. */
export function bitsToImageData({ width, height, data }: Bits): ImageData {
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  const rowBytes = Math.ceil(width / 8);
  const img = new ImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((bytes[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1) {
        const p = (y * width + x) * 4;
        img.data[p] = img.data[p + 1] = img.data[p + 2] = 0x11;
        img.data[p + 3] = 255;
      }
    }
  }
  return img;
}

const xFor = (align: Align, w: number) =>
  MARGIN + (align === 'center' ? (HEAD - w) / 2 : align === 'right' ? HEAD - w : 0);

type Op = { h: number; draw: (ctx: CanvasRenderingContext2D, y: number) => void };

/** Re-draw a receipt at printer scale (576 dots wide) from its events, not from the DOM. */
export function renderReceipt(rows: InkRow[]): HTMLCanvasElement {
  const ops: Op[] = [];
  // glyph advance differs per OS font (Consolas 0.55em, Menlo 0.6em); measured below
  let emPerChar = 0.6;

  for (const row of rows) {
    if (row.type === 'line') {
      const cw = CHAR_W * row.size;
      const lh = CHAR_H * row.size;
      for (const text of wrapColumns(row.text, HEAD / cw)) {
        ops.push({
          h: lh + LINE_GAP,
          draw: (ctx, y) => {
            // size the font so every character lands exactly on the 12-dot grid
            ctx.font = `${row.bold ? 'bold ' : ''}${cw / emPerChar}px ${FONT}`;
            const w = Math.min(HEAD, ctx.measureText(text).width);
            const x = xFor(row.align, w);
            ctx.fillText(text, x, y + lh / 2, HEAD);
            if (row.underline) ctx.fillRect(x, y + lh - row.size, w, row.size * 2);
          },
        });
      }
    } else {
      const scale = Math.min(1, HEAD / row.width);
      const w = Math.round(row.width * scale);
      const h = Math.round(row.height * scale);
      const bmp = document.createElement('canvas');
      bmp.width = row.width;
      bmp.height = row.height;
      bmp.getContext('2d')?.putImageData(bitsToImageData(row), 0, 0);
      ops.push({ h: h + LINE_GAP, draw: (ctx, y) => ctx.drawImage(bmp, xFor(row.align, w), y, w, h) });
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = HEAD + MARGIN * 2;
  canvas.height = MARGIN * 2 + ops.reduce((sum, op) => sum + op.h, 0);
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  ctx.font = `100px ${FONT}`;
  emPerChar = ctx.measureText('M'.repeat(10)).width / 1000 || 0.6;

  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = INK;
  ctx.textBaseline = 'middle';
  ctx.imageSmoothingEnabled = false;

  let y = MARGIN;
  for (const op of ops) {
    op.draw(ctx, y);
    y += op.h;
  }
  return canvas;
}

export function saveReceiptPng(rows: InkRow[], filename: string): void {
  // A blob: URL lets Chrome fall back to the blob's UUID as the filename (no .png),
  // e.g. when a download-manager extension grabs it. A data: URL has no name of its
  // own, so the download attribute always wins.
  // ponytail: data URLs top out around 2 MB in Chrome — thousands of lines; switch to
  // showSaveFilePicker if receipts ever get that long.
  const a = document.createElement('a');
  a.href = renderReceipt(rows).toDataURL('image/png');
  a.download = filename;
  document.body.appendChild(a); // Firefox ignores clicks on detached anchors
  a.click();
  a.remove();
}
