import fs from 'node:fs';
import path from 'node:path';
import { serverDir } from '../config.js';

/**
 * Configuración de Geyser. Geyser crea su config.yml en el primer arranque;
 * el panel solo toca unas pocas líneas (puerto UDP y tipo de autenticación)
 * para no pelear con el formato que use cada versión de Geyser.
 */

export const GEYSER_CONFIG_PATHS = {
  paper: 'plugins/Geyser-Spigot/config.yml',
  fabric: 'config/Geyser-Fabric/config.yml',
  neoforge: 'config/Geyser-NeoForge/config.yml',
};

export function geyserConfigFile(server) {
  const rel = GEYSER_CONFIG_PATHS[server.type];
  return rel ? path.join(serverDir(server.id), rel) : null;
}

/**
 * Cambia el valor de `key` dentro de la sección de primer nivel `section`.
 * Devuelve el texto nuevo y si hubo cambios.
 */
export function setYamlValue(text, section, key, value) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^${section}:\\s*(#.*)?$`).test(l));
  if (start === -1) return { text, changed: false, found: false };
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\S/.test(line) && !line.startsWith('#')) break; // empezó otra sección
    const m = line.match(new RegExp(`^(\\s+)${key}:\\s*([^#]*?)(\\s+#.*)?$`));
    if (m) {
      const current = m[2].trim().replace(/^["']|["']$/g, '');
      if (current === String(value)) return { text, changed: false, found: true };
      lines[i] = `${m[1]}${key}: ${value}${m[3] || ''}`;
      return { text: lines.join('\n'), changed: true, found: true };
    }
  }
  return { text, changed: false, found: false };
}

export function readGeyserPort(server) {
  const file = geyserConfigFile(server);
  if (!file || !fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^bedrock:/.test(l));
  if (start === -1) return null;
  for (let i = start + 1; i < lines.length && !/^\S/.test(lines[i]); i++) {
    const m = lines[i].match(/^\s+port:\s*(\d+)/);
    if (m) return Number(m[1]);
  }
  return null;
}

/**
 * Aplica el puerto Bedrock y la autenticación al config.yml si ya existe.
 * Devuelve 'missing' si Geyser todavía no lo ha creado, 'changed' o 'unchanged'.
 */
export function applyGeyserConfig(server) {
  const file = geyserConfigFile(server);
  if (!file || !server.bedrock?.enabled) return 'unchanged';
  if (!fs.existsSync(file)) return 'missing';
  let text = fs.readFileSync(file, 'utf8');
  let changed = false;
  const edits = [
    ['bedrock', 'port', server.bedrock.port],
    ['bedrock', 'clone-remote-port', 'false'],
    // En versiones de Geyser con sección "remote" (o "java"), con Floodgate la autenticación es "floodgate".
    ['remote', 'auth-type', server.bedrock.floodgate ? 'floodgate' : 'online'],
    ['java', 'auth-type', server.bedrock.floodgate ? 'floodgate' : 'online'],
  ];
  for (const [section, key, value] of edits) {
    const r = setYamlValue(text, section, key, value);
    text = r.text;
    changed ||= r.changed;
  }
  if (changed) fs.writeFileSync(file, text);
  return changed ? 'changed' : 'unchanged';
}
