import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config.js';
import { getJson } from '../lib/http.js';
import { HttpError } from '../lib/util.js';
import { mojangVersion } from './versions.js';

/**
 * Listas de objetos, efectos, encantamientos y entidades de cada versión de Minecraft,
 * con su nombre en español, para los comandos rápidos (give, effect, enchant, summon).
 *
 *  - IDs: misode/mcmeta (registros sacados del propio juego, una etiqueta por versión).
 *  - Nombres: el archivo de idioma es_mx oficial de Mojang (índice de recursos del juego).
 *
 * Todo se guarda en data/cache para no descargarlo otra vez.
 */

const CACHE = path.join(DATA_DIR, 'cache', 'gamedata');
const MCMETA = process.env.MCMETA_URL || 'https://raw.githubusercontent.com/misode/mcmeta';
const RESOURCES = 'https://resources.download.minecraft.net';
export const KINDS = {
  item: { registry: 'item', lang: (id) => [`item.minecraft.${id}`, `block.minecraft.${id}`] },
  effect: { registry: 'mob_effect', lang: (id) => [`effect.minecraft.${id}`] },
  enchantment: { registry: 'enchantment', lang: (id) => [`enchantment.minecraft.${id}`] },
  entity: { registry: 'entity_type', lang: (id) => [`entity.minecraft.${id}`] },
};

const memory = new Map();

function readCache(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeCache(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

const safe = (v) => String(v).replace(/[^a-zA-Z0-9._-]/g, '_');

async function registry(version, key) {
  const file = path.join(CACHE, safe(version), `${key}.json`);
  const hit = readCache(file);
  if (hit) return hit;
  let ids;
  try {
    ids = await getJson(`${MCMETA}/${encodeURIComponent(version)}-registries/${key}/data.min.json`, { timeout: 15000 });
  } catch {
    // Versión que mcmeta no tiene (muy vieja o muy nueva): se usa la lista más reciente.
    ids = await getJson(`${MCMETA}/registries/${key}/data.min.json`, { timeout: 15000 });
  }
  if (!Array.isArray(ids)) throw new HttpError(502, 'La lista de Minecraft llegó en un formato inesperado');
  writeCache(file, ids);
  return ids;
}

async function spanish(version) {
  const file = path.join(CACHE, safe(version), 'es_mx.json');
  const hit = readCache(file);
  if (hit) return hit;
  try {
    const meta = await mojangVersion(version);
    const index = await getJson(meta.assetIndex.url, { timeout: 15000 });
    const obj = index.objects['minecraft/lang/es_mx.json'] || index.objects['minecraft/lang/es_es.json'];
    if (!obj) return {};
    const lang = await getJson(`${RESOURCES}/${obj.hash.slice(0, 2)}/${obj.hash}`, { timeout: 20000 });
    // Solo se guardan las claves que se usan.
    const keep = {};
    for (const [k, v] of Object.entries(lang)) if (/^(item|block|effect|enchantment|entity)\.minecraft\.[a-z0-9_]+$/.test(k)) keep[k] = v;
    writeCache(file, keep);
    return keep;
  } catch {
    return {}; // sin nombres en español se muestran los IDs
  }
}

/** [{ id, name }] ordenado por nombre. */
export async function gameList(version, kind) {
  const def = KINDS[kind];
  if (!def) throw new HttpError(400, 'Lista desconocida');
  const key = `${version}:${kind}`;
  if (memory.has(key)) return memory.get(key);
  const [ids, lang] = await Promise.all([registry(version, def.registry), spanish(version)]);
  const list = ids
    .filter((id) => id !== 'air')
    .map((id) => ({ id, name: def.lang(id).map((k) => lang[k]).find(Boolean) || null }))
    .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id, 'es'));
  memory.set(key, list);
  return list;
}
