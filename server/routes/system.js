import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { DOCS_DIR, VERSION } from '../config.js';
import { db } from '../db.js';
import { HttpError } from '../lib/util.js';
import { listVersions, SERVER_TYPES } from '../services/versions.js';
import { installedJavas, ensureJava } from '../services/java.js';
import { localIps, publicIp } from '../services/network.js';
import { systemInfo } from '../services/procstats.js';
import { healthCheck } from '../services/health.js';
import { getMetrics } from '../services/metrics.js';
import { checkUpdate, startUpdate, updateStatus } from '../services/appUpdate.js';
import { startupStatus, setStartup } from '../services/startup.js';
import { DEFAULT_COMMANDS, PARAM_TYPES, listCommands, saveCommands } from '../services/quickCommands.js';
import { getAppearance, setAppearance, saveImage, removeImage, MAX_IMAGE_BYTES } from '../services/appearance.js';
import * as backupMirror from '../services/backupMirror.js';

export const systemRouter = express.Router();

// --- Apariencia: tema, fondo, acento, letra y la foto de fondo -------------------------

const imageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } });

systemRouter.get('/appearance', (_req, res) => res.json(getAppearance()));
systemRouter.put('/appearance', (req, res) => res.json(setAppearance(req.body)));
systemRouter.put('/appearance/background', imageUpload.single('image'), (req, res) => res.json(saveImage(req.file?.buffer)));
systemRouter.delete('/appearance/background', (_req, res) => res.json(removeImage()));

// --- Tablero de inicio: salud y mini gráficas de cada servidor --------------------------

systemRouter.get('/dashboard', async (_req, res) => {
  const out = await Promise.all(
    db.data.servers.map(async (s) => {
      let health = null;
      try {
        const h = await healthCheck(s.id);
        health = { level: h.level, counts: h.counts, top: h.checks.filter((c) => c.level === 'bad' || c.level === 'warn').slice(0, 2) };
      } catch {
        /* sin revisión */
      }
      const m = getMetrics(s.id, '1h');
      const pick = (k) => m.points.map((p) => p[k]);
      return { id: s.id, health, spark: { players: pick('players'), mem: pick('mem'), cpu: pick('cpu'), tps: pick('tps'), memoryLimitMb: m.memoryLimitMb } };
    })
  );
  res.json({ servers: out });
});

// --- Copia de respaldos en una carpeta sincronizada (OneDrive, Google Drive, Dropbox…) -----

systemRouter.get('/backup-mirror', (_req, res) => res.json({ ...backupMirror.settings(), suggestions: backupMirror.suggestions() }));
systemRouter.put('/backup-mirror', (req, res) => res.json({ ...backupMirror.setSettings(req.body || {}), suggestions: backupMirror.suggestions() }));

// --- Comandos rápidos de la consola ------------------------------------------------

systemRouter.get('/quick-commands', (_req, res) => {
  res.json({ commands: listCommands(), defaults: DEFAULT_COMMANDS, types: PARAM_TYPES, custom: Boolean(db.data.settings.quickCommands) });
});
systemRouter.put('/quick-commands', (req, res) => {
  const commands = saveCommands(req.body?.reset ? null : req.body?.commands);
  res.json({ commands, defaults: DEFAULT_COMMANDS, types: PARAM_TYPES, custom: Boolean(db.data.settings.quickCommands) });
});

systemRouter.get('/info', (_req, res) => {
  res.json({ version: VERSION, system: systemInfo(), types: SERVER_TYPES });
});

systemRouter.get('/versions/:type', async (req, res) => {
  res.json(await listVersions(req.params.type));
});

systemRouter.get('/network', async (_req, res) => {
  res.json({ localIps: localIps(), publicIp: await publicIp(), panelPort: db.data.settings.panelPort, remoteAccess: db.data.settings.remoteAccess || 'lan' });
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
  const { panelPort, javaPaths, remoteAccess } = req.body || {};
  if (remoteAccess !== undefined) {
    if (!['local', 'lan', 'any'].includes(remoteAccess)) throw new HttpError(400, 'Opción inválida');
    db.data.settings.remoteAccess = remoteAccess;
  }
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
  // Solo lo que se puede cambiar aquí: los tokens de DNS o CurseForge nunca salen del panel.
  const { panelPort: port, javaPaths: paths, remoteAccess: access } = db.data.settings;
  res.json({ settings: { panelPort: port, javaPaths: paths || {}, remoteAccess: access || 'lan' }, restartRequired: panelPort !== undefined });
});

// --- Actualizar el panel e inicio con Windows -----------------------------------------

systemRouter.get('/update', (_req, res) => res.json(updateStatus()));
systemRouter.post('/update/check', async (_req, res) => res.json({ ...updateStatus(), lastCheck: await checkUpdate() }));
systemRouter.post('/update', (_req, res) => res.status(202).json(startUpdate()));

systemRouter.get('/startup', (_req, res) => res.json(startupStatus()));
systemRouter.put('/startup', async (req, res) => {
  if (typeof req.body?.enabled !== 'boolean') throw new HttpError(400, 'Falta "enabled"');
  res.json(await setStartup(req.body.enabled));
});

const DOCS = { puertos: 'ABRIR-PUERTOS.md' };
systemRouter.get('/docs/:name', (req, res) => {
  const file = DOCS[req.params.name];
  if (!file) throw new HttpError(404, 'Documento no encontrado');
  res.type('text/markdown').send(fs.readFileSync(path.join(DOCS_DIR, file), 'utf8'));
});
