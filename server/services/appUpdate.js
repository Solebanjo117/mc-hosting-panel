import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { ROOT, TMP_DIR, VERSION, IS_WINDOWS } from '../config.js';
import { bus } from '../lib/bus.js';
import { download, getJson } from '../lib/http.js';
import { HttpError, compareVersions } from '../lib/util.js';

/**
 * Actualizar el panel desde el propio panel.
 *  - git: si el panel se instaló con "git clone" (los .bat de siempre): git pull, y solo si hace falta
 *    npm install y volver a compilar la interfaz.
 *  - installer: si se instaló con el instalador de Windows (trae su propio Node): descarga el instalador
 *    nuevo de GitHub Releases y lo ejecuta en silencio al cerrar el panel.
 * En los dos casos tus servidores y la carpeta data/ no se tocan. Al terminar, el panel se reinicia
 * (código de salida 75: iniciar.bat lo vuelve a abrir; con el instalador lo abre el instalador).
 */

const APP_ROOT = process.env.MCP_APP_ROOT || ROOT;
const RELEASES_URL = process.env.MCP_UPDATE_URL || 'https://api.github.com/repos/Solebanjo117/mc-hosting-panel/releases/latest';
export const RESTART_CODE = 75;

export function updateMode() {
  if (process.env.MCP_UPDATE_MODE) return process.env.MCP_UPDATE_MODE;
  if (fs.existsSync(path.join(APP_ROOT, '.git'))) return 'git';
  if (fs.existsSync(path.join(APP_ROOT, 'node', IS_WINDOWS ? 'node.exe' : 'node'))) return 'installer';
  return 'manual';
}

function run(cmd, args, { timeout = 10 * 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    // npm en Windows es npm.cmd: necesita shell.
    const shell = IS_WINDOWS && cmd === 'npm';
    execFile(cmd, args, { cwd: APP_ROOT, timeout, windowsHide: true, shell, maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const detail = String(stderr || stdout || err.message).trim().split(/\r?\n/).slice(-6).join('\n');
        reject(Object.assign(new Error(`${cmd} ${args[0]} falló: ${detail}`), { code: err.code }));
      } else resolve(String(stdout).trim());
    });
  });
}

const git = (...args) => run('git', args, { timeout: 120_000 });

let lastCheck = null;
const state = { running: false, step: null, log: [], error: null, done: false };

function step(text) {
  state.step = text;
  state.log.push(`${new Date().toTimeString().slice(0, 8)} ${text}`);
  bus.emit('app-update', publicState());
}

function publicState() {
  return { running: state.running, step: state.step, log: state.log.slice(-30), error: state.error, done: state.done };
}

/** ¿Hay versión nueva? */
export async function checkUpdate() {
  const mode = updateMode();
  const base = { mode, current: VERSION, checkedAt: new Date().toISOString() };
  if (mode === 'git') {
    try {
      await git('fetch', '--quiet');
    } catch (err) {
      throw new HttpError(502, `No se pudo consultar GitHub con git: ${err.message.split('\n')[0]}`);
    }
    let behind = 0;
    try {
      behind = Number(await git('rev-list', '--count', 'HEAD..@{u}')) || 0;
    } catch {
      throw new HttpError(409, 'Esta copia del panel no sigue a ninguna rama de GitHub; actualízala a mano con git.');
    }
    const changes = behind
      ? (await git('log', '--format=%h%x09%s', '-n', '30', 'HEAD..@{u}'))
          .split('\n')
          .filter(Boolean)
          .map((l) => {
            const [hash, ...rest] = l.split('\t');
            return { hash, subject: rest.join('\t') };
          })
      : [];
    const dirty = (await git('status', '--porcelain', '--untracked-files=no')).split('\n').filter(Boolean);
    let latest = VERSION;
    if (behind) {
      try {
        latest = JSON.parse(await git('show', '@{u}:package.json')).version || VERSION;
      } catch {
        /* sin package.json */
      }
    }
    lastCheck = { ...base, available: behind > 0, latest, behind, changes, dirty: dirty.length > 0 };
    return lastCheck;
  }
  if (mode === 'installer') {
    let rel;
    try {
      rel = await getJson(RELEASES_URL, { headers: { Accept: 'application/vnd.github+json' } });
    } catch (err) {
      throw new HttpError(
        502,
        err.status === 404
          ? 'No hay versiones publicadas en GitHub Releases (o el repositorio es privado).'
          : `No se pudo consultar las versiones publicadas: ${err.message}`
      );
    }
    const latest = String(rel.tag_name || '').replace(/^v/, '');
    const asset = (rel.assets || []).find((a) => /\.exe$/i.test(a.name));
    lastCheck = {
      ...base,
      available: Boolean(latest && asset && compareVersions(latest, VERSION) > 0),
      latest,
      notes: String(rel.body || '').slice(0, 4000),
      changes: [],
      asset: asset ? { name: asset.name, url: asset.browser_download_url, size: asset.size } : null,
    };
    return lastCheck;
  }
  lastCheck = {
    ...base,
    available: false,
    latest: VERSION,
    changes: [],
    message: 'Esta copia no se instaló con git ni con el instalador: descarga la versión nueva y reemplaza los archivos conservando la carpeta data.',
  };
  return lastCheck;
}

export function updateStatus() {
  return { ...publicState(), mode: updateMode(), current: VERSION, lastCheck };
}

/** Pide al panel que se cierre ordenadamente y se vuelva a abrir (lo maneja index.js). */
function requestRestart(afterExit = null) {
  if (process.env.MCP_UPDATE_NO_RESTART) return; // pruebas
  setTimeout(() => bus.emit('app-restart', { code: RESTART_CODE, afterExit }), 1500);
}

async function applyGit() {
  const before = await git('rev-parse', 'HEAD');
  step('Descargando la versión nueva (git pull)…');
  await git('pull', '--ff-only');
  const after = await git('rev-parse', 'HEAD');
  if (before === after) {
    step('Ya tenías la versión más reciente.');
    return false;
  }
  const changed = (await git('diff', '--name-only', before, after)).split('\n').filter(Boolean);
  if (changed.some((f) => f === 'package.json' || f === 'package-lock.json')) {
    step('Instalando dependencias nuevas (npm install)…');
    await run('npm', ['install', '--no-audit', '--no-fund']);
  }
  if (changed.some((f) => f.startsWith('client/') || f === 'vite.config.js' || f === 'package.json' || f === 'package-lock.json')) {
    step('Compilando la interfaz (npm run build)…');
    await run('npm', ['run', 'build']);
  }
  return true;
}

async function applyInstaller() {
  const check = lastCheck?.mode === 'installer' ? lastCheck : await checkUpdate();
  if (!check.available || !check.asset) {
    step('Ya tenías la versión más reciente.');
    return false;
  }
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const file = path.join(TMP_DIR, check.asset.name.replace(/[^\w.-]/g, '_'));
  step(`Descargando ${check.asset.name}…`);
  await download(check.asset.url, file);
  step('Listo. El panel se cierra, se instala la versión nueva y vuelve a abrirse solo.');
  // Se ejecuta cuando el panel ya cerró (si no, no podría reemplazar node.exe).
  return () =>
    spawn('cmd', ['/c', 'timeout', '/t', '3', '/nobreak', '>nul', '&', file, '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref();
}

/** Actualiza en segundo plano; el avance se consulta con updateStatus() o llega por WebSocket. */
export function startUpdate() {
  if (state.running) throw new HttpError(409, 'Ya se está actualizando');
  const mode = updateMode();
  if (mode === 'manual') throw new HttpError(409, 'Esta copia no se puede actualizar sola; descarga la versión nueva y reemplaza los archivos (conserva data).');
  Object.assign(state, { running: true, step: null, log: [], error: null, done: false });
  (async () => {
    try {
      const result = mode === 'git' ? await applyGit() : await applyInstaller();
      state.done = true;
      if (result) {
        step('Actualización lista. Reiniciando el panel…');
        requestRestart(typeof result === 'function' ? result : null);
      }
    } catch (err) {
      state.error = err.message;
      step(`Error: ${err.message}`);
    } finally {
      state.running = false;
      bus.emit('app-update', publicState());
    }
  })();
  return updateStatus();
}
