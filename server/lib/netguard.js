import { db } from '../db.js';

/**
 * Quién puede abrir el panel. Por defecto solo esta PC, la red de la casa y Tailscale:
 * si alguien abre por error el puerto 8080 en el router, el panel rechaza a los de internet.
 *  - local: solo esta PC
 *  - lan:   esta PC, la red local y Tailscale (100.64.0.0/10)
 *  - any:   cualquiera (no recomendado)
 */

export function clientIp(socketAddress = '') {
  return socketAddress.replace(/^::ffff:/, '');
}

function isLoopback(ip) {
  return ip === '::1' || ip.startsWith('127.');
}

function isLan(ip) {
  if (isLoopback(ip)) return true;
  if (ip.includes(':')) {
    const lower = ip.toLowerCase();
    return lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd');
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}

export function accessMode() {
  return db.data.settings.remoteAccess || 'lan';
}

export function isAllowed(socketAddress) {
  const ip = clientIp(socketAddress);
  const mode = accessMode();
  if (mode === 'any') return true;
  if (mode === 'local') return isLoopback(ip);
  return isLan(ip);
}

const BLOCKED_PAGE = `<!doctype html><meta charset="utf-8"><title>Acceso bloqueado</title>
<body style="font-family:system-ui;background:#161c2a;color:#ece5d3;padding:2rem;max-width:42rem">
<h1>Acceso bloqueado</h1><p>Este panel solo acepta conexiones desde la red de la casa (o Tailscale).
Si eres el dueño, ábrelo desde la PC del servidor. Si alguien abrió el puerto del panel en el router, ciérralo.</p></body>`;

export function guardHttp(req, res, next) {
  if (isAllowed(req.socket.remoteAddress)) return next();
  res.status(403).type('html').send(BLOCKED_PAGE);
}

/** Cabeceras que impiden meter el panel en otra página y cargar scripts ajenos. */
export function securityHeaders(_req, res, next) {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );
  next();
}

/**
 * Otra página web no puede mandar acciones al panel aprovechando tu sesión (CSRF):
 * las peticiones que cambian algo deben venir del mismo panel.
 */
export function sameOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (!origin) return next();
  try {
    if (new URL(origin).host === req.headers.host) return next();
  } catch {
    /* origin inválido */
  }
  res.status(403).json({ error: 'Petición bloqueada: no viene del panel' });
}

export function sameOriginUpgrade(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}
