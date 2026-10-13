import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import AdmZip from 'adm-zip';
import { DATA_DIR, serverDir } from '../config.js';
import { db, getServer } from '../db.js';
import { download, getJson } from '../lib/http.js';
import { HttpError, safeJoin } from '../lib/util.js';
import { createServerRecord } from './serverFactory.js';
import { startInstall } from './installer.js';

/**
 * Modpacks de Modrinth (.mrpack). Un .mrpack es un zip con:
 *  - modrinth.index.json: versión de Minecraft, loader y la lista de mods (con URL y hash)
 *  - overrides/ y server-overrides/: configuraciones y archivos extra
 * Los archivos marcados como "unsupported" en el servidor (shaders, minimapas…) se omiten.
 */

const MODRINTH = 'https://api.modrinth.com/v2';
const PACK_DIR = path.join(DATA_DIR, 'modpacks');
fs.mkdirSync(PACK_DIR, { recursive: true });

const LOADERS = {
  'fabric-loader': 'fabric',
  forge: 'forge',
  neoforge: 'neoforge',
};

export function readIndex(packPath) {
  let zip;
  try {
    zip = new AdmZip(packPath);
  } catch {
    throw new HttpError(400, 'El archivo no es un .mrpack válido');
  }
  const entry = zip.getEntry('modrinth.index.json');
  if (!entry) throw new HttpError(400, 'El archivo no es un modpack de Modrinth (.mrpack): falta modrinth.index.json');
  let index;
  try {
    index = JSON.parse(entry.getData().toString('utf8'));
  } catch {
    throw new HttpError(400, 'El índice del modpack está dañado');
  }
  return { zip, index };
}

/** Qué servidor hace falta para este modpack. */
export function planFromIndex(index) {
  const deps = index.dependencies || {};
  const mcVersion = deps.minecraft;
  if (!mcVersion) throw new HttpError(400, 'El modpack no indica la versión de Minecraft');
  if (deps['quilt-loader']) throw new HttpError(400, 'Este modpack usa Quilt, que el panel todavía no soporta. Busca una versión para Fabric.');
  const loaderKey = Object.keys(LOADERS).find((k) => deps[k]);
  if (!loaderKey) throw new HttpError(400, 'El modpack no indica Fabric, Forge ni NeoForge');
  const files = (index.files || []).filter((f) => f.env?.server !== 'unsupported');
  return {
    name: index.name || 'Modpack',
    packVersion: index.versionId || null,
    summary: index.summary || '',
    mcVersion,
    type: LOADERS[loaderKey],
    loaderVersion: deps[loaderKey],
    serverFiles: files.length,
    skippedClientFiles: (index.files || []).length - files.length,
  };
}

export function inspect(packPath) {
  return planFromIndex(readIndex(packPath).index);
}

/** Crea el servidor a partir de un .mrpack ya guardado en disco. */
export async function createFromPack(packPath, { name, memoryMb = 6144, port, eula, source = null }) {
  const plan = planFromIndex(readIndex(packPath).index);
  const server = await createServerRecord({
    name: name || plan.name,
    type: plan.type,
    mcVersion: plan.mcVersion,
    loaderVersion: plan.loaderVersion,
    memoryMb,
    port,
    eula,
    extra: { modpack: { name: plan.name, version: plan.packVersion, source, pendingApply: true } },
  });
  fs.renameSync(packPath, path.join(PACK_DIR, `${server.id}.mrpack`));
  startInstall(server.id);
  return server;
}

// --- Modrinth ------------------------------------------------------------------

export async function searchModpacks({ query = '', offset = 0, limit = 20, sort = 'downloads' }) {
  const facets = [['project_type:modpack'], ['server_side:required', 'server_side:optional'], ['categories:fabric', 'categories:forge', 'categories:neoforge']];
  const params = new URLSearchParams({ query, offset: String(Number(offset) || 0), limit: String(Math.min(Number(limit) || 20, 50)), index: sort, facets: JSON.stringify(facets) });
  const data = await getJson(`${MODRINTH}/search?${params}`);
  return {
    total: data.total_hits,
    results: data.hits.map((h) => ({
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

export async function modpackVersions(projectId) {
  const list = await getJson(`${MODRINTH}/project/${encodeURIComponent(projectId)}/version`);
  return list
    .filter((v) => v.loaders.some((l) => ['fabric', 'forge', 'neoforge'].includes(l)))
    .map((v) => ({
      id: v.id,
      name: v.name,
      number: v.version_number,
      type: v.version_type,
      date: v.date_published,
      gameVersions: v.game_versions,
      loaders: v.loaders,
      file: v.files.find((f) => f.primary) || v.files[0],
    }))
    .slice(0, 40);
}

export async function downloadFromModrinth(projectId, versionId) {
  const versions = await modpackVersions(projectId);
  const version = versionId ? versions.find((v) => v.id === versionId) : versions.find((v) => v.type === 'release') || versions[0];
  if (!version?.file) throw new HttpError(404, 'No hay una versión de este modpack compatible con Fabric, Forge o NeoForge');
  const dest = path.join(PACK_DIR, `descarga-${crypto.randomUUID()}.mrpack`);
  await download(version.file.url, dest);
  return { path: dest, version };
}

// --- Instalación del contenido ----------------------------------------------

function sha1(file) {
  return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
}

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

function extractFolder(zip, prefix, dest) {
  let count = 0;
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory || !entry.entryName.startsWith(prefix)) continue;
    const rel = entry.entryName.slice(prefix.length);
    if (!rel) continue;
    const target = safeJoin(dest, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, entry.getData());
    count++;
  }
  return count;
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

/** Descarga los mods del modpack y copia sus overrides en la carpeta del servidor. */
export async function applyModpack(id, report = () => {}) {
  const server = getServer(id);
  const packPath = path.join(PACK_DIR, `${id}.mrpack`);
  if (!fs.existsSync(packPath)) throw new HttpError(404, 'No se encontró el archivo del modpack');
  const { zip, index } = readIndex(packPath);
  const dir = serverDir(id);
  const files = (index.files || []).filter((f) => f.env?.server !== 'unsupported');

  let done = 0;
  const failed = [];
  const records = [];
  await pool(files, 6, async (file) => {
    let target;
    try {
      target = safeJoin(dir, file.path);
    } catch {
      failed.push(`${file.path}: ruta no permitida`);
      done++;
      return;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    let ok = false;
    for (const url of file.downloads || []) {
      try {
        if (!allowedDownload(url)) throw new Error('enlace no permitido (solo Modrinth, GitHub o GitLab)');
        await download(url, target);
        if (file.hashes?.sha1 && sha1(target) !== file.hashes.sha1) throw new Error('el archivo descargado no coincide (hash)');
        ok = true;
        const m = url.match(/cdn\.modrinth\.com\/data\/([A-Za-z0-9]+)\/versions\/([A-Za-z0-9]+)\//);
        if (m && /^mods\//.test(file.path)) {
          records.push({
            source: 'modrinth',
            projectId: m[1],
            versionId: m[2],
            versionName: null,
            title: path.basename(file.path).replace(/\.jar$/, ''),
            icon: null,
            filename: path.basename(file.path),
            installedAt: new Date().toISOString(),
            dependency: false,
            managedBy: 'modpack',
          });
        }
        break;
      } catch (err) {
        fs.rmSync(target, { force: true });
        if (url === file.downloads.at(-1)) failed.push(`${file.path}: ${err.message}`);
      }
    }
    done++;
    report({ message: `Descargando mods del modpack (${done}/${files.length})…`, progress: done / files.length });
    if (!ok && !file.downloads?.length) failed.push(`${file.path}: sin enlace de descarga`);
  });

  report({ message: 'Copiando la configuración del modpack…', progress: null });
  extractFolder(zip, 'overrides/', dir);
  extractFolder(zip, 'server-overrides/', dir);

  const fresh = getServer(id);
  fresh.content = [...(fresh.content || []).filter((r) => !records.some((n) => n.filename === r.filename)), ...records];
  fresh.modpack = { ...fresh.modpack, pendingApply: false, appliedAt: new Date().toISOString(), failed };
  db.flush();
  if (failed.length) {
    report({ message: `${failed.length} archivo(s) del modpack no se pudieron descargar. Revisa la pestaña Mods.`, progress: 1 });
  }
  return { files: files.length, failed };
}
