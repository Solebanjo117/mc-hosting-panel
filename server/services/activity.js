import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, serverDir } from '../config.js';
import { getServer } from '../db.js';
import { bus } from '../lib/bus.js';
import { HttpError } from '../lib/util.js';
import { readProperties } from './properties.js';

/**
 * Actividad de cada servidor:
 *  - Línea de tiempo: entradas y salidas de jugadores, encendidos, apagados, caídas y respaldos.
 *    Se deduce de los cambios de estado que ya publica el administrador de procesos.
 *  - Mapa de calor: cuántos jugadores hay en promedio cada día de la semana y hora.
 *  - Estadísticas de jugadores: las que guarda Minecraft en <mundo>/stats/<uuid>.json.
 *
 * Se guarda en data/activity/<id>.json (90 días, máximo 20 000 eventos).
 */

const DIR = path.join(DATA_DIR, 'activity');
const KEEP_MS = 90 * 24 * 3600_000;
const MAX_EVENTS = 20_000;
fs.mkdirSync(DIR, { recursive: true });

const store = new Map(); // id -> { events, dirty }
const live = new Map(); // id -> { status, players:Set }

function load(id) {
  if (!store.has(id)) {
    let events = [];
    try {
      events = JSON.parse(fs.readFileSync(path.join(DIR, `${id}.json`), 'utf8'));
    } catch {
      /* sin historial */
    }
    store.set(id, { events, dirty: false });
  }
  return store.get(id);
}

export function record(id, type, extra = {}) {
  const s = load(id);
  s.events.push({ t: Date.now(), type, ...extra });
  if (s.events.length > MAX_EVENTS) s.events.splice(0, s.events.length - MAX_EVENTS);
  s.dirty = true;
}

function persist() {
  const cutoff = Date.now() - KEEP_MS;
  for (const [id, s] of store) {
    if (!s.dirty) continue;
    s.events = s.events.filter((e) => e.t >= cutoff);
    try {
      fs.writeFileSync(path.join(DIR, `${id}.json`), JSON.stringify(s.events));
      s.dirty = false;
    } catch (err) {
      console.error('[activity]', err.message);
    }
  }
}
setInterval(persist, 60_000).unref();
process.on('exit', persist);

export function removeActivity(id) {
  store.delete(id);
  live.delete(id);
  fs.rmSync(path.join(DIR, `${id}.json`), { force: true });
}

bus.on('status', (id, snap) => {
  const prev = live.get(id) || { status: 'stopped', players: new Set() };
  const players = new Set(snap.players || []);
  const stopping = snap.status === 'stopped' || snap.status === 'crashed';
  for (const p of prev.players) if (!players.has(p)) record(id, 'leave', { player: p, ...(stopping ? { detail: 'el servidor se apagó' } : {}) });
  for (const p of players) if (!prev.players.has(p)) record(id, 'join', { player: p });
  if (snap.status !== prev.status) {
    if (snap.status === 'starting' && (prev.status === 'stopped' || prev.status === 'crashed')) record(id, 'start');
    else if (snap.status === 'running' && prev.status === 'starting') record(id, 'ready');
    else if (snap.status === 'stopped' && prev.status !== 'stopped') record(id, 'stop');
    else if (snap.status === 'crashed') record(id, 'crash', { detail: snap.lastCrash?.findings?.[0]?.title || `código ${snap.lastCrash?.code ?? '?'}` });
  }
  live.set(id, { status: snap.status, players });
});

// --- Línea de tiempo y mapa de calor -------------------------------------------------

/** Sesiones [inicio, fin] por jugador a partir de entradas y salidas. */
function sessions(events, now = Date.now()) {
  const open = new Map();
  const out = [];
  for (const e of events) {
    if (e.type === 'join') open.set(e.player, e.t);
    else if (e.type === 'leave' && open.has(e.player)) {
      out.push({ player: e.player, start: open.get(e.player), end: e.t });
      open.delete(e.player);
    } else if ((e.type === 'stop' || e.type === 'crash' || e.type === 'start') && open.size) {
      // Por si el panel se cerró sin registrar las salidas.
      for (const [player, start] of open) out.push({ player, start, end: e.t });
      open.clear();
    }
  }
  for (const [player, start] of open) out.push({ player, start, end: now, online: true });
  return out;
}

/** Promedio de jugadores conectados por día de la semana (0 = lunes) y hora, en la hora local de esta PC. */
function heatmap(events, days = 30) {
  const now = Date.now();
  const from = now - days * 24 * 3600_000;
  const minutes = Array.from({ length: 7 }, () => new Array(24).fill(0));
  for (const s of sessions(events, now)) {
    let t = Math.max(s.start, from);
    const end = Math.min(s.end, now);
    while (t < end) {
      const d = new Date(t);
      const next = new Date(d);
      next.setMinutes(60, 0, 0); // inicio de la siguiente hora
      const stop = Math.min(next.getTime(), end);
      minutes[(d.getDay() + 6) % 7][d.getHours()] += (stop - t) / 60_000;
      t = stop;
    }
  }
  // Cuántas veces ocurrió cada día-hora desde que hay datos (para promediar).
  const first = events.length ? Math.max(events[0].t, from) : now;
  const count = Array.from({ length: 7 }, () => new Array(24).fill(0));
  for (let t = new Date(first).setMinutes(0, 0, 0); t < now; t += 3600_000) {
    const d = new Date(t);
    count[(d.getDay() + 6) % 7][d.getHours()] += 1;
  }
  const avg = minutes.map((row, i) => row.map((m, h) => (count[i][h] ? Math.round((m / 60 / count[i][h]) * 100) / 100 : 0)));
  const total = sessions(events, now).filter((s) => s.end >= from);
  return {
    days,
    since: first,
    grid: avg,
    max: Math.max(0, ...avg.flat()),
    uniquePlayers: new Set(total.map((s) => s.player)).size,
    playerHours: Math.round(total.reduce((n, s) => n + (Math.min(s.end, now) - Math.max(s.start, from)), 0) / 360_000) / 10,
  };
}

export function activity(id, { limit = 100, before = null, filter = 'all' } = {}) {
  if (!getServer(id)) throw new HttpError(404, 'Servidor no encontrado');
  const events = load(id).events;
  const PLAYER = new Set(['join', 'leave']);
  let list = events.filter((e) => (filter === 'players' ? PLAYER.has(e.type) : filter === 'server' ? !PLAYER.has(e.type) : true));
  if (before) list = list.filter((e) => e.t < Number(before));
  const page = list.slice(-Math.min(500, limit)).reverse();
  return { events: page, more: list.length > page.length, heatmap: heatmap(events) };
}

// --- Estadísticas de jugadores (archivos de Minecraft) ----------------------------------

const sum = (obj = {}, pred = () => true) => Object.entries(obj).reduce((n, [k, v]) => (pred(k) ? n + Number(v || 0) : n), 0);
const top = (obj = {}, n = 6) =>
  Object.entries(obj)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => ({ id: k.replace(/^minecraft:/, ''), value: v }));

function parseStats(json) {
  if (json.stats) {
    const s = json.stats;
    const c = s['minecraft:custom'] || {};
    return {
      playTime: Math.round((c['minecraft:play_time'] ?? c['minecraft:play_one_minute'] ?? 0) / 20), // segundos
      deaths: c['minecraft:deaths'] || 0,
      mobKills: c['minecraft:mob_kills'] || 0,
      playerKills: c['minecraft:player_kills'] || 0,
      distance: Math.round(sum(c, (k) => k.endsWith('_one_cm')) / 100), // metros (bloques)
      blocksMined: sum(s['minecraft:mined']),
      crafted: sum(s['minecraft:crafted']),
      jumps: c['minecraft:jump'] || 0,
      damageDealt: Math.round((c['minecraft:damage_dealt'] || 0) / 10),
      topMined: top(s['minecraft:mined']),
      topKilled: top(s['minecraft:killed']),
      killedBy: top(s['minecraft:killed_by'], 3),
    };
  }
  // Formato antiguo (1.12 y anteriores): claves planas "stat.algo".
  const flat = (k) => Number(json[k] || 0);
  return {
    playTime: Math.round(flat('stat.playOneMinute') / 20),
    deaths: flat('stat.deaths'),
    mobKills: flat('stat.mobKills'),
    playerKills: flat('stat.playerKills'),
    distance: Math.round(sum(json, (k) => /^stat\.\w+OneCm$/.test(k)) / 100),
    blocksMined: sum(json, (k) => k.startsWith('stat.mineBlock.')),
    crafted: sum(json, (k) => k.startsWith('stat.craftItem.')),
    jumps: flat('stat.jump'),
    damageDealt: Math.round(flat('stat.damageDealt') / 10),
    topMined: [],
    topKilled: [],
    killedBy: [],
  };
}

export function playerStats(id) {
  const server = getServer(id);
  if (!server) throw new HttpError(404, 'Servidor no encontrado');
  const root = serverDir(id);
  const world = readProperties(id)['level-name'] || 'world';
  const dir = path.join(root, world, 'stats');
  let cache = [];
  try {
    cache = JSON.parse(fs.readFileSync(path.join(root, 'usercache.json'), 'utf8'));
  } catch {
    /* sin caché */
  }
  const names = new Map(cache.map((c) => [c.uuid, c.name]));
  const seen = new Map();
  for (const s of sessions(load(id).events)) {
    const p = seen.get(s.player) || { lastSeen: 0, sessions: 0, online: false };
    p.lastSeen = Math.max(p.lastSeen, s.end);
    p.sessions += 1;
    p.online ||= Boolean(s.online);
    seen.set(s.player, p);
  }
  const players = [];
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      if (!/^[0-9a-f-]{36}\.json$/i.test(f)) continue;
      try {
        const uuid = f.slice(0, -5);
        const json = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        const name = names.get(uuid) || null;
        const hasData = fs.existsSync(path.join(root, world, 'playerdata', `${uuid}.dat`));
        players.push({ uuid, name, ...parseStats(json), ...(name && seen.get(name)), playerdata: hasData ? `${world}/playerdata/${uuid}.dat` : null });
      } catch {
        /* archivo dañado: se ignora */
      }
    }
  }
  return { world, players };
}
