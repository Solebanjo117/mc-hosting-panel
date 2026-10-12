import express from 'express';
import { getServer } from '../db.js';
import { HttpError } from '../lib/util.js';
import { listBackups, createBackup, deleteBackup, restoreBackup, backupPath } from '../services/backups.js';

export const backupsRouter = express.Router({ mergeParams: true });

function id(req) {
  if (!getServer(req.params.id)) throw new HttpError(404, 'Servidor no encontrado');
  return req.params.id;
}

backupsRouter.get('/', (req, res) => {
  const server = getServer(id(req));
  res.json({ backups: listBackups(server.id), schedule: server.backupSchedule, lastAutoBackup: server.lastAutoBackup || null });
});

backupsRouter.post('/', async (req, res) => {
  const mode = req.body?.mode === 'mundo' ? 'mundo' : 'completo';
  res.status(201).json(await createBackup(id(req), mode));
});

backupsRouter.get('/:file/download', (req, res) => {
  res.download(backupPath(id(req), req.params.file));
});

backupsRouter.post('/:file/restore', async (req, res) => {
  res.json({ restored: await restoreBackup(id(req), req.params.file) });
});

backupsRouter.delete('/:file', (req, res) => {
  deleteBackup(id(req), req.params.file);
  res.json({ ok: true });
});
