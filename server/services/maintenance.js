import fs from 'node:fs';
import path from 'node:path';
import { serverDir } from '../config.js';
import { db, getServer } from '../db.js';
import { HttpError } from '../lib/util.js';
import { instance, isRunning } from './processManager.js';
import { readProperties, writeProperties } from './properties.js';
import { playerAction } from './players.js';
import { record } from './activity.js';

/**
 * Modo mantenimiento: el servidor sigue encendido pero solo entran quienes ayudan.
 *  - MOTD con el aviso ("🔧 Volvemos a las 8"),
 *  - lista blanca activa con los ayudantes,
 *  - se expulsa a los demás con el mensaje.
 * Al salir se restaura el MOTD y la lista blanca tal como estaban.
 */

const listFile = (id) => path.join(serverDir(id), 'whitelist.json');
const readList = (id) => {
  try {
    return JSON.parse(fs.readFileSync(listFile(id), 'utf8'));
  } catch {
    return [];
  }
};

export function status(id) {
  const server = getServer(id);
  if (!server) throw new HttpError(404, 'Servidor no encontrado');
  const m = server.maintenance;
  return m?.active ? { active: true, message: m.message, until: m.until, helpers: m.helpers, since: m.at } : { active: false };
}

export async function enter(id, { message = '', helpers = [], until = '', restart = false } = {}) {
  const server = getServer(id);
  if (!server) throw new HttpError(404, 'Servidor no encontrado');
  if (server.maintenance?.active) throw new HttpError(409, 'Ya está en mantenimiento');
  const msg = String(message || 'En mantenimiento, volvemos pronto').trim().slice(0, 120);
  const names = [...new Set((Array.isArray(helpers) ? helpers : []).map((h) => String(h).trim()).filter((h) => /^[A-Za-z0-9_.]{2,17}$/.test(h)))];
  const props = readProperties(id);
  const prev = { motd: props.motd ?? null, whitelist: props['white-list'] === 'true', list: readList(id) };
  const motd = `§6🔧 ${msg}${until ? ` §7(${String(until).slice(0, 40)})` : ''}`;
  writeProperties(id, { motd, 'white-list': 'true' });
  server.maintenance = { active: true, message: msg, until: String(until || '').slice(0, 40), helpers: names, prev, at: new Date().toISOString() };
  db.save();
  for (const h of names) {
    try {
      await playerAction(id, 'whitelist-add', h);
    } catch (err) {
      server.maintenance.warnings = [...(server.maintenance.warnings || []), `${h}: ${err.message}`];
    }
  }
  if (!fs.existsSync(listFile(id))) fs.writeFileSync(listFile(id), JSON.stringify(prev.list, null, 2));
  const inst = instance(id);
  if (isRunning(id)) {
    inst.send('whitelist on');
    inst.send('whitelist reload');
    for (const p of inst.players) if (!names.includes(p)) inst.send(`kick ${p} ${msg}`);
    if (restart) await inst.restart();
  }
  record(id, 'maintenance', { detail: `inicio: ${msg}` });
  db.save();
  return status(id);
}

export async function exit(id, { restart = false } = {}) {
  const server = getServer(id);
  if (!server) throw new HttpError(404, 'Servidor no encontrado');
  const m = server.maintenance;
  if (!m?.active) throw new HttpError(409, 'No está en mantenimiento');
  writeProperties(id, { motd: m.prev.motd ?? 'A Minecraft Server', 'white-list': m.prev.whitelist ? 'true' : 'false' });
  fs.writeFileSync(listFile(id), JSON.stringify(m.prev.list || [], null, 2));
  server.maintenance = { active: false };
  db.save();
  const inst = instance(id);
  if (isRunning(id)) {
    inst.send(m.prev.whitelist ? 'whitelist reload' : 'whitelist off');
    inst.send('say Terminó el mantenimiento. ¡Bienvenidos de vuelta!');
    if (restart) await inst.restart();
  }
  record(id, 'maintenance', { detail: 'fin' });
  return status(id);
}
