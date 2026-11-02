import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { DATA_DIR } from './config.js';
import { db } from './db.js';
import { HttpError } from './lib/util.js';
import { ROLES, requireOwner } from './lib/access.js';

export const COOKIE = 'mcp_token';
const TOKEN_TTL = '7d';
const USERNAME_RE = /^[A-Za-z0-9_.-]{3,32}$/;

/**
 * Cuentas:
 *  - db.data.admin es el dueño (la cuenta que se crea al instalar; también la que restablece el script).
 *  - db.data.users son las demás: moderadores y observadores con su lista de servidores.
 * La sesión es una cookie con un JWT { sub: usuario, uid: id de cuenta, v: versión } y se invalida
 * subiendo la versión (cambio de contraseña) o borrando la cuenta.
 */
function users() {
  if (!Array.isArray(db.data.users)) db.data.users = [];
  return db.data.users;
}

const ownerAccount = () => (db.data.admin ? { id: 'owner', username: db.data.admin.username, role: 'owner', servers: '*' } : null);
const toAccount = (u) => ({ id: u.id, username: u.username, role: u.role, servers: u.servers });

/** Devuelve la cuenta de la sesión o null si no es válida. */
export function verifyToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, db.data.jwtSecret);
  } catch {
    return null;
  }
  if (!payload.uid || payload.uid === 'owner') {
    if (!db.data.admin || payload.sub !== db.data.admin.username || payload.v !== (db.data.admin.tokenVersion || 0)) return null;
    return ownerAccount();
  }
  const u = users().find((x) => x.id === payload.uid);
  if (!u || payload.sub !== u.username || payload.v !== (u.tokenVersion || 0)) return null;
  return toAccount(u);
}

function issue(req, res, record, id) {
  const token = jwt.sign({ sub: record.username, uid: id, v: record.tokenVersion || 0 }, db.data.jwtSecret, { expiresIn: TOKEN_TTL });
  // Detrás de Caddy/Nginx con HTTPS (X-Forwarded-Proto desde esta PC) o con Tailscale Serve, la cookie
  // lleva Secure: el navegador no la manda por HTTP. En http://localhost no se pone, porque fallaría.
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: 7 * 24 * 3600 * 1000, path: '/' });
}

export function requireAuth(req, _res, next) {
  const account = verifyToken(req.cookies?.[COOKIE]);
  if (!account) return next(new HttpError(401, 'Inicia sesión para continuar'));
  req.user = account.username;
  req.account = account;
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

function validateUsername(username) {
  if (!USERNAME_RE.test(username || '')) throw new HttpError(400, 'El usuario debe tener 3-32 caracteres (letras, números, _ . -)');
}
function validatePassword(password) {
  if (!password || password.length < 8) throw new HttpError(400, 'La contraseña debe tener al menos 8 caracteres');
}
function validate(username, password) {
  validateUsername(username);
  validatePassword(password);
}

/** ¿Ya hay una cuenta con ese nombre (sin distinguir mayúsculas)? */
function taken(username, exceptId = null) {
  const low = String(username).toLowerCase();
  if (db.data.admin && exceptId !== 'owner' && db.data.admin.username.toLowerCase() === low) return true;
  return users().some((u) => u.id !== exceptId && u.username.toLowerCase() === low);
}

export const authRouter = express.Router();

authRouter.get('/status', (req, res) => {
  const account = verifyToken(req.cookies?.[COOKIE]);
  res.json({
    setupRequired: !db.data.admin,
    authenticated: Boolean(account),
    username: account?.username || null,
    role: account?.role || null,
    servers: account ? account.servers : null,
  });
});

authRouter.post('/setup', async (req, res) => {
  if (db.data.admin) throw new HttpError(409, 'El panel ya fue configurado');
  const { username, password } = req.body || {};
  validate(username, password);
  db.data.admin = { username, passwordHash: await bcrypt.hash(password, 12), tokenVersion: 0 };
  db.flush();
  issue(req, res, db.data.admin, 'owner');
  res.json({ ok: true, username });
});

function recordLogin(ip, username, ok) {
  if (!Array.isArray(db.data.loginLog)) db.data.loginLog = [];
  db.data.loginLog.unshift({ at: new Date().toISOString(), ip: String(ip || '').replace(/^::ffff:/, ''), username: String(username || '').slice(0, 32), ok });
  db.data.loginLog = db.data.loginLog.slice(0, 40);
  db.save();
}

authRouter.get('/log', requireAuth, requireOwner, (_req, res) => {
  res.json(db.data.loginLog || []);
});

authRouter.post('/login', async (req, res) => {
  const ip = req.ip;
  checkRate(ip);
  const { username, password } = req.body || {};
  const admin = db.data.admin;
  let record = null;
  let id = null;
  if (admin && username === admin.username) {
    record = admin;
    id = 'owner';
  } else {
    const u = users().find((x) => x.username === username);
    if (u) {
      record = u;
      id = u.id;
    }
  }
  const ok = record && (await bcrypt.compare(String(password || ''), record.passwordHash));
  recordLogin(ip, username, Boolean(ok));
  if (!ok) {
    fail(ip);
    throw new HttpError(401, 'Usuario o contraseña incorrectos');
  }
  attempts.delete(ip);
  if (id !== 'owner') {
    record.lastLoginAt = new Date().toISOString();
    db.save();
  }
  issue(req, res, record, id);
  res.json({ ok: true, username, role: id === 'owner' ? 'owner' : record.role });
});

authRouter.post('/logout', (_req, res) => {
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

/**
 * Restablecer la contraseña olvidada desde la PC del panel: scripts/restablecer-contrasena.mjs deja
 * este archivo en la carpeta data (solo quien usa esa PC puede escribir ahí) y el panel lo aplica
 * al arrancar o, si ya está abierto, en un par de segundos. Cierra todas las sesiones del dueño.
 */
export const RESET_FILE = path.join(DATA_DIR, 'restablecer-contrasena.json');

export function applyPendingReset() {
  if (!fs.existsSync(RESET_FILE)) return false;
  let req;
  try {
    req = JSON.parse(fs.readFileSync(RESET_FILE, 'utf8'));
  } catch {
    req = null;
  }
  fs.rmSync(RESET_FILE, { force: true });
  const username = String(req?.username || db.data.admin?.username || '');
  if (!/^\$2[aby]\$\d\d\$.{53}$/.test(String(req?.passwordHash || '')) || !USERNAME_RE.test(username)) {
    console.error('  Se ignoró un archivo para restablecer la contraseña que no es válido.');
    return false;
  }
  if (taken(username, 'owner')) {
    console.error(`  No se restableció la contraseña: ya hay otra cuenta llamada "${username}".`);
    return false;
  }
  db.data.admin = { ...(db.data.admin || {}), username, passwordHash: req.passwordHash, tokenVersion: (db.data.admin?.tokenVersion || 0) + 1 };
  attempts.clear();
  if (!Array.isArray(db.data.loginLog)) db.data.loginLog = [];
  db.data.loginLog.unshift({ at: new Date().toISOString(), ip: 'esta PC', username, ok: true, reset: true });
  db.data.loginLog = db.data.loginLog.slice(0, 40);
  db.flush();
  console.log(`  Contraseña restablecida desde esta PC (usuario ${username}). Se cerraron las sesiones abiertas.`);
  return true;
}

applyPendingReset();
setInterval(applyPendingReset, 1500).unref();

/** Cambia la contraseña de la cuenta con la que se entró; cierra sus otras sesiones. */
authRouter.post('/password', requireAuth, async (req, res) => {
  const { current, password } = req.body || {};
  const record = req.account.id === 'owner' ? db.data.admin : users().find((u) => u.id === req.account.id);
  if (!record || !(await bcrypt.compare(String(current || ''), record.passwordHash))) throw new HttpError(401, 'La contraseña actual no es correcta');
  validatePassword(password);
  record.passwordHash = await bcrypt.hash(password, 12);
  record.tokenVersion = (record.tokenVersion || 0) + 1; // cierra las demás sesiones
  db.flush();
  issue(req, res, record, req.account.id);
  res.json({ ok: true });
});

// --- Usuarios (solo el dueño) -----------------------------------------------------------

const publicUser = (u) => ({ id: u.id, username: u.username, role: u.role, servers: u.servers, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt || null });

function cleanRole(role) {
  if (!ROLES.includes(role) || role === 'owner') throw new HttpError(400, 'El rol debe ser moderador u observador');
  return role;
}

/** '*' (todos, también los que se creen después) o una lista de servidores que existan. */
function cleanServers(value) {
  if (value === '*') return '*';
  if (!Array.isArray(value)) throw new HttpError(400, 'Indica los servidores: una lista de ids o "*" para todos');
  const ids = [...new Set(value.map(String))];
  const missing = ids.filter((id) => !db.data.servers.some((s) => s.id === id));
  if (missing.length) throw new HttpError(400, 'Alguno de esos servidores no existe');
  return ids;
}

authRouter.get('/users', requireAuth, requireOwner, (_req, res) => {
  res.json(users().map(publicUser));
});

authRouter.post('/users', requireAuth, requireOwner, async (req, res) => {
  const { username, password, role, servers } = req.body || {};
  validate(username, password);
  if (taken(username)) throw new HttpError(409, 'Ya hay una cuenta con ese nombre');
  if (users().length >= 50) throw new HttpError(400, 'Demasiadas cuentas');
  const u = {
    id: crypto.randomBytes(6).toString('hex'),
    username,
    passwordHash: await bcrypt.hash(password, 12),
    role: cleanRole(role),
    servers: cleanServers(servers ?? '*'),
    tokenVersion: 0,
    createdAt: new Date().toISOString(),
  };
  users().push(u);
  db.flush();
  res.status(201).json(publicUser(u));
});

authRouter.put('/users/:id', requireAuth, requireOwner, async (req, res) => {
  const u = users().find((x) => x.id === req.params.id);
  if (!u) throw new HttpError(404, 'Esa cuenta no existe');
  const { username, password, role, servers } = req.body || {};
  if (username !== undefined && username !== u.username) {
    validateUsername(username);
    if (taken(username, u.id)) throw new HttpError(409, 'Ya hay una cuenta con ese nombre');
    u.username = username;
    u.tokenVersion = (u.tokenVersion || 0) + 1; // el nombre va en la sesión
  }
  if (role !== undefined) u.role = cleanRole(role);
  if (servers !== undefined) u.servers = cleanServers(servers);
  if (password !== undefined && password !== '') {
    validatePassword(password);
    u.passwordHash = await bcrypt.hash(password, 12);
    u.tokenVersion = (u.tokenVersion || 0) + 1; // cierra sus sesiones abiertas
  }
  db.flush();
  res.json(publicUser(u));
});

authRouter.delete('/users/:id', requireAuth, requireOwner, (req, res) => {
  const list = users();
  const i = list.findIndex((x) => x.id === req.params.id);
  if (i < 0) throw new HttpError(404, 'Esa cuenta no existe');
  list.splice(i, 1); // sus sesiones dejan de valer: ya no hay cuenta que las respalde
  db.flush();
  res.json({ ok: true });
});

/** Al borrar un servidor, sale de las listas de las cuentas. */
export function forgetServer(id) {
  let changed = false;
  for (const u of users()) {
    if (Array.isArray(u.servers) && u.servers.includes(id)) {
      u.servers = u.servers.filter((x) => x !== id);
      changed = true;
    }
  }
  if (changed) db.save();
}
