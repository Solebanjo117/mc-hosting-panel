import express from 'express';
import { getServer } from '../db.js';
import { HttpError } from '../lib/util.js';
import * as market from '../services/marketplace.js';

export const contentRouter = express.Router({ mergeParams: true });

function id(req) {
  if (!getServer(req.params.id)) throw new HttpError(404, 'Servidor no encontrado');
  return req.params.id;
}

contentRouter.get('/search', async (req, res) => {
  res.json(await market.search(id(req), req.query));
});

contentRouter.get('/versions', async (req, res) => {
  const { source = 'modrinth', projectId } = req.query;
  if (!projectId) throw new HttpError(400, 'Falta projectId');
  res.json(await market.projectVersions(id(req), source, projectId));
});

contentRouter.post('/install', async (req, res) => {
  const body = req.body || {};
  if (!body.projectId) throw new HttpError(400, 'Falta projectId');
  res.json({ installed: await market.install(id(req), body) });
});

contentRouter.get('/installed', (req, res) => {
  res.json(market.listInstalled(id(req)));
});

contentRouter.post('/toggle', (req, res) => {
  market.toggle(id(req), req.body?.filename, Boolean(req.body?.enabled));
  res.json(market.listInstalled(req.params.id));
});

contentRouter.post('/uninstall', (req, res) => {
  market.uninstall(id(req), req.body?.filename);
  res.json(market.listInstalled(req.params.id));
});

contentRouter.get('/updates', async (req, res) => {
  res.json(await market.checkUpdates(id(req)));
});

contentRouter.post('/update', async (req, res) => {
  res.json({ installed: await market.applyUpdate(id(req), req.body || {}) });
});
