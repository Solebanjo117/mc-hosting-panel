import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { serverDir, USER_AGENT } from '../config.js';
import { db, getServer } from '../db.js';
import { download, getJson, getText, rewriteUrl } from '../lib/http.js';
import { HttpError, safeJoin, sanitizeFileName } from '../lib/util.js';
import AdmZip from 'adm-zip';
import { readProperties } from './properties.js';
import * as curseforge from './curseforge.js';

/**
 * Marketplace de mods, plugins y datapacks.
 *  - Modrinth (api.modrinth.com/v2): mods (Fabric/Forge/NeoForge), plugins (Paper/Spigot/Bukkit) y datapacks.
 *  - Hangar (hangar.papermc.io/api/v1): repositorio oficial de plugins de PaperMC.
 */

const MODRINTH = process.env.MODRINTH_API || 'https://api.modrinth.com/v2';
const HANGAR = 'https://hangar.papermc.io/api/v1';

/**
 * Qué tipo de contenido y qué loaders acepta cada tipo de servidor (CurseForge solo si hay clave).
 * kind = 'datapack' pide los datapacks del mundo activo, que funcionan en cualquier tipo de servidor.
 */
export function contentProfile(server, kind = null) {
  const p = kind === 'datapack' ? datapackProfile(server) : baseProfile(server);
  return curseforge.hasKey() ? { ...p, sources: [...p.sources, 'curseforge'] } : p;
}

function datapackProfile(server) {
  const level = readProperties(server.id)['level-name'] || 'world';
  return { kind: 'datapack', folder: `${level}/datapacks`, ext: '.zip', loaders: ['datapack'], sources: ['modrinth'] };
}

function baseProfile(server) {
  switch (server.type) {
    case 'paper':
      return { kind: 'plugin', folder: 'plugins', ext: '.jar', loaders: ['paper', 'spigot', 'bukkit', 'purpur'], sources: ['modrinth', 'hangar'] };
    case 'fabric':
      return { kind: 'mod', folder: 'mods', ext: '.jar', loaders: ['fabric'], sources: ['modrinth'] };
    case 'forge':
      return { kind: 'mod', folder: 'mods', ext: '.jar', loaders: ['forge'], sources: ['modrinth'] };
    case 'neoforge':
      return { kind: 'mod', folder: 'mods', ext: '.jar', loaders: ['neoforge'], sources: ['modrinth'] };
    default:
      return datapackProfile(server);
  }
}

function requireServer(id) {
  const server = getServer(id);
  if (!server) throw new HttpError(404, 'Servidor no encontrado');
  return server;
}

const q = (obj) => new URLSearchParams(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();

// --- Búsqueda ----------------------------------------------------------------

async function searchModrinth(server, profile, { query, offset, limit, sort }) {
  const facets = [
    [`project_type:${profile.kind}`],
    profile.loaders.map((l) => `categories:${l}`),
    [`versions:${server.mcVersion}`],
  ];
  const data = await getJson(
    `${MODRINTH}/search?${q({ query, offset, limit, index: sort || 'downloads', facets: JSON.stringify(facets) })}`
  );
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
      categories: h.display_categories || h.categories || [],
      clientOnly: h.server_side === 'unsupported',
      url: `https://modrinth.com/${h.project_type}/${h.slug}`,
      banner: h.featured_gallery || h.gallery?.[0] || null,
      color: typeof h.color === 'number' ? `#${h.color.toString(16).padStart(6, '0')}` : null,
      follows: h.follows ?? null,
      worldgen: (h.categories || h.display_categories || []).includes('worldgen'),
    })),
  };
}

async function searchHangar(server, { query, offset, limit, sort }) {
  const base = { q: query, offset, limit, platform: 'PAPER', sort: sort === 'updated' ? '-updated' : '-downloads' };
  let data;
  try {
    data = await getJson(`${HANGAR}/projects?${q({ ...base, version: server.mcVersion })}`);
  } catch (err) {
    if (err.status === 404) throw err;
    data = await getJson(`${HANGAR}/projects?${q(base)}`); // si el filtro de versión no es aceptado
  }
  return {
    total: data.pagination?.count ?? data.result.length,
    results: data.result.map((p) => ({
      source: 'hangar',
      id: p.namespace?.slug || p.name,
      slug: p.namespace?.slug || p.name,
      owner: p.namespace?.owner,
      title: p.name,
      description: p.description,
      author: p.namespace?.owner,
      icon: p.avatarUrl || null,
      downloads: p.stats?.downloads ?? 0,
      updated: p.lastUpdated,
      categories: p.category ? [p.category] : [],
      clientOnly: false,
      url: `https://hangar.papermc.io/${p.namespace?.owner}/${p.namespace?.slug}`,
    })),
  };
}

export async function search(id, { source = 'modrinth', query = '', offset = 0, limit = 20, sort, kind = null }) {
  const server = requireServer(id);
  const profile = contentProfile(server, kind);
  if (!profile.sources.includes(source)) throw new HttpError(400, `${source} no aplica para servidores ${server.type}`);
  const opts = { query, offset: Number(offset) || 0, limit: Math.min(Number(limit) || 20, 50), sort };
  const res =
    source === 'hangar'
      ? await searchHangar(server, opts)
      : source === 'curseforge'
        ? await curseforge.search(server, profile, opts)
        : await searchModrinth(server, profile, opts);
  return { ...res, kind: profile.kind, sources: profile.sources };
}

// --- Detalle de un proyecto (descripción completa y galería) -------------------

export async function projectDetails(source, projectId) {
  if (source === 'curseforge') return curseforge.details(projectId);
  if (source === 'hangar') {
    const p = await getJson(`${HANGAR}/projects/${encodeURIComponent(projectId)}`);
    let body = p.description || '';
    try {
      body = await getText(`${HANGAR}/pages/main/${encodeURIComponent(projectId)}`);
    } catch {
      /* sin página principal */
    }
    return {
      source,
      id: projectId,
      title: p.name,
      author: p.namespace?.owner,
      description: p.description,
      icon: p.avatarUrl || null,
      body,
      gallery: [],
      downloads: p.stats?.downloads ?? null,
      follows: p.stats?.stars ?? null,
      updated: p.lastUpdated,
      license: p.settings?.license?.name || null,
      links: (p.settings?.links || []).flatMap((g) => g.links || []).map((l) => ({ label: l.name, url: l.url })),
      url: `https://hangar.papermc.io/${p.namespace?.owner}/${p.namespace?.slug}`,
    };
  }
  const p = await getJson(`${MODRINTH}/project/${encodeURIComponent(projectId)}`);
  const links = [
    ['Código fuente', p.source_url],
    ['Reportar problemas', p.issues_url],
    ['Wiki', p.wiki_url],
    ['Discord', p.discord_url],
  ]
    .filter(([, url]) => url)
    .map(([label, url]) => ({ label, url }));
  return {
    source,
    id: p.id,
    title: p.title,
    description: p.description,
    icon: p.icon_url || null,
    body: p.body || '',
    gallery: (p.gallery || [])
      .sort((a, b) => Number(b.featured) - Number(a.featured) || (a.ordering ?? 0) - (b.ordering ?? 0))
      .map((g) => ({ url: g.url, raw: g.raw_url || g.url, title: g.title || '', description: g.description || '' })),
    downloads: p.downloads,
    follows: p.followers,
    updated: p.updated,
    license: p.license?.name || p.license?.id || null,
    categories: p.categories || [],
    clientSide: p.client_side,
    serverSide: p.server_side,
    links,
    url: `https://modrinth.com/${p.project_type}/${p.slug}`,
  };
}

// --- Versiones de un proyecto ------------------------------------------------

async function modrinthVersions(server, profile, projectId) {
  const list = await getJson(
    `${MODRINTH}/project/${encodeURIComponent(projectId)}/version?${q({
      loaders: JSON.stringify(profile.loaders),
      game_versions: JSON.stringify([server.mcVersion]),
    })}`
  );
  return list.map((v) => {
    const file = v.files.find((f) => f.primary) || v.files[0];
    return {
      id: v.id,
      name: v.name,
      number: v.version_number,
      type: v.version_type,
      date: v.date_published,
      downloads: v.downloads,
      file: file ? { url: file.url, name: file.filename, size: file.size, sha1: file.hashes?.sha1 } : null,
      dependencies: (v.dependencies || [])
        .filter((d) => d.dependency_type === 'required' && d.project_id)
        .map((d) => ({ projectId: d.project_id, versionId: d.version_id })),
    };
  });
}

async function hangarVersions(server, slug) {
  const base = { limit: 25, offset: 0, platform: 'PAPER' };
  let data;
  try {
    data = await getJson(`${HANGAR}/projects/${encodeURIComponent(slug)}/versions?${q({ ...base, platformVersion: server.mcVersion })}`);
  } catch (err) {
    if (err.status === 404) throw new HttpError(404, 'Proyecto no encontrado en Hangar');
    data = await getJson(`${HANGAR}/projects/${encodeURIComponent(slug)}/versions?${q(base)}`);
  }
  return data.result.map((v) => {
    const dl = v.downloads?.PAPER || {};
    return {
      id: v.name,
      name: v.name,
      number: v.name,
      type: (v.channel?.name || 'release').toLowerCase(),
      date: v.createdAt,
      downloads: v.stats?.totalDownloads ?? null,
      file: dl.downloadUrl ? { url: dl.downloadUrl, name: dl.fileInfo?.name || `${slug}-${v.name}.jar`, size: dl.fileInfo?.sizeBytes } : null,
      externalUrl: dl.externalUrl || null,
      platformVersions: v.platformDependencies?.PAPER || [],
      dependencies: [],
    };
  });
}

export async function projectVersions(id, source, projectId, kind = null) {
  const server = requireServer(id);
  const profile = contentProfile(server, kind);
  if (source === 'curseforge') return curseforge.versions(server, profile, projectId);
  return source === 'hangar' ? hangarVersions(server, projectId) : modrinthVersions(server, profile, projectId);
}

// --- Instalación -------------------------------------------------------------

function contentDir(server, profile) {
  const dir = safeJoin(serverDir(server.id), profile.folder);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function records(server) {
  if (!Array.isArray(server.content)) server.content = [];
  return server.content;
}

async function projectInfo(source, projectId) {
  if (source === 'hangar') return { title: projectId, icon: null };
  if (source === 'curseforge') {
    try {
      return await curseforge.info(projectId);
    } catch {
      return { title: projectId, icon: null };
    }
  }
  try {
    const p = await getJson(`${MODRINTH}/project/${encodeURIComponent(projectId)}`);
    return { title: p.title, icon: p.icon_url, slug: p.slug, projectType: p.project_type };
  } catch {
    return { title: projectId, icon: null };
  }
}

/**
 * Instala un proyecto y, si es de Modrinth, sus dependencias obligatorias.
 * Devuelve la lista de lo que se instaló.
 */
export async function install(id, { source = 'modrinth', projectId, versionId, title, icon, kind = null }, depth = 0, done = []) {
  const server = requireServer(id);
  const profile = contentProfile(server, kind);
  const list = records(server);

  const versions = await projectVersions(id, source, projectId, kind);
  if (!versions.length) {
    throw new HttpError(404, `No hay una versión de "${title || projectId}" compatible con ${server.type} ${server.mcVersion}`);
  }
  const version = versionId ? versions.find((v) => v.id === versionId) : versions.find((v) => v.type === 'release') || versions[0];
  if (!version) throw new HttpError(404, 'Esa versión ya no está disponible');
  if (!version.file) {
    if (version.externalUrl) {
      const why = source === 'curseforge' ? 'Su autor no permite descargarlo desde otras apps' : 'Se descarga desde un sitio externo';
      throw new HttpError(422, `${why}. Bájalo de ${version.externalUrl} y súbelo en Archivos (carpeta ${profile.folder}).`);
    }
    throw new HttpError(422, 'Esta versión no tiene archivo descargable');
  }

  const dir = contentDir(server, profile);
  const fileName = sanitizeFileName(version.file.name);

  // Si ya estaba instalado, quita el archivo viejo (actualización).
  // Un mismo proyecto puede estar como mod y como datapack (p. ej. Terralith): se compara el tipo.
  const recKind = (r) => r.kind || (server.type === 'vanilla' ? 'datapack' : 'main');
  const wantKind = profile.kind === 'datapack' ? 'datapack' : 'main';
  const previous = list.find((r) => r.source === source && r.projectId === projectId && recKind(r) === wantKind);
  if (previous) {
    for (const f of [previous.filename, `${previous.filename}.disabled`]) fs.rmSync(path.join(dir, f), { force: true });
    list.splice(list.indexOf(previous), 1);
  }

  await download(version.file.url, path.join(dir, fileName));
  const info = title ? { title, icon } : await projectInfo(source, projectId);
  list.push({
    source,
    projectId,
    versionId: version.id,
    versionName: version.number,
    title: info.title || title || projectId,
    icon: info.icon || icon || null,
    filename: fileName,
    installedAt: new Date().toISOString(),
    dependency: depth > 0,
    ...(profile.kind === 'datapack' ? { kind: 'datapack', world: profile.folder.split('/')[0] } : {}),
  });
  db.save();
  const worldgen = profile.kind === 'datapack' ? datapackInfo(path.join(dir, fileName)).worldgen : false;
  done.push({ projectId, title: info.title || projectId, version: version.number, file: fileName, dependency: depth > 0, worldgen });

  if (depth < 4) {
    for (const dep of version.dependencies) {
      if (list.some((r) => r.projectId === dep.projectId) || done.some((d) => d.projectId === dep.projectId)) continue;
      try {
        await install(id, { source, projectId: dep.projectId, versionId: dep.versionId || undefined, kind }, depth + 1, done);
      } catch (err) {
        done.push({ projectId: dep.projectId, title: dep.projectId, error: `Dependencia no instalada: ${err.message}`, dependency: true });
      }
    }
  }
  return done;
}

// --- Contenido instalado -----------------------------------------------------

function sha1(file) {
  return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
}

/**
 * Lo que hace un datapack: si trae generación de mundo (biomas, estructuras, dimensiones) solo se
 * aplica al reiniciar y únicamente en las zonas que todavía no se exploran.
 */
const WORLDGEN_RE = /^data\/[^/]+\/(worldgen|dimension|dimension_type)\//;
export function datapackInfo(target) {
  let names = [];
  try {
    if (fs.statSync(target).isDirectory()) {
      const walk = (dir, rel = '') => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const r = rel ? `${rel}/${e.name}` : e.name;
          if (e.isDirectory()) {
            names.push(`${r}/`); // data/<ns>/worldgen/ basta para saberlo
            if (r.split('/').length < 4) walk(path.join(dir, e.name), r);
          } else names.push(r);
          if (names.length > 5000) return;
        }
      };
      walk(target);
    } else {
      names = new AdmZip(target).getEntries().map((e) => e.entryName);
    }
  } catch {
    return { worldgen: false, valid: false };
  }
  return { worldgen: names.some((n) => WORLDGEN_RE.test(n)), valid: names.includes('pack.mcmeta') };
}

export function listInstalled(id, kind = null) {
  const server = requireServer(id);
  const profile = contentProfile(server, kind);
  const dir = safeJoin(serverDir(server.id), profile.folder);
  const list = records(server);
  if (!fs.existsSync(dir)) return { kind: profile.kind, folder: profile.folder, items: [] };
  const isPack = profile.kind === 'datapack';
  const items = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter(
      (e) =>
        (e.isFile() && (e.name.endsWith(profile.ext) || e.name.endsWith(`${profile.ext}.disabled`))) ||
        // Los datapacks también pueden ser una carpeta con pack.mcmeta.
        (isPack && e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'pack.mcmeta')))
    )
    .map((e) => {
      const folder = e.isDirectory();
      const enabled = folder || !e.name.endsWith('.disabled');
      const filename = enabled ? e.name : e.name.replace(/\.disabled$/, '');
      const rec = list.find((r) => r.filename === filename);
      return {
        filename,
        enabled,
        folder,
        size: folder ? null : fs.statSync(path.join(dir, e.name)).size,
        title: rec?.title || filename.replace(/\.(jar|zip)$/, ''),
        icon: rec?.icon || null,
        source: rec?.source || 'manual',
        projectId: rec?.projectId || null,
        versionName: rec?.versionName || null,
        dependency: rec?.dependency || false,
        managedBy: rec?.managedBy || null,
        ...(isPack ? { worldgen: datapackInfo(path.join(dir, e.name)).worldgen } : {}),
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
  return { kind: profile.kind, folder: profile.folder, items };
}

export function toggle(id, filename, enabled, kind = null) {
  const server = requireServer(id);
  const dir = safeJoin(serverDir(server.id), contentProfile(server, kind).folder);
  const on = safeJoin(dir, filename);
  const off = `${on}.disabled`;
  if (fs.existsSync(on) && fs.statSync(on).isDirectory()) {
    throw new HttpError(400, 'Los datapacks en carpeta no se pueden desactivar; desinstálalo o comprímelo en .zip desde Archivos');
  }
  if (enabled && fs.existsSync(off)) fs.renameSync(off, on);
  if (!enabled && fs.existsSync(on)) fs.renameSync(on, off);
}

export function uninstall(id, filename, kind = null) {
  const server = requireServer(id);
  const dir = safeJoin(serverDir(server.id), contentProfile(server, kind).folder);
  const file = safeJoin(dir, filename);
  if (file === path.resolve(dir)) throw new HttpError(400, 'Elige qué desinstalar');
  fs.rmSync(file, { force: true, recursive: true });
  fs.rmSync(`${file}.disabled`, { force: true });
  server.content = records(server).filter((r) => r.filename !== filename);
  db.save();
}

/**
 * Busca actualizaciones en Modrinth usando el hash SHA-1 de cada archivo,
 * así también detecta mods que se subieron a mano.
 */
export async function checkUpdates(id, kind = null) {
  const server = requireServer(id);
  const profile = contentProfile(server, kind);
  const dir = safeJoin(serverDir(server.id), profile.folder);
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(profile.ext) && fs.statSync(path.join(dir, f)).isFile());
  const hashes = new Map(files.map((f) => [sha1(path.join(dir, f)), f]));
  if (!hashes.size) return [];
  const res = await fetch(rewriteUrl(`${MODRINTH}/version_files/update`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
    body: JSON.stringify({ hashes: [...hashes.keys()], algorithm: 'sha1', loaders: profile.loaders, game_versions: [server.mcVersion] }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new HttpError(502, `Modrinth respondió ${res.status}`);
  const data = await res.json();
  const updates = [];
  for (const [hash, version] of Object.entries(data)) {
    const file = hashes.get(hash);
    const newFile = version.files.find((f) => f.primary) || version.files[0];
    if (!file || !newFile || newFile.hashes?.sha1 === hash) continue;
    updates.push({ filename: file, projectId: version.project_id, versionId: version.id, newVersion: version.version_number, newFile: newFile.filename });
  }
  return updates;
}

/**
 * Antes de cambiar de versión de Minecraft: cuáles de los mods/plugins instalados tienen versión para
 * la nueva en Modrinth (y cuál), y cuáles no (o no están en Modrinth: subidos a mano, CurseForge…).
 */
export async function targetCompatibility(id, mcVersion) {
  const server = requireServer(id);
  if (server.type === 'vanilla') return { total: 0, ready: [], missing: [] };
  const profile = contentProfile(server);
  const dir = safeJoin(serverDir(server.id), profile.folder);
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(profile.ext) && fs.statSync(path.join(dir, f)).isFile()) : [];
  if (!files.length) return { total: 0, ready: [], missing: [] };
  const hashes = new Map(files.map((f) => [sha1(path.join(dir, f)), f]));
  const res = await fetch(rewriteUrl(`${MODRINTH}/version_files/update`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
    body: JSON.stringify({ hashes: [...hashes.keys()], algorithm: 'sha1', loaders: profile.loaders, game_versions: [mcVersion] }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new HttpError(502, `Modrinth respondió ${res.status}`);
  const data = await res.json();
  const titles = new Map(records(server).map((r) => [r.filename, r.title]));
  const ready = [];
  for (const [hash, version] of Object.entries(data)) {
    const filename = hashes.get(hash);
    if (filename) ready.push({ filename, title: titles.get(filename) || filename, newVersion: version.version_number });
  }
  const readySet = new Set(ready.map((r) => r.filename));
  const missing = files.filter((f) => !readySet.has(f)).map((filename) => ({ filename, title: titles.get(filename) || filename }));
  return { total: files.length, ready, missing, kind: profile.kind };
}

/** Aplica una actualización detectada por checkUpdates. */
export async function applyUpdate(id, { filename, projectId, versionId, kind = null }) {
  const server = requireServer(id);
  const dir = safeJoin(serverDir(server.id), contentProfile(server, kind).folder);
  const list = records(server);
  const rec = list.find((r) => r.filename === filename);
  if (!rec) {
    // Archivo subido a mano: se reemplaza registrándolo como de Modrinth.
    fs.rmSync(safeJoin(dir, filename), { force: true });
  }
  return install(id, { source: 'modrinth', projectId, versionId, title: rec?.title, icon: rec?.icon, kind });
}
