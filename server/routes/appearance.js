import express from 'express';
import fs from 'node:fs';
import fsPath from 'node:path';
import { getAppearance, imageFile, imageMime } from '../services/appearance.js';
import { publicStatus } from '../services/publicPage.js';
import { getServer } from '../db.js';
import { serverDir } from '../config.js';
import { publicSettings } from '../services/publicPage.js';

/**
 * La foto del fondo se sirve sin sesión: la pantalla de acceso también la muestra.
 * Es solo un fondo de pantalla; nada más del panel sale por aquí.
 */
export const appearancePublic = express.Router();

appearancePublic.get('/', (_req, res) => res.json(getAppearance()));

/** Página pública de un servidor (si el administrador la activó). */
export const publicRouter = express.Router();
publicRouter.get('/:id', async (req, res) => res.json(await publicStatus(req.params.id)));
publicRouter.get('/:id/icon', (req, res) => {
  const server = getServer(req.params.id);
  if (!server || !publicSettings(server).enabled) return res.status(404).end();
  const file = fsPath.join(serverDir(server.id), 'server-icon.png');
  if (!fs.existsSync(file)) return res.status(404).end();
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.type('png').send(fs.readFileSync(file));
});

appearancePublic.get('/background', (_req, res) => {
  const f = imageFile();
  if (!f) return res.status(404).json({ error: 'No hay fondo personalizado' });
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.type(imageMime(f)).send(fs.readFileSync(f));
});
