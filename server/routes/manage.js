import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import archiver from 'archiver';
import { TMP_DIR, serverDir } from '../config.js';
import { getServer } from '../db.js';
import { HttpError } from '../lib/util.js';
import * as worlds from '../services/worlds.js';
import * as logs from '../services/logs.js';
import * as scheduler from '../services/scheduler.js';
import { getMetrics } from '../services/metrics.js';

/** Mundos, logs, tareas programadas y rendimiento de un servidor. */
export const manageRouter = express.Router({ mergeParams: true });
const upload = multer({ dest: TMP_DIR, limits: { fileSize: 8 * 1024 * 1024 * 1024 } });

manageRouter.use((req, _res, next) => {
  if (!getServer(req.params.id)) return next(new HttpError(404, 'Servidor no encontrado'));
  next();
});

// --- Mundos ------------------------------------------------------------------

manageRouter.get('/worlds', async (req, res) => res.json(await worlds.listWorlds(req.params.id)));

manageRouter.post('/worlds/switch', async (req, res) => {
  worlds.switchWorld(req.params.id, req.body?.name);
  res.json(await worlds.listWorlds(req.params.id));
});

manageRouter.post('/worlds', async (req, res) => {
  worlds.createWorld(req.params.id, req.body || {});
  res.json(await worlds.listWorlds(req.params.id));
});

manageRouter.post('/worlds/import', upload.single('file'), async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Falta el archivo .zip');
  try {
    const name = worlds.importWorld(req.params.id, req.file.path, req.body?.name);
    if (req.body?.activate === 'true') worlds.switchWorld(req.params.id, name);
    res.json({ imported: name, ...(await worlds.listWorlds(req.params.id)) });
  } finally {
    fs.rmSync(req.file.path, { force: true });
  }
});

manageRouter.get('/worlds/:name/download', (req, res) => {
  const parts = worlds.worldFolders(req.params.id, req.params.name);
  res.attachment(`${req.params.name}.zip`);
  const zip = archiver('zip', { zlib: { level: 5 } });
  zip.on('error', (err) => res.destroy(err));
  zip.pipe(res);
  for (const p of parts) zip.directory(p.path, p.name);
  zip.finalize();
});

manageRouter.delete('/worlds/:name', async (req, res) => {
  worlds.deleteWorld(req.params.id, req.params.name);
  res.json(await worlds.listWorlds(req.params.id));
});

// --- Logs ----------------------------------------------------------------------

manageRouter.get('/logs', (req, res) => res.json(logs.listLogs(req.params.id)));
manageRouter.get('/logs/search', (req, res) => res.json(logs.searchAll(req.params.id, String(req.query.q || ''))));
manageRouter.get('/logs/diagnose', (req, res) => res.json({ findings: logs.diagnoseLatest(req.params.id) }));
manageRouter.get('/logs/file/:file', (req, res) => res.json(logs.readLog(req.params.id, 'logs', req.params.file, String(req.query.q || ''))));
manageRouter.get('/logs/crash/:file', (req, res) => res.json(logs.readCrash(req.params.id, req.params.file)));
manageRouter.get('/logs/raw/:kind/:file', (req, res) => {
  const folder = req.params.kind === 'crash' ? 'crash-reports' : 'logs';
  const file = path.join(serverDir(req.params.id), folder, path.basename(req.params.file));
  if (!fs.existsSync(file)) throw new HttpError(404, 'Archivo no encontrado');
  res.download(file);
});

// --- Tareas programadas --------------------------------------------------------

manageRouter.get('/schedules', (req, res) => res.json(scheduler.listTasks(req.params.id)));
manageRouter.post('/schedules', (req, res) => res.json(scheduler.saveTask(req.params.id, req.body || {})));
manageRouter.put('/schedules/:taskId', (req, res) => res.json(scheduler.saveTask(req.params.id, req.body || {}, req.params.taskId)));
manageRouter.delete('/schedules/:taskId', (req, res) => res.json(scheduler.deleteTask(req.params.id, req.params.taskId)));
manageRouter.post('/schedules/:taskId/run', async (req, res) => {
  const task = (getServer(req.params.id).schedules || []).find((t) => t.id === req.params.taskId);
  if (!task) throw new HttpError(404, 'Tarea no encontrada');
  // Se ejecuta en segundo plano (un reinicio con avisos puede tardar minutos).
  scheduler.runTask(req.params.id, task).then((result) => {
    const s = getServer(req.params.id);
    if (!s) return;
    s.scheduleLog = [{ at: new Date().toISOString(), taskId: task.id, action: task.action, result: `${result} (manual)` }, ...(s.scheduleLog || [])].slice(0, 30);
  });
  res.json({ ok: true });
});

// --- Rendimiento ---------------------------------------------------------------

manageRouter.get('/metrics', (req, res) => res.json(getMetrics(req.params.id, String(req.query.range || '6h'))));
