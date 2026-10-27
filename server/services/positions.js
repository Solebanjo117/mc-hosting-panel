import { db, getServer } from '../db.js';
import { HttpError } from '../lib/util.js';
import { bus } from '../lib/bus.js';
import { allInstances, instance } from './processManager.js';
import { record } from './activity.js';

/**
 * Dónde está cada jugador y zonas con alerta.
 *  - Cada 15 s el panel pregunta en silencio la posición de los conectados ("data get entity X Pos").
 *  - Las zonas son rectángulos (x1,z1)-(x2,z2) con nombre; al entrar alguien, queda en la línea de
 *    tiempo y se avisa en el panel (y con notificación del navegador si están activadas).
 */

const POLL_MS = 15_000;
const inside = new Map(); // id -> Map(player -> Set(zoneId))

export function listZones(id) {
  const server = getServer(id);
  if (!server) throw new HttpError(404, 'Servidor no encontrado');
  return Array.isArray(server.zones) ? server.zones : [];
}

export function saveZones(id, zones) {
  const server = getServer(id);
  if (!server) throw new HttpError(404, 'Servidor no encontrado');
  if (!Array.isArray(zones) || zones.length > 50) throw new HttpError(400, 'Hasta 50 zonas');
  const clean = zones.map((z, i) => {
    const n = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : null);
    const [x1, z1, x2, z2] = [n(z.x1), n(z.z1), n(z.x2), n(z.z2)];
    if ([x1, z1, x2, z2].some((v) => v === null)) throw new HttpError(400, `Zona ${i + 1}: faltan coordenadas`);
    const name = String(z.name || '').trim().slice(0, 40);
    if (!name) throw new HttpError(400, `Zona ${i + 1}: ponle nombre`);
    return { id: String(z.id || `z${Date.now().toString(36)}${i}`), name, x1: Math.min(x1, x2), x2: Math.max(x1, x2), z1: Math.min(z1, z2), z2: Math.max(z1, z2), notify: z.notify !== false };
  });
  server.zones = clean;
  db.save();
  inside.delete(id);
  return clean;
}

const within = (z, p) => p.x >= z.x1 && p.x <= z.x2 && p.z >= z.z1 && p.z <= z.z2;

/** Llamado por la instancia cuando llega una posición nueva. */
export function onPosition(id, player, pos) {
  const zones = listZones(id);
  if (!zones.length) return;
  if (!inside.has(id)) inside.set(id, new Map());
  const byPlayer = inside.get(id);
  const was = byPlayer.get(player) || new Set();
  const now = new Set(zones.filter((z) => within(z, pos)).map((z) => z.id));
  for (const zid of now) {
    if (was.has(zid)) continue;
    const zone = zones.find((z) => z.id === zid);
    record(id, 'zone', { player, detail: zone.name });
    if (zone.notify) bus.emit('zone', id, { player, zone: zone.name, x: pos.x, z: pos.z });
  }
  byPlayer.set(player, now);
}

bus.on('status', (id, snap) => {
  const byPlayer = inside.get(id);
  if (!byPlayer) return;
  const online = new Set(snap.players || []);
  for (const p of [...byPlayer.keys()]) if (!online.has(p)) byPlayer.delete(p);
});

setInterval(() => {
  for (const inst of allInstances()) {
    if (!inst.proc || inst.status !== 'running' || !inst.players.size) continue;
    const server = getServer(inst.id);
    if (!server) continue;
    // Solo si alguien lo va a usar: hay zonas o alguien tiene abierta la lista de jugadores.
    if (!(server.zones || []).length && !inst.wantPositions) continue;
    for (const p of inst.players) inst.silentCommand(`data get entity ${p} Pos`, [/has the following entity data/, /No entity was found/, /Unknown command/i], 4000);
  }
}, POLL_MS).unref();

export const wantPositions = (id, on) => {
  instance(id).wantPositions = on;
};
