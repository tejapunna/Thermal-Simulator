'use client';

import { useEffect, useRef, useState } from 'react';
import type { PrintEvent } from '../lib/escpos-interpreter';
import { fileStamp, groupReceipts, InkRow, Receipt, Row } from '../lib/receipt';
import { bitsToImageData, saveReceiptPng } from '../lib/snapshot';

type Printer = { id: string; name: string; port: number };

let rowKey = 0;

export default function Page() {
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [rows, setRows] = useState<Record<string, Row[]>>({});
  const [active, setActive] = useState<Record<string, number>>({});
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let ws: WebSocket;
    let retry: ReturnType<typeof setTimeout>;
    let closed = false;

    const connect = () => {
      // same origin, so it keeps working behind a reverse proxy / on another port
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
      ws.onopen = () => setConnected(true);
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'config') {
          setPrinters(msg.printers);
          return;
        }
        const { printerId, event } = msg as { printerId: string; event: PrintEvent };
        if (event.type === 'init') return;
        const row: Row = { key: rowKey++, at: Date.now(), ...event };
        setRows((prev) => ({ ...prev, [printerId]: [...(prev[printerId] ?? []), row] }));
        setActive((prev) => ({ ...prev, [printerId]: Date.now() }));
      };
      ws.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(connect, 1500);
      };
      ws.onerror = () => ws.close();
    };

    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      ws?.close();
    };
  }, []);

  return (
    <main className="min-h-screen p-4 sm:p-6">
      <header className="mb-6 flex items-baseline gap-3">
        <h1 className="text-xl font-semibold">Thermal Printer Emulator</h1>
        <span className={`text-xs ${connected ? 'text-emerald-400' : 'text-red-400'}`}>
          {connected ? 'connected' : 'reconnecting…'}
        </span>
      </header>

      <div className="flex flex-wrap gap-6">
        {printers.map((p) => (
          <PrinterCard
            key={p.id}
            printer={p}
            rows={rows[p.id] ?? []}
            lastAt={active[p.id] ?? 0}
            onClear={() => setRows((prev) => ({ ...prev, [p.id]: [] }))}
          />
        ))}
        {printers.length === 0 && <p className="text-sm text-zinc-500">Waiting for the server…</p>}
      </div>
    </main>
  );
}

function PrinterCard({
  printer,
  rows,
  lastAt,
  onClear,
}: {
  printer: Printer;
  rows: Row[];
  lastAt: number;
  onClear: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const paperRef = useRef<HTMLDivElement>(null);
  const receipts = groupReceipts(rows);

  useEffect(() => {
    if (!lastAt) return;
    setBusy(true);
    const t = setTimeout(() => setBusy(false), 600);
    return () => clearTimeout(t);
  }, [lastAt]);

  useEffect(() => {
    const el = paperRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rows.length]);

  return (
    <section className="flex w-full max-w-[360px] flex-col rounded-xl border border-zinc-800 bg-zinc-900 p-4 shadow-lg">
      <div className="mb-3 flex items-center gap-2">
        <span
          className={`h-2.5 w-2.5 rounded-full ${
            busy ? 'animate-pulse bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400' : 'bg-zinc-600'
          }`}
        />
        <span className="font-medium">{printer.name}</span>
        <span className="text-xs text-zinc-500">tcp :{printer.port}</span>
        <button
          type="button"
          onClick={onClear}
          className="ml-auto rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400"
        >
          Clear
        </button>
      </div>

      <div
        ref={paperRef}
        className="h-[520px] overflow-y-auto rounded bg-[#fdf6e3] px-3 py-4 font-mono text-zinc-900 [container-type:inline-size]"
      >
        {/* 48 columns × ~0.6em per glyph ≈ 29em, so the font tracks the paper width */}
        <div className="text-[3.4cqw] leading-snug">
          {receipts.length === 0 && <p className="text-zinc-400">no jobs yet</p>}
          {receipts.map((r) => (
            <ReceiptView key={r.key} receipt={r} printerId={printer.id} />
          ))}
        </div>
      </div>
    </section>
  );
}

function ReceiptView({ receipt, printerId }: { receipt: Receipt; printerId: string }) {
  const at = receipt.rows[0]?.at;
  return (
    <article>
      {receipt.rows.map((row) =>
        row.type === 'image' ? <BitImage key={row.key} row={row} /> : <TextLine key={row.key} row={row} />
      )}
      {receipt.cut && (
        <div className="my-3 flex items-center gap-2 border-t border-dashed border-zinc-500 pt-1.5 text-[10px] text-zinc-500">
          <span>✂ CUT</span>
          {at !== undefined && <span>{new Date(at).toLocaleTimeString()}</span>}
          {at !== undefined && (
            <button
              type="button"
              onClick={() => saveReceiptPng(receipt.rows, `${printerId}-${fileStamp(at)}.png`)}
              aria-label="Save this receipt as a PNG"
              className="ml-auto flex items-center gap-1 rounded bg-zinc-900 px-2 py-0.5 font-sans text-[10px] font-medium text-zinc-100 hover:bg-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500"
            >
              <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3 w-3" fill="currentColor">
                <path d="M5.5 2 4.6 3.5H2.5A1.5 1.5 0 0 0 1 5v7.5A1.5 1.5 0 0 0 2.5 14h11a1.5 1.5 0 0 0 1.5-1.5V5a1.5 1.5 0 0 0-1.5-1.5h-2.1L10.5 2h-5ZM8 5.5a3 3 0 1 1 0 6 3 3 0 0 1 0-6Zm0 1.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z" />
              </svg>
              Snapshot
            </button>
          )}
        </div>
      )}
    </article>
  );
}

const alignClass = (a: InkRow['align']) =>
  a === 'center' ? 'text-center' : a === 'right' ? 'text-right' : 'text-left';

function TextLine({ row }: { row: Extract<InkRow, { type: 'line' }> }) {
  return (
    <div
      className={[
        'whitespace-pre-wrap break-words',
        alignClass(row.align),
        row.bold ? 'font-bold' : '',
        row.underline ? 'underline' : '',
        row.size === 2 ? 'text-[2em] leading-tight' : '',
      ].join(' ')}
    >
      {row.text || ' '}
    </div>
  );
}

function BitImage({ row }: { row: Extract<InkRow, { type: 'image' }> }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    ref.current?.getContext('2d')?.putImageData(bitsToImageData(row), 0, 0);
  }, [row]);

  return (
    <div className={alignClass(row.align)}>
      <canvas
        ref={ref}
        width={row.width}
        height={row.height}
        // 80mm heads are 576 dots wide; scale to the paper, never past 100%
        style={{ width: `${Math.min(100, (row.width / 576) * 100)}%`, imageRendering: 'pixelated' }}
        className="my-1 inline-block align-top"
      />
    </div>
  );
}
