import crypto from 'node:crypto';
import { DEFAULT_MC_PORT } from '../config.js';
import { db } from '../db.js';
import { HttpError } from '../lib/util.js';
import { isPortFree } from './network.js';
import { SERVER_TYPES } from './versions.js';

export function nextFreePort() {
  const used = new Set(db.data.servers.map((s) => Number(s.port)));
  let port = DEFAULT_MC_PORT;
  while (used.has(port)) port += 1;
  return port;
}

export async function validatePort(port, selfId) {
  const p = Number(port);
  if (!Number.isInteger(p) || p < 1024 || p > 65535) throw new HttpError(400, 'El puerto debe estar entre 1024 y 65535');
  const clash = db.data.servers.find((s) => Number(s.port) === p && s.id !== selfId);
  if (clash) throw new HttpError(409, `El puerto ${p} ya lo usa el servidor "${clash.name}"`);
  if (Number(db.data.settings.panelPort) === p) throw new HttpError(409, `El puerto ${p} lo usa el propio panel`);
  return p;
}

/** Valida los datos y agrega el servidor a la base (sin instalarlo todavía). */
export async function createServerRecord({ name, type, mcVersion, loaderVersion, memoryMb = 2048, port, eula, extra = {} }) {
  if (!eula) throw new HttpError(400, 'Debes aceptar el EULA de Minecraft para crear un servidor');
  if (!SERVER_TYPES[type]) throw new HttpError(400, 'Tipo de servidor inválido');
  if (!mcVersion) throw new HttpError(400, 'Elige una versión de Minecraft');
  const cleanName = String(name || '').trim().slice(0, 40);
  if (!cleanName) throw new HttpError(400, 'Ponle un nombre al servidor');
  const finalPort = await validatePort(port || nextFreePort());
  if (!(await isPortFree(finalPort))) throw new HttpError(409, `Otro programa ya está usando el puerto ${finalPort} en esta PC`);

  const server = {
    id: crypto.randomUUID().slice(0, 8),
    name: cleanName,
    type,
    mcVersion,
    loaderVersion: loaderVersion || null,
    port: finalPort,
    memoryMb: Math.max(512, Number(memoryMb) || 2048),
    jvmArgs: '',
    javaPath: null,
    autoStart: false,
    autoRestart: true,
    backupSchedule: { enabled: false, intervalHours: 24, keep: 7, mode: 'mundo' },
    installState: 'pending',
    createdAt: new Date().toISOString(),
    content: [],
    schedules: [],
    ...extra,
  };
  db.data.servers.push(server);
  db.flush();
  return server;
}
