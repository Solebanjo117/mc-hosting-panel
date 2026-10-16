import { WebSocketServer } from 'ws';
import { bus } from './lib/bus.js';
import { COOKIE, verifyToken } from './auth.js';
import { instance } from './services/processManager.js';
import { getServer } from './db.js';
import { clientIp, isAllowed, sameOriginUpgrade } from './lib/netguard.js';

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/**
 * Límites contra abusos (una pestaña normal manda unos pocos mensajes y se suscribe a uno o dos servidores):
 *  - mensajes de hasta 16 KB,
 *  - hasta 40 mensajes cada 10 segundos por conexión (si no, se cierra),
 *  - hasta 50 servidores suscritos por conexión,
 *  - hasta 20 conexiones abiertas por IP y 200 en total.
 */
const env = (k, d) => Number(process.env[k]) || d;
export const LIMITS = {
  maxPayload: 16 * 1024,
  messages: env('MCP_WS_MAX_MESSAGES', 40),
  windowMs: 10_000,
  subscriptions: 50,
  perIp: env('MCP_WS_MAX_PER_IP', 20),
  total: 200,
};

function reject(socket, status, text) {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

/**
 * Un solo WebSocket por pestaña del navegador:
 *  - estado de todos los servidores (siempre)
 *  - consola y progreso de instalación del servidor al que se "suscribe" la vista abierta
 */
export function attachWebSocket(httpServer) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: LIMITS.maxPayload });
  const perIp = new Map();

  httpServer.on('upgrade', (req, socket, head) => {
    if (!req.url.startsWith('/ws') || !isAllowed(req.socket.remoteAddress) || !sameOriginUpgrade(req)) return socket.destroy();
    if (!verifyToken(parseCookies(req.headers.cookie)[COOKIE])) return reject(socket, 401, 'Unauthorized');
    const ip = clientIp(req.socket.remoteAddress);
    if ((perIp.get(ip) || 0) >= LIMITS.perIp || wss.clients.size >= LIMITS.total) return reject(socket, 429, 'Too Many Requests');
    wss.handleUpgrade(req, socket, head, (ws) => {
      perIp.set(ip, (perIp.get(ip) || 0) + 1);
      ws.once('close', () => {
        const n = (perIp.get(ip) || 1) - 1;
        if (n <= 0) perIp.delete(ip);
        else perIp.set(ip, n);
      });
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws) => {
    ws.subscriptions = new Set();
    ws.isAlive = true;
    ws.window = { start: Date.now(), count: 0 };
    ws.on('pong', () => (ws.isAlive = true));
    // Un mensaje demasiado grande cierra la conexión (código 1009); que no tumbe el panel.
    ws.on('error', () => ws.terminate());
    ws.on('message', (raw) => {
      const now = Date.now();
      if (now - ws.window.start > LIMITS.windowMs) ws.window = { start: now, count: 0 };
      if (++ws.window.count > LIMITS.messages) return ws.close(1008, 'Demasiados mensajes');
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      if (msg?.type === 'subscribe' && typeof msg.id === 'string' && getServer(msg.id)) {
        if (!ws.subscriptions.has(msg.id) && ws.subscriptions.size >= LIMITS.subscriptions) return;
        ws.subscriptions.add(msg.id);
        ws.send(JSON.stringify({ type: 'console-history', id: msg.id, lines: instance(msg.id).lines }));
      } else if (msg?.type === 'unsubscribe') {
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
