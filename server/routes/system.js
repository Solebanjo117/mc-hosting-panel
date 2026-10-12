import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { DOCS_DIR, VERSION } from '../config.js';
import { db } from '../db.js';
import { HttpError } from '../lib/util.js';
import { listVersions, SERVER_TYPES } from '../services/versions.js';
import { installedJavas, ensureJava } from '../services/java.js';
import { localIps, publicIp } from '../services/network.js';
import { systemInfo } from '../services/procstats.js';

export const systemRouter = express.Router();

systemRouter.get('/info', (_req, res) => {
  res.json({ version: VERSION, system: systemInfo(), types: SERVER_TYPES });
});

systemRouter.get('/versions/:type', async (req, res) => {
  res.json(await listVersions(req.params.type));
});

systemRouter.get('/network', async (_req, res) => {
  res.json({ localIps: localIps(), publicIp: await publicIp(), panelPort: db.data.settings.panelPort });
});

systemRouter.get('/java', (_req, res) => {
  res.json({ installed: installedJavas(), custom: db.data.settings.javaPaths || {} });
});

systemRouter.post('/java/:major', async (req, res) => {
  const major = Number(req.params.major);
  if (![8, 11, 17, 21, 25].includes(major)) throw new HttpError(400, 'Versión de Java no soportada');
  res.json({ path: await ensureJava(major) });
});

systemRouter.put('/settings', (req, res) => {
  const { panelPort, javaPaths } = req.body || {};
  if (panelPort !== undefined) {
    const p = Number(panelPort);
    if (!Number.isInteger(p) || p < 1024 || p > 65535) throw new HttpError(400, 'Puerto inválido');
    db.data.settings.panelPort = p;
  }
  if (javaPaths !== undefined) {
    const clean = {};
    for (const [k, v] of Object.entries(javaPaths || {})) if (v) clean[k] = String(v);
    db.data.settings.javaPaths = clean;
  }
  db.flush();
  res.json({ settings: db.data.settings, restartRequired: panelPort !== undefined });
});

const DOCS = { puertos: 'ABRIR-PUERTOS.md' };
systemRouter.get('/docs/:name', (req, res) => {
  const file = DOCS[req.params.name];
  if (!file) throw new HttpError(404, 'Documento no encontrado');
  res.type('text/markdown').send(fs.readFileSync(path.join(DOCS_DIR, file), 'utf8'));
});
