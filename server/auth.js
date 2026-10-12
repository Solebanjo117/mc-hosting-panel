import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from './db.js';
import { HttpError } from './lib/util.js';

export const COOKIE = 'mcp_token';
const TOKEN_TTL = '7d';

export function verifyToken(token) {
  try {
    const payload = jwt.verify(token, db.data.jwtSecret);
    if (!db.data.admin || payload.sub !== db.data.admin.username || payload.v !== (db.data.admin.tokenVersion || 0)) return null;
    return payload;
  } catch {
    return null;
  }
}

function issue(res) {
  const token = jwt.sign({ sub: db.data.admin.username, v: db.data.admin.tokenVersion || 0 }, db.data.jwtSecret, { expiresIn: TOKEN_TTL });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 3600 * 1000, path: '/' });
}

export function requireAuth(req, _res, next) {
  const payload = verifyToken(req.cookies?.[COOKIE]);
  if (!payload) return next(new HttpError(401, 'Inicia sesión para continuar'));
  req.user = payload.sub;
  next();
}

// Límite sencillo contra fuerza bruta: 8 intentos fallidos por IP cada 10 minutos.
const attempts = new Map();
function checkRate(ip) {
  const a = attempts.get(ip);
  if (a && a.count >= 8 && Date.now() - a.first < 10 * 60_000) {
    throw new HttpError(429, 'Demasiados intentos. Espera unos minutos.');
  }
}
function fail(ip) {
  const a = attempts.get(ip);
  if (!a || Date.now() - a.first > 10 * 60_000) attempts.set(ip, { count: 1, first: Date.now() });
  else a.count += 1;
}

function validate(username, password) {
  if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username || '')) throw new HttpError(400, 'El usuario debe tener 3-32 caracteres (letras, números, _ . -)');
  if (!password || password.length < 8) throw new HttpError(400, 'La contraseña debe tener al menos 8 caracteres');
}

export const authRouter = express.Router();

authRouter.get('/status', (req, res) => {
  const payload = verifyToken(req.cookies?.[COOKIE]);
  res.json({ setupRequired: !db.data.admin, authenticated: Boolean(payload), username: payload?.sub || null });
});

authRouter.post('/setup', async (req, res) => {
  if (db.data.admin) throw new HttpError(409, 'El panel ya fue configurado');
  const { username, password } = req.body || {};
  validate(username, password);
  db.data.admin = { username, passwordHash: await bcrypt.hash(password, 12), tokenVersion: 0 };
  db.flush();
  issue(res);
  res.json({ ok: true, username });
});

function recordLogin(ip, username, ok) {
  if (!Array.isArray(db.data.loginLog)) db.data.loginLog = [];
  db.data.loginLog.unshift({ at: new Date().toISOString(), ip: String(ip || '').replace(/^::ffff:/, ''), username: String(username || '').slice(0, 32), ok });
  db.data.loginLog = db.data.loginLog.slice(0, 40);
  db.save();
}

authRouter.get('/log', requireAuth, (_req, res) => {
  res.json(db.data.loginLog || []);
});

authRouter.post('/login', async (req, res) => {
  const ip = req.ip;
  checkRate(ip);
  const { username, password } = req.body || {};
  const admin = db.data.admin;
  const ok = admin && username === admin.username && (await bcrypt.compare(String(password || ''), admin.passwordHash));
  recordLogin(ip, username, Boolean(ok));
  if (!ok) {
    fail(ip);
    throw new HttpError(401, 'Usuario o contraseña incorrectos');
  }
  attempts.delete(ip);
  issue(res);
  res.json({ ok: true, username });
});

authRouter.post('/logout', (_req, res) => {
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

authRouter.post('/password', requireAuth, async (req, res) => {
  const { current, password } = req.body || {};
  const admin = db.data.admin;
  if (!(await bcrypt.compare(String(current || ''), admin.passwordHash))) throw new HttpError(401, 'La contraseña actual no es correcta');
  validate(admin.username, password);
  admin.passwordHash = await bcrypt.hash(password, 12);
  admin.tokenVersion = (admin.tokenVersion || 0) + 1; // cierra las demás sesiones
  db.flush();
  issue(res);
  res.json({ ok: true });
});
