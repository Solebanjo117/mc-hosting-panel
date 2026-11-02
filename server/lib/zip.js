// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { HttpError, safeJoin } from './util.js';

/**
 * Lectura y extracción de .zip con defensas, en un solo lugar. Los zips que abre el panel vienen de
 * fuera (modpacks, mundos y archivos que sube el usuario, descargas de internet), así que ninguno se
 * extrae tal cual:
 *  - zip slip: una entrada "../x" o con ruta absoluta no puede escribir fuera de la carpeta destino;
 *  - enlaces simbólicos dentro del zip se rechazan (podrían apuntar a cualquier archivo de la PC);
 *  - límite de entradas y de tamaño por entrada, y el total declarado se compara con el espacio libre
 *    del disco antes de empezar (una "bomba zip" de unos KB puede declarar terabytes);
 *  - el tamaño real de cada entrada debe coincidir con el declarado.
 */
export const ZIP_LIMITS = {
  entries: 200_000,
  entryBytes: 4 * 1024 ** 3, // 4 GiB: el máximo del formato zip clásico
};

const S_IFMT = 0xf000;
const S_IFLNK = 0xa000;

function wrap(entry) {
  const name = entry.entryName;
  const header = entry.header;
  return {
    name,
    isDirectory: entry.isDirectory,
    size: header.size,
    compressedSize: header.compressedSize,
    // En zips hechos en Linux/macOS los permisos van en los 16 bits altos de los atributos externos.
    isSymlink: ((entry.attr >>> 16) & S_IFMT) === S_IFLNK,
    data: () => entry.getData(),
  };
}

/**
 * Abre un .zip (ruta o Buffer) y devuelve sus entradas con un tamaño máximo conocido.
 * Lanza HttpError 400 si no es un zip válido o excede los límites.
 */
export function openZip(source, { limits = ZIP_LIMITS } = {}) {
  let zip;
  try {
    zip = new AdmZip(source);
  } catch {
    throw new HttpError(400, 'El archivo no se pudo abrir como .zip (está dañado o no es un zip)');
  }
  const raw = zip.getEntries();
  if (raw.length > limits.entries) throw new HttpError(400, `El .zip tiene demasiados archivos (más de ${limits.entries})`);
  const entries = raw.map(wrap);
  let totalBytes = 0;
  for (const e of entries) {
    if (e.isDirectory) continue;
    if (e.size > limits.entryBytes) throw new HttpError(400, `El archivo ${e.name} dentro del .zip es demasiado grande`);
    totalBytes += e.size;
  }
  const byName = new Map(entries.map((e) => [e.name, e]));
  return {
    entries,
    totalBytes,
    entry: (name) => byName.get(name) || null,
    /** Contenido de una entrada como Buffer, o null si no existe. */
    read: (name) => byName.get(name)?.data() ?? null,
    names: () => entries.map((e) => e.name),
  };
}

function freeBytes(dir) {
  try {
    const st = fs.statfsSync(dir);
    return Number(st.bavail) * Number(st.bsize);
  } catch {
    return null; // sistema de archivos sin esa información: no se puede comprobar
  }
}

/**
 * Extrae un zip en `dest` sin dejar que ninguna entrada salga de ahí.
 *  - select(entry): devuelve la ruta relativa donde guardar la entrada, o null/'' para saltarla
 *    (por defecto, su propio nombre).
 *  - onBadPath: 'throw' (por defecto) rechaza todo el zip si una ruta intenta salir; 'skip' la ignora.
 *  - freeSpace: espacio libre mínimo a dejar tras extraer (por defecto 256 MB).
 * Devuelve las rutas relativas escritas (con "/").
 */
export function extractZip(source, dest, { select = (e) => e.name, onBadPath = 'throw', limits = ZIP_LIMITS, freeSpace = 256 * 1024 ** 2, minFree = freeBytes } = {}) {
  const zip = typeof source === 'string' || Buffer.isBuffer(source) ? openZip(source, { limits }) : source;
  const root = path.resolve(dest);
  const plan = [];
  let bytes = 0;
  for (const entry of zip.entries) {
    if (entry.isDirectory) continue;
    const rel = select(entry);
    if (!rel) continue;
    if (entry.isSymlink) throw new HttpError(400, `El .zip contiene un enlace simbólico (${entry.name}); no se puede extraer por seguridad`);
    let target;
    try {
      target = safeJoin(root, rel);
    } catch {
      if (onBadPath === 'skip') continue;
      throw new HttpError(400, `El .zip contiene una ruta no permitida (${entry.name})`);
    }
    if (target === root) continue;
    plan.push({ entry, target, rel: String(rel).replace(/\\/g, '/') });
    bytes += entry.size;
  }
  fs.mkdirSync(root, { recursive: true });
  const free = minFree(root);
  if (free !== null && bytes + freeSpace > free) {
    const gb = (n) => (n / 1024 ** 3).toFixed(1);
    throw new HttpError(507, `No hay espacio en disco para extraer el .zip: necesita ${gb(bytes)} GB y quedan ${gb(free)} GB libres`);
  }
  const written = [];
  for (const { entry, target, rel } of plan) {
    let data;
    try {
      data = entry.data();
    } catch (err) {
      throw new HttpError(400, `No se pudo leer ${entry.name} dentro del .zip: ${err.message}`);
    }
    if (!data || data.length !== entry.size) throw new HttpError(400, `El .zip está dañado: ${entry.name} no mide lo que declara`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    // Si en el destino hubiera un enlace simbólico con ese nombre, escribir lo seguiría: se quita antes.
    try {
      if (fs.lstatSync(target).isSymbolicLink()) fs.rmSync(target, { force: true });
    } catch {
      /* no existe */
    }
    fs.writeFileSync(target, data);
    written.push(rel);
  }
  return written;
}
