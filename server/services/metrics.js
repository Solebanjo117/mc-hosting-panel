import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config.js';
import { db } from '../db.js';
import { allInstances, instance } from './processManager.js';

/**
 * Historial de rendimiento: cada 30 s guarda CPU, RAM, TPS y jugadores de cada
 * servidor encendido. Se conserva 7 días y se guarda en data/metrics/<id>.json.
 */

const DIR = path.join(DATA_DIR, 'metrics');
const SAMPLE_MS = 30_000;
const KEEP_MS = 7 * 24 * 3600_000;
fs.mkdirSync(DIR, { recursive: true });

const series = new Map(); // id -> [{t, cpu, mem, tps, players}]

function load(id) {
  if (series.has(id)) return series.get(id);
  let list = [];
  try {
    list = JSON.parse(fs.readFileSync(path.join(DIR, `${id}.json`), 'utf8'));
  } catch {
    /* sin historial */
  }
  series.set(id, list);
  return list;
}

function persist() {
  const cutoff = Date.now() - KEEP_MS;
  for (const [id, list] of series) {
    const kept = list.filter((p) => p.t >= cutoff);
    series.set(id, kept);
    try {
      fs.writeFileSync(path.join(DIR, `${id}.json`), JSON.stringify(kept));
    } catch (err) {
      console.error('[metrics]', err.message);
    }
  }
}

export function removeMetrics(id) {
  series.delete(id);
  fs.rmSync(path.join(DIR, `${id}.json`), { force: true });
}

// Pide el TPS un poco antes de cada muestra para tener el dato fresco.
setInterval(() => {
  for (const inst of allInstances()) inst.pollTps();
}, 60_000).unref();

setInterval(() => {
  const now = Date.now();
  for (const inst of allInstances()) {
    if (!inst.proc || inst.status !== 'running') continue;
    const tps = inst.tps && now - inst.tps.at < 3 * 60_000 ? inst.tps.value : null;
    load(inst.id).push({
      t: now,
      cpu: inst.stats?.cpu ?? null,
      mem: inst.stats?.memoryMb ?? null,
      tps,
      players: inst.players.size,
    });
  }
}, SAMPLE_MS).unref();

setInterval(persist, 5 * 60_000).unref();
process.on('exit', persist);

const RANGES = { '1h': 3600_000, '6h': 6 * 3600_000, '24h': 24 * 3600_000, '7d': KEEP_MS };

/** Devuelve el historial agrupado en ~240 puntos; los huecos (servidor apagado) quedan en null. */
export function getMetrics(id, range = '6h') {
  const span = RANGES[range] || RANGES['6h'];
  const end = Date.now();
  const start = end - span;
  const bucketMs = Math.max(SAMPLE_MS, Math.ceil(span / 240 / SAMPLE_MS) * SAMPLE_MS);
  const points = load(id).filter((p) => p.t >= start);
  const buckets = new Map();
  for (const p of points) {
    const key = Math.floor(p.t / bucketMs) * bucketMs;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(p);
  }
  const avg = (list, k) => {
    const vals = list.map((p) => p[k]).filter((v) => v != null);
    return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null;
  };
  const out = [];
  for (let t = Math.floor(start / bucketMs) * bucketMs; t <= end; t += bucketMs) {
    const list = buckets.get(t);
    out.push(
      list
        ? { t, cpu: avg(list, 'cpu'), mem: avg(list, 'mem'), tps: avg(list, 'tps'), players: Math.max(...list.map((p) => p.players)) }
        : { t, cpu: null, mem: null, tps: null, players: null }
    );
  }
  const server = db.data.servers.find((s) => s.id === id);
  return {
    range,
    bucketMs,
    memoryLimitMb: server?.memoryMb || null,
    tpsAvailable: instance(id).tpsSupported,
    points: out,
  };
}
