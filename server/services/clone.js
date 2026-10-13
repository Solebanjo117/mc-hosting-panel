import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { serverDir } from '../config.js';
import { db, getServer } from '../db.js';
import { HttpError } from '../lib/util.js';
import { instance, isRunning } from './processManager.js';
import { writeProperties } from './properties.js';
import { nextFreePort } from './serverFactory.js';
import { nextBedrockPort } from './bedrock.js';
import { nextMapPort } from './worldMap.js';
import { GEYSER_CONFIG_PATHS } from './geyserConfig.js';

// Lo que se regenera solo o no debe copiarse al clon.
const SKIP = new Set(['logs', 'crash-reports', 'cache', 'session.lock']);

/**
 * Copia un servidor completo (mundos, mods, plugins, configuración) con otro nombre y puertos.
 * Sirve para probar mods o una versión nueva sin tocar el original.
 */
export async function cloneServer(id, { name }) {
  const src = getServer(id);
  if (!src) throw new HttpError(404, 'Servidor no encontrado');
  if (src.installState !== 'ready') throw new HttpError(409, 'Espera a que termine la instalación');
  const cleanName = String(name || `${src.name} (copia)`).trim().slice(0, 40);

  const inst = instance(id);
  const running = isRunning(id) && inst.status === 'running';
  if (running) {
    inst.send('save-off');
    inst.send('save-all flush');
    await inst.waitForLine(/Saved the game|Saved the world/i, 30_000);
  }

  const newId = crypto.randomUUID().slice(0, 8);
  const from = serverDir(id);
  const to = serverDir(newId);
  try {
    await fs.promises.cp(from, to, {
      recursive: true,
      filter: (p) => !SKIP.has(path.basename(p)) || path.dirname(p) !== from,
    });
  } finally {
    if (running && isRunning(id)) inst.send('save-on');
  }

  const port = nextFreePort();
  const clone = {
    ...structuredClone(src),
    id: newId,
    name: cleanName,
    port,
    autoStart: false,
    createdAt: new Date().toISOString(),
    clonedFrom: id,
    playit: { enabled: false },
    dns: undefined, // el dominio es del original; la copia se configura aparte
    map: src.map?.enabled ? { enabled: true, port: nextMapPort(newId) } : undefined, // newId: cuenta también el puerto del original
    lastAutoBackup: null,
    scheduleLog: [],
    protectionState: null,
    securityLog: [],
    // Las tareas se copian apagadas para que el clon no reinicie a la misma hora que el original.
    schedules: (src.schedules || []).map((t) => ({ ...t, id: crypto.randomUUID().slice(0, 8), enabled: false, lastRun: null, lastRunKey: null })),
  };
  if (src.bedrock?.enabled) clone.bedrock = { ...src.bedrock, port: nextBedrockPort(newId), xboxGamertag: null };

  // La sesión de Xbox de MCXboxBroadcast no debe compartirse entre dos servidores.
  const geyserDir = GEYSER_CONFIG_PATHS[src.type];
  if (geyserDir) {
    const ext = path.join(to, path.dirname(geyserDir), 'extensions');
    fs.rmSync(path.join(ext, 'MCXboxBroadcastExtension.jar'), { force: true });
    fs.rmSync(path.join(ext, 'mcxboxbroadcast'), { recursive: true, force: true });
  }

  db.data.servers.push(clone);
  db.flush();
  writeProperties(newId, { 'server-port': port, 'query.port': port });
  return clone;
}
