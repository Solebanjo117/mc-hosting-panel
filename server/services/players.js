import fs from 'node:fs';
import path from 'node:path';
import { serverDir } from '../config.js';
import { getJson } from '../lib/http.js';
import { HttpError, formatUuid, offlineUuid, sleep } from '../lib/util.js';
import { instance, isRunning } from './processManager.js';
import { readProperties } from './properties.js';

const FILES = {
  whitelist: 'whitelist.json',
  ops: 'ops.json',
  banned: 'banned-players.json',
  bannedIps: 'banned-ips.json',
};

function readList(id, key) {
  const f = path.join(serverDir(id), FILES[key]);
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return [];
  }
}

function writeList(id, key, list) {
  fs.writeFileSync(path.join(serverDir(id), FILES[key]), JSON.stringify(list, null, 2));
}

export function getPlayers(id) {
  const props = readProperties(id);
  return {
    online: [...instance(id).players],
    whitelistEnabled: props['white-list'] === 'true',
    onlineMode: props['online-mode'] !== 'false',
    whitelist: readList(id, 'whitelist'),
    ops: readList(id, 'ops'),
    banned: readList(id, 'banned'),
    bannedIps: readList(id, 'bannedIps'),
  };
}

async function resolveUuid(id, name) {
  if (readProperties(id)['online-mode'] === 'false') return offlineUuid(name);
  try {
    const profile = await getJson(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`);
    return formatUuid(profile.id);
  } catch (err) {
    if (err.status === 404) throw new HttpError(404, `No existe una cuenta de Minecraft llamada "${name}"`);
    throw err;
  }
}

const COMMANDS = {
  'whitelist-add': (n) => `whitelist add ${n}`,
  'whitelist-remove': (n) => `whitelist remove ${n}`,
  op: (n) => `op ${n}`,
  deop: (n) => `deop ${n}`,
  ban: (n, r) => `ban ${n}${r ? ` ${r}` : ''}`,
  pardon: (n) => `pardon ${n}`,
  kick: (n, r) => `kick ${n}${r ? ` ${r}` : ''}`,
  'ban-ip': (n, r) => `ban-ip ${n}${r ? ` ${r}` : ''}`,
  'pardon-ip': (n) => `pardon-ip ${n}`,
};

/**
 * Con el servidor encendido se usan comandos (el servidor actualiza sus archivos).
 * Apagado, se editan los JSON directamente.
 */
export async function playerAction(id, action, name, reason = '') {
  if (!COMMANDS[action]) throw new HttpError(400, 'Acción desconocida');
  const target = String(name || '').trim();
  const isIp = action.endsWith('-ip');
  if (!isIp && !/^[A-Za-z0-9_]{2,16}$/.test(target)) throw new HttpError(400, 'Nombre de jugador inválido');
  if (isIp && !/^[0-9a-fA-F:.]+$/.test(target)) throw new HttpError(400, 'IP inválida');
  const cleanReason = String(reason).replace(/[\r\n]/g, ' ').slice(0, 200);

  if (isRunning(id)) {
    instance(id).send(COMMANDS[action](target, cleanReason));
    await sleep(800);
    return getPlayers(id);
  }

  if (action === 'kick') throw new HttpError(409, 'El servidor está apagado; no hay a quién expulsar');
  const lower = target.toLowerCase();
  const without = (key, field = 'name') => readList(id, key).filter((e) => String(e[field]).toLowerCase() !== lower);
  const now = new Date().toISOString().replace('T', ' ').replace(/\..+/, ' +0000');

  switch (action) {
    case 'whitelist-add':
      writeList(id, 'whitelist', [...without('whitelist'), { uuid: await resolveUuid(id, target), name: target }]);
      break;
    case 'whitelist-remove':
      writeList(id, 'whitelist', without('whitelist'));
      break;
    case 'op':
      writeList(id, 'ops', [
        ...without('ops'),
        { uuid: await resolveUuid(id, target), name: target, level: 4, bypassesPlayerLimit: false },
      ]);
      break;
    case 'deop':
      writeList(id, 'ops', without('ops'));
      break;
    case 'ban':
      writeList(id, 'banned', [
        ...without('banned'),
        { uuid: await resolveUuid(id, target), name: target, created: now, source: 'MC Hosting Panel', expires: 'forever', reason: cleanReason || 'Baneado por un operador.' },
      ]);
      break;
    case 'pardon':
      writeList(id, 'banned', without('banned'));
      break;
    case 'ban-ip':
      writeList(id, 'bannedIps', [
        ...without('bannedIps', 'ip'),
        { ip: target, created: now, source: 'MC Hosting Panel', expires: 'forever', reason: cleanReason || 'Baneado por un operador.' },
      ]);
      break;
    case 'pardon-ip':
      writeList(id, 'bannedIps', without('bannedIps', 'ip'));
      break;
  }
  return getPlayers(id);
}
