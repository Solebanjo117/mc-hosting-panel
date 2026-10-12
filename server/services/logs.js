import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { serverDir } from '../config.js';
import { HttpError, safeJoin } from '../lib/util.js';
import { analyze } from './crashAnalyzer.js';

const FOLDERS = { logs: 'logs', crash: 'crash-reports' };
const MAX_RETURN = 4000;

function listFolder(id, kind) {
  const dir = path.join(serverDir(id), FOLDERS[kind]);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => (kind === 'logs' ? /\.log(\.gz)?$/.test(f) : /\.txt$/.test(f)))
    .map((f) => {
      const st = fs.statSync(path.join(dir, f));
      return { file: f, size: st.size, mtime: st.mtime.toISOString() };
    })
    .sort((a, b) => (a.file === 'latest.log' ? -1 : b.file === 'latest.log' ? 1 : b.mtime.localeCompare(a.mtime)));
}

export function listLogs(id) {
  return { logs: listFolder(id, 'logs'), crashes: listFolder(id, 'crash') };
}

function readText(id, kind, file) {
  if (!FOLDERS[kind]) throw new HttpError(400, 'Tipo inválido');
  const p = safeJoin(path.join(serverDir(id), FOLDERS[kind]), file);
  if (!fs.existsSync(p)) throw new HttpError(404, 'Archivo no encontrado');
  const raw = fs.readFileSync(p);
  const buf = p.endsWith('.gz') ? zlib.gunzipSync(raw) : raw;
  return buf.toString('utf8');
}

/** Lee un log; con `query` devuelve solo las líneas que coinciden (con su número). */
export function readLog(id, kind, file, query = '') {
  const lines = readText(id, kind, file).split(/\r?\n/);
  const q = query.trim().toLowerCase();
  let result = lines.map((text, i) => ({ n: i + 1, text }));
  if (q) result = result.filter((l) => l.text.toLowerCase().includes(q));
  const truncated = result.length > MAX_RETURN;
  return { file, total: lines.length, matches: q ? result.length : null, truncated, lines: result.slice(-MAX_RETURN) };
}

/** Busca en todos los logs (incluidos los .gz antiguos). */
export function searchAll(id, query) {
  const q = query.trim().toLowerCase();
  if (q.length < 2) throw new HttpError(400, 'Escribe al menos 2 letras');
  const out = [];
  for (const { file } of listFolder(id, 'logs')) {
    let lines;
    try {
      lines = readText(id, 'logs', file).split(/\r?\n/);
    } catch {
      continue;
    }
    lines.forEach((text, i) => {
      if (out.length < 1000 && text.toLowerCase().includes(q)) out.push({ file, n: i + 1, text });
    });
    if (out.length >= 1000) break;
  }
  return { query, results: out, truncated: out.length >= 1000 };
}

export function readCrash(id, file) {
  const text = readText(id, 'crash', file);
  return { file, text: text.slice(0, 400_000), findings: analyze(text) };
}

export function diagnoseLatest(id) {
  let text = '';
  try {
    text = readText(id, 'logs', 'latest.log');
  } catch {
    /* no hay log */
  }
  return analyze(text);
}
