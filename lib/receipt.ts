import type { PrintEvent } from './escpos-interpreter';

/** One event as the browser stores it. `init` never reaches the paper, so it's not a row. */
export type Row = { key: number; at: number } & Exclude<PrintEvent, { type: 'init' }>;

/** Something actually inked on paper. */
export type InkRow = Exclude<Row, { type: 'cut' }>;

export type Receipt = { key: number; rows: InkRow[]; cut: boolean };

/**
 * Split the paper roll into receipts at every cut. The last one may still be printing.
 * Keyed by its first row so a receipt keeps its identity when its cut arrives.
 */
export function groupReceipts(rows: Row[]): Receipt[] {
  const out: Receipt[] = [];
  let cur: InkRow[] = [];
  for (const r of rows) {
    if (r.type === 'cut') {
      out.push({ key: cur[0]?.key ?? r.key, rows: cur, cut: true });
      cur = [];
    } else {
      cur.push(r);
    }
  }
  if (cur.length) out.push({ key: cur[0].key, rows: cur, cut: false });
  return out;
}

/** Hard-wrap at a fixed column count, the way a print head does (no word breaking). */
export function wrapColumns(text: string, cols: number): string[] {
  const chars = [...text];
  if (chars.length === 0) return [''];
  const out: string[] = [];
  for (let i = 0; i < chars.length; i += cols) out.push(chars.slice(i, i + cols).join(''));
  return out;
}

/** Local-time stamp that is safe in a filename: 2026-11-20_14-03-09 */
export function fileStamp(t: number): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}
