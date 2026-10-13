import express from 'express';
import { getServer } from '../db.js';
import { HttpError } from '../lib/util.js';
import * as market from '../services/marketplace.js';
import { instance, isRunning } from '../services/processManager.js';

export const contentRouter = express.Router({ mergeParams: true });

/** ?kind=datapack (o en el cuerpo) trabaja con los datapacks del mundo en vez de mods/plugins. */
const kindOf = (req) => ((req.query.kind || req.body?.kind) === 'datapack' ? 'datapack' : null);

function id(req) {
  if (!getServer(req.params.id)) throw new HttpError(404, 'Servidor no encontrado');
  return req.params.id;
}

contentRouter.get('/search', async (req, res) => {
  res.json(await market.search(id(req), { ...req.query, kind: kindOf(req) }));
});

contentRouter.get('/project', async (req, res) => {
  res.json(await market.projectDetails(String(req.query.source || 'modrinth'), String(req.query.projectId || '')));
});

contentRouter.get('/versions', async (req, res) => {
  const { source = 'modrinth', projectId } = req.query;
  if (!projectId) throw new HttpError(400, 'Falta projectId');
  res.json(await market.projectVersions(id(req), source, projectId, kindOf(req)));
});

contentRouter.post('/install', async (req, res) => {
  const body = req.body || {};
  if (!body.projectId) throw new HttpError(400, 'Falta projectId');
  res.json({ installed: await market.install(id(req), { ...body, kind: kindOf(req) }) });
});

contentRouter.get('/installed', (req, res) => {
  res.json(market.listInstalled(id(req), kindOf(req)));
});

contentRouter.post('/toggle', (req, res) => {
  market.toggle(id(req), req.body?.filename, Boolean(req.body?.enabled), kindOf(req));
  res.json(market.listInstalled(req.params.id, kindOf(req)));
});

contentRouter.post('/uninstall', (req, res) => {
  market.uninstall(id(req), req.body?.filename, kindOf(req));
  res.json(market.listInstalled(req.params.id, kindOf(req)));
});

contentRouter.get('/updates', async (req, res) => {
  res.json(await market.checkUpdates(id(req), kindOf(req)));
});

contentRouter.post('/update', async (req, res) => {
  res.json({ installed: await market.applyUpdate(id(req), { ...(req.body || {}), kind: kindOf(req) }) });
});

/**
 * Aplica los cambios de datapacks sin reiniciar. Se usa minecraft:reload porque en Paper "/reload"
 * recarga los plugins (y eso puede romperlos).
 */
contentRouter.post('/reload', async (req, res) => {
  const serverId = id(req);
  if (!isRunning(serverId)) throw new HttpError(409, 'El servidor está apagado: los cambios se aplican solos al encenderlo');
  const inst = instance(serverId);
  if (inst.status !== 'running') throw new HttpError(409, 'Espera a que el servidor termine de encender');
  const done = inst.waitForLine(/Reloading!|Reload (?:failed|complete)|Failed to (?:load|reload) data ?packs/i, 20_000);
  inst.send('minecraft:reload');
  const ok = await done;
  const worldgen = market.listInstalled(serverId, 'datapack').items.filter((i) => i.enabled && i.worldgen).map((i) => i.title);
  res.json({ ok, worldgen });
});
