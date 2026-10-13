import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { serverDir } from '../config.js';
import { db, getServer } from '../db.js';
import { HttpError } from '../lib/util.js';
import * as market from './marketplace.js';
import { readProperties } from './properties.js';

/**
 * Mapa del mundo con BlueMap (3D, en el navegador). Funciona en Paper, Fabric, Forge y NeoForge.
 *
 * BlueMap trae su propio servidor web. El panel:
 *  - lo instala desde Modrinth,
 *  - acepta la descarga de recursos que BlueMap necesita (accept-download) y le da un puerto propio,
 *    escuchando solo en esta PC (127.0.0.1),
 *  - y lo muestra dentro del panel a través de /api/servers/:id/map/view/, con la misma sesión.
 */

const PROJECT = 'bluemap';
const BASE_PORT = 8100;
const CONFIG_DIRS = { paper: 'plugins/BlueMap', fabric: 'config/bluemap', forge: 'config/bluemap', neoforge: 'config/bluemap' };

function requireServer(id) {
  const server = getServer(id);
  if (!server) throw new HttpError(404, 'Servidor no encontrado');
  return server;
}

export function nextMapPort(exceptId) {
  const used = new Set(db.data.servers.filter((s) => s.id !== exceptId && s.map?.enabled).map((s) => Number(s.map.port)));
  used.add(Number(db.data.settings.panelPort));
  let port = BASE_PORT;
  while (used.has(port)) port += 1;
  return port;
}

const configDir = (server) => (CONFIG_DIRS[server.type] ? path.join(serverDir(server.id), CONFIG_DIRS[server.type]) : null);

export function status(id) {
  const server = requireServer(id);
  const supported = Boolean(CONFIG_DIRS[server.type]);
  const installed = market.listInstalled(id).items.find((i) => i.projectId === PROJECT || /bluemap/i.test(i.filename));
  return {
    supported,
    reason: supported ? null : 'Vanilla no admite plugins ni mods. Crea un servidor Paper (se juega igual) para tener mapa.',
    enabled: Boolean(server.map?.enabled),
    installed: Boolean(installed),
    port: server.map?.port || null,
    configured: applyConfig(server, { dryRun: true }) === 'ok',
  };
}

export async function enable(id) {
  const server = requireServer(id);
  if (!CONFIG_DIRS[server.type]) throw new HttpError(400, status(id).reason);
  if (server.installState !== 'ready') throw new HttpError(409, 'Espera a que termine la instalación del servidor');
  const results = await market.install(id, { source: 'modrinth', projectId: PROJECT });
  const main = results.find((r) => r.projectId === PROJECT || /bluemap/i.test(r.file || ''));
  if (!main || main.error) throw new HttpError(502, main?.error || 'No se pudo instalar BlueMap');
  server.map = { enabled: true, port: server.map?.port || nextMapPort(id), world: readProperties(id)['level-name'] || 'world' };
  db.flush();
  return { ...status(id), installedNow: results };
}

export function disable(id) {
  const server = requireServer(id);
  for (const item of market.listInstalled(id).items) {
    if (item.projectId === PROJECT || /bluemap/i.test(item.filename)) market.uninstall(id, item.filename);
  }
  server.map = { enabled: false };
  db.flush();
  return status(id);
}

/**
 * Ajusta core.conf y webserver.conf. BlueMap los crea en su primer arranque.
 * Devuelve 'missing' (aún no existen), 'changed' u 'ok'.
 */
export function applyConfig(server, { dryRun = false } = {}) {
  const dir = configDir(server);
  if (!dir || !server.map?.enabled) return 'missing';
  const core = path.join(dir, 'core.conf');
  const web = path.join(dir, 'webserver.conf');
  if (!fs.existsSync(core) || !fs.existsSync(web)) return 'missing';
  let changed = false;

  const patch = (file, edits) => {
    let text = fs.readFileSync(file, 'utf8');
    const before = text;
    for (const [re, line, append] of edits) {
      if (re.test(text)) text = text.replace(re, (m, indent = '') => `${indent}${line}`);
      else if (append) text = `${text.replace(/\s*$/, '')}\n${line}\n`;
    }
    if (text !== before) {
      changed = true;
      if (!dryRun) fs.writeFileSync(file, text);
    }
  };
  patch(core, [[/^([ \t]*)accept-download\s*:\s*\w+/m, 'accept-download: true', true]]);
  patch(web, [
    [/^([ \t]*)port\s*:\s*\d+/m, `port: ${server.map.port}`, true],
    // Solo esta PC: tus amigos lo ven a través del panel, no hace falta abrir otro puerto.
    [/^([ \t]*)#?\s*ip\s*:\s*"[^"]*"/m, 'ip: "127.0.0.1"', true],
  ]);
  return changed ? 'changed' : 'ok';
}

/** Pasa las peticiones del navegador al servidor web de BlueMap. */
export function proxy(req, res) {
  const server = requireServer(req.params.id);
  if (!server.map?.enabled) throw new HttpError(404, 'El mapa no está activado');
  if (!['GET', 'HEAD'].includes(req.method)) throw new HttpError(405, 'Solo lectura');
  const upstream = http.request(
    {
      host: '127.0.0.1',
      port: server.map.port,
      method: req.method,
      path: req.url || '/',
      headers: { accept: req.headers.accept || '*/*', 'accept-encoding': req.headers['accept-encoding'] || 'identity' },
      timeout: 15000,
    },
    (up) => {
      const headers = { ...up.headers };
      delete headers['x-frame-options'];
      // Si el mapa se vuelve a dibujar (mundo nuevo), el navegador no debe mostrar imágenes viejas.
      headers['cache-control'] = 'no-cache';
      delete headers['content-security-policy'];
      res.removeHeader('X-Frame-Options');
      // BlueMap usa WebGL, workers y estilos propios; solo se permite meterlo dentro del panel.
      res.setHeader('Content-Security-Policy', "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; img-src 'self' data: blob: https:; frame-ancestors 'self'");
      res.writeHead(up.statusCode || 502, headers);
      up.pipe(res);
    }
  );
  upstream.on('timeout', () => upstream.destroy(new Error('timeout')));
  upstream.on('error', () => {
    if (res.headersSent) return res.end();
    res.removeHeader('X-Frame-Options');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'");
    res
      .status(502)
      .type('html')
      .send(
        '<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;background:#161c2a;color:#ece5d3;padding:2rem">' +
          '<h2>El mapa todavía no responde</h2><p>Enciende el servidor y espera a que BlueMap arranque (la primera vez tarda un poco más porque descarga sus recursos).</p></body>'
      );
  });
  upstream.end();
}

// --- El mapa sigue al mundo activo --------------------------------------------------

const DIM_SUFFIX = /(_nether|_the_end)$/;
const WORLD_LINE = /^(\s*world\s*:\s*)(["']?)([^"'\n#]*?)\2(\s*(?:#.*)?)$/m;

/** Dónde guarda BlueMap lo que ya dibujó (storages/file.conf, por defecto bluemap/web/maps). */
function tilesRoot(server) {
  const dir = configDir(server);
  let root = 'bluemap/web/maps';
  try {
    const m = fs.readFileSync(path.join(dir, 'storages', 'file.conf'), 'utf8').match(/^\s*root\s*:\s*"([^"]+)"/m);
    if (m) root = m[1];
  } catch {
    /* sin archivo: valor por defecto */
  }
  return path.resolve(serverDir(server.id), root);
}

/**
 * Al borrar un mundo: quita los mapas de BlueMap que lo mostraban (también Nether y End)
 * y lo que tenían dibujado, para que no queden mapas de un mundo que ya no existe.
 * Devuelve cuántos mapas quitó.
 */
export function forgetWorld(server, world) {
  const dir = configDir(server);
  const mapsDir = dir && path.join(dir, 'maps');
  if (!mapsDir || !fs.existsSync(mapsDir)) return 0;
  const tiles = tilesRoot(server);
  let removed = 0;
  for (const f of fs.readdirSync(mapsDir).filter((x) => x.endsWith('.conf'))) {
    const file = path.join(mapsDir, f);
    const m = fs.readFileSync(file, 'utf8').match(WORLD_LINE);
    if (!m) continue;
    const folder = m[3].trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
    if (folder.replace(DIM_SUFFIX, '') !== world) continue;
    fs.rmSync(file, { force: true });
    const rendered = path.join(tiles, f.slice(0, -5));
    if (rendered.startsWith(tiles + path.sep)) fs.rmSync(rendered, { recursive: true, force: true });
    removed++;
  }
  return removed;
}

/**
 * BlueMap crea sus mapas apuntando a la carpeta del mundo que había al activarlo ("world").
 * Si después creas o cambias de mundo, seguiría mostrando el anterior: aquí se apuntan los mapas
 * al mundo activo (con su Nether y su End) y se borra lo dibujado para que lo vuelva a dibujar.
 * Se llama al encender (con el servidor apagado no hay nada que BlueMap esté leyendo).
 * Devuelve un mensaje si cambió algo.
 */
export function followActiveWorld(server) {
  const dir = configDir(server);
  if (!dir || !server.map?.enabled) return null;
  const mapsDir = path.join(dir, 'maps');
  if (!fs.existsSync(mapsDir)) return null;
  const active = readProperties(server.id)['level-name'] || 'world';

  const maps = [];
  for (const f of fs.readdirSync(mapsDir).filter((x) => x.endsWith('.conf'))) {
    const file = path.join(mapsDir, f);
    const text = fs.readFileSync(file, 'utf8');
    const m = text.match(WORLD_LINE);
    if (!m) continue;
    const value = m[3].trim();
    const folder = value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
    if (folder.includes('/')) continue; // ruta rara (otra carpeta): no se toca
    maps.push({ id: f.slice(0, -5), file, text, folder, base: folder.replace(DIM_SUFFIX, ''), suffix: (folder.match(DIM_SUFFIX) || [''])[0] });
  }
  // ¿Cuál era el mundo del mapa? El que el panel recuerda o, en instalaciones viejas, el único que aparece.
  let previous = server.map.world;
  if (!previous) {
    const bases = [...new Set(maps.map((x) => x.base))];
    previous = bases.length === 1 ? bases[0] : active;
  }
  if (previous === active) {
    if (server.map.world !== active) {
      server.map.world = active;
      db.flush();
    }
    return null;
  }

  // Solo se cambian los mapas del mundo anterior; mundos extra (Multiverse, etc.) se respetan.
  const changed = maps.filter((x) => x.base === previous);
  const tiles = tilesRoot(server);
  for (const x of changed) {
    fs.writeFileSync(x.file, x.text.replace(WORLD_LINE, (_all, pre, q, _v, post) => `${pre}${q || '"'}${active}${x.suffix}${q || '"'}${post}`));
    const rendered = path.join(tiles, x.id);
    if (rendered.startsWith(tiles + path.sep)) fs.rmSync(rendered, { recursive: true, force: true });
  }
  server.map.world = active;
  db.flush();
  return changed.length ? `El mapa ahora muestra el mundo "${active}". BlueMap lo vuelve a dibujar desde cero (tarda unos minutos).` : null;
}
