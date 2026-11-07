import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DATA_DIR } from '../config.js';
import { db } from '../db.js';
import { allInstances, instance } from './processManager.js';

/**
 * Historial de rendimiento: cada 30 s guarda CPU, RAM, TPS y jugadores de cada servidor encendido,
 * y CPU, RAM usada y disco libre de la PC. Se conserva 7 días en data/metrics/<id>.json
 * (la PC en data/metrics/_host.json).
 */

const DIR = path.join(DATA_DIR, 'metrics');
const SAMPLE_MS = 30_000;
const KEEP_MS = 7 * 24 * 3600_000;
const HOST_ID = '_host';
fs.mkdirSync(DIR, { recursive: true });

const series = new Map(); // id -> [{t, cpu, mem, tps, players}] · _host -> [{t, cpu, mem, disk}]

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

// --- La PC ------------------------------------------------------------------------------

let prevCpu = null;
/** Uso de CPU de toda la PC (0-100) desde la última llamada; null la primera vez. */
function hostCpu() {
  let idle = 0;
  let total = 0;
  for (const c of os.cpus()) {
    for (const v of Object.values(c.times)) total += v;
    idle += c.times.idle;
  }
  const prev = prevCpu;
  prevCpu = { idle, total };
  if (!prev || total <= prev.total) return null;
  return Math.round((1 - (idle - prev.idle) / (total - prev.total)) * 1000) / 10;
}

function disk() {
  try {
    const st = fs.statfsSync(DATA_DIR);
    const mb = (n) => Math.round((Number(n) * Number(st.bsize)) / 1024 / 1024);
    return { freeMb: mb(st.bavail), totalMb: mb(st.blocks) };
  } catch {
    return null;
  }
}

const toMb = (bytes) => Math.round(bytes / 1024 / 1024);

/** Estado actual de la PC para las tarjetas del Rendimiento general. */
export function hostNow() {
  const last = load(HOST_ID).at(-1);
  const d = disk();
  return {
    cpu: last && Date.now() - last.t < 2 * SAMPLE_MS ? last.cpu : null,
    cores: os.cpus().length,
    memUsedMb: toMb(os.totalmem() - os.freemem()),
    totalMemMb: toMb(os.totalmem()),
    diskFreeMb: d?.freeMb ?? null,
    diskTotalMb: d?.totalMb ?? null,
  };
}

hostCpu(); // primera lectura, para que la siguiente ya tenga con qué comparar

// --- Muestreo ---------------------------------------------------------------------------

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
  load(HOST_ID).push({ t: now, cpu: hostCpu(), mem: toMb(os.totalmem() - os.freemem()), disk: disk()?.freeMb ?? null });
}, SAMPLE_MS).unref();

setInterval(persist, 5 * 60_000).unref();
process.on('exit', persist);

// --- Consultas --------------------------------------------------------------------------

const RANGES = { '1h': 3600_000, '6h': 6 * 3600_000, '24h': 24 * 3600_000, '7d': KEEP_MS };

function grid(range, end) {
  const span = RANGES[range] || RANGES['6h'];
  const bucketMs = Math.max(SAMPLE_MS, Math.ceil(span / 240 / SAMPLE_MS) * SAMPLE_MS);
  return { range: RANGES[range] ? range : '6h', start: end - span, end, bucketMs };
}

/**
 * Agrupa una serie en la cuadrícula (~240 puntos); los huecos quedan en null.
 * keys: { medida: 'avg' | 'max' } según cómo resumir cada medida dentro de un intervalo.
 */
function bucketize(list, { start, end, bucketMs }, keys) {
  const buckets = new Map();
  for (const p of list) {
    if (p.t < start) continue;
    const key = Math.floor(p.t / bucketMs) * bucketMs;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(p);
  }
  const summarize = (group, k, how) => {
    const vals = group.map((p) => p[k]).filter((v) => v != null);
    if (!vals.length) return null;
    if (how === 'max') return Math.max(...vals);
    return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
  };
  const out = [];
  for (let t = Math.floor(start / bucketMs) * bucketMs; t <= end; t += bucketMs) {
    const group = buckets.get(t);
    const point = { t };
    for (const [k, how] of Object.entries(keys)) point[k] = group ? summarize(group, k, how) : null;
    out.push(point);
  }
  return out;
}

const SERVER_KEYS = { cpu: 'avg', mem: 'avg', tps: 'avg', players: 'max' };
const HOST_KEYS = { cpu: 'avg', mem: 'avg', disk: 'avg' };

/** Historial de un servidor agrupado en ~240 puntos; los huecos (servidor apagado) quedan en null. */
export function getMetrics(id, range = '6h', end = Date.now()) {
  const g = grid(range, end);
  const server = db.data.servers.find((s) => s.id === id);
  return {
    range: g.range,
    bucketMs: g.bucketMs,
    memoryLimitMb: server?.memoryMb || null,
    tpsAvailable: instance(id).tpsSupported,
    points: bucketize(load(id), g, SERVER_KEYS),
  };
}

/** Todos los servidores y la PC sobre la misma cuadrícula de tiempo, más los totales por intervalo. */
export function getAllMetrics(range = '6h', end = Date.now(), allow = () => true) {
  const g = grid(range, end);
  const servers = db.data.servers
    .filter((s) => allow(s.id))
    .map((s) => ({
      id: s.id,
      name: s.name,
      memoryLimitMb: s.memoryMb || null,
      tpsAvailable: instance(s.id).tpsSupported,
      points: bucketize(load(s.id), g, SERVER_KEYS),
    }));
  const host = { cores: os.cpus().length, totalMemMb: toMb(os.totalmem()), points: bucketize(load(HOST_ID), g, HOST_KEYS) };
  // Totales: suma de jugadores, RAM y CPU de los servidores; el peor TPS.
  const totals = host.points.map((hp, i) => {
    const col = servers.map((s) => s.points[i]).filter(Boolean);
    const sum = (k) => (col.some((p) => p[k] != null) ? Math.round(col.reduce((n, p) => n + (p[k] || 0), 0) * 10) / 10 : null);
    const tps = col.map((p) => p.tps).filter((v) => v != null);
    return { t: hp.t, players: sum('players'), mem: sum('mem'), cpu: sum('cpu'), tpsMin: tps.length ? Math.min(...tps) : null };
  });
  return { range: g.range, bucketMs: g.bucketMs, host, servers, totals };
}
