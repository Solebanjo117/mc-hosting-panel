import { db } from '../db.js';
import { getJson } from '../lib/http.js';
import { HttpError } from '../lib/util.js';

/**
 * CurseForge (api.curseforge.com). Pide una clave de API propia, que el usuario saca gratis
 * en console.curseforge.com y pega en Ajustes del panel.
 *
 * Respeta "allowModDistribution": si el autor no permite descargas desde otras apps,
 * el panel muestra el enlace a CurseForge en lugar de descargarlo.
 */

const API = process.env.CURSEFORGE_API || 'https://api.curseforge.com/v1';
export const MINECRAFT = 432;
const CLASS = { mod: 6, plugin: 5, datapack: 6945 };
const LOADER = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 };
const SORT = { downloads: 6, updated: 3, relevance: 2, newest: 11 };
const RELEASE = { 1: 'release', 2: 'beta', 3: 'alpha' };
const SECTION = { 6: 'mc-mods', 5: 'bukkit-plugins', 6945: 'data-packs', 4471: 'modpacks', 12: 'texture-packs', 6552: 'shaders' };
export const CLASS_IDS = { mod: 6, modpack: 4471, resourcepack: 12, shader: 6552, datapack: 6945 };

function settings() {
  if (!db.data.settings.curseforge) db.data.settings.curseforge = { apiKey: '' };
  return db.data.settings.curseforge;
}

export const hasKey = () => Boolean(settings().apiKey);

export function publicStatus() {
  const k = settings().apiKey;
  return { hasKey: Boolean(k), hint: k ? `…${k.slice(-4)}` : null };
}

async function call(path, key = settings().apiKey, { body } = {}) {
  if (!key) throw new HttpError(409, 'Agrega tu clave de CurseForge en Ajustes del panel');
  const opts = { headers: { 'x-api-key': key }, timeout: 30000 };
  if (body !== undefined) Object.assign(opts, { method: 'POST', body: JSON.stringify(body), headers: { ...opts.headers, 'Content-Type': 'application/json' } });
  try {
    return await getJson(`${API}${path}`, opts);
  } catch (err) {
    if (/ 40[13]/.test(err.message)) throw new HttpError(400, 'CurseForge no aceptó la clave. Revisa que la copiaste completa en Ajustes del panel.');
    throw err;
  }
}

export async function saveKey(apiKey) {
  const key = String(apiKey || '').trim();
  if (key) {
    await call(`/games/${MINECRAFT}`, key); // comprueba que funcione
  }
  settings().apiKey = key;
  db.flush();
  return publicStatus();
}

const classFor = (profile) => CLASS[profile.kind];
const loaderFor = (profile) => (profile.kind === 'mod' ? LOADER[profile.loaders[0]] : undefined);
const qs = (obj) => new URLSearchParams(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();

function projectUrl(m) {
  return m.links?.websiteUrl || `https://www.curseforge.com/minecraft/${SECTION[m.classId] || 'mc-mods'}/${m.slug}`;
}

export async function search(server, profile, { query, offset, limit, sort }) {
  const base = {
    gameId: MINECRAFT,
    classId: classFor(profile),
    modLoaderType: loaderFor(profile),
    searchFilter: query,
    sortField: SORT[sort] || SORT.downloads,
    sortOrder: sort === 'relevance' ? undefined : 'desc',
    index: offset,
    pageSize: Math.min(limit, 50),
  };
  let data = await call(`/mods/search?${qs({ ...base, gameVersion: server.mcVersion })}`);
  // Muchos plugins solo marcan la versión mayor (1.21): si no hay nada, se busca sin filtro de versión.
  if (!data.data?.length && profile.kind === 'plugin') data = await call(`/mods/search?${qs(base)}`);
  return {
    total: Math.min(data.pagination?.totalCount ?? data.data.length, 10000 - offset),
    results: (data.data || []).map((m) => ({
      source: 'curseforge',
      id: String(m.id),
      slug: m.slug,
      title: m.name,
      description: m.summary,
      author: m.authors?.[0]?.name || '',
      icon: m.logo?.thumbnailUrl || m.logo?.url || null,
      downloads: m.downloadCount,
      updated: m.dateModified,
      categories: (m.categories || []).map((c) => c.name).slice(0, 4),
      clientOnly: false,
      url: projectUrl(m),
      banner: m.screenshots?.[0]?.url || null,
      color: null,
      follows: null,
      blocked: m.allowModDistribution === false,
    })),
  };
}

export async function versions(server, profile, modId) {
  const [{ data: mod }, files] = await Promise.all([
    call(`/mods/${encodeURIComponent(modId)}`),
    call(`/mods/${encodeURIComponent(modId)}/files?${qs({ gameVersion: profile.kind === 'plugin' ? undefined : server.mcVersion, modLoaderType: loaderFor(profile), pageSize: 50 })}`),
  ]);
  const url = projectUrl(mod);
  return (files.data || [])
    .filter((f) => f.isAvailable !== false)
    .sort((a, b) => Date.parse(b.fileDate) - Date.parse(a.fileDate))
    .map((f) => ({
      id: String(f.id),
      name: f.displayName,
      number: f.displayName,
      type: RELEASE[f.releaseType] || 'release',
      date: f.fileDate,
      downloads: f.downloadCount,
      file: f.downloadUrl ? { url: f.downloadUrl, name: f.fileName, size: f.fileLength, sha1: f.hashes?.find((h) => h.algo === 1)?.value } : null,
      externalUrl: f.downloadUrl ? null : `${url}/files/${f.id}`,
      gameVersions: f.gameVersions || [],
      dependencies: (f.dependencies || []).filter((d) => d.relationType === 3).map((d) => ({ projectId: String(d.modId), versionId: null })),
    }));
}

export async function info(modId) {
  const { data: m } = await call(`/mods/${encodeURIComponent(modId)}`);
  return { title: m.name, icon: m.logo?.thumbnailUrl || null, slug: m.slug };
}

export async function details(modId) {
  const [{ data: m }, desc] = await Promise.all([
    call(`/mods/${encodeURIComponent(modId)}`),
    call(`/mods/${encodeURIComponent(modId)}/description`).catch(() => ({ data: '' })),
  ]);
  const links = [
    ['Código fuente', m.links?.sourceUrl],
    ['Reportar problemas', m.links?.issuesUrl],
    ['Wiki', m.links?.wikiUrl],
  ]
    .filter(([, u]) => u)
    .map(([label, url]) => ({ label, url }));
  return {
    source: 'curseforge',
    id: String(m.id),
    title: m.name,
    description: m.summary,
    icon: m.logo?.thumbnailUrl || null,
    body: typeof desc.data === 'string' ? desc.data : '',
    gallery: (m.screenshots || []).map((s) => ({ url: s.thumbnailUrl || s.url, raw: s.url, title: s.title || '', description: s.description || '' })),
    downloads: m.downloadCount,
    follows: null,
    updated: m.dateModified,
    license: null,
    categories: (m.categories || []).map((c) => c.name),
    links,
    url: projectUrl(m),
    blocked: m.allowModDistribution === false,
  };
}


// --- Modpacks ---------------------------------------------------------------------

const PACK_LOADERS = { Forge: 'forge', NeoForge: 'neoforge', Fabric: 'fabric', Quilt: 'quilt' };

export async function searchModpacks({ query = '', offset = 0, limit = 20, sort = 'downloads' }) {
  const data = await call(
    `/mods/search?${qs({ gameId: MINECRAFT, classId: CLASS_IDS.modpack, searchFilter: query, sortField: SORT[sort] || SORT.downloads, sortOrder: 'desc', index: Number(offset) || 0, pageSize: Math.min(Number(limit) || 20, 50) })}`
  );
  return {
    total: data.pagination?.totalCount ?? data.data.length,
    results: (data.data || []).map((m) => {
      const versions = [...new Set((m.latestFilesIndexes || []).map((f) => f.gameVersion).filter(Boolean))];
      const loaders = [...new Set((m.latestFilesIndexes || []).map((f) => ({ 1: 'forge', 4: 'fabric', 5: 'quilt', 6: 'neoforge' })[f.modLoader]).filter(Boolean))];
      return {
        source: 'curseforge',
        id: String(m.id),
        slug: m.slug,
        title: m.name,
        description: m.summary,
        author: m.authors?.[0]?.name || '',
        icon: m.logo?.thumbnailUrl || null,
        downloads: m.downloadCount,
        updated: m.dateModified,
        versions: versions.slice(0, 3),
        loaders,
        url: projectUrl(m),
        blocked: m.allowModDistribution === false,
      };
    }),
  };
}

/** Versiones de un modpack de CurseForge (sin los "server packs", que son otra cosa). */
export async function modpackFiles(modId) {
  const [{ data: mod }, files] = await Promise.all([call(`/mods/${encodeURIComponent(modId)}`), call(`/mods/${encodeURIComponent(modId)}/files?${qs({ pageSize: 50 })}`)]);
  const url = projectUrl(mod);
  return (files.data || [])
    .filter((f) => f.isAvailable !== false && !f.isServerPack)
    .sort((a, b) => Date.parse(b.fileDate) - Date.parse(a.fileDate))
    .map((f) => ({
      id: String(f.id),
      name: f.displayName,
      number: f.displayName,
      type: RELEASE[f.releaseType] || 'release',
      date: f.fileDate,
      gameVersions: (f.gameVersions || []).filter((v) => /^\d/.test(v)),
      loaders: (f.gameVersions || []).map((v) => PACK_LOADERS[v]).filter(Boolean),
      file: f.downloadUrl ? { url: f.downloadUrl, filename: f.fileName, size: f.fileLength } : null,
      externalUrl: `${url}/files/${f.id}`,
      projectTitle: mod.name,
    }));
}

/** Datos de varios archivos y proyectos de una vez (para instalar los mods de un modpack). */
export async function filesInfo(fileIds) {
  const out = new Map();
  for (let i = 0; i < fileIds.length; i += 500) {
    const { data } = await call('/mods/files', undefined, { body: { fileIds: fileIds.slice(i, i + 500) } });
    for (const f of data || []) out.set(f.id, f);
  }
  return out;
}

export async function modsInfo(modIds) {
  const out = new Map();
  for (let i = 0; i < modIds.length; i += 500) {
    const { data } = await call('/mods', undefined, { body: { modIds: modIds.slice(i, i + 500) } });
    for (const m of data || []) out.set(m.id, m);
  }
  return out;
}

export const fileUrl = (mod, fileId) => `${projectUrl(mod)}/files/${fileId}`;
