import express from 'express';
import fs from 'node:fs';
import { getAppearance, imageFile, imageMime } from '../services/appearance.js';

/**
 * La foto del fondo se sirve sin sesión: la pantalla de acceso también la muestra.
 * Es solo un fondo de pantalla; nada más del panel sale por aquí.
 */
export const appearancePublic = express.Router();

appearancePublic.get('/', (_req, res) => res.json(getAppearance()));

appearancePublic.get('/background', (_req, res) => {
  const f = imageFile();
  if (!f) return res.status(404).json({ error: 'No hay fondo personalizado' });
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.type(imageMime(f)).send(fs.readFileSync(f));
});
