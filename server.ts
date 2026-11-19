import http from 'node:http';
import net from 'node:net';
import next from 'next';
import { WebSocketServer, WebSocket } from 'ws';
import { EscPosInterpreter, PrintEvent } from './lib/escpos-interpreter';

// PRINTERS="Counter:9100,Kitchen:9101,Bar:9102"  →  one virtual printer per Name:port
const PRINTERS = (process.env.PRINTERS ?? 'Counter:9100,Kitchen:9101,Bar:9102').split(',').map((spec) => {
  const [name, portText] = spec.split(':').map((s) => s.trim());
  const port = Number(portText);
  if (!name || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Bad PRINTERS entry "${spec}" — expected Name:port, e.g. Kitchen:9101`);
  }
  return { id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, port };
});

const WEB_PORT = Number(process.env.PORT ?? 7788);
const HOSTNAME = process.env.HOST ?? '0.0.0.0';
const dev = !process.argv.includes('--prod') && process.env.NODE_ENV !== 'production';

async function main() {
  const app = next({ dev, hostname: HOSTNAME, port: WEB_PORT });
  const handle = app.getRequestHandler();
  await app.prepare();

  const server = http.createServer((req, res) => handle(req, res));

  // noServer + manual routing so Next's own HMR upgrades on /_next/* still get through
  const wss = new WebSocketServer({ noServer: true });
  const upgradeNext = app.getUpgradeHandler();
  server.on('upgrade', (req, socket, head) => {
    if (req.url?.split('?')[0] === '/ws') {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    } else {
      upgradeNext(req, socket, head);
    }
  });

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'config', printers: PRINTERS }));
  });

  const broadcast = (printerId: string, event: PrintEvent) => {
    const msg = JSON.stringify({ printerId, event });
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(msg);
    }
  };

  server.on('error', (err) => {
    console.error(`web: cannot listen on :${WEB_PORT} — ${err.message}`);
    process.exit(1);
  });
  server.listen(WEB_PORT, HOSTNAME, () => {
    console.log(`web + ws  http://localhost:${WEB_PORT}  (ws path /ws)`);
  });

  for (const printer of PRINTERS) {
    net
      .createServer((socket) => {
        const remote = `${socket.remoteAddress}:${socket.remotePort}`;
        console.log(`[${printer.id}] connected ${remote}`);
        const interpreter = new EscPosInterpreter((e) => broadcast(printer.id, e));

        // ponytail: 'close' also finishes the job so an abrupt reset still flushes
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          interpreter.end();
        };

        socket.on('data', (chunk) => interpreter.write(chunk));
        socket.on('end', finish);
        socket.on('error', (err) => console.log(`[${printer.id}] ${err.message}`));
        socket.on('close', () => {
          finish();
          console.log(`[${printer.id}] closed ${remote}`);
        });
      })
      .on('error', (err) => {
        console.error(`printer ${printer.name}: cannot listen on :${printer.port} — ${err.message}`);
        process.exit(1);
      })
      .listen(printer.port, HOSTNAME, () => {
        console.log(`printer ${printer.name.padEnd(8)} tcp 0.0.0.0:${printer.port}`);
      });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
