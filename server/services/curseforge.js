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
const SECTION = { 6: 'mc-mods', 5: 'bukkit-plugins', 6945: 'data-packs' };

function settings() {
  if (!db.data.settings.curseforge) db.data.settings.curseforge = { apiKey: '' };
  return db.data.settings.curseforge;
}

export const hasKey = () => Boolean(settings().apiKey);

export function publicStatus() {
  const k = settings().apiKey;
  return { hasKey: Boolean(k), hint: k ? `…${k.slice(-4)}` : null };
}

async function call(path, key = settings().apiKey) {
  if (!key) throw new HttpError(409, 'Agrega tu clave de CurseForge en Ajustes del panel');
  try {
    return await getJson(`${API}${path}`, { headers: { 'x-api-key': key }, timeout: 20000 });
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

