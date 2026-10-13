import fs from 'node:fs';
import path from 'node:path';
import { serverDir } from '../config.js';
import { db, getServer } from '../db.js';
import { HttpError, compareVersions } from '../lib/util.js';
import { readProperties, writeProperties } from './properties.js';
import * as market from './marketplace.js';

/**
 * Optimización de un clic. Solo ajustes que no cambian cómo se juega:
 *  - Java: parámetros de Aikar (recolector de basura G1 afinado para Minecraft) y memoria fija.
 *  - server.properties: distancias razonables y guardado de chunks sin bloquear (Paper).
 *  - Paper: explosiones optimizadas, menos choques entre mobs, guardado repartido…
 *  - Fabric / Forge / NeoForge: mods de rendimiento que solo van en el servidor (Lithium, FerriteCore, ModernFix).
 * Antes de cambiar algo se guarda el valor anterior para poder deshacerlo.
 */

// https://docs.papermc.io/paper/aikars-flags
export function aikarFlags(memMb) {
  const big = memMb >= 12 * 1024;
  return [
    '-XX:+UseG1GC',
    '-XX:+ParallelRefProcEnabled',
    '-XX:MaxGCPauseMillis=200',
    '-XX:+UnlockExperimentalVMOptions',
    '-XX:+DisableExplicitGC',
    '-XX:+AlwaysPreTouch',
    `-XX:G1NewSizePercent=${big ? 40 : 30}`,
    `-XX:G1MaxNewSizePercent=${big ? 50 : 40}`,
    `-XX:G1HeapRegionSize=${big ? '16M' : '8M'}`,
    `-XX:G1ReservePercent=${big ? 15 : 20}`,
    '-XX:G1HeapWastePercent=5',
    '-XX:G1MixedGCCountTarget=4',
    `-XX:InitiatingHeapOccupancyPercent=${big ? 20 : 15}`,
    '-XX:G1MixedGCLiveThresholdPercent=90',
    '-XX:G1RSetUpdatingPauseTimePercent=5',
    '-XX:SurvivorRatio=32',
    '-XX:+PerfDisableSharedMem',
    '-XX:MaxTenuringThreshold=1',
    '-Dusing.aikars.flags=https://mcflags.emc.gs',
    '-Daikars.new.flags=true',
  ];
}

const PROP_DEFAULTS = { 'view-distance': '10', 'simulation-distance': '10', 'sync-chunk-writes': 'true' };

const PAPER_FILE = 'config/paper-world-defaults.yml';
const PAPER_TWEAKS = [
  { path: ['environment', 'optimize-explosions'], value: 'true', label: 'Explosiones optimizadas (mismo resultado, menos cálculo)' },
  { path: ['collisions', 'max-entity-collisions'], value: '2', label: 'Menos choques calculados entre mobs amontonados' },
  { path: ['chunks', 'max-auto-save-chunks-per-tick'], value: '8', label: 'Guardado automático repartido (evita tirones)' },
  { path: ['chunks', 'prevent-moving-into-unloaded-chunks'], value: 'true', label: 'Evita que jugadores rápidos entren a zonas sin cargar' },
  { path: ['tick-rates', 'mob-spawner'], value: '2', label: 'Generadores de mobs revisados cada 2 ticks' },
];

const PERF_MODS = {
  fabric: [
    { slug: 'lithium', title: 'Lithium', re: /lithium/i, what: 'optimiza la lógica del juego (mobs, física, redstone) sin cambiar nada' },
    { slug: 'ferrite-core', title: 'FerriteCore', re: /ferrite/i, what: 'reduce mucho el uso de memoria' },
    { slug: 'modernfix', title: 'ModernFix', re: /modernfix/i, what: 'arranque más rápido y menos memoria' },
  ],
  forge: [
    { slug: 'ferrite-core', title: 'FerriteCore', re: /ferrite/i, what: 'reduce mucho el uso de memoria' },
    { slug: 'modernfix', title: 'ModernFix', re: /modernfix/i, what: 'arranque más rápido y menos memoria' },
  ],
  neoforge: [
    { slug: 'ferrite-core', title: 'FerriteCore', re: /ferrite/i, what: 'reduce mucho el uso de memoria' },
    { slug: 'modernfix', title: 'ModernFix', re: /modernfix/i, what: 'arranque más rápido y menos memoria' },
  ],
};

// --- YAML anidado (solo cambia una línea; respeta el resto del archivo) ------------------

function findYaml(lines, keys) {
  let start = 0;
  let parentIndent = -1;
  let idx = -1;
  for (const key of keys) {
    let childIndent = null;
    idx = -1;
    for (let i = start; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim() || line.trim().startsWith('#')) continue;
      const ind = line.match(/^ */)[0].length;
      if (ind <= parentIndent) break;
      if (childIndent === null) childIndent = ind;
      if (ind !== childIndent) continue;
      const m = line.match(/^ *['"]?([^'":#]+?)['"]?\s*:(.*)$/);
      if (m && m[1] === key) {
        idx = i;
        break;
      }
    }
    if (idx === -1) return -1;
    start = idx + 1;
    parentIndent = lines[idx].match(/^ */)[0].length;
  }
  return idx;
}

export function getYamlPath(text, keys) {
  const lines = text.split(/\r?\n/);
  const i = findYaml(lines, keys);
  if (i === -1) return undefined;
  return lines[i].split(':').slice(1).join(':').trim().replace(/^['"]|['"]$/g, '');
}

export function setYamlPath(text, keys, value) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const i = findYaml(lines, keys);
  if (i === -1) return { text, changed: false, found: false };
  const m = lines[i].match(/^( *['"]?[^'":#]+?['"]?\s*:)/);
  const next = `${m[1]} ${value}`;
  const changed = next !== lines[i];
  lines[i] = next;
  return { text: lines.join(eol), changed, found: true };
}

// --- Estado y aplicación -------------------------------------------------------------

function requireServer(id) {
  const server = getServer(id);
  if (!server) throw new HttpError(404, 'Servidor no encontrado');
  return server;
}

function propTweaks(server, props) {
  const out = [];
  const view = Number(props['view-distance'] || 10);
  out.push({ id: 'view-distance', label: 'Distancia de visión', current: String(view), recommended: String(Math.min(view, 10)), note: 'Más de 10 chunks multiplica el trabajo del servidor.' });
  const sim = Number(props['simulation-distance'] || 10);
  if (compareVersions(server.mcVersion, '1.18') >= 0) {
    out.push({ id: 'simulation-distance', label: 'Distancia de simulación', current: String(sim), recommended: String(Math.min(sim, 8)), note: 'Hasta dónde se mueven mobs y cultivos. 8 casi no se nota al jugar.' });
  }
  if (server.type === 'paper') {
    out.push({ id: 'sync-chunk-writes', label: 'Guardar chunks sin frenar el juego', current: props['sync-chunk-writes'] ?? 'true', recommended: 'false', note: 'Recomendado por Paper.' });
  }
  return out.map((t) => ({ ...t, applied: t.current === t.recommended }));
}

export function status(id) {
  const server = requireServer(id);
  const dir = serverDir(id);
  const props = readProperties(id);
  const items = [];

  items.push({
    id: 'aikar',
    group: 'Java',
    label: 'Parámetros de Java optimizados (Aikar)',
    note: 'El recolector de memoria se ajusta para Minecraft: menos pausas y tirones. La memoria mínima y máxima quedan iguales.',
    applied: Boolean(server.aikarFlags),
  });

  for (const t of propTweaks(server, props)) items.push({ group: 'server.properties', ...t, label: t.applied ? `${t.label}: ${t.current}` : `${t.label}: ${t.current} → ${t.recommended}` });

  let paperMissing = false;
  if (server.type === 'paper') {
    const file = path.join(dir, PAPER_FILE);
    if (!fs.existsSync(file)) paperMissing = compareVersions(server.mcVersion, '1.19') >= 0;
    else {
      const text = fs.readFileSync(file, 'utf8');
      for (const t of PAPER_TWEAKS) {
        const current = getYamlPath(text, t.path);
        if (current === undefined) continue;
        items.push({ id: `paper:${t.path.join('.')}`, group: 'Paper', label: t.label, current, recommended: t.value, applied: current === t.value });
      }
    }
  }

  const mods = PERF_MODS[server.type] || [];
  if (mods.length) {
    const installed = market.listInstalled(id).items;
    for (const m of mods) {
      items.push({ id: `mod:${m.slug}`, group: 'Mods de rendimiento', label: `${m.title}: ${m.what}`, applied: installed.some((i) => m.re.test(i.filename) || m.re.test(i.title)) });
    }
  }

  return {
    items,
    pending: items.filter((i) => !i.applied).length,
    paperMissing,
    canUndo: Boolean(server.optimization?.previous),
    optimizedAt: server.optimization?.at || null,
  };
}

/** Aplica todo lo pendiente (o solo los ids indicados). */
export async function apply(id, only = null) {
  const server = requireServer(id);
  const want = (itemId) => !only || only.includes(itemId);
  const prev = server.optimization?.previous || { props: {}, paper: {}, aikar: Boolean(server.aikarFlags) };
  const results = [];

  if (want('aikar') && !server.aikarFlags) {
    server.aikarFlags = true;
    results.push('Parámetros de Java optimizados');
  }

  const props = readProperties(id);
  const changes = {};
  for (const t of propTweaks(server, props)) {
    if (t.applied || !want(t.id)) continue;
    // Si la clave no existía, se guarda el valor que usa Minecraft por defecto para poder volver a él.
    if (!(t.id in prev.props)) prev.props[t.id] = props[t.id] ?? PROP_DEFAULTS[t.id];
    changes[t.id] = t.recommended;
  }
  if (Object.keys(changes).length) {
    writeProperties(id, changes);
    results.push('server.properties ajustado');
  }

  if (server.type === 'paper') {
    const file = path.join(serverDir(id), PAPER_FILE);
    if (fs.existsSync(file)) {
      let text = fs.readFileSync(file, 'utf8');
      let changed = false;
      for (const t of PAPER_TWEAKS) {
        const key = t.path.join('.');
        if (!want(`paper:${key}`)) continue;
        const current = getYamlPath(text, t.path);
        if (current === undefined || current === t.value) continue;
        if (!(key in prev.paper)) prev.paper[key] = current;
        const r = setYamlPath(text, t.path, t.value);
        text = r.text;
        changed ||= r.changed;
      }
      if (changed) {
        if (!fs.existsSync(`${file}.panel-bak`)) fs.copyFileSync(file, `${file}.panel-bak`);
        fs.writeFileSync(file, text);
        results.push('Ajustes de Paper aplicados');
      }
    }
  }

  const errors = [];
  for (const m of PERF_MODS[server.type] || []) {
    if (!want(`mod:${m.slug}`)) continue;
    const installed = market.listInstalled(id).items.some((i) => m.re.test(i.filename) || m.re.test(i.title));
    if (installed) continue;
    try {
      await market.install(id, { source: 'modrinth', projectId: m.slug });
      results.push(`${m.title} instalado`);
    } catch (err) {
      errors.push(`${m.title}: ${err.message}`);
    }
  }

  server.optimization = { at: new Date().toISOString(), previous: prev };
  db.flush();
  return { ...status(id), results, errors };
}

/** Vuelve los ajustes a como estaban (los mods instalados se quitan desde la pestaña de mods). */
export function undo(id) {
  const server = requireServer(id);
  const prev = server.optimization?.previous;
  if (!prev) throw new HttpError(409, 'No hay nada que deshacer');
  server.aikarFlags = prev.aikar;
  const props = Object.fromEntries(Object.entries(prev.props).map(([k, v]) => [k, v ?? PROP_DEFAULTS[k]]).filter(([, v]) => v != null));
  if (Object.keys(props).length) writeProperties(id, props);
  const file = path.join(serverDir(id), PAPER_FILE);
  if (fs.existsSync(file) && Object.keys(prev.paper).length) {
    let text = fs.readFileSync(file, 'utf8');
    for (const [key, value] of Object.entries(prev.paper)) text = setYamlPath(text, key.split('.'), value).text;
    fs.writeFileSync(file, text);
  }
  server.optimization = null;
  db.flush();
  return status(id);
}
