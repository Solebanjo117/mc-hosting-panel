import fs from 'node:fs';
import path from 'node:path';
import dgram from 'node:dgram';
import { serverDir } from '../config.js';
import { db, getServer } from '../db.js';
import { download } from '../lib/http.js';
import { HttpError, compareVersions } from '../lib/util.js';
import * as market from './marketplace.js';
import { mojangManifest } from './versions.js';
import { applyGeyserConfig, readGeyserPort } from './geyserConfig.js';

/**
 * Crossplay con Bedrock (celular, Windows 10/11, consolas) usando GeyserMC.
 *  - Geyser traduce el protocolo de Bedrock al de Java y escucha en un puerto UDP.
 *  - Floodgate (opcional) deja entrar a jugadores de Bedrock sin cuenta de Java.
 *  - ViaVersion (solo Paper) permite usar Geyser en versiones de Minecraft que no son la más reciente,
 *    porque Geyser siempre habla la versión de Java más nueva.
 */

export const DEFAULT_BEDROCK_PORT = 19132;

const PROJECTS = {
  geyser: 'wKkoqHrH', // Modrinth: Geyser (Paper, Spigot, Fabric, NeoForge…)
  floodgateMod: 'bWrNNfkb', // Modrinth: Floodgate para Fabric y NeoForge
  fabricApi: 'P7dR8mSH', // Modrinth: Fabric API (Geyser y Floodgate la necesitan en Fabric)
  viaVersion: 'viaversion', // Modrinth: ViaVersion
};
// Floodgate para Paper se publica en la API de descargas de GeyserMC.
const FLOODGATE_SPIGOT_URL = 'https://download.geysermc.org/v2/projects/floodgate/versions/latest/builds/latest/downloads/spigot';
const FLOODGATE_SPIGOT_FILE = 'floodgate-spigot.jar';

const UNSUPPORTED = {
  vanilla:
    'Vanilla no admite plugins ni mods, así que Geyser no se puede instalar dentro. Crea un servidor Paper: se juega igual que Vanilla y sí admite Bedrock.',
  forge: 'Geyser no tiene versión para Forge. Usa NeoForge o Fabric (en la versión más reciente de Minecraft) o Paper.',
};

function requireServer(id) {
  const server = getServer(id);
  if (!server) throw new HttpError(404, 'Servidor no encontrado');
  return server;
}

/** Revisa si un puerto UDP está libre en esta PC. */
export function isUdpPortFree(port) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    sock.once('error', () => resolve(false));
    sock.bind(port, '0.0.0.0', () => sock.close(() => resolve(true)));
  });
}

function usedBedrockPorts(exceptId) {
  return new Set(db.data.servers.filter((s) => s.id !== exceptId && s.bedrock?.enabled).map((s) => Number(s.bedrock.port)));
}

export function nextBedrockPort(exceptId) {
  const used = usedBedrockPorts(exceptId);
  let port = DEFAULT_BEDROCK_PORT;
  while (used.has(port)) port += 1;
  return port;
}

async function latestRelease() {
  try {
    return (await mojangManifest()).latest.release;
  } catch {
    return null;
  }
}

async function needsViaVersion(server) {
  if (server.type !== 'paper') return false;
  const latest = await latestRelease();
  return Boolean(latest && compareVersions(server.mcVersion, latest) < 0);
}

function managedItems(server) {
  const installed = market.listInstalled(server.id).items;
  const managed = new Set((server.content || []).filter((r) => r.managedBy === 'bedrock').map((r) => r.filename));
  return installed.filter((i) => managed.has(i.filename));
}

export async function status(id) {
  const server = requireServer(id);
  const base = {
    type: server.type,
    mcVersion: server.mcVersion,
    enabled: Boolean(server.bedrock?.enabled),
    port: server.bedrock?.port || nextBedrockPort(server.id),
    floodgate: server.bedrock?.floodgate ?? true,
    configPort: readGeyserPort(server),
  };
  if (UNSUPPORTED[server.type]) return { ...base, supported: false, reason: UNSUPPORTED[server.type], items: [] };

  let compatible = null;
  let compatibilityError = null;
  try {
    compatible = (await market.projectVersions(id, 'modrinth', PROJECTS.geyser)).length > 0;
  } catch (err) {
    compatibilityError = err.message;
  }
  const latest = await latestRelease();
  return {
    ...base,
    supported: compatible !== false,
    reason:
      compatible === false
        ? `Geyser no tiene una versión para ${server.type === 'fabric' ? 'Fabric' : 'NeoForge'} ${server.mcVersion}. En mods, Geyser solo funciona con la versión más reciente de Minecraft${latest ? ` (${latest})` : ''}; cambia la versión del servidor o usa Paper.`
        : null,
    compatibilityError,
    latestRelease: latest,
    viaVersion: await needsViaVersion(server),
    items: managedItems(server),
  };
}

async function installFloodgateSpigot(server) {
  const dir = path.join(serverDir(server.id), 'plugins');
  fs.mkdirSync(dir, { recursive: true });
  await download(FLOODGATE_SPIGOT_URL, path.join(dir, FLOODGATE_SPIGOT_FILE));
  server.content = (server.content || []).filter((r) => r.filename !== FLOODGATE_SPIGOT_FILE);
  server.content.push({
    source: 'geysermc',
    projectId: 'floodgate-spigot',
    versionId: 'latest',
    versionName: 'última',
    title: 'Floodgate',
    icon: null,
    filename: FLOODGATE_SPIGOT_FILE,
    installedAt: new Date().toISOString(),
    dependency: false,
    managedBy: 'bedrock',
  });
  db.save();
  return { projectId: 'floodgate-spigot', title: 'Floodgate', version: 'última', file: FLOODGATE_SPIGOT_FILE };
}

// Solo estos se quitan al desactivar Bedrock; dependencias como Fabric API se quedan
// porque otros mods pueden necesitarlas.
const MANAGED_IDS = new Set([PROJECTS.geyser, PROJECTS.floodgateMod, PROJECTS.viaVersion, 'floodgate-spigot']);

function markManaged(server, results) {
  const files = new Set(results.filter((r) => !r.error && MANAGED_IDS.has(r.projectId)).map((r) => r.file));
  for (const rec of server.content || []) if (files.has(rec.filename)) rec.managedBy = 'bedrock';
  db.save();
}

/** ¿Ya hay un archivo de ese plugin/mod (instalado por el usuario o por el panel)? */
function hasFile(server, regex, { managedOnly = false } = {}) {
  const items = managedOnly ? managedItems(server) : market.listInstalled(server.id).items;
  return items.some((i) => regex.test(i.filename) || regex.test(i.title));
}

/** Instala (o actualiza) todo lo necesario para Bedrock. */
async function installComponents(server, { floodgate }) {
  const id = server.id;
  const results = [];
  const add = async (label, fn) => {
    try {
      const r = await fn();
      results.push(...(Array.isArray(r) ? r : [r]));
    } catch (err) {
      if (label === 'Geyser') throw err; // sin Geyser no hay nada que hacer
      results.push({ title: label, error: `${label}: ${err.message}` });
    }
  };

  await add('Geyser', () => market.install(id, { source: 'modrinth', projectId: PROJECTS.geyser, title: 'Geyser', icon: null }));
  if (server.type === 'fabric' && !market.listInstalled(id).items.some((i) => i.projectId === PROJECTS.fabricApi)) {
    await add('Fabric API', () => market.install(id, { source: 'modrinth', projectId: PROJECTS.fabricApi }));
  }
  if (floodgate) {
    if (server.type === 'paper') await add('Floodgate', () => installFloodgateSpigot(server));
    else await add('Floodgate', () => market.install(id, { source: 'modrinth', projectId: PROJECTS.floodgateMod }));
  }
  // Si el usuario ya tenía ViaVersion por su cuenta, se respeta su copia.
  const ownVia = hasFile(server, /viaversion/i) && !hasFile(server, /viaversion/i, { managedOnly: true });
  if (!ownVia && (await needsViaVersion(server))) {
    await add('ViaVersion', () => market.install(id, { source: 'modrinth', projectId: PROJECTS.viaVersion }));
  }
  markManaged(requireServer(id), results);
  return results;
}

function removeComponent(server, predicate) {
  for (const item of managedItems(server)) if (predicate(item)) market.uninstall(server.id, item.filename);
}

export async function enable(id, { port, floodgate = true } = {}) {
  const server = requireServer(id);
  if (UNSUPPORTED[server.type]) throw new HttpError(400, UNSUPPORTED[server.type]);
  if (server.installState !== 'ready') throw new HttpError(409, 'Espera a que termine la instalación del servidor');

  const finalPort = Number(port) || server.bedrock?.port || nextBedrockPort(id);
  if (!Number.isInteger(finalPort) || finalPort < 1024 || finalPort > 65535) throw new HttpError(400, 'El puerto Bedrock debe estar entre 1024 y 65535');
  const clash = db.data.servers.find((s) => s.id !== id && s.bedrock?.enabled && Number(s.bedrock.port) === finalPort);
  if (clash) throw new HttpError(409, `El puerto UDP ${finalPort} ya lo usa Bedrock en "${clash.name}"`);
  const alreadyOurs = server.bedrock?.enabled && Number(server.bedrock.port) === finalPort;
  if (!alreadyOurs && !(await isUdpPortFree(finalPort))) {
    throw new HttpError(409, `Otro programa ya está usando el puerto UDP ${finalPort} en esta PC`);
  }

  const results = await installComponents(server, { floodgate });
  if (!floodgate) removeComponent(server, (i) => /floodgate/i.test(i.filename));

  const fresh = requireServer(id);
  fresh.bedrock = { enabled: true, port: finalPort, floodgate: Boolean(floodgate), enabledAt: fresh.bedrock?.enabledAt || new Date().toISOString() };
  db.flush();
  applyGeyserConfig(fresh);
  return { installed: results };
}

/** Actualiza Geyser, Floodgate y ViaVersion a sus últimas versiones compatibles. */
export async function update(id) {
  const server = requireServer(id);
  if (!server.bedrock?.enabled) throw new HttpError(409, 'Bedrock no está activado en este servidor');
  return { installed: await installComponents(server, { floodgate: server.bedrock.floodgate }) };
}

export function disable(id) {
  const server = requireServer(id);
  removeComponent(server, () => true);
  server.bedrock = { ...(server.bedrock || {}), enabled: false };
  db.flush();
}
