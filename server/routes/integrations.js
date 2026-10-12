import express from 'express';
import fs from 'node:fs';
import multer from 'multer';
import { TMP_DIR } from '../config.js';
import { bus } from '../lib/bus.js';
import { HttpError } from '../lib/util.js';
import * as playit from '../services/playit.js';
import * as dns from '../services/dns.js';
import * as modpack from '../services/modpack.js';

/** playit.gg, DuckDNS y modpacks: funciones del panel que no son de un solo servidor. */
export const integrationsRouter = express.Router();
const upload = multer({ dest: TMP_DIR, limits: { fileSize: 2 * 1024 * 1024 * 1024 } });

// --- playit.gg -----------------------------------------------------------------

integrationsRouter.get('/playit', (_req, res) => res.json(playit.status()));
integrationsRouter.post('/playit/claim', (_req, res) => res.json(playit.startClaim()));
integrationsRouter.post('/playit/enabled', async (req, res) => res.json(await playit.setEnabled(Boolean(req.body?.enabled))));
integrationsRouter.post('/playit/reinstall', async (_req, res) => res.json(await playit.installAgent()));
integrationsRouter.post('/playit/unlink', async (_req, res) => res.json(await playit.unlink()));
integrationsRouter.get('/playit/tunnels', async (_req, res) => res.json(await playit.agentTunnels()));

// --- Dominio (DuckDNS, deSEC o Cloudflare) --------------------------------------

integrationsRouter.get('/dns', (_req, res) => res.json(dns.publicStatus()));
integrationsRouter.put('/dns', async (req, res) => res.json(await dns.saveSettings(req.body || {})));
integrationsRouter.post('/dns/unlink', async (_req, res) => res.json(await dns.unlink()));

// --- Modpacks ------------------------------------------------------------------

integrationsRouter.get('/modpacks/search', async (req, res) => res.json(await modpack.searchModpacks(req.query)));
integrationsRouter.get('/modpacks/:projectId/versions', async (req, res) => res.json(await modpack.modpackVersions(req.params.projectId)));

/** Revisa un .mrpack subido y devuelve qué servidor se va a crear. */
integrationsRouter.post('/modpacks/inspect', upload.single('file'), (req, res) => {
  if (!req.file) throw new HttpError(400, 'Falta el archivo .mrpack');
  try {
    res.json(modpack.inspect(req.file.path));
  } finally {
    fs.rmSync(req.file.path, { force: true });
  }
});

integrationsRouter.post('/modpacks/import', upload.single('file'), async (req, res) => {
  const body = req.body || {};
  const opts = {
    name: body.name,
    memoryMb: Number(body.memoryMb) || 6144,
    port: body.port ? Number(body.port) : undefined,
    eula: body.eula === true || body.eula === 'true',
  };
  let packPath;
  let source = null;
  if (req.file) {
    packPath = `${req.file.path}.mrpack`;
    fs.renameSync(req.file.path, packPath);
  } else if (body.projectId) {
    const dl = await modpack.downloadFromModrinth(body.projectId, body.versionId);
    packPath = dl.path;
    source = { projectId: body.projectId, versionId: dl.version.id };
  } else {
    throw new HttpError(400, 'Sube un .mrpack o elige un modpack de Modrinth');
  }
  try {
    const server = await modpack.createFromPack(packPath, { ...opts, source });
    bus.emit('servers');
    res.status(201).json({ id: server.id, name: server.name });
  } catch (err) {
    fs.rmSync(packPath, { force: true });
    throw err;
  }
});
