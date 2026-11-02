// @ts-check
import { HttpError } from './util.js';

/**
 * Quién puede hacer qué. Tres niveles:
 *  - owner (dueño): todo. Es la cuenta que se crea al instalar el panel.
 *  - moderator (moderador): en los servidores que se le asignan, ve todo menos los archivos, y puede
 *    encender/apagar, mandar comandos, administrar jugadores, hacer respaldos y poner mantenimiento.
 *  - viewer (observador): en sus servidores solo mira (consola, jugadores, chat, actividad, rendimiento, logs).
 * Un servidor que no está en la lista de la cuenta no existe para ella (404, no 403).
 */
export const ROLES = ['owner', 'moderator', 'viewer'];
export const ROLE_LABEL = { owner: 'Dueño', moderator: 'Moderador', viewer: 'Observador' };

/** @typedef {{ id: string, username: string, role: 'owner'|'moderator'|'viewer', servers: '*'|string[] }} Account */

/** @param {Account} account @param {string} id */
export function canSeeServer(account, id) {
  if (!account) return false;
  if (account.role === 'owner' || account.servers === '*') return true;
  return Array.isArray(account.servers) && account.servers.includes(id);
}

/** Lo que un moderador puede cambiar dentro de un servidor suyo (método y ruta relativa al servidor). */
/** @type {Array<[string, RegExp]>} */
const MODERATOR_WRITES = [
  ['POST', /^\/(start|stop|restart|kill)\/?$/],
  ['POST', /^\/command\/?$/],
  ['POST', /^\/players\/?$/],
  ['POST', /^\/backups\/?$/],
  ['POST', /^\/positions\/watch\/?$/],
  ['POST', /^\/maintenance\/?$/],
  ['DELETE', /^\/maintenance\/?$/],
];

/** Lecturas dentro de un servidor que solo el dueño puede hacer (dan acceso a archivos del disco). */
const OWNER_ONLY_READS = [/^\/files(\/|$)/, /^\/backups\/[^/]+\/download\/?$/];

/** Lecturas fuera de los servidores que cualquier cuenta puede hacer. */
const SHARED_READS = [/^\/system\/(info|dashboard|metrics|quick-commands|appearance)\/?$/, /^\/system\/docs\//];

const deny = () => new HttpError(403, 'Tu cuenta no puede hacer esto; pídeselo al dueño del panel');

/**
 * Middleware para /api (después de requireAuth). El dueño pasa siempre; para los demás decide por
 * rol y por la lista de servidores de la cuenta.
 * @param {any} req
 */
export function authorize(req, _res, next) {
  const account = req.account;
  if (!account) return next(new HttpError(401, 'Inicia sesión para continuar'));
  if (account.role === 'owner') return next();
  const method = req.method;
  const path = req.path.replace(/\/+$/, '') || '/';
  const read = method === 'GET' || method === 'HEAD';

  // Su propia cuenta: estado, salir, cambiar su contraseña. Administrar usuarios es del dueño.
  if (path.startsWith('/auth')) return path.startsWith('/auth/users') ? next(deny()) : next();
  if (path === '/servers') return read ? next() : next(deny());

  const m = path.match(/^\/servers\/([^/]+)(\/.*)?$/);
  if (m) {
    const [, id, rest = '/'] = m;
    if (!canSeeServer(account, id)) return next(new HttpError(404, 'Servidor no encontrado'));
    if (OWNER_ONLY_READS.some((rx) => rx.test(rest))) return next(deny());
    if (read) return next();
    if (account.role === 'moderator' && MODERATOR_WRITES.some(([mm, rx]) => mm === method && rx.test(rest))) return next();
    return next(deny());
  }
  if (read && SHARED_READS.some((rx) => rx.test(path))) return next();
  next(deny());
}

/** Solo el dueño (para rutas montadas antes de authorize, como las de usuarios). */
export function requireOwner(req, _res, next) {
  if (req.account?.role === 'owner') return next();
  next(deny());
}
