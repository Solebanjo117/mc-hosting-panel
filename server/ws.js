import { WebSocketServer } from 'ws';
import { bus } from './lib/bus.js';
import { COOKIE, verifyToken } from './auth.js';
import { instance } from './services/processManager.js';
import { getServer } from './db.js';
import { isAllowed, sameOriginUpgrade } from './lib/netguard.js';

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/**
 * Un solo WebSocket por pestaña del navegador:
 *  - estado de todos los servidores (siempre)
 *  - consola y progreso de instalación del servidor al que se "suscribe" la vista abierta
 */
export function attachWebSocket(httpServer) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    if (!req.url.startsWith('/ws') || !isAllowed(req.socket.remoteAddress) || !sameOriginUpgrade(req)) return socket.destroy();
    if (!verifyToken(parseCookies(req.headers.cookie)[COOKIE])) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws) => {
    ws.subscriptions = new Set();
    ws.isAlive = true;
    ws.on('pong', () => (ws.isAlive = true));
    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      if (msg.type === 'subscribe' && getServer(msg.id)) {
        ws.subscriptions.add(msg.id);
        ws.send(JSON.stringify({ type: 'console-history', id: msg.id, lines: instance(msg.id).lines }));
      } else if (msg.type === 'unsubscribe') {
        ws.subscriptions.delete(msg.id);
      }
    });
  });

  const send = (filter, payload) => {
    const data = JSON.stringify(payload);
    for (const ws of wss.clients) if (ws.readyState === 1 && filter(ws)) ws.send(data);
  };

  bus.on('status', (id, snapshot) => send(() => true, { type: 'status', id, ...snapshot }));
  bus.on('servers', () => send(() => true, { type: 'servers' }));
  bus.on('playit', (status) => send(() => true, { type: 'playit', ...status, logs: undefined }));
  bus.on('install', (id, payload) => send(() => true, { type: 'install', id, ...payload }));
  bus.on('app-update', (state) => send(() => true, { type: 'app-update', ...state }));
  bus.on('console', (id, line) => send((ws) => ws.subscriptions.has(id), { type: 'console', id, line }));

  // Cierra conexiones muertas (laptop suspendida, Wi-Fi caído…).
  setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30_000).unref();

  return wss;
}
