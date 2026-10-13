import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { serverDir } from '../config.js';
import { getServer } from '../db.js';
import { HttpError, dirSize, safeJoin } from '../lib/util.js';
import { isRunning } from './processManager.js';
import { readProperties, writeProperties } from './properties.js';
import { forgetWorld } from './worldMap.js';

/**
 * Mundos de un servidor. Cada mundo es una carpeta con level.dat; Paper/Spigot
 * guardan el Nether y el End aparte (mundo_nether, mundo_the_end).
 */

const DIMS = ['_nether', '_the_end'];
const LEVEL_TYPES = {
  normal: 'minecraft:normal',
  flat: 'minecraft:flat',
  large_biomes: 'minecraft:large_biomes',
  amplified: 'minecraft:amplified',
};

function requireStopped(id) {
  if (!getServer(id)) throw new HttpError(404, 'Servidor no encontrado');
  if (isRunning(id)) throw new HttpError(409, 'Apaga el servidor para hacer cambios en los mundos');
}

function validName(name) {
  const n = String(name || '').trim();
  if (!/^[A-Za-z0-9_\- ]{1,40}$/.test(n)) throw new HttpError(400, 'El nombre solo puede tener letras sin acentos, números, espacios, - y _');
  if (DIMS.some((d) => n.endsWith(d))) throw new HttpError(400, 'El nombre no puede terminar en _nether ni _the_end');
  return n;
}

function folders(id, name) {
  const dir = serverDir(id);
  return [name, ...DIMS.map((d) => `${name}${d}`)].filter((f) => fs.existsSync(path.join(dir, f)));
}

export async function listWorlds(id) {
  const dir = serverDir(id);
  const active = readProperties(id)['level-name'] || 'world';
  const entries = fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : [];
  const names = entries
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'level.dat')))
    .map((e) => e.name)
    .filter((n) => !DIMS.some((d) => n.endsWith(d) && fs.existsSync(path.join(dir, n.slice(0, -d.length)))));
  if (!names.includes(active)) names.push(active); // aún no generado
  const out = [];
  for (const name of names) {
    const parts = folders(id, name);
    let size = 0;
    for (const p of parts) size += await dirSize(path.join(dir, p));
    const levelDat = path.join(dir, name, 'level.dat');
    out.push({
      name,
      active: name === active,
      generated: fs.existsSync(levelDat),
      size,
      mtime: fs.existsSync(levelDat) ? fs.statSync(levelDat).mtime.toISOString() : null,
      dimensions: parts.length,
      datapacks: countDatapacks(path.join(dir, name, 'datapacks')),
    });
  }
  return { active, seed: readProperties(id)['level-seed'] || '', worlds: out.sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name)) };
}

export function switchWorld(id, name) {
  requireStopped(id);
  const n = validName(name);
  if (!fs.existsSync(path.join(serverDir(id), n, 'level.dat'))) throw new HttpError(404, 'Ese mundo no existe');
  writeProperties(id, { 'level-name': n });
}

function countDatapacks(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => (e.isFile() && e.name.endsWith('.zip')) || (e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'pack.mcmeta')))).length;
  } catch {
    return 0;
  }
}

/**
 * Prepara un mundo nuevo: se genera la próxima vez que enciendas el servidor.
 * Con copyDatapacks se copian los datapacks del mundo activo antes de generarlo, así también
 * aplican los que cambian la generación (biomas, estructuras).
 */
export function createWorld(id, { name, seed = '', levelType = 'normal', copyDatapacks = false }) {
  requireStopped(id);
  const n = validName(name);
  if (folders(id, n).length) throw new HttpError(409, 'Ya existe un mundo con ese nombre');
  const dir = serverDir(id);
  const active = readProperties(id)['level-name'] || 'world';
  let copied = 0;
  if (copyDatapacks) {
    const from = path.join(dir, active, 'datapacks');
    if (fs.existsSync(from)) {
      const to = path.join(dir, n, 'datapacks');
      fs.mkdirSync(to, { recursive: true });
      for (const e of fs.readdirSync(from, { withFileTypes: true })) {
        const packZip = e.isFile() && /\.zip(\.disabled)?$/.test(e.name);
        const packDir = e.isDirectory() && fs.existsSync(path.join(from, e.name, 'pack.mcmeta'));
        if (!packZip && !packDir) continue;
        fs.cpSync(path.join(from, e.name), path.join(to, e.name), { recursive: true });
        if (!e.name.endsWith('.disabled')) copied++;
      }
    }
  }
  writeProperties(id, { 'level-name': n, 'level-seed': String(seed).slice(0, 100), 'level-type': LEVEL_TYPES[levelType] || LEVEL_TYPES.normal });
  return { copiedDatapacks: copied };
}

export function deleteWorld(id, name) {
  requireStopped(id);
  const n = validName(name);
  if ((readProperties(id)['level-name'] || 'world') === n) throw new HttpError(409, 'No puedes borrar el mundo activo; cambia a otro primero');
  for (const f of folders(id, n)) fs.rmSync(safeJoin(serverDir(id), f), { recursive: true, force: true });
  // Si el mapa (BlueMap) tenía un mapa de ese mundo, se quita junto con lo dibujado.
  const server = getServer(id);
  return { removedMaps: server.map?.enabled ? forgetWorld(server, n) : 0 };
}

export function worldFolders(id, name) {
  const n = validName(name);
  const list = folders(id, n);
  if (!list.length) throw new HttpError(404, 'Ese mundo no existe');
  return list.map((f) => ({ name: f, path: path.join(serverDir(id), f) }));
}

/** Importa un mundo desde un .zip: busca el level.dat más cercano a la raíz. */
export function importWorld(id, zipPath, wantedName) {
  requireStopped(id);
  const zip = new AdmZip(zipPath);
  const levelDats = zip
    .getEntries()
    .filter((e) => !e.isDirectory && /(^|\/)level\.dat$/.test(e.entryName))
    .sort((a, b) => a.entryName.split('/').length - b.entryName.split('/').length);
  if (!levelDats.length) throw new HttpError(400, 'El .zip no contiene un mundo de Minecraft (falta level.dat)');
  const prefix = levelDats[0].entryName.replace(/level\.dat$/, '');
  const base = validName(wantedName || prefix.split('/').filter(Boolean).pop() || 'mundo-importado');
  let name = base;
  for (let i = 2; folders(id, name).length; i++) name = `${base}-${i}`;
  const dest = safeJoin(serverDir(id), name);
  for (const entry of zip.getEntries()) {
    if (!entry.entryName.startsWith(prefix) || entry.isDirectory) continue;
    const rel = entry.entryName.slice(prefix.length);
    if (!rel) continue;
    const target = safeJoin(dest, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, entry.getData());
  }
  return name;
}
