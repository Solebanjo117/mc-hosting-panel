import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { serverDir, backupDir, DATA_DIR } from '../config.js';
import { db, getServer, updateServer } from '../db.js';
import { bus } from '../lib/bus.js';
import { HttpError, dirSize } from '../lib/util.js';
import { startInstall, isInstalling } from '../services/installer.js';
import { instance, isRunning, removeInstance } from '../services/processManager.js';
import { readProperties, writeProperties } from '../services/properties.js';
import { getPlayers, playerAction } from '../services/players.js';
import { externalCheck, publicIp } from '../services/network.js';
import * as bedrock from '../services/bedrock.js';
import * as playit from '../services/playit.js';
import * as dns from '../services/dns.js';
import { removePack } from '../services/modpack.js';
import { gameList } from '../services/gameData.js';
import * as worldMap from '../services/worldMap.js';
import { healthCheck } from '../services/health.js';
import { activity, playerStats, removeActivity } from '../services/activity.js';
import * as optimize from '../services/optimize.js';
import { createServerRecord, validatePort } from '../services/serverFactory.js';
import { cloneServer } from '../services/clone.js';
import { removeMetrics } from '../services/metrics.js';

export const serversRouter = express.Router();

function view(server) {
  const inst = instance(server.id);
  return {
    ...server,
    content: undefined,
    installing: isInstalling(server.id),
    runtime: inst.snapshot(),
  };
}

function load(req) {
  const server = getServer(req.params.id);
  if (!server) throw new HttpError(404, 'Servidor no encontrado');
  return server;
}

serversRouter.get('/', (_req, res) => {
  res.json(db.data.servers.map(view));
});

serversRouter.post('/', async (req, res) => {
  const { name, type, mcVersion, loaderVersion, memoryMb, port, eula } = req.body || {};
  const server = await createServerRecord({ name, type, mcVersion, loaderVersion, memoryMb, port, eula });
  startInstall(server.id);
  res.status(201).json(view(server));
});

serversRouter.post('/:id/clone', async (req, res) => {
  const clone = await cloneServer(load(req).id, req.body || {});
  bus.emit('servers');
  res.status(201).json(view(clone));
});

serversRouter.get('/:id', (req, res) => res.json(view(load(req))));

serversRouter.patch('/:id', async (req, res) => {
  const server = load(req);
  const body = req.body || {};
  const patch = {};
  if (body.name !== undefined) patch.name = String(body.name).trim().slice(0, 40) || server.name;
  if (body.memoryMb !== undefined) patch.memoryMb = Math.max(512, Number(body.memoryMb) || server.memoryMb);
  if (body.jvmArgs !== undefined) patch.jvmArgs = String(body.jvmArgs).slice(0, 1000);
  if (body.javaPath !== undefined) patch.javaPath = body.javaPath ? String(body.javaPath) : null;
  if (body.autoStart !== undefined) patch.autoStart = Boolean(body.autoStart);
  if (body.autoRestart !== undefined) patch.autoRestart = Boolean(body.autoRestart);
  if (body.backupSchedule !== undefined) {
    const b = body.backupSchedule;
    patch.backupSchedule = {
      enabled: Boolean(b.enabled),
      intervalHours: Math.max(1, Number(b.intervalHours) || 24),
      keep: Math.max(1, Number(b.keep) || 7),
      mode: b.mode === 'completo' ? 'completo' : 'mundo',
    };
  }
  if (body.port !== undefined && Number(body.port) !== Number(server.port)) {
    if (isRunning(server.id)) throw new HttpError(409, 'Apaga el servidor para cambiar el puerto');
    patch.port = await validatePort(body.port, server.id);
    writeProperties(server.id, { 'server-port': patch.port, 'query.port': patch.port });
  }
  updateServer(server.id, patch);
  if (patch.port) {
    playit.syncServer(server.id);
    dns.scheduleSync();
  }
  bus.emit('servers');
  res.json(view(server));
});

serversRouter.delete('/:id', async (req, res) => {
  const server = load(req);
  if (isRunning(server.id)) throw new HttpError(409, 'Apaga el servidor antes de eliminarlo');
  if (isInstalling(server.id)) throw new HttpError(409, 'Espera a que termine la instalación');
  await dns.forgetServer(server.id);
  if (server.playit?.enabled) await playit.disableForServer(server.id).catch(() => {});
  fs.rmSync(serverDir(server.id), { recursive: true, force: true });
  removePack(server.id);
  removeMetrics(server.id);
  removeActivity(server.id);
  if (req.query.keepBackups !== 'true') fs.rmSync(backupDir(server.id), { recursive: true, force: true });
  db.data.servers = db.data.servers.filter((s) => s.id !== server.id);
  db.flush();
  removeInstance(server.id);
  bus.emit('servers');
  res.json({ ok: true });
});

// --- Encendido / apagado -----------------------------------------------------

for (const action of ['start', 'stop', 'restart', 'kill']) {
  serversRouter.post(`/:id/${action}`, async (req, res) => {
    const server = load(req);
    const inst = instance(server.id);
    if (action === 'start') await inst.start();
    else if (action === 'kill') inst.kill();
    else inst[action]().catch((err) => inst.panelLine(`Error: ${err.message}`)); // stop/restart responden al instante
    res.json(inst.snapshot());
  });
}

serversRouter.post('/:id/command', (req, res) => {
  const server = load(req);
  instance(server.id).send(req.body?.command || '');
  res.json({ ok: true });
});

serversRouter.get('/:id/console', (req, res) => {
  res.json({ lines: instance(load(req).id).lines });
});

/** Reinstala o cambia de versión conservando mundos y configuración. */
serversRouter.post('/:id/reinstall', (req, res) => {
  const server = load(req);
  if (isRunning(server.id)) throw new HttpError(409, 'Apaga el servidor antes de reinstalar');
  const { mcVersion, loaderVersion } = req.body || {};
  updateServer(server.id, {
    mcVersion: mcVersion || server.mcVersion,
    loaderVersion: loaderVersion !== undefined ? loaderVersion : server.loaderVersion,
    javaMajor: null,
  });
  startInstall(server.id);
  res.json(view(server));
});

serversRouter.get('/:id/disk', async (req, res) => {
  const server = load(req);
  res.json({ server: await dirSize(serverDir(server.id)), backups: await dirSize(backupDir(server.id)) });
});

// --- server.properties -------------------------------------------------------

serversRouter.get('/:id/properties', (req, res) => {
  res.json(readProperties(load(req).id));
});

serversRouter.put('/:id/properties', async (req, res) => {
  const server = load(req);
  const values = { ...(req.body || {}) };
  if (values['server-port'] !== undefined && Number(values['server-port']) !== Number(server.port)) {
    if (isRunning(server.id)) throw new HttpError(409, 'Apaga el servidor para cambiar el puerto');
    const port = await validatePort(values['server-port'], server.id);
    updateServer(server.id, { port });
    values['query.port'] = port;
    playit.syncServer(server.id);
    dns.scheduleSync();
  }
  res.json({ properties: writeProperties(server.id, values), restartRequired: isRunning(server.id) });
});

// --- Jugadores ---------------------------------------------------------------

serversRouter.get('/:id/players', (req, res) => {
  res.json(getPlayers(load(req).id));
});

serversRouter.post('/:id/players', async (req, res) => {
  const { action, name, reason } = req.body || {};
  res.json(await playerAction(load(req).id, action, name, reason));
});

// --- Red ---------------------------------------------------------------------

serversRouter.get('/:id/network/check', async (req, res) => {
  const server = load(req);
  const input = String(req.query.host || '').trim();
  const [host, explicitPort] = (input || (await publicIp()) || '').split(':');
  if (!host) throw new HttpError(502, 'No se pudo obtener tu IP pública');
  if (!/^[A-Za-z0-9.-]+$/.test(host)) throw new HttpError(400, 'Dirección inválida');
  if (explicitPort && !/^\d{1,5}$/.test(explicitPort)) throw new HttpError(400, 'Puerto inválido');
  // Un dominio sin puerto se prueba tal cual para respetar registros SRV.
  const bedrock = req.query.edition === 'bedrock';
  if (bedrock && !server.bedrock?.enabled) throw new HttpError(409, 'Activa Bedrock en este servidor primero');
  const ownPort = bedrock ? server.bedrock.port : server.port;
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  // Bedrock no usa registros SRV: sin puerto explícito se prueba el del servidor.
  const port = explicitPort ? Number(explicitPort) : isIp || bedrock ? ownPort : null;
  const result = await externalCheck(host, port, bedrock ? 'bedrock' : 'java');
  res.json({ host, edition: bedrock ? 'bedrock' : 'java', running: isRunning(server.id), ...result, port: result.port || port || ownPort });
});

// --- Bedrock (Geyser) ---------------------------------------------------------

serversRouter.get('/:id/bedrock', async (req, res) => {
  res.json(await bedrock.status(load(req).id));
});

serversRouter.post('/:id/bedrock/enable', async (req, res) => {
  const server = load(req);
  const result = await bedrock.enable(server.id, req.body || {});
  playit.syncServer(server.id);
  dns.scheduleSync();
  bus.emit('servers');
  res.json({ ...result, restartRequired: isRunning(server.id) });
});

serversRouter.post('/:id/bedrock/update', async (req, res) => {
  const server = load(req);
  const result = await bedrock.update(server.id);
  res.json({ ...result, restartRequired: isRunning(server.id) });
});

serversRouter.post('/:id/bedrock/disable', (req, res) => {
  const server = load(req);
  bedrock.disable(server.id);
  playit.syncServer(server.id);
  dns.scheduleSync();
  bus.emit('servers');
  res.json({ ok: true, restartRequired: isRunning(server.id) });
});

serversRouter.post('/:id/bedrock/broadcast', async (req, res) => {
  const server = load(req);
  const result = req.body?.enabled
    ? await bedrock.enableBroadcast(server.id)
    : bedrock.disableBroadcast(server.id, { forgetAccount: Boolean(req.body?.forgetAccount) });
  res.json({ broadcast: result, restartRequired: isRunning(server.id) });
});

// --- playit.gg por servidor -----------------------------------------------------

serversRouter.get('/:id/playit', async (req, res) => {
  res.json(await playit.serverTunnels(load(req).id));
});

serversRouter.post('/:id/playit', async (req, res) => {
  const server = load(req);
  if (req.body?.enabled === false) {
    await playit.disableForServer(server.id);
    bus.emit('servers');
    return res.json(await playit.serverTunnels(server.id));
  }
  const result = await playit.enableForServer(server.id);
  bus.emit('servers');
  res.json(result);
});

// --- Optimización de un clic ---------------------------------------------------------

serversRouter.get('/:id/optimize', (req, res) => res.json(optimize.status(load(req).id)));
serversRouter.post('/:id/optimize', async (req, res) => {
  const server = load(req);
  const result = req.body?.undo ? optimize.undo(server.id) : await optimize.apply(server.id, Array.isArray(req.body?.only) ? req.body.only : null);
  bus.emit('servers');
  res.json({ ...result, restartRequired: isRunning(server.id) });
});

// --- Actividad y estadísticas de jugadores --------------------------------------------

serversRouter.get('/:id/activity', (req, res) => {
  res.json(activity(load(req).id, { limit: Number(req.query.limit) || 100, before: req.query.before || null, filter: String(req.query.filter || 'all') }));
});
serversRouter.get('/:id/stats', (req, res) => res.json(playerStats(load(req).id)));

// --- Revisión general, ícono del servidor -----------------------------------------------

serversRouter.get('/:id/health', async (req, res) => res.json(await healthCheck(load(req).id)));

serversRouter.get('/:id/icon', (req, res) => {
  const file = path.join(serverDir(load(req).id), 'server-icon.png');
  if (!fs.existsSync(file)) throw new HttpError(404, 'Sin ícono');
  res.setHeader('Cache-Control', 'no-cache');
  res.type('png').send(fs.readFileSync(file));
});

/** Recibe el ícono ya recortado a 64×64 en el navegador (PNG en base64). */
serversRouter.put('/:id/icon', (req, res) => {
  const server = load(req);
  const file = path.join(serverDir(server.id), 'server-icon.png');
  if (req.body?.remove) {
    fs.rmSync(file, { force: true });
    bus.emit('servers');
    return res.json({ ok: true, restartRequired: isRunning(server.id) });
  }
  const buf = Buffer.from(String(req.body?.png || '').replace(/^data:image\/png;base64,/, ''), 'base64');
  const isPng = buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.toString('ascii', 12, 16) === 'IHDR';
  if (!isPng) throw new HttpError(400, 'El ícono debe ser una imagen PNG');
  if (buf.readUInt32BE(16) !== 64 || buf.readUInt32BE(20) !== 64) throw new HttpError(400, 'El ícono debe medir 64×64 píxeles');
  if (buf.length > 256 * 1024) throw new HttpError(400, 'El ícono es demasiado grande');
  fs.writeFileSync(file, buf);
  updateServer(server.id, { iconAt: Date.now() });
  bus.emit('servers');
  res.json({ ok: true, restartRequired: isRunning(server.id) });
});

// --- Mapa del mundo (BlueMap) -------------------------------------------------------

serversRouter.get('/:id/map', (req, res) => res.json(worldMap.status(load(req).id)));
serversRouter.post('/:id/map', async (req, res) => {
  const server = load(req);
  const result = req.body?.enabled === false ? worldMap.disable(server.id) : await worldMap.enable(server.id);
  bus.emit('servers');
  res.json({ ...result, restartRequired: isRunning(server.id) });
});
serversRouter.put('/:id/map/settings', (req, res) => res.json(worldMap.setSettings(load(req).id, req.body || {})));
serversRouter.post('/:id/map/redraw', async (req, res) => res.json(await worldMap.redraw(load(req).id)));
serversRouter.use('/:id/map/view', (req, res) => worldMap.proxy(req, res));

// --- Listas del juego para los comandos rápidos (objetos, efectos…) ---------------

serversRouter.get('/:id/gamedata/:kind', async (req, res) => {
  const server = load(req);
  res.json({ version: server.mcVersion, list: await gameList(server.mcVersion, req.params.kind) });
});

// --- Dominio del servidor ---------------------------------------------------------

serversRouter.get('/:id/dns', (req, res) => res.json(dns.serverStatus(load(req).id)));
serversRouter.put('/:id/dns', async (req, res) => {
  const result = await dns.configureServer(load(req).id, req.body || {});
  res.json(result);
});
serversRouter.post('/:id/dns/update', async (req, res) => {
  const server = load(req);
  await dns.syncServer(server.id, { force: true });
  res.json(dns.serverStatus(server.id));
});

/** Usa túneles que el usuario creó a mano en playit.gg. */
serversRouter.post('/:id/playit/link', async (req, res) => {
  const server = load(req);
  const result = await playit.linkTunnels(server.id, { java: req.body?.java || null, bedrock: req.body?.bedrock || null });
  bus.emit('servers');
  res.json(result);
});
