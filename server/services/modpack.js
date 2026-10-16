import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import AdmZip from 'adm-zip';
import { DATA_DIR, serverDir } from '../config.js';
import { db, getServer, updateServer } from '../db.js';
import { download, getJson } from '../lib/http.js';
import { HttpError, safeJoin } from '../lib/util.js';
import { writeNbt } from '../lib/nbt.js';
import { createServerRecord } from './serverFactory.js';
import { startInstall, isInstalling } from './installer.js';
import { isRunning } from './processManager.js';
import { readProperties } from './properties.js';
import * as curseforge from './curseforge.js';

/**
 * Modpacks de Modrinth y de CurseForge.
 *
 *  - Modrinth (.mrpack): zip con modrinth.index.json (versión de Minecraft, loader y la lista de mods
 *    con URL y hash), más overrides/ y server-overrides/. Cada archivo dice si sirve en el servidor.
 *  - CurseForge (.zip): zip con manifest.json (versión, loader y los mods como projectID + fileID)
 *    y una carpeta de overrides. No dice qué mods son solo del cliente: el panel revisa cada jar.
 *
 * Los mods que solo sirven en el juego (shaders, minimapas, mejoras gráficas) se omiten en el servidor
 * porque lo harían fallar. Para los jugadores, el panel arma un archivo con el modpack completo.
 */

const MODRINTH = 'https://api.modrinth.com/v2';
const PACK_DIR = path.join(DATA_DIR, 'modpacks');
fs.mkdirSync(PACK_DIR, { recursive: true });

const MR_LOADERS = { 'fabric-loader': 'fabric', forge: 'forge', neoforge: 'neoforge' };
const MR_LOADER_KEY = { fabric: 'fabric-loader', forge: 'forge', neoforge: 'neoforge' };
const LOADER_NAME = { fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge', quilt: 'Quilt' };

// --- Leer un modpack ------------------------------------------------------------------

/** Abre el zip y reconoce el formato. */
export function readPack(packPath) {
  let zip;
  try {
    zip = new AdmZip(packPath);
  } catch {
    throw new HttpError(400, 'El archivo no es un modpack válido (no se pudo abrir como .zip)');
  }
  const json = (name) => {
    const entry = zip.getEntry(name);
    if (!entry) return null;
    try {
      return JSON.parse(entry.getData().toString('utf8').replace(/^﻿/, ''));
    } catch {
      throw new HttpError(400, `El archivo ${name} del modpack está dañado`);
    }
  };
  const mr = json('modrinth.index.json');
  if (mr) return { zip, format: 'mrpack', index: mr };
  const cf = json('manifest.json');
  if (cf?.minecraft) return { zip, format: 'curseforge', index: cf };
  const names = zip.getEntries().map((e) => e.entryName);
  if (names.some((n) => /^([^/]+\/)?mods\/[^/]+\.jar$/i.test(n))) {
    throw new HttpError(
      400,
      'Ese archivo parece un "server pack" (trae los mods ya listos). Usa el archivo normal del modpack: el .mrpack de Modrinth o el .zip de CurseForge que se instala en el CurseForge App.'
    );
  }
  throw new HttpError(400, 'No es un modpack de Modrinth (.mrpack) ni de CurseForge (.zip con manifest.json)');
}

/** Qué servidor hace falta para este modpack. */
export function planFromPack({ format, index }) {
  if (format === 'curseforge') {
    const mcVersion = index.minecraft?.version;
    if (!mcVersion) throw new HttpError(400, 'El modpack no indica la versión de Minecraft');
    const loaders = index.minecraft.modLoaders || [];
    const primary = loaders.find((l) => l.primary) || loaders[0];
    const [kind, ...rest] = String(primary?.id || '').split('-');
    const type = { forge: 'forge', neoforge: 'neoforge', fabric: 'fabric' }[kind];
    if (kind === 'quilt') throw new HttpError(400, 'Este modpack usa Quilt, que el panel todavía no soporta. Busca una versión para Fabric.');
    if (!type) throw new HttpError(400, 'El modpack no indica Fabric, Forge ni NeoForge');
    const files = (index.files || []).filter((f) => f.required !== false);
    return {
      format,
      name: index.name || 'Modpack',
      packVersion: index.version || null,
      summary: index.author ? `de ${index.author}` : '',
      mcVersion,
      type,
      loaderVersion: rest.join('-'),
      serverFiles: files.length,
      // CurseForge no marca los mods de cliente: se sabe al descargarlos.
      skippedClientFiles: null,
    };
  }
  const deps = index.dependencies || {};
  const mcVersion = deps.minecraft;
  if (!mcVersion) throw new HttpError(400, 'El modpack no indica la versión de Minecraft');
  if (deps['quilt-loader']) throw new HttpError(400, 'Este modpack usa Quilt, que el panel todavía no soporta. Busca una versión para Fabric.');
  const loaderKey = Object.keys(MR_LOADERS).find((k) => deps[k]);
  if (!loaderKey) throw new HttpError(400, 'El modpack no indica Fabric, Forge ni NeoForge');
  const files = (index.files || []).filter((f) => f.env?.server !== 'unsupported');
  return {
    format,
    name: index.name || 'Modpack',
    packVersion: index.versionId || null,
    summary: index.summary || '',
    mcVersion,
    type: MR_LOADERS[loaderKey],
    loaderVersion: deps[loaderKey],
    serverFiles: files.length,
    skippedClientFiles: (index.files || []).length - files.length,
  };
}

export function inspect(packPath) {
  return planFromPack(readPack(packPath));
}

/** El archivo del modpack guardado para cada servidor (.mrpack o .zip). */
export function packFile(id) {
  for (const ext of ['.mrpack', '.zip']) {
    const f = path.join(PACK_DIR, `${id}${ext}`);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

function storePack(id, src, format) {
  for (const ext of ['.mrpack', '.zip']) fs.rmSync(path.join(PACK_DIR, `${id}${ext}`), { force: true });
  const dest = path.join(PACK_DIR, `${id}${format === 'curseforge' ? '.zip' : '.mrpack'}`);
  try {
    fs.renameSync(src, dest);
  } catch {
    fs.copyFileSync(src, dest);
    fs.rmSync(src, { force: true });
  }
  return dest;
}

export function removePack(id) {
  for (const ext of ['.mrpack', '.zip']) fs.rmSync(path.join(PACK_DIR, `${id}${ext}`), { force: true });
}

export function copyPack(fromId, toId) {
  const src = packFile(fromId);
  if (src) fs.copyFileSync(src, path.join(PACK_DIR, `${toId}${path.extname(src)}`));
}

/** Crea el servidor a partir de un modpack ya guardado en disco. */
export async function createFromPack(packPath, { name, memoryMb = 6144, port, eula, source = null }) {
  const plan = planFromPack(readPack(packPath));
  const server = await createServerRecord({
    name: name || plan.name,
    type: plan.type,
    mcVersion: plan.mcVersion,
    loaderVersion: plan.loaderVersion,
    memoryMb,
    port,
    eula,
    extra: { modpack: { name: plan.name, version: plan.packVersion, format: plan.format, source, pendingApply: true } },
  });
  storePack(server.id, packPath, plan.format);
  startInstall(server.id);
  return server;
}

// --- Buscar y descargar -----------------------------------------------------------------

export async function searchModpacks({ source = 'modrinth', query = '', offset = 0, limit = 20, sort = 'downloads' }) {
  if (source === 'curseforge') return curseforge.searchModpacks({ query, offset, limit, sort });
  const facets = [['project_type:modpack'], ['server_side:required', 'server_side:optional'], ['categories:fabric', 'categories:forge', 'categories:neoforge']];
  const params = new URLSearchParams({ query, offset: String(Number(offset) || 0), limit: String(Math.min(Number(limit) || 20, 50)), index: sort, facets: JSON.stringify(facets) });
  const data = await getJson(`${MODRINTH}/search?${params}`);
  return {
    total: data.total_hits,
    results: data.hits.map((h) => ({
      source: 'modrinth',
      id: h.project_id,
      slug: h.slug,
      title: h.title,
      description: h.description,
      author: h.author,
      icon: h.icon_url || null,
      downloads: h.downloads,
      updated: h.date_modified,
      versions: h.versions?.slice(-3) || [],
      loaders: (h.categories || []).filter((c) => ['fabric', 'forge', 'neoforge', 'quilt'].includes(c)),
      url: `https://modrinth.com/modpack/${h.slug}`,
    })),
  };
}

export async function modpackVersions(projectId, source = 'modrinth') {
  if (source === 'curseforge') return curseforge.modpackFiles(projectId);
  const list = await getJson(`${MODRINTH}/project/${encodeURIComponent(projectId)}/version`);
  return list
    .filter((v) => (v.loaders || []).some((l) => ['fabric', 'forge', 'neoforge'].includes(l)))
    .map((v) => ({
      id: v.id,
      name: v.name,
      number: v.version_number,
      type: v.version_type,
      date: v.date_published,
      gameVersions: v.game_versions || [],
      loaders: v.loaders,
      file: v.files.find((f) => f.primary) || v.files[0],
    }))
    .slice(0, 40);
}

/** Descarga el archivo del modpack (Modrinth o CurseForge). */
export async function downloadPack(source, projectId, versionId) {
  const versions = await modpackVersions(projectId, source);
  const version = versionId ? versions.find((v) => v.id === String(versionId)) : versions.find((v) => v.type === 'release') || versions[0];
  if (!version) throw new HttpError(404, 'Esa versión del modpack ya no está disponible');
  if (!version.file?.url) {
    if (source === 'curseforge') {
      throw new HttpError(
        422,
        `El autor de este modpack no permite descargarlo desde otras apps. Descárgalo de ${version.externalUrl} y súbelo en "Subir archivo".`
      );
    }
    throw new HttpError(404, 'Esa versión no tiene archivo descargable');
  }
  const dest = path.join(PACK_DIR, `descarga-${crypto.randomUUID()}${source === 'curseforge' ? '.zip' : '.mrpack'}`);
  await download(version.file.url, dest);
  return { path: dest, version };
}

// --- Instalar el contenido en el servidor ------------------------------------------------

const hash = (algo, file) => crypto.createHash(algo).update(fs.readFileSync(file)).digest('hex');

async function pool(items, size, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/** Copia una carpeta del zip; devuelve las rutas escritas. */
function extractFolder(zip, prefix, dest) {
  const written = [];
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory || !entry.entryName.startsWith(prefix)) continue;
    const rel = entry.entryName.slice(prefix.length);
    if (!rel) continue;
    let target;
    try {
      target = safeJoin(dest, rel);
    } catch {
      continue; // ruta que intenta salir de la carpeta: se ignora
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, entry.getData());
    written.push(rel.replace(/\\/g, '/'));
  }
  return written;
}

// Dominios que permite el formato .mrpack de Modrinth: un modpack no puede hacer que el panel
// descargue de cualquier sitio (ni de equipos de tu red).
const ALLOWED_HOSTS = new Set(['cdn.modrinth.com', 'github.com', 'raw.githubusercontent.com', 'gitlab.com']);
function allowedDownload(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && ALLOWED_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

// Mods de Forge/NeoForge muy usados que solo funcionan en el juego y no lo declaran en su archivo.
const CLIENT_ONLY_IDS = new Set([
  'oculus',
  'embeddium',
  'embeddiumplus',
  'rubidium',
  'optifine',
  'entityculling',
  'notenoughanimations',
  'legendarytooltips',
  'fancymenu',
  'drippyloadingscreen',
  'skinlayers3d',
  'dynamiclightsreforged',
  'betterthirdperson',
  'sound_physics_remastered',
  'chat_heads',
  'itemborders',
  'betterf3',
  'particlerain',
  'ryoamiclights',
]);

/** ¿Este jar es un mod que solo funciona en el juego (y haría fallar al servidor)? */
export function isClientOnlyJar(file) {
  let zip;
  try {
    zip = new AdmZip(file);
  } catch {
    return false;
  }
  const text = (name) => zip.getEntry(name)?.getData().toString('utf8') || null;
  const fabric = text('fabric.mod.json');
  if (fabric) {
    try {
      // Algunos mods traen saltos de línea dentro de los textos; JSON los rechaza.
      const json = JSON.parse(fabric.replace(/[\u0000-\u001f]+/g, ' '));
      if (json.environment === 'client') return true;
    } catch {
      if (/"environment"\s*:\s*"client"/.test(fabric)) return true;
    }
  }
  const quilt = text('quilt.mod.json');
  if (quilt && /"environment"\s*:\s*"client"/.test(quilt)) return true;
  for (const toml of ['META-INF/neoforge.mods.toml', 'META-INF/mods.toml']) {
    const t = text(toml);
    if (!t) continue;
    if (/^\s*clientSideOnly\s*=\s*true/m.test(t)) return true;
    const ids = [...t.matchAll(/^\s*modId\s*=\s*"([^"]+)"/gm)].map((m) => m[1].toLowerCase());
    if (ids.length && ids.every((i) => CLIENT_ONLY_IDS.has(i))) return true;
  }
  return false;
}

/** Trabajos de descarga de un .mrpack. */
function mrpackJobs(index) {
  const jobs = [];
  let skipped = 0;
  for (const f of index.files || []) {
    if (f.env?.server === 'unsupported') {
      skipped++;
      continue;
    }
    const url = (f.downloads || []).find((u) => /cdn\.modrinth\.com\/data\//.test(u)) || '';
    const m = url.match(/cdn\.modrinth\.com\/data\/([A-Za-z0-9]+)\/versions\/([A-Za-z0-9]+)\//);
    jobs.push({
      path: f.path,
      urls: f.downloads || [],
      sha1: f.hashes?.sha1 || null,
      record: m ? { source: 'modrinth', projectId: m[1], versionId: m[2], title: path.basename(f.path).replace(/\.jar$/, ''), icon: null } : null,
    });
  }
  return { jobs, skipped, failed: [] };
}

/** Trabajos de descarga de un modpack de CurseForge (pregunta a la API por cada archivo). */
async function curseforgeJobs(index, server, report) {
  const wanted = (index.files || []).filter((f) => f.required !== false && f.fileID);
  if (!wanted.length) return { jobs: [], skipped: 0, failed: [] };
  if (!curseforge.hasKey()) {
    throw new HttpError(409, 'Para instalar modpacks de CurseForge agrega tu clave de CurseForge en Ajustes del panel (es gratis).');
  }
  report({ message: 'Consultando los mods del modpack en CurseForge…', progress: null });
  const [files, mods] = await Promise.all([
    curseforge.filesInfo(wanted.map((f) => Number(f.fileID))),
    curseforge.modsInfo([...new Set(wanted.map((f) => Number(f.projectID)))]),
  ]);
  const level = readProperties(server.id)['level-name'] || 'world';
  const jobs = [];
  const failed = [];
  let skipped = 0;
  for (const w of wanted) {
    const f = files.get(Number(w.fileID));
    const mod = mods.get(Number(w.projectID));
    const classId = mod?.classId;
    // Paquetes de texturas y shaders solo sirven en el juego.
    if (classId === curseforge.CLASS_IDS.resourcepack || classId === curseforge.CLASS_IDS.shader) {
      skipped++;
      continue;
    }
    if (!f) {
      failed.push(`${mod?.name || `Proyecto ${w.projectID}`}: CurseForge ya no tiene ese archivo`);
      continue;
    }
    const folder = classId === curseforge.CLASS_IDS.datapack ? `${level}/datapacks` : 'mods';
    if (!f.downloadUrl) {
      failed.push(`${mod?.name || f.fileName}: su autor no permite descargarlo desde otras apps. Bájalo de ${mod ? curseforge.fileUrl(mod, f.id) : 'CurseForge'} y súbelo en Archivos (carpeta ${folder}).`);
      continue;
    }
    jobs.push({
      path: `${folder}/${f.fileName}`,
      cf: { projectID: Number(w.projectID), fileID: Number(w.fileID) },
      urls: [f.downloadUrl],
      sha1: f.hashes?.find((h) => h.algo === 1)?.value || null,
      trusted: true, // viene de la API de CurseForge, no del archivo
      record:
        folder === 'mods'
          ? { source: 'curseforge', projectId: String(w.projectID), versionId: String(w.fileID), title: mod?.name || f.fileName, icon: mod?.logo?.thumbnailUrl || null }
          : null,
    });
  }
  return { jobs, skipped, failed };
}

/** Descarga los mods del modpack y copia sus overrides en la carpeta del servidor. */
export async function applyModpack(id, report = () => {}) {
  const server = getServer(id);
  const packPath = packFile(id);
  if (!packPath) throw new HttpError(404, 'No se encontró el archivo del modpack');
  const pack = readPack(packPath);
  const dir = serverDir(id);
  const plan = pack.format === 'curseforge' ? await curseforgeJobs(pack.index, server, report) : mrpackJobs(pack.index);
  const { jobs } = plan;
  const failed = [...plan.failed];
  const clientOnly = [];
  const installed = [];
  const records = [];
  // CurseForge identifica los mods por número: se guarda qué archivo es cada uno (para el paquete de jugadores).
  const fileMap = Object.fromEntries(jobs.filter((j) => j.cf).map((j) => [j.path, j.cf]));

  let done = 0;
  await pool(jobs, 6, async (job) => {
    let target;
    try {
      target = safeJoin(dir, job.path);
    } catch {
      failed.push(`${job.path}: ruta no permitida`);
      done++;
      return;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    let ok = false;
    for (const url of job.urls) {
      try {
        if (!job.trusted && !allowedDownload(url)) throw new Error('enlace no permitido (solo Modrinth, GitHub o GitLab)');
        await download(url, target);
        if (job.sha1 && hash('sha1', target) !== job.sha1) throw new Error('el archivo descargado no coincide (hash)');
        ok = true;
        break;
      } catch (err) {
        fs.rmSync(target, { force: true });
        if (url === job.urls.at(-1)) failed.push(`${job.path}: ${err.message}`);
      }
    }
    if (!ok && !job.urls.length) failed.push(`${job.path}: sin enlace de descarga`);
    if (ok && /^mods\/[^/]+\.jar$/i.test(job.path) && isClientOnlyJar(target)) {
      fs.rmSync(target, { force: true });
      clientOnly.push(path.basename(job.path));
      ok = false;
    }
    if (ok) {
      installed.push(job.path);
      if (job.record && /^mods\//.test(job.path)) {
        records.push({ ...job.record, versionName: null, filename: path.basename(job.path), installedAt: new Date().toISOString(), dependency: false, managedBy: 'modpack' });
      }
    }
    done++;
    report({ message: `Descargando mods del modpack (${done}/${jobs.length})…`, progress: done / jobs.length });
  });

  report({ message: 'Copiando la configuración del modpack…', progress: null });
  const overrideDirs = pack.format === 'curseforge' ? [`${String(pack.index.overrides || 'overrides').replace(/\/$/, '')}/`] : ['overrides/', 'server-overrides/'];
  for (const prefix of overrideDirs) {
    for (const rel of extractFolder(pack.zip, prefix, dir)) {
      // Algunos modpacks traen mods dentro de overrides: también se revisan.
      if (/^mods\/[^/]+\.jar$/i.test(rel)) {
        if (isClientOnlyJar(path.join(dir, rel))) {
          fs.rmSync(path.join(dir, rel), { force: true });
          clientOnly.push(path.basename(rel));
        } else installed.push(rel);
      }
    }
  }

  const fresh = getServer(id);
  fresh.content = [...(fresh.content || []).filter((r) => !records.some((n) => n.filename === r.filename)), ...records];
  fresh.modpack = {
    ...fresh.modpack,
    format: pack.format,
    pendingApply: false,
    appliedAt: new Date().toISOString(),
    failed,
    clientOnly: [...new Set(clientOnly)].sort(),
    skippedClient: plan.skipped,
    files: [...new Set(installed)],
    ...(Object.keys(fileMap).length ? { fileMap } : {}),
  };
  db.flush();
  if (failed.length) {
    report({ message: `${failed.length} archivo(s) del modpack no se pudieron descargar. Revisa la pestaña Mods.`, progress: 1 });
  }
  return { files: jobs.length, failed, clientOnly };
}

// --- Actualizar un modpack instalado ------------------------------------------------------

function requireServer(id) {
  const server = getServer(id);
  if (!server) throw new HttpError(404, 'Servidor no encontrado');
  return server;
}

const projectPage = (source) =>
  !source?.projectId ? null : source.site === 'curseforge' ? source.url || null : `https://modrinth.com/modpack/${source.projectId}`;

/** Información del modpack del servidor y versiones más nuevas. */
export async function modpackStatus(id) {
  const server = requireServer(id);
  const mp = server.modpack;
  const base = { type: server.type, mods: ['fabric', 'forge', 'neoforge'].includes(server.type), address: await shareAddress(server) };
  if (!mp) return { ...base, modpack: null };
  const source = mp.source || null;
  const site = source ? source.site || 'modrinth' : null;
  let updates = [];
  let updatesError = null;
  if (source?.projectId) {
    try {
      const versions = await modpackVersions(source.projectId, site);
      const current = versions.findIndex((v) => v.id === String(source.versionId));
      const newer = current === -1 ? versions.slice(0, 5) : versions.slice(0, current);
      updates = newer.map((v) => ({
        id: v.id,
        number: v.number,
        type: v.type,
        date: v.date,
        gameVersions: v.gameVersions,
        loaders: v.loaders,
        compatible: !v.loaders?.length || v.loaders.includes(server.type),
      }));
    } catch (err) {
      updatesError = err.message;
    }
  }
  return {
    ...base,
    modpack: {
      name: mp.name,
      version: mp.version,
      format: mp.format || 'mrpack',
      site,
      page: projectPage(source),
      appliedAt: mp.appliedAt || null,
      pending: Boolean(mp.pendingApply),
      failed: mp.failed || [],
      clientOnly: mp.clientOnly || [],
      hasFile: Boolean(packFile(id)),
    },
    updates,
    updatesError,
  };
}

/**
 * Cambia el modpack del servidor a otra versión (descargada o subida):
 * respaldo completo, quita los archivos de la versión anterior y vuelve a instalar.
 * El mundo y los mods que agregaste tú se quedan.
 */
export async function updateModpack(id, { versionId, uploadedPath } = {}) {
  const server = requireServer(id);
  const cleanup = () => uploadedPath && fs.rmSync(uploadedPath, { force: true });
  if (isRunning(id)) {
    cleanup();
    throw new HttpError(409, 'Apaga el servidor antes de actualizar el modpack');
  }
  if (isInstalling(id)) {
    cleanup();
    throw new HttpError(409, 'Espera a que termine la instalación');
  }
  const mp = server.modpack;
  if (!mp && !uploadedPath) throw new HttpError(409, 'Este servidor no se creó con un modpack');

  let newPath = uploadedPath;
  let source = mp?.source || null;
  if (!uploadedPath) {
    if (!source?.projectId) throw new HttpError(400, 'Este modpack se subió como archivo: sube el archivo de la versión nueva');
    const dl = await downloadPack(source.site || 'modrinth', source.projectId, versionId);
    newPath = dl.path;
    source = { ...source, versionId: dl.version.id };
  }

  let plan;
  try {
    plan = planFromPack(readPack(newPath));
    if (plan.type !== server.type) {
      throw new HttpError(400, `Esa versión del modpack usa ${LOADER_NAME[plan.type]} y tu servidor es ${LOADER_NAME[server.type] || server.type}. Crea un servidor nuevo con ella.`);
    }
  } catch (err) {
    fs.rmSync(newPath, { force: true });
    throw err;
  }
  if (uploadedPath && mp?.source && plan.name !== mp.name) source = null; // otro modpack: ya no se busca en la tienda

  const { createBackup } = await import('./backups.js');
  await createBackup(id, 'completo', 'antes-de-actualizar-modpack');

  // Quita los archivos que puso la versión anterior (no toca los que agregaste tú).
  const dir = serverDir(id);
  const oldFiles = mp?.files?.length ? mp.files : (server.content || []).filter((r) => r.managedBy === 'modpack').map((r) => `mods/${r.filename}`);
  for (const rel of oldFiles) {
    try {
      const abs = safeJoin(dir, rel);
      fs.rmSync(abs, { force: true });
      fs.rmSync(`${abs}.disabled`, { force: true });
    } catch {
      /* ruta rara: se ignora */
    }
  }
  server.content = (server.content || []).filter((r) => r.managedBy !== 'modpack');

  storePack(id, newPath, plan.format);
  updateServer(id, {
    mcVersion: plan.mcVersion,
    loaderVersion: plan.loaderVersion,
    javaMajor: null,
    modpack: {
      ...(mp || {}),
      name: plan.name,
      version: plan.packVersion,
      format: plan.format,
      source,
      pendingApply: true,
      files: [],
      previousVersion: mp?.version || null,
      updatedAt: new Date().toISOString(),
    },
  });
  db.flush();
  startInstall(id);
  return { mcVersion: plan.mcVersion, changedMinecraft: plan.mcVersion !== server.mcVersion, version: plan.packVersion };
}

// --- Para los jugadores ----------------------------------------------------------------

/** La dirección que tus amigos escriben para entrar (dominio, túnel de playit o tu IP). */
export async function shareAddress(server) {
  const applied = server.dns?.enabled && server.dns.applied?.ok ? server.dns.applied : null;
  if (applied?.java?.address && !applied.java.unsupported) return applied.java.address;
  if (server.playit?.enabled) {
    try {
      const { serverTunnels } = await import('./playit.js');
      const t = await serverTunnels(server.id);
      if (t.java?.address) return t.java.address;
    } catch {
      /* sin playit */
    }
  }
  try {
    const { publicIp } = await import('./network.js');
    const ip = await publicIp();
    if (ip) return Number(server.port) === 25565 ? ip : `${ip}:${server.port}`;
  } catch {
    /* sin internet */
  }
  return null;
}

/** servers.dat con el servidor ya agregado a la lista de "Multijugador". */
function serversDat(name, address) {
  return writeNbt({
    compression: 'none',
    rootName: '',
    root: {
      type: 'compound',
      value: [
        {
          name: 'servers',
          type: 'list',
          listType: 'compound',
          value: [{ type: 'compound', value: [{ name: 'name', type: 'string', value: name }, { name: 'ip', type: 'string', value: address }] }],
        },
      ],
    },
  });
}

/** Datos de Modrinth para los mods que agregaste (para enlazarlos en vez de copiarlos). */
async function modrinthExtras(records) {
  const out = new Map();
  if (!records.length) return out;
  const q = (ids) => encodeURIComponent(JSON.stringify(ids));
  try {
    const [projects, versions] = await Promise.all([
      getJson(`${MODRINTH}/projects?ids=${q([...new Set(records.map((r) => r.projectId))])}`),
      getJson(`${MODRINTH}/versions?ids=${q([...new Set(records.map((r) => r.versionId))])}`),
    ]);
    for (const r of records) {
      const p = projects.find((x) => x.id === r.projectId || x.slug === r.projectId);
      const v = versions.find((x) => x.id === r.versionId);
      const file = v?.files?.find((f) => f.filename === r.filename) || v?.files?.find((f) => f.primary);
      if (p && file?.url) out.set(r.filename, { clientSide: p.client_side, url: file.url });
    }
  } catch {
    /* sin Modrinth: se copian dentro del archivo */
  }
  return out;
}

/**
 * Arma el modpack para los jugadores: el original (con sus mods del juego) más los mods que
 * agregaste al servidor, y la dirección del servidor ya puesta en la lista de Multijugador.
 */
/**
 * ¿Este archivo del modpack se instaló en el servidor y luego se quitó o desactivó?
 * Los mods solo de cliente, los que no se pudieron descargar y lo que nunca fue al servidor se conservan.
 */
function droppedFromServer(dir, mp, rel) {
  if (!mp?.files || !/^mods\/[^/]+\.jar$/i.test(rel)) return false;
  if ((mp.clientOnly || []).includes(path.basename(rel))) return false;
  if (!mp.files.includes(rel)) return false;
  return !fs.existsSync(path.join(dir, rel));
}

export async function playersPack(id) {
  const server = requireServer(id);
  if (!['fabric', 'forge', 'neoforge'].includes(server.type)) {
    throw new HttpError(400, 'Este servidor no usa mods: tus amigos entran con Minecraft normal, sin instalar nada.');
  }
  const dir = serverDir(id);
  const mp = server.modpack;
  const packPath = mp ? packFile(id) : null;
  const base = packPath ? readPack(packPath) : null;
  const format = base?.format || 'mrpack';

  // Mods del servidor que no vienen en el modpack.
  const { listInstalled } = await import('./marketplace.js');
  const fromPack = new Set((mp?.files || []).map((f) => path.basename(f)));
  for (const r of server.content || []) if (r.managedBy === 'modpack') fromPack.add(r.filename);
  const records = new Map((server.content || []).map((r) => [r.filename, r]));
  const extras = listInstalled(id).items.filter((i) => i.enabled && !fromPack.has(i.filename) && i.managedBy !== 'bedrock');
  const mrRecords = extras.map((i) => records.get(i.filename)).filter((r) => r?.source === 'modrinth' && r.versionId);
  const mrInfo = format === 'mrpack' ? await modrinthExtras(mrRecords) : new Map();

  const out = new AdmZip();
  const overrides = format === 'curseforge' ? String(base.index.overrides || 'overrides').replace(/\/$/, '') : 'overrides';
  const summary = { linked: [], embedded: [], serverOnly: [], removed: [] };
  const dropped = (rel) => {
    if (!droppedFromServer(dir, mp, rel)) return false;
    summary.removed.push(path.basename(rel));
    return true;
  };
  if (base) {
    for (const e of base.zip.getEntries()) {
      if (e.isDirectory || e.entryName === 'modrinth.index.json' || e.entryName === 'manifest.json') continue;
      if (e.entryName.startsWith('server-overrides/')) continue; // solo para el servidor
      // Mods del modpack que se quitaron o desactivaron en el servidor tampoco van para los jugadores.
      if (e.entryName.startsWith(`${overrides}/mods/`) && dropped(e.entryName.slice(overrides.length + 1))) continue;
      out.addFile(e.entryName, e.getData());
    }
  }

  let index;
  if (format === 'curseforge') {
    index = structuredClone(base.index);
    const byIds = new Map(Object.entries(mp?.fileMap || {}).map(([rel, ids]) => [`${ids.projectID}:${ids.fileID}`, rel]));
    index.files = (index.files || []).filter((f) => {
      const rel = byIds.get(`${f.projectID}:${f.fileID}`);
      return !rel || !dropped(rel);
    });
    for (const item of extras) {
      const r = records.get(item.filename);
      if (r?.source === 'curseforge' && r.versionId) {
        index.files.push({ projectID: Number(r.projectId), fileID: Number(r.versionId), required: true });
        summary.linked.push(item.title);
      } else {
        out.addFile(`${overrides}/mods/${item.filename}`, fs.readFileSync(path.join(dir, 'mods', item.filename)));
        summary.embedded.push(item.title);
      }
    }
  } else {
    index = base
      ? structuredClone(base.index)
      : {
          formatVersion: 1,
          game: 'minecraft',
          versionId: new Date().toISOString().slice(0, 10),
          name: server.name,
          summary: `Mods del servidor ${server.name}`,
          dependencies: { minecraft: server.mcVersion, [MR_LOADER_KEY[server.type]]: server.loaderVersion },
          files: [],
        };
    index.files = (index.files || []).filter((f) => !dropped(f.path));
    for (const item of extras) {
      const file = path.join(dir, 'mods', item.filename);
      const info = mrInfo.get(item.filename);
      if (info?.clientSide === 'unsupported') {
        summary.serverOnly.push(item.title); // p. ej. mods de rendimiento solo para el servidor
        continue;
      }
      if (info) {
        index.files.push({
          path: `mods/${item.filename}`,
          hashes: { sha1: hash('sha1', file), sha512: hash('sha512', file) },
          env: { client: info.clientSide === 'optional' ? 'optional' : 'required', server: 'required' },
          downloads: [info.url],
          fileSize: fs.statSync(file).size,
        });
        summary.linked.push(item.title);
      } else {
        out.addFile(`overrides/mods/${item.filename}`, fs.readFileSync(file));
        summary.embedded.push(item.title);
      }
    }
  }

  const address = await shareAddress(server);
  if (address) out.addFile(`${overrides}/servers.dat`, serversDat(server.name, address));
  out.addFile(format === 'curseforge' ? 'manifest.json' : 'modrinth.index.json', Buffer.from(JSON.stringify(index, null, 2)));

  const name = `${(mp?.name || server.name).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim() || 'modpack'} - para jugadores`;
  return { filename: `${name}${format === 'curseforge' ? '.zip' : '.mrpack'}`, format, buffer: out.toBuffer(), address, summary };
}
