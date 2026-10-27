import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, serverDir } from '../config.js';
import { db, getServer } from '../db.js';
import { HttpError, dirSize } from '../lib/util.js';
import { readProperties } from './properties.js';

/**
 * Cómo creció el mundo: una muestra al día con el tamaño en disco y cuántas regiones (archivos .mca)
 * tiene cada dimensión. Se guarda en data/metrics/world-<id>.json (dos años).
 */

const DIR = path.join(DATA_DIR, 'metrics');
const file = (id) => path.join(DIR, `world-${id}.json`);
const DAY = 24 * 3600_000;

function load(id) {
  try {
    return JSON.parse(fs.readFileSync(file(id), 'utf8'));
  } catch {
    return [];
  }
}

function regions(dir) {
  try {
    return fs.readdirSync(path.join(dir, 'region')).filter((f) => f.endsWith('.mca')).length;
  } catch {
    return 0;
  }
}

export async function sample(id) {
  const server = getServer(id);
  if (!server) throw new HttpError(404, 'Servidor no encontrado');
  const root = serverDir(id);
  const level = readProperties(id)['level-name'] || 'world';
  const dims = { overworld: level, nether: `${level}_nether`, end: `${level}_the_end` };
  const out = { t: Date.now(), bytes: 0, regions: 0, dims: {} };
  for (const [key, folder] of Object.entries(dims)) {
    const dir = path.join(root, folder);
    if (!fs.existsSync(dir)) continue;
    // En Vanilla el nether y el end viven dentro del mundo (DIM-1, DIM1).
    const bytes = await dirSize(dir);
    const r = regions(dir) + regions(path.join(dir, 'DIM-1')) + regions(path.join(dir, 'DIM1'));
    out.dims[key] = { bytes, regions: r };
    out.bytes += bytes;
    out.regions += r;
  }
  const list = load(id).filter((p) => p.t > Date.now() - 730 * DAY);
  // Una muestra por día: la última del día reemplaza a la anterior.
  const dayOf = (t) => new Date(t).toDateString();
  const kept = list.filter((p) => dayOf(p.t) !== dayOf(out.t));
  kept.push(out);
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(file(id), JSON.stringify(kept));
  return out;
}

export async function growth(id) {
  const list = load(id);
  const last = list.at(-1);
  if (!last || Date.now() - last.t > 3600_000) await sample(id);
  const points = load(id);
  const first = points[0];
  const latest = points.at(-1);
  return {
    points,
    summary: latest && first ? { days: Math.max(1, Math.round((latest.t - first.t) / DAY)), bytes: latest.bytes, grewBytes: latest.bytes - first.bytes, regions: latest.regions, grewRegions: latest.regions - first.regions } : null,
  };
}

export function removeGrowth(id) {
  fs.rmSync(file(id), { force: true });
}

setTimeout(() => {
  const all = async () => {
    for (const s of db.data.servers) if (s.installState === 'ready') await sample(s.id).catch(() => {});
  };
  all();
  setInterval(all, DAY).unref();
}, 90_000).unref();
