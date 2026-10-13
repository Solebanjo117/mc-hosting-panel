import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.resolve(process.env.MCP_DATA_DIR || path.join(ROOT, 'data'));
export const SERVERS_DIR = path.join(DATA_DIR, 'servers');
export const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
export const JAVA_DIR = path.join(DATA_DIR, 'java');
export const TMP_DIR = path.join(DATA_DIR, 'tmp');
export const DIST_DIR = path.join(ROOT, 'dist');
export const DOCS_DIR = path.join(ROOT, 'docs');

export const VERSION = '0.10.2';
// Modrinth, PaperMC y mcsrvstat piden un User-Agent que identifique el proyecto y un contacto.
export const USER_AGENT = `Solebanjo117/mc-hosting-panel/${VERSION} (https://github.com/Solebanjo117/mc-hosting-panel)`;

export const IS_WINDOWS = process.platform === 'win32';
export const DEFAULT_PANEL_PORT = 8080;
export const DEFAULT_MC_PORT = 25565;

for (const dir of [DATA_DIR, SERVERS_DIR, BACKUPS_DIR, JAVA_DIR, TMP_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

export const serverDir = (id) => path.join(SERVERS_DIR, id);
export const backupDir = (id) => path.join(BACKUPS_DIR, id);
