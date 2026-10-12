import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import archiver from 'archiver';
import AdmZip from 'adm-zip';
import { serverDir, TMP_DIR } from '../config.js';
import { getServer } from '../db.js';
import { HttpError, safeJoin, relPath, moveFile, sanitizeFileName } from '../lib/util.js';

export const filesRouter = express.Router({ mergeParams: true });

const upload = multer({ dest: TMP_DIR, limits: { fileSize: 4 * 1024 * 1024 * 1024 } });
const MAX_EDIT_BYTES = 3 * 1024 * 1024;
const TEXT_EXT = /\.(txt|properties|json|json5|yml|yaml|toml|cfg|conf|ini|log|md|mcmeta|sk|js|csv|xml|lang|bat|sh|snbt)$/i;

function base(req) {
  const server = getServer(req.params.id);
  if (!server) throw new HttpError(404, 'Servidor no encontrado');
  return serverDir(server.id);
}

filesRouter.get('/', async (req, res) => {
  const root = base(req);
  const dir = safeJoin(root, req.query.path || '');
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new HttpError(404, 'Carpeta no encontrada');
  const entries = await Promise.all(
    (await fs.promises.readdir(dir, { withFileTypes: true })).map(async (e) => {
      let stat = null;
      try {
        stat = await fs.promises.stat(path.join(dir, e.name));
      } catch {
        /* archivo bloqueado */
      }
      return {
        name: e.name,
        type: e.isDirectory() ? 'dir' : 'file',
        size: stat && !e.isDirectory() ? stat.size : null,
        mtime: stat?.mtime.toISOString() || null,
        editable: !e.isDirectory() && TEXT_EXT.test(e.name) && (stat?.size ?? 0) <= MAX_EDIT_BYTES,
      };
    })
  );
  entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
  res.json({ path: relPath(root, dir), entries });
});

filesRouter.get('/content', async (req, res) => {
  const file = safeJoin(base(req), req.query.path);
  const stat = fs.existsSync(file) && fs.statSync(file);
  if (!stat || !stat.isFile()) throw new HttpError(404, 'Archivo no encontrado');
  if (stat.size > MAX_EDIT_BYTES) throw new HttpError(413, 'El archivo es demasiado grande para editarlo aquí; descárgalo');
  res.json({ path: req.query.path, content: await fs.promises.readFile(file, 'utf8') });
});

filesRouter.put('/content', async (req, res) => {
  const { path: p, content } = req.body || {};
  if (typeof content !== 'string') throw new HttpError(400, 'Contenido inválido');
  const file = safeJoin(base(req), p);
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, content, 'utf8');
  res.json({ ok: true });
});

filesRouter.post('/upload', upload.array('files', 50), async (req, res) => {
  const dir = safeJoin(base(req), req.query.path || '');
  await fs.promises.mkdir(dir, { recursive: true });
  const saved = [];
  for (const f of req.files || []) {
    // multer entrega el nombre en latin1; se corrige para acentos y ñ.
    const name = sanitizeFileName(Buffer.from(f.originalname, 'latin1').toString('utf8'));
    await moveFile(f.path, safeJoin(dir, name));
    saved.push(name);
  }
  res.json({ saved });
});

filesRouter.get('/download', (req, res) => {
  const target = safeJoin(base(req), req.query.path);
  if (!fs.existsSync(target)) throw new HttpError(404, 'No encontrado');
  if (fs.statSync(target).isFile()) return res.download(target);
  // Una carpeta se descarga como .zip al vuelo.
  res.attachment(`${path.basename(target)}.zip`);
  const zip = archiver('zip', { zlib: { level: 5 } });
  zip.on('error', (err) => res.destroy(err));
  zip.pipe(res);
  zip.directory(target, path.basename(target));
  zip.finalize();
});

filesRouter.post('/mkdir', async (req, res) => {
  await fs.promises.mkdir(safeJoin(base(req), req.body?.path), { recursive: true });
  res.json({ ok: true });
});

filesRouter.post('/rename', async (req, res) => {
  const root = base(req);
  const from = safeJoin(root, req.body?.from);
  const to = safeJoin(root, req.body?.to);
  if (!fs.existsSync(from)) throw new HttpError(404, 'No encontrado');
  if (fs.existsSync(to)) throw new HttpError(409, 'Ya existe un archivo con ese nombre');
  await fs.promises.rename(from, to);
  res.json({ ok: true });
});

filesRouter.post('/delete', async (req, res) => {
  const root = base(req);
  for (const p of req.body?.paths || []) {
    const target = safeJoin(root, p);
    if (target === path.resolve(root)) throw new HttpError(400, 'No se puede borrar la carpeta raíz');
    await fs.promises.rm(target, { recursive: true, force: true });
  }
  res.json({ ok: true });
});

filesRouter.post('/extract', async (req, res) => {
  const root = base(req);
  const file = safeJoin(root, req.body?.path);
  if (!file.toLowerCase().endsWith('.zip')) throw new HttpError(400, 'Solo se pueden extraer archivos .zip');
  const dest = path.dirname(file);
  const zip = new AdmZip(file);
  // Revisa que ningún archivo del zip intente salir de la carpeta (zip slip).
  for (const entry of zip.getEntries()) safeJoin(dest, entry.entryName);
  zip.extractAllTo(dest, true);
  res.json({ ok: true, entries: zip.getEntries().length });
});
