import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import archiver from 'archiver';
import AdmZip from 'adm-zip';
import { serverDir, TMP_DIR } from '../config.js';
import { getServer } from '../db.js';
import { HttpError, safeJoin, relPath, moveFile, sanitizeFileName } from '../lib/util.js';
import { parseNbt, writeNbt } from '../lib/nbt.js';
import { isRunning } from '../services/processManager.js';
import { readProperties } from '../services/properties.js';

export const filesRouter = express.Router({ mergeParams: true });

const upload = multer({ dest: TMP_DIR, limits: { fileSize: 4 * 1024 * 1024 * 1024, files: 5000, fieldSize: 10 * 1024 * 1024 } });
const MAX_EDIT_BYTES = 3 * 1024 * 1024;
const MAX_NBT_BYTES = 8 * 1024 * 1024;
const TEXT_EXT = /\.(txt|properties|json|json5|yml|yaml|toml|cfg|conf|ini|log|md|mcmeta|sk|js|csv|xml|lang|bat|sh|snbt|mcfunction)$/i;
const NBT_EXT = /\.(dat|dat_old|nbt|schem|schematic|litematic)$/i;

function ctx(req) {
  const server = getServer(req.params.id);
  if (!server) throw new HttpError(404, 'Servidor no encontrado');
  return { server, root: serverDir(server.id) };
}

/** Carpetas del mundo activo (con Nether y End), protegidas mientras el servidor corre. */
function worldRoots(server) {
  const level = readProperties(server.id)['level-name'] || 'world';
  return [level, `${level}_nether`, `${level}_the_end`];
}

/**
 * Con el servidor encendido, el mundo se está escribiendo: borrar, mover o reemplazar
 * sus archivos puede dañarlo. Los datapacks sí se pueden tocar (se aplican con /reload).
 */
function assertWritable(server, rel, action) {
  if (!isRunning(server.id)) return;
  const parts = String(rel || '').replace(/\\/g, '/').split('/').filter(Boolean);
  if (!parts.length) return;
  if (worldRoots(server).includes(parts[0]) && parts[1] !== 'datapacks') {
    throw new HttpError(409, `No se puede ${action} dentro del mundo mientras el servidor está encendido; podría dañarse. Apágalo primero.`);
  }
}

function uniqueName(dir, name) {
  if (!fs.existsSync(path.join(dir, name))) return name;
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  for (let i = 2; ; i++) {
    const candidate = `${base} (${i})${ext}`;
    if (!fs.existsSync(path.join(dir, candidate))) return candidate;
  }
}

function parsePaths(value) {
  let list = value;
  if (typeof value === 'string') {
    try {
      list = JSON.parse(value);
    } catch {
      list = [value];
    }
  }
  if (!Array.isArray(list) || !list.length) throw new HttpError(400, 'No elegiste archivos');
  if (list.length > 2000) throw new HttpError(400, 'Demasiados archivos a la vez');
  return list.map(String);
}

function entryInfo(dir, name, isDir) {
  let stat = null;
  try {
    stat = fs.statSync(path.join(dir, name));
  } catch {
    /* archivo bloqueado */
  }
  return {
    name,
    type: isDir ? 'dir' : 'file',
    size: stat && !isDir ? stat.size : null,
    mtime: stat?.mtime.toISOString() || null,
    editable: !isDir && TEXT_EXT.test(name) && (stat?.size ?? 0) <= MAX_EDIT_BYTES,
    nbt: !isDir && NBT_EXT.test(name) && (stat?.size ?? 0) <= MAX_NBT_BYTES,
  };
}

filesRouter.get('/', async (req, res) => {
  const { server, root } = ctx(req);
  const dir = safeJoin(root, req.query.path || '');
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new HttpError(404, 'Carpeta no encontrada');
  const entries = (await fs.promises.readdir(dir, { withFileTypes: true })).map((e) => entryInfo(dir, e.name, e.isDirectory()));
  entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
  const rel = relPath(root, dir);
  let protectedPath = false;
  try {
    assertWritable(server, `${rel}/x`, 'x');
  } catch {
    protectedPath = true;
  }
  res.json({ path: rel, entries, protected: protectedPath, running: isRunning(server.id), worlds: worldRoots(server) });
});

/** Busca por nombre en todas las subcarpetas. */
filesRouter.get('/search', (req, res) => {
  const { root } = ctx(req);
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q.length < 2) throw new HttpError(400, 'Escribe al menos 2 letras');
  const start = safeJoin(root, req.query.path || '');
  const results = [];
  let scanned = 0;
  const stack = [start];
  while (stack.length && results.length < 300 && scanned < 60_000) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      scanned++;
      const abs = path.join(dir, e.name);
      if (e.name.toLowerCase().includes(q)) results.push({ ...entryInfo(dir, e.name, e.isDirectory()), path: relPath(root, abs) });
      if (e.isDirectory()) stack.push(abs);
    }
  }
  res.json({ query: q, results, truncated: results.length >= 300 || scanned >= 60_000 });
});

filesRouter.get('/content', async (req, res) => {
  const { root } = ctx(req);
  const file = safeJoin(root, req.query.path);
  const stat = fs.existsSync(file) && fs.statSync(file);
  if (!stat || !stat.isFile()) throw new HttpError(404, 'Archivo no encontrado');
  if (stat.size > MAX_EDIT_BYTES) throw new HttpError(413, 'El archivo es demasiado grande para editarlo aquí; descárgalo');
  res.json({ path: req.query.path, content: await fs.promises.readFile(file, 'utf8') });
});

filesRouter.put('/content', async (req, res) => {
  const { root } = ctx(req);
  const { path: p, content } = req.body || {};
  if (typeof content !== 'string') throw new HttpError(400, 'Contenido inválido');
  const file = safeJoin(root, p);
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, content, 'utf8');
  res.json({ ok: true });
});

/**
 * Subida de archivos o carpetas completas: el navegador manda, en el mismo orden,
 * la ruta relativa de cada archivo ("paths") para recrear las subcarpetas.
 */
filesRouter.post('/upload', upload.array('files', 5000), async (req, res) => {
  const { server, root } = ctx(req);
  const base = req.query.path || '';
  const dir = safeJoin(root, base);
  const relPaths = [].concat(req.body?.paths || []);
  const saved = [];
  try {
    for (const [i, f] of (req.files || []).entries()) {
      const original = Buffer.from(f.originalname, 'latin1').toString('utf8');
      const rel = (relPaths[i] || original)
        .replace(/\\/g, '/')
        .split('/')
        .filter((s) => s && s !== '.' && s !== '..')
        .map(sanitizeFileName)
        .join('/');
      const target = safeJoin(dir, rel);
      assertWritable(server, relPath(root, target), 'subir archivos');
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      await moveFile(f.path, target);
      saved.push(rel);
    }
  } finally {
    for (const f of req.files || []) fs.rmSync(f.path, { force: true });
  }
  res.json({ saved });
});

filesRouter.get('/download', (req, res) => {
  const { root } = ctx(req);
  const target = safeJoin(root, req.query.path);
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

/** Varios archivos y carpetas en un solo .zip. */
filesRouter.get('/download-many', (req, res) => {
  const { root } = ctx(req);
  const list = parsePaths(req.query.paths).map((p) => safeJoin(root, p));
  for (const p of list) if (!fs.existsSync(p)) throw new HttpError(404, `No existe ${relPath(root, p)}`);
  res.attachment(`seleccion-${new Date().toISOString().slice(0, 10)}.zip`);
  const zip = archiver('zip', { zlib: { level: 5 } });
  zip.on('error', (err) => res.destroy(err));
  zip.pipe(res);
  for (const p of list) {
    if (fs.statSync(p).isDirectory()) zip.directory(p, path.basename(p));
    else zip.file(p, { name: path.basename(p) });
  }
  zip.finalize();
});

filesRouter.post('/mkdir', async (req, res) => {
  const { server, root } = ctx(req);
  assertWritable(server, req.body?.path, 'crear carpetas');
  await fs.promises.mkdir(safeJoin(root, req.body?.path), { recursive: true });
  res.json({ ok: true });
});

filesRouter.post('/rename', async (req, res) => {
  const { server, root } = ctx(req);
  const from = safeJoin(root, req.body?.from);
  const to = safeJoin(root, req.body?.to);
  assertWritable(server, req.body?.from, 'renombrar');
  assertWritable(server, req.body?.to, 'renombrar');
  if (!fs.existsSync(from)) throw new HttpError(404, 'No encontrado');
  if (fs.existsSync(to)) throw new HttpError(409, 'Ya existe un archivo con ese nombre');
  await fs.promises.rename(from, to);
  res.json({ ok: true });
});

/** Mueve o copia una selección a otra carpeta. Si el nombre ya existe, agrega " (2)". */
async function transfer(req, res, mode) {
  const { server, root } = ctx(req);
  const list = parsePaths(req.body?.paths);
  const destRel = String(req.body?.dest ?? '');
  const dest = safeJoin(root, destRel);
  if (!fs.existsSync(dest) || !fs.statSync(dest).isDirectory()) throw new HttpError(404, 'La carpeta de destino no existe');
  assertWritable(server, `${destRel}/x`, mode === 'move' ? 'mover archivos' : 'copiar archivos');
  const done = [];
  for (const rel of list) {
    const from = safeJoin(root, rel);
    if (!fs.existsSync(from)) continue;
    if (mode === 'move') assertWritable(server, rel, 'mover archivos');
    const destNorm = path.resolve(dest) + path.sep;
    if (destNorm.startsWith(path.resolve(from) + path.sep) || path.resolve(dest) === path.resolve(from)) {
      throw new HttpError(400, `No puedes ${mode === 'move' ? 'mover' : 'copiar'} "${path.basename(from)}" dentro de sí misma`);
    }
    if (mode === 'move' && path.dirname(path.resolve(from)) === path.resolve(dest)) continue; // ya está ahí
    const name = uniqueName(dest, path.basename(from));
    const to = path.join(dest, name);
    if (mode === 'move') {
      try {
        await fs.promises.rename(from, to);
      } catch (err) {
        if (err.code !== 'EXDEV') throw err;
        await fs.promises.cp(from, to, { recursive: true });
        await fs.promises.rm(from, { recursive: true, force: true });
      }
    } else {
      await fs.promises.cp(from, to, { recursive: true, errorOnExist: true });
    }
    done.push(name);
  }
  res.json({ done });
}

filesRouter.post('/move', (req, res) => transfer(req, res, 'move'));
filesRouter.post('/copy', (req, res) => transfer(req, res, 'copy'));

filesRouter.post('/delete', async (req, res) => {
  const { server, root } = ctx(req);
  for (const p of parsePaths(req.body?.paths)) {
    const target = safeJoin(root, p);
    if (target === path.resolve(root)) throw new HttpError(400, 'No se puede borrar la carpeta raíz');
    assertWritable(server, p, 'borrar');
    await fs.promises.rm(target, { recursive: true, force: true });
  }
  res.json({ ok: true });
});

filesRouter.post('/extract', async (req, res) => {
  const { server, root } = ctx(req);
  const file = safeJoin(root, req.body?.path);
  if (!file.toLowerCase().endsWith('.zip')) throw new HttpError(400, 'Solo se pueden extraer archivos .zip');
  const dest = path.dirname(file);
  assertWritable(server, `${relPath(root, dest)}/x`, 'extraer archivos');
  const zip = new AdmZip(file);
  // Revisa que ningún archivo del zip intente salir de la carpeta (zip slip).
  for (const entry of zip.getEntries()) safeJoin(dest, entry.entryName);
  zip.extractAllTo(dest, true);
  res.json({ ok: true, entries: zip.getEntries().length });
});

/** Comprime una selección en un .zip dentro del servidor. */
filesRouter.post('/compress', async (req, res) => {
  const { root } = ctx(req);
  const list = parsePaths(req.body?.paths).map((p) => safeJoin(root, p));
  const dir = path.dirname(list[0]);
  const name = uniqueName(dir, `${sanitizeFileName(req.body?.name || (list.length === 1 ? path.basename(list[0]) : 'archivos'))}.zip`);
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(path.join(dir, name));
    const zip = archiver('zip', { zlib: { level: 6 } });
    out.on('close', resolve);
    zip.on('error', reject);
    zip.pipe(out);
    for (const p of list) {
      if (fs.statSync(p).isDirectory()) zip.directory(p, path.basename(p));
      else zip.file(p, { name: path.basename(p) });
    }
    zip.finalize();
  });
  res.json({ name });
});

// --- NBT (level.dat, playerdata, estructuras) ---------------------------------

filesRouter.get('/nbt', (req, res) => {
  const { root } = ctx(req);
  const file = safeJoin(root, req.query.path);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new HttpError(404, 'Archivo no encontrado');
  if (fs.statSync(file).size > MAX_NBT_BYTES) throw new HttpError(413, 'El archivo es demasiado grande para el editor');
  try {
    res.json({ path: req.query.path, ...parseNbt(fs.readFileSync(file)) });
  } catch (err) {
    throw new HttpError(422, `No se pudo leer como NBT: ${err.message}`);
  }
});

filesRouter.put('/nbt', (req, res) => {
  const { server, root } = ctx(req);
  const { path: p, compression, rootName, root: tree } = req.body || {};
  if (isRunning(server.id)) {
    throw new HttpError(409, 'Apaga el servidor para guardar: mientras corre, el servidor sobrescribe estos archivos y perderías los cambios.');
  }
  const file = safeJoin(root, p);
  if (!fs.existsSync(file)) throw new HttpError(404, 'Archivo no encontrado');
  let buf;
  try {
    buf = writeNbt({ compression, rootName: rootName || '', root: tree });
  } catch (err) {
    throw new HttpError(400, err.message);
  }
  // Copia de seguridad del original antes de reemplazarlo.
  fs.copyFileSync(file, `${file}.panel-bak`);
  fs.writeFileSync(file, buf);
  res.json({ ok: true, backup: `${p}.panel-bak` });
});

/** Nombres de jugadores para los archivos playerdata/<uuid>.dat (desde usercache.json). */
filesRouter.get('/players', (req, res) => {
  const { server, root } = ctx(req);
  let cache = [];
  try {
    cache = JSON.parse(fs.readFileSync(path.join(root, 'usercache.json'), 'utf8'));
  } catch {
    /* sin caché */
  }
  const names = new Map(cache.map((c) => [c.uuid, c.name]));
  const world = String(req.query.world || worldRoots(server)[0]);
  const dir = safeJoin(root, `${world}/playerdata`);
  const players = fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((f) => /^[0-9a-f-]{36}\.dat$/i.test(f))
        .map((f) => {
          const uuid = f.replace(/\.dat$/, '');
          return { uuid, name: names.get(uuid) || null, path: `${world}/playerdata/${f}`, mtime: fs.statSync(path.join(dir, f)).mtime.toISOString() };
        })
        .sort((a, b) => b.mtime.localeCompare(a.mtime))
    : [];
  res.json({ world, players });
});
