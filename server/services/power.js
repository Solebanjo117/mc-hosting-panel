import { db, getServer } from '../db.js';
import { HttpError } from '../lib/util.js';
import { instance, isRunning } from './processManager.js';

/**
 * Horario de energía: una cuadrícula semanal (7 días × 24 horas, lunes primero) pintada por el
 * usuario. En las horas marcadas el servidor debe estar encendido; fuera de ellas, apagado
 * (si "apagar solo cuando no haya nadie" está activo, espera a que salga el último jugador).
 */

const EMPTY = () => Array.from({ length: 7 }, () => new Array(24).fill(false));
const pendingStops = new Map(); // id -> timestamp del aviso de apagado

export function getPower(id) {
  const server = getServer(id);
  if (!server) throw new HttpError(404, 'Servidor no encontrado');
  const p = server.power || {};
  return { enabled: Boolean(p.enabled), grid: Array.isArray(p.grid) && p.grid.length === 7 ? p.grid : EMPTY(), stopIfEmpty: p.stopIfEmpty !== false, lastAction: p.lastAction || null };
}

export function setPower(id, body = {}) {
  const server = getServer(id);
  if (!server) throw new HttpError(404, 'Servidor no encontrado');
  const cur = getPower(id);
  let grid = cur.grid;
  if (body.grid !== undefined) {
    if (!Array.isArray(body.grid) || body.grid.length !== 7 || body.grid.some((row) => !Array.isArray(row) || row.length !== 24)) {
      throw new HttpError(400, 'El horario debe tener 7 días de 24 horas');
    }
    grid = body.grid.map((row) => row.map(Boolean));
  }
  server.power = {
    enabled: body.enabled === undefined ? cur.enabled : Boolean(body.enabled),
    grid,
    stopIfEmpty: body.stopIfEmpty === undefined ? cur.stopIfEmpty : Boolean(body.stopIfEmpty),
    lastAction: cur.lastAction,
  };
  db.save();
  return getPower(id);
}

/** ¿El horario quiere el servidor encendido ahora? */
export function wantedNow(grid, now = new Date()) {
  return Boolean(grid[(now.getDay() + 6) % 7]?.[now.getHours()]);
}

function note(server, text) {
  server.power.lastAction = { at: new Date().toISOString(), text };
  if (!Array.isArray(server.scheduleLog)) server.scheduleLog = [];
  server.scheduleLog.unshift({ at: new Date().toISOString(), taskId: 'power', action: 'power', result: text });
  server.scheduleLog = server.scheduleLog.slice(0, 30);
  db.save();
}

export function tick(now = new Date()) {
  for (const server of db.data.servers) {
    const p = server.power;
    if (!p?.enabled || server.installState !== 'ready') continue;
    const inst = instance(server.id);
    const want = wantedNow(p.grid, now);
    if (want) {
      pendingStops.delete(server.id);
      if (!isRunning(server.id) && inst.status === 'stopped') {
        note(server, 'encendido por el horario');
        inst.start().catch((err) => note(server, `no se pudo encender: ${err.message}`));
      }
      continue;
    }
    if (!isRunning(server.id) || inst.status !== 'running') continue;
    if (p.stopIfEmpty !== false && inst.players.size > 0) {
      pendingStops.delete(server.id);
      continue; // esperando a que salga el último jugador
    }
    const warnedAt = pendingStops.get(server.id);
    if (!warnedAt) {
      pendingStops.set(server.id, now.getTime());
      if (inst.players.size) inst.send('say Termina el horario: el servidor se apaga en 1 minuto.');
      continue;
    }
    if (now.getTime() - warnedAt >= 60_000) {
      pendingStops.delete(server.id);
      note(server, 'apagado por el horario');
      inst.stop().catch((err) => note(server, `no se pudo apagar: ${err.message}`));
    }
  }
}

setInterval(() => tick(), 30_000).unref();
