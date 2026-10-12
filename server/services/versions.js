import { getJson } from '../lib/http.js';
import { compareVersions, HttpError } from '../lib/util.js';

/**
 * Catálogo de versiones por tipo de servidor. Todo sale de las APIs oficiales:
 *  - Vanilla:  piston-meta.mojang.com
 *  - Paper:    fill.papermc.io (API v3)
 *  - Fabric:   meta.fabricmc.net
 *  - Forge:    files.minecraftforge.net + maven.minecraftforge.net
 *  - NeoForge: maven.neoforged.net
 */

export const SERVER_TYPES = {
  vanilla: { label: 'Vanilla', content: 'datapack', description: 'Servidor oficial de Mojang, sin modificar.' },
  paper: { label: 'Paper', content: 'plugin', description: 'Alto rendimiento y compatible con plugins Bukkit/Spigot/Paper.' },
  fabric: { label: 'Fabric', content: 'mod', description: 'Cargador de mods ligero y rápido de actualizar.' },
  forge: { label: 'Forge', content: 'mod', description: 'El cargador de mods clásico, ideal para modpacks grandes.' },
  neoforge: { label: 'NeoForge', content: 'mod', description: 'Sucesor moderno de Forge (1.20.2 en adelante).' },
};

const MOJANG_MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const PAPER_API = 'https://fill.papermc.io/v3/projects/paper';
const FABRIC_META = 'https://meta.fabricmc.net/v2';
const FORGE_PROMOS = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json';
const NEOFORGE_VERSIONS = 'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge';

const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}
const TTL = 30 * 60 * 1000;

export function mojangManifest() {
  return cached('mojang', TTL, () => getJson(MOJANG_MANIFEST));
}

export async function mojangVersion(mcVersion) {
  const manifest = await mojangManifest();
  const entry = manifest.versions.find((v) => v.id === mcVersion);
  if (!entry) throw new HttpError(404, `Mojang no publica la versión ${mcVersion}`);
  return cached(`mojang:${mcVersion}`, 24 * 60 * 60 * 1000, () => getJson(entry.url));
}

/** Convierte una versión de NeoForge a la versión de Minecraft que usa. */
export function neoforgeToMc(neo) {
  const [a, b, c] = neo.split('-')[0].split('.').map(Number);
  if (a >= 26) return c ? `${a}.${b}.${c}` : `${a}.${b}`; // nuevo esquema de Minecraft (26.1, 26.1.1…)
  return b ? `1.${a}.${b}` : `1.${a}`; // 21.1.x -> 1.21.1, 21.0.x -> 1.21
}

async function vanillaVersions() {
  const manifest = await mojangManifest();
  return manifest.versions.filter((v) => v.type === 'release').map((v) => ({ id: v.id }));
}

async function paperVersions() {
  const project = await getJson(PAPER_API);
  const all = Object.values(project.versions || {}).flat();
  return all
    .filter((v) => !/-(pre|rc)/i.test(v))
    .sort((a, b) => compareVersions(b, a))
    .map((id) => ({ id }));
}

async function fabricVersions() {
  const games = await getJson(`${FABRIC_META}/versions/game`);
  return games.filter((g) => g.stable).map((g) => ({ id: g.version }));
}

async function forgeVersions() {
  const promos = await getJson(FORGE_PROMOS);
  const byMc = new Map();
  for (const [key, forge] of Object.entries(promos.promos || {})) {
    const m = key.match(/^(.+)-(latest|recommended)$/);
    if (!m) continue;
    const [, mc, kind] = m;
    if (!byMc.has(mc)) byMc.set(mc, []);
    const list = byMc.get(mc);
    if (!list.some((l) => l.version === forge)) {
      list.push({ version: forge, label: kind === 'recommended' ? `${forge} (recomendada)` : `${forge} (más reciente)` });
    } else if (kind === 'recommended') {
      list.find((l) => l.version === forge).label = `${forge} (recomendada)`;
    }
  }
  return [...byMc.entries()]
    .sort((a, b) => compareVersions(b[0], a[0]))
    .map(([id, loaders]) => ({ id, loaders: loaders.sort((a, b) => compareVersions(b.version, a.version)) }));
}

async function neoforgeVersions() {
  const data = await getJson(NEOFORGE_VERSIONS);
  const byMc = new Map();
  for (const v of data.versions || []) {
    if (v.startsWith('0.')) continue; // versiones de prueba antiguas (1.20.1)
    const mc = neoforgeToMc(v);
    if (!byMc.has(mc)) byMc.set(mc, []);
    byMc.get(mc).push({ version: v, label: v.includes('beta') ? `${v} (beta)` : v });
  }
  return [...byMc.entries()]
    .sort((a, b) => compareVersions(b[0], a[0]))
    .map(([id, loaders]) => ({ id, loaders: loaders.sort((a, b) => compareVersions(b.version, a.version)).slice(0, 25) }));
}

const LISTERS = {
  vanilla: vanillaVersions,
  paper: paperVersions,
  fabric: fabricVersions,
  forge: forgeVersions,
  neoforge: neoforgeVersions,
};

export async function listVersions(type) {
  const fn = LISTERS[type];
  if (!fn) throw new HttpError(400, `Tipo de servidor desconocido: ${type}`);
  return cached(`list:${type}`, TTL, fn);
}

// --- Resolución de descargas -------------------------------------------------

export async function vanillaServerUrl(mcVersion) {
  const info = await mojangVersion(mcVersion);
  const url = info.downloads?.server?.url;
  if (!url) throw new HttpError(404, `La versión ${mcVersion} no tiene servidor oficial`);
  return url;
}

export async function paperBuild(mcVersion) {
  const builds = await getJson(`${PAPER_API}/versions/${encodeURIComponent(mcVersion)}/builds`);
  if (!Array.isArray(builds) || builds.length === 0) throw new HttpError(404, `Paper no tiene builds para ${mcVersion}`);
  const sorted = [...builds].sort((a, b) => b.id - a.id);
  const build = sorted.find((b) => b.channel === 'STABLE') || sorted[0];
  const dl = build.downloads?.['server:default'];
  if (!dl?.url) throw new HttpError(502, 'La respuesta de Paper no trae URL de descarga');
  return { build: build.id, url: dl.url, channel: build.channel };
}

export async function fabricLauncherUrl(mcVersion) {
  const loaders = await getJson(`${FABRIC_META}/versions/loader/${encodeURIComponent(mcVersion)}`);
  if (!loaders.length) throw new HttpError(404, `Fabric no soporta ${mcVersion}`);
  const loader = (loaders.find((l) => l.loader.stable) || loaders[0]).loader.version;
  const installers = await getJson(`${FABRIC_META}/versions/installer`);
  const installer = (installers.find((i) => i.stable) || installers[0]).version;
  return {
    loader,
    url: `${FABRIC_META}/versions/loader/${mcVersion}/${loader}/${installer}/server/jar`,
  };
}

export function forgeInstallerUrl(mcVersion, forgeVersion) {
  const v = `${mcVersion}-${forgeVersion}`;
  return `https://maven.minecraftforge.net/net/minecraftforge/forge/${v}/forge-${v}-installer.jar`;
}

export function neoforgeInstallerUrl(neoVersion) {
  return `https://maven.neoforged.net/releases/net/neoforged/neoforge/${neoVersion}/neoforge-${neoVersion}-installer.jar`;
}
