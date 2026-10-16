import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { ROOT, IS_WINDOWS } from '../config.js';
import { HttpError } from '../lib/util.js';
import { updateMode } from './appUpdate.js';

/**
 * Abrir el panel al iniciar sesión en Windows: un acceso directo en la carpeta "Inicio" del usuario
 * (el mismo que crean scripts/inicio-automatico.bat y el instalador, así se reconocen entre sí).
 */

const APP_ROOT = process.env.MCP_APP_ROOT || ROOT;
const LINK_NAME = 'MC Hosting Panel.lnk';

function startupDir() {
  if (process.env.MCP_STARTUP_DIR) return process.env.MCP_STARTUP_DIR;
  return path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
}

const linkPath = () => path.join(startupDir(), LINK_NAME);
const supported = () => IS_WINDOWS && Boolean(process.env.MCP_STARTUP_DIR || process.env.APPDATA);

/** A qué apunta el acceso directo según cómo se instaló el panel. */
function target() {
  if (updateMode() === 'installer') {
    return { file: path.join(APP_ROOT, 'node', 'node.exe'), args: 'server\\index.js' };
  }
  return { file: path.join(APP_ROOT, 'iniciar.bat'), args: 'minimizado' };
}

export function startupStatus() {
  if (!supported()) return { supported: false, enabled: false };
  return { supported: true, enabled: fs.existsSync(linkPath()), path: linkPath() };
}

const ps = (s) => `'${String(s).replace(/'/g, "''")}'`;

export async function setStartup(enabled) {
  if (!supported()) throw new HttpError(400, 'El inicio automático solo está disponible en Windows');
  const link = linkPath();
  if (!enabled) {
    fs.rmSync(link, { force: true });
    return startupStatus();
  }
  fs.mkdirSync(startupDir(), { recursive: true });
  const t = target();
  const script = [
    `$s = (New-Object -ComObject WScript.Shell).CreateShortcut(${ps(link)})`,
    `$s.TargetPath = ${ps(t.file)}`,
    `$s.Arguments = ${ps(t.args)}`,
    `$s.WorkingDirectory = ${ps(APP_ROOT)}`,
    // 7 = minimizada: el panel arranca sin estorbar; se usa desde el navegador.
    '$s.WindowStyle = 7',
    `$s.Description = ${ps('MC Hosting Panel')}`,
    '$s.Save()',
  ].join('; ');
  await new Promise((resolve, reject) =>
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 30_000 }, (err, _out, stderr) =>
      err ? reject(new HttpError(500, `No se pudo crear el acceso directo: ${String(stderr || err.message).trim().slice(0, 300)}`)) : resolve()
    )
  );
  if (!fs.existsSync(link)) throw new HttpError(500, 'No se pudo crear el acceso directo de inicio');
  return startupStatus();
}
