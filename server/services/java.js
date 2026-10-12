import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import AdmZip from 'adm-zip';
import { JAVA_DIR, TMP_DIR, IS_WINDOWS } from '../config.js';
import { db } from '../db.js';
import { download } from '../lib/http.js';
import { compareVersions, HttpError } from '../lib/util.js';
import { mojangVersion } from './versions.js';

/**
 * Cada versión de Minecraft necesita un Java distinto (8, 17, 21, 25…).
 * El panel descarga automáticamente el JRE de Eclipse Temurin (Adoptium)
 * a data/java/<versión> para que el usuario no tenga que instalar nada.
 */

function heuristicJava(mcVersion) {
  if (/^\d{2}\./.test(mcVersion) && Number(mcVersion.split('.')[0]) >= 26) return 25;
  if (compareVersions(mcVersion, '1.20.5') >= 0) return 21;
  if (compareVersions(mcVersion, '1.17') >= 0) return 17;
  return 8;
}

export async function requiredJava(mcVersion) {
  try {
    const info = await mojangVersion(mcVersion);
    const major = info.javaVersion?.majorVersion;
    if (major) return normalizeMajor(major);
  } catch {
    /* sin conexión o versión no listada: usar la regla general */
  }
  return heuristicJava(mcVersion);
}

/** Adoptium no publica JRE de todas las versiones; 16 se cubre con 17. */
function normalizeMajor(major) {
  if (major === 16) return 17;
  return major;
}

const javaExe = IS_WINDOWS ? 'java.exe' : 'java';

function findJavaIn(dir) {
  if (!fs.existsSync(dir)) return null;
  const direct = path.join(dir, 'bin', javaExe);
  if (fs.existsSync(direct)) return direct;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidates = [
      path.join(dir, entry.name, 'bin', javaExe),
      path.join(dir, entry.name, 'Contents', 'Home', 'bin', javaExe), // macOS
    ];
    const found = candidates.find((c) => fs.existsSync(c));
    if (found) return found;
  }
  return null;
}

export function installedJavas() {
  if (!fs.existsSync(JAVA_DIR)) return [];
  return fs
    .readdirSync(JAVA_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d+$/.test(e.name))
    .map((e) => ({ major: Number(e.name), path: findJavaIn(path.join(JAVA_DIR, e.name)) }))
    .filter((j) => j.path)
    .sort((a, b) => a.major - b.major);
}

function adoptiumUrl(major) {
  const os = IS_WINDOWS ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x64';
  return `https://api.adoptium.net/v3/binary/latest/${major}/ga/${os}/${arch}/jre/hotspot/normal/eclipse`;
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { ...opts, windowsHide: true });
    let err = '';
    p.stderr?.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err || `${cmd} salió con código ${code}`))));
  });
}

const pending = new Map();

/** Devuelve la ruta a java para la versión mayor indicada, descargándolo si hace falta. */
export async function ensureJava(major, report = () => {}) {
  const custom = db.data.settings.javaPaths?.[major];
  if (custom && fs.existsSync(custom)) return custom;

  const target = path.join(JAVA_DIR, String(major));
  const existing = findJavaIn(target);
  if (existing) return existing;

  if (pending.has(major)) return pending.get(major);
  const job = (async () => {
    report({ message: `Descargando Java ${major} (Eclipse Temurin)…`, progress: 0 });
    const ext = IS_WINDOWS ? 'zip' : 'tar.gz';
    const archive = path.join(TMP_DIR, `java-${major}-${Date.now()}.${ext}`);
    try {
      await download(adoptiumUrl(major), archive, (p) =>
        report({ message: `Descargando Java ${major}…`, progress: p })
      );
      report({ message: `Instalando Java ${major}…`, progress: null });
      fs.mkdirSync(target, { recursive: true });
      if (ext === 'zip') {
        new AdmZip(archive).extractAllTo(target, true);
      } else {
        await run('tar', ['-xzf', archive, '-C', target]);
      }
    } catch (err) {
      fs.rmSync(target, { recursive: true, force: true });
      throw new HttpError(502, `No se pudo descargar Java ${major}: ${err.message}`);
    } finally {
      fs.rmSync(archive, { force: true });
    }
    const javaPath = findJavaIn(target);
    if (!javaPath) throw new HttpError(500, `Java ${major} se descargó pero no se encontró el ejecutable`);
    return javaPath;
  })();
  pending.set(major, job);
  try {
    return await job;
  } finally {
    pending.delete(major);
  }
}
