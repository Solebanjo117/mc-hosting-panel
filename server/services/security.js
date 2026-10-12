import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { serverDir } from '../config.js';
import { db, getServer } from '../db.js';
import { HttpError, compareVersions } from '../lib/util.js';
import { readProperties, writeProperties } from './properties.js';
import { instance, isRunning } from './processManager.js';
import { setYamlValue } from './geyserConfig.js';

/**
 * Revisión de seguridad de un servidor: revisa la configuración y propone arreglos.
 * Cada hallazgo tiene un nivel (critical | warning | info | ok) y, si se puede, un arreglo de un clic.
 */

function bukkitThrottle(id) {
  const file = path.join(serverDir(id), 'bukkit.yml');
  if (!fs.existsSync(file)) return null;
  const m = fs.readFileSync(file, 'utf8').match(/^\s*connection-throttle:\s*(-?\d+)/m);
  return m ? Number(m[1]) : null;
}

function readOps(id) {
  try {
    return JSON.parse(fs.readFileSync(path.join(serverDir(id), 'ops.json'), 'utf8'));
  } catch {
    return [];
  }
}

export function audit(id) {
  const server = getServer(id);
  if (!server) throw new HttpError(404, 'Servidor no encontrado');
  const p = readProperties(id);
  const has = Object.keys(p).length > 0;
  const findings = [];
  const add = (f) => findings.push(f);
  const exposed = !server.playit?.enabled; // sin túnel, se comparte la IP de la casa

  if (!has) {
    return {
      findings: [{ id: 'not-generated', level: 'info', title: 'Enciende el servidor una vez', detail: 'Todavía no existe server.properties; la revisión estará disponible después del primer arranque.' }],
      score: null,
    };
  }

  // Cuentas verificadas
  if (p['online-mode'] === 'false') {
    add({
      id: 'online-mode',
      level: 'critical',
      title: 'Cualquiera puede entrar con cualquier nombre',
      detail: 'online-mode está desactivado: el servidor no verifica las cuentas con Microsoft. Alguien puede entrar con tu nombre y, si eres operador, usar tus permisos.',
      fix: 'Activar online-mode',
    });
  } else {
    add({ id: 'online-mode', level: 'ok', title: 'Se verifican las cuentas de Minecraft', detail: 'online-mode está activado.' });
  }

  // Lista blanca
  const wl = p['white-list'] === 'true';
  const enforce = p['enforce-whitelist'] === 'true';
  if (!wl) {
    add({
      id: 'whitelist',
      level: 'warning',
      title: 'Cualquier persona con la dirección puede entrar',
      detail: 'La lista blanca está desactivada. Hay programas que recorren internet buscando servidores abiertos para destruir construcciones. Si el servidor es solo para amigos, actívala y agrégalos en Jugadores.',
      fix: 'Activar lista blanca',
    });
  } else if (!enforce) {
    add({
      id: 'whitelist',
      level: 'info',
      title: 'La lista blanca no expulsa a quien ya está dentro',
      detail: 'Con enforce-whitelist, si quitas a alguien de la lista se le expulsa al momento.',
      fix: 'Activar enforce-whitelist',
    });
  } else {
    add({ id: 'whitelist', level: 'ok', title: 'Lista blanca activa', detail: 'Solo entran los jugadores que agregaste.' });
  }

  // RCON
  if (p['enable-rcon'] === 'true') {
    const pw = p['rcon.password'] || '';
    add({
      id: 'rcon',
      level: pw.length < 16 ? 'critical' : 'warning',
      title: 'RCON está activado',
      detail: `RCON permite controlar el servidor a distancia con una contraseña${pw.length < 16 ? ' débil o vacía' : ''}. El panel no lo necesita. Nunca abras su puerto (${p['rcon.port'] || 25575}) en el router.`,
      fix: 'Desactivar RCON',
    });
  }

  // Query
  if (p['enable-query'] === 'true') {
    add({
      id: 'query',
      level: 'info',
      title: 'Query está activado',
      detail: 'Publica la lista de jugadores y plugins por UDP. Solo hace falta para algunas páginas de listas de servidores.',
      fix: 'Desactivar query',
    });
  }

  // Ocultar jugadores en la lista (1.18+)
  const supportsHide = /^\d{2}\./.test(server.mcVersion) || compareVersions(server.mcVersion, '1.18') >= 0;
  if (supportsHide && p['hide-online-players'] !== 'true') {
    add({
      id: 'hide-players',
      level: 'info',
      title: 'Cualquiera puede ver quién está conectado',
      detail: 'Los escáneres de servidores guardan los nombres de los jugadores conectados. Ocultarlos no afecta a tus amigos.',
      fix: 'Ocultar jugadores en la lista',
    });
  }

  // Bloques de comandos
  if (p['enable-command-block'] === 'true') {
    add({
      id: 'command-blocks',
      level: 'info',
      title: 'Bloques de comandos activados',
      detail: 'Si un operador o un plugin con fallas los usa mal, pueden afectar todo el servidor. Desactívalos si no los usas.',
      fix: 'Desactivar bloques de comandos',
    });
  }

  // Throttle de conexiones (Paper/Spigot)
  if (server.type === 'paper') {
    const t = bukkitThrottle(id);
    if (t != null && t < 4000) {
      add({
        id: 'throttle',
        level: 'warning',
        title: 'Límite de reconexión desactivado o muy bajo',
        detail: `connection-throttle en bukkit.yml es ${t} ms. Con 4000 ms una misma IP no puede reconectar más de una vez cada 4 segundos, lo que frena a muchos bots.`,
        fix: 'Poner 4000 ms',
      });
    }
  }

  // Operadores
  const ops = readOps(id);
  if (ops.length > 3) {
    add({
      id: 'ops',
      level: 'info',
      title: `${ops.length} operadores`,
      detail: 'Cada operador puede usar todos los comandos. Revisa en Jugadores que todos sean de confianza.',
    });
  }

  // Protección contra oleadas
  if (!server.protection?.enabled) {
    add({
      id: 'flood',
      level: 'warning',
      title: 'Protección contra oleadas de bots desactivada',
      detail: 'Detecta cuando entran muchas conexiones seguidas, banea por un rato las IP que insisten y, si el ataque viene de muchas IP, activa la lista blanca de emergencia.',
      fix: 'Activar protección',
    });
  } else {
    add({ id: 'flood', level: 'ok', title: 'Protección contra oleadas activa', detail: 'El panel vigila las conexiones en la consola.' });
  }

  // IP de la casa expuesta
  add(
    exposed
      ? {
          id: 'ip',
          level: 'info',
          title: 'Tus jugadores ven la IP de tu casa',
          detail: 'Si alguien quiere atacar tu internet (DDoS), necesita tu IP. Con un túnel de playit.gg tus amigos se conectan a playit y tu IP no se ve. Comparte la dirección solo con gente de confianza.',
        }
      : { id: 'ip', level: 'ok', title: 'Tu IP está oculta detrás de playit.gg', detail: 'Tus amigos se conectan al túnel, no a tu casa.' }
  );

  // Respaldos
  if (!server.backupSchedule?.enabled && !(server.schedules || []).some((t) => t.enabled && (t.action === 'backup' || t.backupBefore))) {
    add({
      id: 'backups',
      level: 'warning',
      title: 'No hay respaldos automáticos',
      detail: 'Si alguien destruye el mundo o se daña un archivo, un respaldo reciente lo arregla en minutos.',
      fix: 'Respaldar cada 24 h',
    });
  }

  const weights = { critical: 25, warning: 10, info: 3, ok: 0 };
  const score = Math.max(0, 100 - findings.reduce((n, f) => n + weights[f.level], 0));
  const order = { critical: 0, warning: 1, info: 2, ok: 3 };
  return { findings: findings.sort((a, b) => order[a.level] - order[b.level]), score };
}

/** Aplica el arreglo recomendado. Devuelve si hace falta reiniciar. */
export function applyFix(id, fixId) {
  const server = getServer(id);
  if (!server) throw new HttpError(404, 'Servidor no encontrado');
  const running = isRunning(id);
  const props = (values) => {
    writeProperties(id, values);
    return running;
  };
  switch (fixId) {
    case 'online-mode':
      return props({ 'online-mode': 'true' });
    case 'whitelist':
      if (running) {
        instance(id).send('whitelist on');
        writeProperties(id, { 'enforce-whitelist': 'true' });
        return false;
      }
      return props({ 'white-list': 'true', 'enforce-whitelist': 'true' });
    case 'rcon':
      return props({ 'enable-rcon': 'false', 'rcon.password': crypto.randomBytes(24).toString('base64url') });
    case 'query':
      return props({ 'enable-query': 'false' });
    case 'hide-players':
      return props({ 'hide-online-players': 'true' });
    case 'command-blocks':
      return props({ 'enable-command-block': 'false' });
    case 'throttle': {
      const file = path.join(serverDir(id), 'bukkit.yml');
      const r = setYamlValue(fs.readFileSync(file, 'utf8'), 'settings', 'connection-throttle', 4000);
      if (r.changed) fs.writeFileSync(file, r.text);
      return running;
    }
    case 'flood':
      server.protection = { ...defaultProtection(), ...(server.protection || {}), enabled: true };
      db.flush();
      return false;
    case 'backups':
      server.backupSchedule = { ...(server.backupSchedule || {}), enabled: true, intervalHours: 24, keep: server.backupSchedule?.keep || 7, mode: 'mundo' };
      db.flush();
      return false;
    default:
      throw new HttpError(400, 'Este punto no tiene arreglo automático');
  }
}

export function defaultProtection() {
  return { enabled: false, perIpPerMinute: 8, globalPerMinute: 25, banMinutes: 60, lockdownMinutes: 15 };
}
