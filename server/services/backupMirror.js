import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { db, getServer } from '../db.js';
import { HttpError, sanitizeFileName } from '../lib/util.js';

/**
 * Copia de los respaldos en la nube, sin claves ni OAuth: se copian a una carpeta que un programa
 * de sincronización ya sube solo (OneDrive, Google Drive, Dropbox, iCloud…). El panel detecta esas
 * carpetas en Windows y avisa en la Revisión si la copia se queda atrás.
 */

export function settings() {
  const m = db.data.settings.backupMirror || {};
  return { path: m.path || '', lastError: m.lastError || null, lastCopy: m.lastCopy || null };
}

export function suggestions() {
  const home = process.env.USERPROFILE || os.homedir();
  const candidates = [
    process.env.OneDrive,
    process.env.OneDriveConsumer,
    path.join(home, 'OneDrive'),
    path.join(home, 'Google Drive'),
    path.join(home, 'Mi unidad'),
    path.join(home, 'Dropbox'),
    path.join(home, 'iCloudDrive'),
    path.join(home, 'Nextcloud'),
    path.join(home, 'MEGA'),
  ].filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const c of candidates) {
    const p = path.resolve(c);
    if (seen.has(p) || !fs.existsSync(p)) continue;
    seen.add(p);
    out.push({ path: path.join(p, 'MC Hosting Panel'), name: path.basename(p) });
  }
  return out;
}

export function setSettings({ path: p = '' } = {}) {
  const clean = String(p || '').trim();
  if (clean) {
    const parent = path.dirname(path.resolve(clean));
    if (!fs.existsSync(parent)) throw new HttpError(400, `No existe la carpeta ${parent}`);
    fs.mkdirSync(path.resolve(clean), { recursive: true });
    try {
      fs.accessSync(path.resolve(clean), fs.constants.W_OK);
    } catch {
      throw new HttpError(400, 'No se puede escribir en esa carpeta');
    }
  }
  db.data.settings.backupMirror = { path: clean ? path.resolve(clean) : '', lastError: null, lastCopy: db.data.settings.backupMirror?.lastCopy || null };
  db.save();
  return settings();
}

/** Copia un respaldo recién creado a la carpeta sincronizada (si hay). */
export async function mirror(id, file) {
  const s = settings();
  if (!s.path) return null;
  const server = getServer(id);
  if (!server) return null;
  const dir = path.join(s.path, sanitizeFileName(server.name));
  try {
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, path.basename(file));
    await fs.promises.copyFile(file, `${dest}.part`);
    await fs.promises.rename(`${dest}.part`, dest);
    db.data.settings.backupMirror = { ...db.data.settings.backupMirror, lastError: null, lastCopy: new Date().toISOString() };
    db.save();
    return dest;
  } catch (err) {
    db.data.settings.backupMirror = { ...db.data.settings.backupMirror, lastError: `${path.basename(file)}: ${err.message}` };
    db.save();
    return null;
  }
}

/** Para la Revisión: ¿la copia en la nube está al día con el último respaldo? */
export function check(id, latestBackupFile) {
  const s = settings();
  if (!s.path) return { configured: false };
  const server = getServer(id);
  if (!fs.existsSync(s.path)) return { configured: true, ok: false, reason: 'La carpeta sincronizada ya no existe' };
  if (!latestBackupFile) return { configured: true, ok: true };
  const copy = path.join(s.path, sanitizeFileName(server.name), latestBackupFile);
  if (!fs.existsSync(copy)) return { configured: true, ok: false, reason: s.lastError ? `No se pudo copiar: ${s.lastError}` : 'El último respaldo todavía no está en la carpeta sincronizada' };
  return { configured: true, ok: true };
}
