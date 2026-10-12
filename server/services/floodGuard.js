import fs from 'node:fs';
import path from 'node:path';
import { serverDir } from '../config.js';
import { db, getServer } from '../db.js';
import { readProperties } from './properties.js';

/**
 * Protección contra oleadas de conexiones (ataques de bots).
 * Lee las líneas de la consola donde el servidor registra conexiones con su IP:
 *  - una IP que se conecta demasiadas veces por minuto se banea un rato (ban-ip)
 *  - si llegan demasiadas conexiones en total, se activa la lista blanca de emergencia
 * No detiene un DDoS que satura tu internet: eso ocurre antes de que el tráfico llegue a la PC.
 */

const IP_RE = /\/(\d{1,3}(?:\.\d{1,3}){3}):\d+/;
const EVENT_RE = /logged in with entity id|lost connection|Disconnecting|disconnected with/i;

const state = new Map(); // id -> { events: [{t, ip}], lastByIp: Map }

function st(id) {
  if (!state.has(id)) state.set(id, { events: [], lastByIp: new Map() });
  return state.get(id);
}

/** Las IP de la casa, de Tailscale y la del túnel de playit (127.0.0.1) nunca se banean. */
export function isPrivateIp(ip) {
  const [a, b] = ip.split('.').map(Number);
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || a === 0;
}

function settings(server) {
  return server?.protection?.enabled ? server.protection : null;
}

function logEvent(server, type, message) {
  if (!Array.isArray(server.securityLog)) server.securityLog = [];
  server.securityLog.unshift({ at: new Date().toISOString(), type, message });
  server.securityLog = server.securityLog.slice(0, 50);
  db.save();
}

function pstate(server) {
  if (!server.protectionState) server.protectionState = { bans: {}, lockdownUntil: null, lockdownByPanel: false };
  return server.protectionState;
}

/** Se llama con cada línea de la consola. */
export function observe(inst, line) {
  if (!EVENT_RE.test(line)) return;
  const m = line.match(IP_RE);
  if (!m) return;
  const server = getServer(inst.id);
  const cfg = settings(server);
  if (!cfg) return;
  const ip = m[1];
  const now = Date.now();
  const s = st(inst.id);

  // Una misma conexión deja varias líneas (entra y sale); se cuenta una vez cada 3 s por IP.
  if (now - (s.lastByIp.get(ip) || 0) < 3000) return;
  s.lastByIp.set(ip, now);
  s.events = s.events.filter((e) => now - e.t < 60_000);
  s.events.push({ t: now, ip });

  const ps = pstate(server);

  // Demasiadas conexiones desde la misma IP pública
  if (!isPrivateIp(ip) && !ps.bans[ip]) {
    const fromIp = s.events.filter((e) => e.ip === ip).length;
    if (fromIp > cfg.perIpPerMinute) {
      ps.bans[ip] = now + cfg.banMinutes * 60_000;
      inst.send(`ban-ip ${ip} Demasiadas conexiones seguidas (bloqueo automático del panel)`);
      inst.panelLine(`Protección: la IP ${ip} se conectó ${fromIp} veces en un minuto; bloqueada ${cfg.banMinutes} min.`);
      logEvent(server, 'ban', `IP ${ip} bloqueada ${cfg.banMinutes} min (${fromIp} conexiones en 1 min)`);
    }
  }

  // Oleada desde muchas IP: lista blanca de emergencia
  const total = s.events.length;
  if (total > cfg.globalPerMinute) {
    const whitelistOn = readProperties(inst.id)['white-list'] === 'true';
    if (!ps.lockdownUntil && !whitelistOn) {
      ps.lockdownByPanel = true;
      inst.send('whitelist on');
      inst.panelLine(`Protección: ${total} conexiones en un minuto. Lista blanca activada por ${cfg.lockdownMinutes} min; solo entran jugadores de la lista.`);
      logEvent(server, 'lockdown', `Lista blanca de emergencia por ${cfg.lockdownMinutes} min (${total} conexiones en 1 min)`);
    }
    ps.lockdownUntil = now + cfg.lockdownMinutes * 60_000; // se extiende mientras siga el ataque
    db.save();
  }
}

function pardonOffline(id, ip) {
  const file = path.join(serverDir(id), 'banned-ips.json');
  try {
    const list = JSON.parse(fs.readFileSync(file, 'utf8')).filter((e) => e.ip !== ip);
    fs.writeFileSync(file, JSON.stringify(list, null, 2));
  } catch {
    /* sin archivo */
  }
}

/** Revisa vencimientos de bloqueos y de la lista blanca de emergencia. */
export function tick(getInstance) {
  const now = Date.now();
  for (const server of db.data.servers) {
    const ps = server.protectionState;
    if (!ps) continue;
    const inst = getInstance(server.id);
    const running = inst?.proc && inst.status === 'running';
    for (const [ip, until] of Object.entries(ps.bans || {})) {
      if (until > now) continue;
      if (running) inst.send(`pardon-ip ${ip}`);
      else pardonOffline(server.id, ip);
      delete ps.bans[ip];
      logEvent(server, 'unban', `IP ${ip} desbloqueada`);
    }
    if (ps.lockdownUntil && ps.lockdownUntil <= now) {
      if (ps.lockdownByPanel) {
        if (running) {
          inst.send('whitelist off');
          inst.panelLine('Protección: terminó la lista blanca de emergencia.');
        } else {
          // Apagado: se deja como estaba antes del ataque en server.properties.
          const file = path.join(serverDir(server.id), 'server.properties');
          if (fs.existsSync(file)) fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^white-list=true$/m, 'white-list=false'));
        }
      }
      ps.lockdownUntil = null;
      ps.lockdownByPanel = false;
      logEvent(server, 'lockdown-end', 'Terminó la lista blanca de emergencia');
    }
  }
}

export function protectionStatus(server) {
  const ps = server.protectionState || {};
  const s = state.get(server.id);
  const now = Date.now();
  return {
    settings: server.protection || null,
    lockdownUntil: ps.lockdownUntil || null,
    bans: Object.entries(ps.bans || {}).map(([ip, until]) => ({ ip, until: new Date(until).toISOString() })),
    connectionsLastMinute: s ? s.events.filter((e) => now - e.t < 60_000).length : 0,
    log: server.securityLog || [],
  };
}

/** Termina la emergencia ya (por ejemplo, si el ataque paró o fue una falsa alarma). */
export function endLockdown(id, getInstance) {
  const server = getServer(id);
  if (!server?.protectionState?.lockdownUntil) return;
  server.protectionState.lockdownUntil = Date.now() - 1;
  tick(getInstance);
}
