import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { IS_WINDOWS } from '../config.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Compara versiones tipo 1.20.4, 26.1, 21.1.77-beta. */
export function compareVersions(a, b) {
  const pa = String(a).split(/[^0-9]+/).filter(Boolean).map(Number);
  const pb = String(b).split(/[^0-9]+/).filter(Boolean).map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  // Una versión sin sufijo (-beta, -pre) es mayor que una con sufijo.
  const sa = /[a-z]/i.test(a) ? 0 : 1;
  const sb = /[a-z]/i.test(b) ? 0 : 1;
  return sa - sb;
}

/** Une una ruta relativa a una base sin permitir salir de ella (../). */
export function safeJoin(base, rel = '') {
  const root = path.resolve(base);
  const target = path.resolve(root, `.${path.sep}${String(rel).replace(/^[/\\]+/, '')}`);
  const norm = (p) => (IS_WINDOWS ? p.toLowerCase() : p);
  if (norm(target) !== norm(root) && !norm(target).startsWith(norm(root) + path.sep)) {
    throw new HttpError(400, 'Ruta no permitida');
  }
  return target;
}

export function relPath(base, abs) {
  return path.relative(base, abs).split(path.sep).join('/');
}

export function formatUuid(hex) {
  const h = hex.replace(/-/g, '');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** UUID que Minecraft asigna a un jugador cuando online-mode=false. */
export function offlineUuid(name) {
  const hash = crypto.createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest();
  hash[6] = (hash[6] & 0x0f) | 0x30;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  return formatUuid(hash.toString('hex'));
}

export async function dirSize(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(current, e.name);
      if (e.isDirectory()) stack.push(p);
      else {
        try {
          total += (await fs.promises.stat(p)).size;
        } catch {
          /* archivo en uso */
        }
      }
    }
  }
  return total;
}

export async function moveFile(from, to) {
  try {
    await fs.promises.rename(from, to);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    await fs.promises.copyFile(from, to);
    await fs.promises.rm(from, { force: true });
  }
}

export function sanitizeFileName(name) {
  return String(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 200);
}
