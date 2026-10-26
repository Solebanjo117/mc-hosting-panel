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
import * as modpack from '../services/modpack.js';
import * as pregen from '../services/pregen.js';
import { softwareStatus, startSoftwareUpdate, undoSoftwareUpdate, softwareJob } from '../services/softwareUpdate.js';
import { bus } from '../lib/bus.js';
import { getMetrics } from '../services/metrics.js';
import { audit, applyFix, defaultProtection } from '../services/security.js';
import { protectionStatus, endLockdown } from '../services/floodGuard.js';
import { instance } from '../services/processManager.js';
import { db } from '../db.js';
import { getPower, setPower } from '../services/power.js';
import * as maintenance from '../services/maintenance.js';
import { record } from '../services/activity.js';

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
  const created = worlds.createWorld(req.params.id, req.body || {});
  res.json({ ...(await worlds.listWorlds(req.params.id)), ...created });
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

// --- Modpack: versión instalada, actualizar y archivo para los jugadores -----------

manageRouter.get('/modpack', async (req, res) => res.json(await modpack.modpackStatus(req.params.id)));

/** Con { versionId } descarga esa versión; con un archivo subido, usa ese. */
manageRouter.post('/modpack/update', upload.single('file'), async (req, res) => {
  let uploadedPath;
  if (req.file) {
    uploadedPath = `${req.file.path}.pack`;
    fs.renameSync(req.file.path, uploadedPath);
  }
  const result = await modpack.updateModpack(req.params.id, { versionId: req.body?.versionId, uploadedPath });
  bus.emit('servers');
  res.json(result);
});

manageRouter.get('/modpack/players', async (req, res) => {
  const pack = await modpack.playersPack(req.params.id);
  res.setHeader('X-Pack-Summary', encodeURIComponent(JSON.stringify({ address: pack.address, ...pack.summary })));
  res.attachment(pack.filename);
  res.type(pack.format === 'curseforge' ? 'application/zip' : 'application/x-modrinth-modpack+zip');
  res.send(pack.buffer);
});

// --- Logs ----------------------------------------------------------------------

// --- Pregenerar el mundo (Chunky) ----------------------------------------------------
manageRouter.get('/pregen', (req, res) => res.json(pregen.status(req.params.id)));
manageRouter.get('/pregen/estimate', (req, res) =>
  res.json(pregen.estimate(Math.min(Number(req.query.radius) || 0, pregen.MAX_RADIUS), String(req.query.shape || 'square'), String(req.query.dimension || 'overworld')))
);
manageRouter.post('/pregen/install', async (req, res) => res.json(await pregen.install(req.params.id)));
manageRouter.post('/pregen/start', async (req, res) => res.json(await pregen.start(req.params.id, req.body || {})));
manageRouter.post('/pregen/:action', async (req, res) => res.json(await pregen.control(req.params.id, req.params.action)));
manageRouter.delete('/pregen', (req, res) => res.json(pregen.clear(req.params.id)));

// --- Actualizar Paper/Fabric/Forge/NeoForge/Minecraft con respaldo -----------------------
manageRouter.get('/software', async (req, res) => res.json(await softwareStatus(req.params.id)));
manageRouter.get('/software/job', (req, res) => res.json({ job: softwareJob(req.params.id) }));
manageRouter.post('/software/update', async (req, res) => {
  const { target, mcVersion, updateContent } = req.body || {};
  res.status(202).json({ job: await startSoftwareUpdate(req.params.id, { target, mcVersion, updateContent: updateContent !== false }) });
});
manageRouter.post('/software/undo', async (req, res) => res.status(202).json({ job: await undoSoftwareUpdate(req.params.id) }));

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

// --- Horario de energía, mantenimiento y simulacro ------------------------------------

manageRouter.get('/power', (req, res) => res.json(getPower(req.params.id)));
manageRouter.put('/power', (req, res) => res.json(setPower(req.params.id, req.body || {})));

manageRouter.get('/maintenance', (req, res) => res.json(maintenance.status(req.params.id)));
manageRouter.post('/maintenance', async (req, res) => {
  const r = await maintenance.enter(req.params.id, req.body || {});
  bus.emit('servers');
  res.json(r);
});
manageRouter.delete('/maintenance', async (req, res) => {
  const r = await maintenance.exit(req.params.id, req.body || {});
  bus.emit('servers');
  res.json(r);
});

manageRouter.post('/drill', (req, res) => {
  const server = getServer(req.params.id);
  const drill = instance(server.id).drillCrash();
  record(server.id, 'drill', { detail: 'simulacro de caída' });
  res.json({ ...drill, autoRestart: Boolean(server.autoRestart) });
});

// --- Rendimiento ---------------------------------------------------------------

manageRouter.get('/metrics', (req, res) => res.json(getMetrics(req.params.id, String(req.query.range || '6h'))));

// --- Seguridad -----------------------------------------------------------------

function securityView(id) {
  const server = getServer(id);
  return { ...audit(id), protection: { ...protectionStatus(server), settings: { ...defaultProtection(), ...(server.protection || {}) } } };
}

manageRouter.get('/security', (req, res) => res.json(securityView(req.params.id)));

manageRouter.post('/security/fix', (req, res) => {
  const restartRequired = applyFix(req.params.id, String(req.body?.fix || ''));
  res.json({ ...securityView(req.params.id), restartRequired });
});

manageRouter.put('/security/protection', (req, res) => {
  const server = getServer(req.params.id);
  const b = req.body || {};
  const clamp = (v, min, max, def) => Math.min(max, Math.max(min, Math.round(Number(v)) || def));
  const d = defaultProtection();
  server.protection = {
    enabled: Boolean(b.enabled),
    perIpPerMinute: clamp(b.perIpPerMinute, 3, 100, d.perIpPerMinute),
    globalPerMinute: clamp(b.globalPerMinute, 5, 500, d.globalPerMinute),
    banMinutes: clamp(b.banMinutes, 1, 24 * 60, d.banMinutes),
    lockdownMinutes: clamp(b.lockdownMinutes, 1, 24 * 60, d.lockdownMinutes),
  };
  db.flush();
  res.json(securityView(req.params.id));
});

manageRouter.post('/security/end-lockdown', (req, res) => {
  endLockdown(req.params.id, (id) => instance(id));
  res.json(securityView(req.params.id));
});
