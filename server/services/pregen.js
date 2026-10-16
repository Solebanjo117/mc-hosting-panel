import { db, getServer, updateServer } from '../db.js';
import { bus } from '../lib/bus.js';
import { HttpError } from '../lib/util.js';
import * as market from './marketplace.js';
import { readProperties } from './properties.js';
import { instance, isRunning } from './processManager.js';

/**
 * Pregenerar el mundo con Chunky: genera por adelantado los chunks alrededor del spawn para que
 * explorar no dé tirones (y para que el mapa de BlueMap se pueda dibujar entero).
 * El panel instala Chunky, le manda los comandos por la consola y lee el avance de lo que imprime:
 *   [Chunky] Task running for world. Processed: 6656 chunks (16.25%), ETA: 0:00:37, Rate: 289.7 cps, Current: -19, 26
 */

const PROJECT = 'chunky';
export const MAX_RADIUS = 30_000;
const KB_PER_CHUNK = { overworld: 4, nether: 3, end: 1.5 }; // aproximado, en disco ya comprimido
const DIMENSIONS = ['overworld', 'nether', 'end'];

const live = new Map(); // id -> estado de la tarea

function requireServer(id) {
  const s = getServer(id);
  if (!s) throw new HttpError(404, 'Servidor no encontrado');
  return s;
}

/** Nombre del mundo como lo entiende Chunky en cada tipo de servidor. */
export function chunkyWorld(server, dimension) {
  if (server.type === 'paper') {
    const level = readProperties(server.id)['level-name'] || 'world';
    return { overworld: level, nether: `${level}_nether`, end: `${level}_the_end` }[dimension];
  }
  return { overworld: 'minecraft:overworld', nether: 'minecraft:the_nether', end: 'minecraft:the_end' }[dimension];
}

/** Cuántos chunks y cuánto disco ocupa (aprox.) pregenerar ese radio. */
export function estimate(radius, shape = 'square', dimension = 'overworld') {
  const r = Number(radius) || 0;
  const side = Math.ceil((2 * r) / 16);
  const chunks = shape === 'circle' ? Math.round((Math.PI * r * r) / 256) : side * side;
  return { chunks, diskMb: Math.round((chunks * (KB_PER_CHUNK[dimension] || 4)) / 1024) };
}

function installedItem(id) {
  return market.listInstalled(id).items.find((i) => i.projectId === PROJECT || /^chunky/i.test(i.filename));
}

function taskView(id) {
  const server = getServer(id);
  return live.get(id) || server?.pregen || null;
}

export function status(id) {
  const server = requireServer(id);
  const supported = server.type !== 'vanilla';
  const item = supported ? installedItem(id) : null;
  return {
    supported,
    reason: supported ? null : 'Vanilla no admite plugins ni mods. Usa un servidor Paper (se juega igual) para pregenerar el mundo.',
    installed: Boolean(item),
    // Instalado con el servidor encendido: Chunky carga al reiniciar.
    needsRestart: needsRestart(id),
    running: isRunning(id) && instance(id).status === 'running',
    task: taskView(id),
    dimensions: DIMENSIONS,
    maxRadius: MAX_RADIUS,
  };
}

function needsRestart(id) {
  const server = getServer(id);
  const startedAt = isRunning(id) ? Date.parse(instance(id).startedAt || 0) : null;
  return Boolean(startedAt && server?.pregenInstalledAt && Date.parse(server.pregenInstalledAt) > startedAt);
}

export async function install(id) {
  const server = requireServer(id);
  if (server.type === 'vanilla') throw new HttpError(400, status(id).reason);
  if (server.installState !== 'ready') throw new HttpError(409, 'Espera a que termine la instalación del servidor');
  const results = await market.install(id, { source: 'modrinth', projectId: PROJECT });
  const main = results.find((r) => r.projectId === PROJECT || /chunky/i.test(r.file || ''));
  if (!main || main.error) throw new HttpError(502, main?.error || 'No se pudo instalar Chunky');
  updateServer(id, { pregenInstalledAt: new Date().toISOString() });
  return status(id);
}

function save(id, patch) {
  const prev = live.get(id) || getServer(id)?.pregen || {};
  const next = { ...prev, ...patch, updatedAt: new Date().toISOString() };
  live.set(id, next);
  bus.emit('pregen', id, next);
  return next;
}

/** Guarda en la base de datos solo en los cambios de estado (no en cada línea de avance). */
function persist(id) {
  const t = live.get(id);
  if (t && getServer(id)) updateServer(id, { pregen: t });
}

function requireLoaded(id) {
  if (!isRunning(id) || instance(id).status !== 'running') throw new HttpError(409, 'Enciende el servidor para pregenerar (Chunky trabaja con el servidor encendido)');
  if (!installedItem(id)) throw new HttpError(409, 'Instala Chunky primero');
  if (needsRestart(id)) throw new HttpError(409, 'Reinicia el servidor para que cargue Chunky');
}

/** Manda un comando de Chunky y espera su respuesta; si pide confirmar, confirma. */
async function chunkyCommand(inst, command, expect, { confirm = false } = {}) {
  const answer = new RegExp(`${expect.source}|chunky confirm|Unknown or incomplete command|Unknown command`, 'i');
  const wait = inst.waitForLine(answer, 8000);
  let last = '';
  const grab = (line) => answer.test(line) && (last = line);
  inst.lineListeners.add(grab);
  inst.send(command);
  const ok = await wait;
  inst.lineListeners.delete(grab);
  if (!ok) throw new HttpError(504, `Chunky no respondió a "${command}". ¿Está cargado? Reinicia el servidor si lo acabas de instalar.`);
  if (/Unknown or incomplete command|Unknown command/i.test(last)) {
    inst.chunkyLoaded = false;
    throw new HttpError(409, 'El servidor no reconoce los comandos de Chunky: reinícialo para que lo cargue.');
  }
  inst.chunkyLoaded = true;
  if (/chunky confirm/i.test(last) && !expect.test(last)) {
    if (!confirm) return { needsConfirm: true, line: last };
    return chunkyCommand(inst, 'chunky confirm', expect);
  }
  return { line: last };
}

export async function start(id, { radius, dimension = 'overworld', shape = 'square', center = 'spawn', x = 0, z = 0, border = false } = {}) {
  const server = requireServer(id);
  requireLoaded(id);
  const r = Math.round(Number(radius));
  if (!Number.isFinite(r) || r < 16 || r > MAX_RADIUS) throw new HttpError(400, `El radio va de 16 a ${MAX_RADIUS} bloques`);
  if (!DIMENSIONS.includes(dimension)) throw new HttpError(400, 'Dimensión inválida');
  if (!['square', 'circle'].includes(shape)) throw new HttpError(400, 'Forma inválida');
  const world = chunkyWorld(server, dimension);
  const inst = instance(id);
  const cur = taskView(id);
  if (cur?.state === 'running') throw new HttpError(409, 'Ya se está pregenerando; pausa o cancela antes de empezar otra');

  // Menos mensajes en la consola: un avance cada 5 segundos.
  inst.send('chunky quiet 5');
  inst.send(`chunky world ${world}`);
  if (center === 'spawn') inst.send('chunky spawn');
  else inst.send(`chunky center ${Math.round(Number(x) || 0)} ${Math.round(Number(z) || 0)}`);
  inst.send(`chunky shape ${shape}`);
  inst.send(`chunky radius ${r}`);
  await chunkyCommand(inst, 'chunky start', /Task started for/i, { confirm: true });

  // Borde del mundo del mismo tamaño (solo el mundo normal: el comando de consola usa el overworld).
  if (border && dimension === 'overworld') {
    inst.send(center === 'spawn' ? 'worldborder center ~ ~' : `worldborder center ${Math.round(Number(x) || 0)} ${Math.round(Number(z) || 0)}`);
    inst.send(`worldborder set ${r * 2}`);
  }

  const est = estimate(r, shape, dimension);
  save(id, {
    state: 'running',
    world,
    dimension,
    radius: r,
    shape,
    center: center === 'spawn' ? 'spawn' : { x: Number(x) || 0, z: Number(z) || 0 },
    border: Boolean(border && dimension === 'overworld'),
    total: est.chunks,
    processed: 0,
    percent: 0,
    eta: null,
    rate: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    totalTime: null,
  });
  persist(id);
  return status(id);
}

export async function control(id, action) {
  requireServer(id);
  const map = { pause: [/Task paused for/i, 'paused'], continue: [/Task continuing for|Task started for/i, 'running'], cancel: [/Task cancelled for/i, 'cancelled'] };
  if (!map[action]) throw new HttpError(400, 'Acción inválida');
  requireLoaded(id);
  const t = taskView(id);
  if (!t) throw new HttpError(404, 'No hay ninguna pregeneración');
  if (action === 'pause' && t.state !== 'running') throw new HttpError(409, 'No se está pregenerando');
  if (action === 'continue' && !['paused', 'interrupted'].includes(t.state)) throw new HttpError(409, 'No hay nada pausado que continuar');
  const [expect, state] = map[action];
  // Con varias tareas, Chunky pide el mundo: se indica siempre.
  await chunkyCommand(instance(id), `chunky ${action} ${t.world}`, expect, { confirm: true });
  save(id, { state, ...(action === 'cancel' ? { finishedAt: new Date().toISOString() } : {}) });
  persist(id);
  return status(id);
}

/** Olvida la última tarea terminada o cancelada (para la interfaz). */
export function clear(id) {
  const t = taskView(id);
  if (t?.state === 'running') throw new HttpError(409, 'Se está pregenerando');
  live.delete(id);
  updateServer(id, { pregen: null });
  return status(id);
}

// --- Leer el avance de la consola ------------------------------------------------------

const RE_RUNNING = /\[Chunky\] Task running for (\S+?)\. Processed: (\d+) chunks \(([\d.,]+)%\), ETA: ([\d:]+), Rate: ([\d.,]+) cps/i;
const RE_DONE = /\[Chunky\] Task finished for (\S+?)\. Processed: (\d+) chunks \(([\d.,]+)%\)(?:, Total time: ([\d:]+))?/i;
const RE_PAUSED = /\[Chunky\] Task (paused|cancelled|stopped) for (\S+?)\./i;
const num = (s) => Number(String(s).replace(',', '.'));

export function parseLine(line) {
  let m = line.match(RE_RUNNING);
  if (m) return { world: m[1], state: 'running', processed: Number(m[2]), percent: num(m[3]), eta: m[4], rate: num(m[5]) };
  m = line.match(RE_DONE);
  if (m) return { world: m[1], state: 'done', processed: Number(m[2]), percent: 100, eta: null, totalTime: m[4] || null };
  m = line.match(RE_PAUSED);
  if (m) return { world: m[2], state: m[1].toLowerCase() === 'cancelled' ? 'cancelled' : 'paused' };
  return null;
}

bus.on('console', (id, line) => {
  if (!line.includes('[Chunky]')) return;
  const p = parseLine(line);
  if (!p) return;
  const t = taskView(id);
  // Una tarea que no inició el panel (desde el juego) también se muestra.
  if (t && t.world && p.world !== t.world && t.state === 'running' && p.state === 'running') return;
  const changed = !t || t.state !== p.state;
  save(id, { ...(t ? {} : { world: p.world, startedAt: new Date().toISOString() }), ...p, ...(p.state === 'done' ? { finishedAt: new Date().toISOString() } : {}) });
  if (changed) persist(id);
});

// Si el servidor se apaga a mitad, Chunky guarda el avance: queda "interrumpida" y se puede continuar.
bus.on('status', (id, snap) => {
  if (snap.status !== 'stopped' && snap.status !== 'crashed') return;
  const t = taskView(id);
  if (t?.state === 'running') {
    save(id, { state: 'interrupted' });
    persist(id);
  }
  const inst = instance(id);
  if (inst) inst.chunkyLoaded = undefined;
});

export function forget(id) {
  live.delete(id);
}

// Al abrir el panel: lo que quedó "pregenerando" cuando se cerró, quedó interrumpido.
for (const s of db.data.servers) {
  if (s.pregen?.state === 'running') s.pregen = { ...s.pregen, state: 'interrupted' };
}
