import fs from 'node:fs';
import path from 'node:path';
import archiver from 'archiver';
import AdmZip from 'adm-zip';
import { serverDir, backupDir } from '../config.js';
import { db, getServer } from '../db.js';
import { HttpError, safeJoin } from '../lib/util.js';
import { instance, isRunning } from './processManager.js';
import { readProperties } from './properties.js';

// Carpetas que se regeneran solas y no vale la pena respaldar.
const EXCLUDE = new Set(['libraries', 'versions', 'cache', 'logs', 'crash-reports', '.fabric', '.paper-remapped', 'bundler']);

function worldFolders(id) {
  const level = readProperties(id)['level-name'] || 'world';
  const dir = serverDir(id);
  return [level, `${level}_nether`, `${level}_the_end`].filter((f) => fs.existsSync(path.join(dir, f)));
}

export function listBackups(id) {
  const dir = backupDir(id);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.zip'))
    .map((f) => {
      const st = fs.statSync(path.join(dir, f));
      return { file: f, size: st.size, createdAt: st.mtime.toISOString(), mode: f.includes('-mundo-') ? 'mundo' : 'completo' };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

const active = new Set();

export async function createBackup(id, mode = 'completo', reason = 'manual') {
  const server = getServer(id);
  if (!server) throw new HttpError(404, 'Servidor no encontrado');
  if (active.has(id)) throw new HttpError(409, 'Ya se está creando un respaldo');
  active.add(id);
  const inst = instance(id);
  const running = isRunning(id) && inst.status === 'running';
  try {
    if (running) {
      // Congela el guardado para que el mundo no cambie mientras se comprime.
      inst.send('save-off');
      inst.send('save-all flush');
      await inst.waitForLine(/Saved the game|Saved the world/i, 30_000);
    }
    const src = serverDir(id);
    const out = backupDir(id);
    fs.mkdirSync(out, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const file = `${stamp}-${mode}-${reason}.zip`;
    const dest = path.join(out, file);

    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(`${dest}.part`);
      const zip = archiver('zip', { zlib: { level: 6 } });
      output.on('close', resolve);
      zip.on('error', reject);
      zip.on('warning', (err) => console.warn('[backup]', err.message));
      zip.pipe(output);
      if (mode === 'mundo') {
        for (const w of worldFolders(id)) zip.directory(path.join(src, w), w);
      } else {
        for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
          if (EXCLUDE.has(entry.name)) continue;
          if (entry.isDirectory()) zip.directory(path.join(src, entry.name), entry.name);
          else zip.file(path.join(src, entry.name), { name: entry.name });
        }
      }
      zip.finalize();
    });
    fs.renameSync(`${dest}.part`, dest);
    if (running) inst.panelLine(`Respaldo creado: ${file}`);
    pruneBackups(id);
    return listBackups(id).find((b) => b.file === file);
  } finally {
    if (running && isRunning(id)) inst.send('save-on');
    active.delete(id);
  }
}

export function pruneBackups(id) {
  const keep = getServer(id)?.backupSchedule?.keep;
  if (!keep) return;
  const auto = listBackups(id).filter((b) => b.file.endsWith('-auto.zip'));
  for (const b of auto.slice(keep)) fs.rmSync(path.join(backupDir(id), b.file), { force: true });
}

export function backupPath(id, file) {
  const p = safeJoin(backupDir(id), file);
  if (!fs.existsSync(p) || !p.endsWith('.zip')) throw new HttpError(404, 'Respaldo no encontrado');
  return p;
}

export function deleteBackup(id, file) {
  fs.rmSync(backupPath(id, file), { force: true });
}

export async function restoreBackup(id, file) {
  if (isRunning(id)) throw new HttpError(409, 'Apaga el servidor antes de restaurar un respaldo');
  const zip = new AdmZip(backupPath(id, file));
  const dir = serverDir(id);
  const top = new Set(zip.getEntries().map((e) => e.entryName.split('/')[0]).filter(Boolean));
  // Reemplaza solo lo que trae el respaldo; lo demás (librerías, jar) queda igual.
  for (const name of top) fs.rmSync(safeJoin(dir, name), { recursive: true, force: true });
  zip.extractAllTo(dir, true);
  return [...top];
}

/** Respaldos automáticos según la programación de cada servidor. */
setInterval(() => {
  for (const server of db.data.servers) {
    const sched = server.backupSchedule;
    if (!sched?.enabled || !sched.intervalHours) continue;
    const last = server.lastAutoBackup ? Date.parse(server.lastAutoBackup) : 0;
    if (Date.now() - last < sched.intervalHours * 3600_000) continue;
    server.lastAutoBackup = new Date().toISOString();
    db.save();
    createBackup(server.id, sched.mode || 'mundo', 'auto').catch((err) =>
      console.error(`[backup auto ${server.name}]`, err.message)
    );
  }
}, 60_000).unref();
