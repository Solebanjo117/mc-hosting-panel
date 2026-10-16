/**
 * Prepara los archivos del instalador de Windows en build/:
 *   build/app/        el panel listo para usar (server, interfaz compilada, dependencias y su propio node.exe)
 *   build/panel.ico   el icono
 * Después Inno Setup (installer/mc-hosting-panel.iss) los empaqueta en un solo .exe.
 * Se corre después de "npm run build":   node scripts/build-installer.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = path.join(ROOT, 'build');
const APP = path.join(BUILD, 'app');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) {
  console.error('Falta la interfaz compilada: corre "npm run build" primero.');
  process.exit(1);
}

fs.rmSync(BUILD, { recursive: true, force: true });
fs.mkdirSync(APP, { recursive: true });

for (const item of ['server', 'dist', 'docs', 'scripts', 'package.json', 'package-lock.json', 'README.md']) {
  const from = path.join(ROOT, item);
  if (fs.existsSync(from)) fs.cpSync(from, path.join(APP, item), { recursive: true });
}
// Los .bat de la versión con git no sirven aquí (el instalador trae su propio Node).
fs.rmSync(path.join(APP, 'scripts', 'build-installer.mjs'), { force: true });
fs.rmSync(path.join(APP, 'scripts', 'inicio-automatico.bat'), { force: true });

console.log('Instalando dependencias de producción…');
execSync('npm ci --omit=dev --ignore-scripts --no-audit --no-fund', { cwd: APP, stdio: 'inherit' });

// Node para Windows: el mismo con el que se construye (en el runner de Windows) o el oficial descargado.
const nodeDir = path.join(APP, 'node');
fs.mkdirSync(nodeDir, { recursive: true });
const nodeExe = path.join(nodeDir, 'node.exe');
if (process.platform === 'win32' && process.arch === 'x64') {
  fs.copyFileSync(process.execPath, nodeExe);
} else {
  const v = process.version;
  const url = `https://nodejs.org/dist/${v}/node-${v}-win-x64.zip`;
  console.log(`Descargando ${url}…`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo descargar Node: ${res.status}`);
  const { default: AdmZip } = await import('adm-zip');
  const zip = new AdmZip(Buffer.from(await res.arrayBuffer()));
  const entry = zip.getEntries().find((e) => e.entryName.endsWith('/node.exe'));
  fs.writeFileSync(nodeExe, entry.getData());
}
fs.writeFileSync(path.join(nodeDir, 'VERSION'), `${process.version}\n`);

// Icono .ico con el PNG dentro (Windows lo acepta desde Vista).
const png = fs.readFileSync(path.join(ROOT, 'client', 'public', 'icons', 'icon-192.png'));
const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0); // reservado
header.writeUInt16LE(1, 2); // tipo: icono
header.writeUInt16LE(1, 4); // una imagen
header.writeUInt8(192, 6); // ancho
header.writeUInt8(192, 7); // alto
header.writeUInt8(0, 8); // sin paleta
header.writeUInt8(0, 9);
header.writeUInt16LE(1, 10); // planos
header.writeUInt16LE(32, 12); // bits por píxel
header.writeUInt32LE(png.length, 14);
header.writeUInt32LE(22, 18); // la imagen empieza después de la cabecera
fs.writeFileSync(path.join(BUILD, 'panel.ico'), Buffer.concat([header, png]));
fs.copyFileSync(path.join(BUILD, 'panel.ico'), path.join(APP, 'panel.ico'));

fs.writeFileSync(path.join(BUILD, 'version.txt'), pkg.version);
console.log(`Listo: build/app (versión ${pkg.version}). Ahora: ISCC /DAppVersion=${pkg.version} installer\\mc-hosting-panel.iss`);
