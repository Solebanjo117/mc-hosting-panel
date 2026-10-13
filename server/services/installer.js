import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { serverDir, IS_WINDOWS } from '../config.js';
import { getServer, updateServer } from '../db.js';
import { bus } from '../lib/bus.js';
import { download } from '../lib/http.js';
import { HttpError } from '../lib/util.js';
import { ensureJava, requiredJava } from './java.js';
import { writeProperties } from './properties.js';
import {
  vanillaServerUrl,
  paperBuild,
  fabricLauncherUrl,
  forgeInstallerUrl,
  neoforgeInstallerUrl,
} from './versions.js';

const running = new Set();

export function isInstalling(id) {
  return running.has(id);
}

function reporter(id) {
  return ({ message, progress = null }) => {
    if (message) console.log(`[install ${id}] ${message}`);
    bus.emit('install', id, { state: 'installing', message, progress });
  };
}

/** Ejecuta el instalador de Forge/NeoForge en modo servidor. */
function runInstaller(javaPath, installerJar, cwd, report) {
  return new Promise((resolve, reject) => {
    const p = spawn(javaPath, ['-jar', installerJar, '--installServer'], { cwd, windowsHide: true });
    let tail = [];
    const onData = (d) => {
      for (const line of d.toString().split(/\r?\n/)) {
        if (!line.trim()) continue;
        tail = [...tail.slice(-30), line];
        if (/Downloading|Extracting|Processing|Installing/i.test(line)) report({ message: line.slice(0, 160) });
      }
    };
    p.stdout.on('data', onData);
    p.stderr.on('data', onData);
    p.on('error', reject);
    p.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`El instalador terminó con código ${code}:\n${tail.join('\n')}`))
    );
  });
}

/**
 * Forge/NeoForge modernos crean un archivo de argumentos (win_args.txt / unix_args.txt)
 * o un "shim" jar. Las versiones viejas de Forge dejan un forge-x.jar ejecutable.
 */
export function detectForgeLaunch(dir, loaderVersion = null) {
  // Tras actualizar (un modpack, por ejemplo) quedan las carpetas de la versión anterior:
  // se prefiere la que coincide con la versión instalada y, si no, la más reciente.
  const matches = (n) => Boolean(loaderVersion) && (n === loaderVersion || n.endsWith(`-${loaderVersion}`) || n.includes(`-${loaderVersion}-`));
  const prefer = (list, name) =>
    [...list].sort((a, b) => {
      const ma = matches(name(a)) ? 1 : 0;
      const mb = matches(name(b)) ? 1 : 0;
      return mb - ma || fs.statSync(path.join(dir, b.rel)).mtimeMs - fs.statSync(path.join(dir, a.rel)).mtimeMs;
    });

  const shims = fs.readdirSync(dir).filter((f) => /-shim\.jar$/.test(f)).map((f) => ({ rel: f, name: f }));
  if (shims.length) return { type: 'jar', jar: prefer(shims, (x) => x.name)[0].rel };

  const found = [];
  for (const base of ['libraries/net/neoforged/neoforge', 'libraries/net/minecraftforge/forge', 'libraries/net/neoforged/forge']) {
    const abs = path.join(dir, base);
    if (!fs.existsSync(abs)) continue;
    for (const ver of fs.readdirSync(abs)) {
      if (fs.existsSync(path.join(abs, ver, 'win_args.txt')) || fs.existsSync(path.join(abs, ver, 'unix_args.txt'))) {
        found.push({ rel: `${base}/${ver}`, name: ver });
      }
    }
  }
  if (found.length) return { type: 'args', argsDir: prefer(found, (x) => x.name)[0].rel };

  const legacy = fs
    .readdirSync(dir)
    .find((f) => /^(forge|neoforge)-.*\.jar$/.test(f) && !f.includes('installer'));
  if (legacy) return { type: 'jar', jar: legacy };
  throw new Error('No se encontró cómo iniciar el servidor después de instalar Forge/NeoForge');
}

export function launchArgs(launch) {
  if (launch.type === 'args') {
    const file = `${launch.argsDir}/${IS_WINDOWS ? 'win_args.txt' : 'unix_args.txt'}`;
    return [`@${file}`];
  }
  return ['-jar', launch.jar];
}

function writeDefaults(server) {
  const dir = serverDir(server.id);
  fs.writeFileSync(
    path.join(dir, 'eula.txt'),
    `# Aceptada desde MC Hosting Panel el ${new Date().toISOString()}\n# https://aka.ms/MinecraftEULA\neula=true\n`
  );
  const isNew = !fs.existsSync(path.join(dir, 'server.properties'));
  writeProperties(server.id, {
    'server-port': server.port,
    'query.port': server.port,
    ...(isNew
      ? {
          motd: `${server.name} §7- MC Hosting Panel`,
          'max-players': 20,
          'online-mode': true,
          difficulty: 'normal',
          'view-distance': 10,
          'enable-command-block': false,
        }
      : {}),
  });
}

async function doInstall(server, report) {
  const dir = serverDir(server.id);
  fs.mkdirSync(dir, { recursive: true });
  const { type, mcVersion } = server;

  const javaMajor = await requiredJava(mcVersion);
  report({ message: `Minecraft ${mcVersion} necesita Java ${javaMajor}` });
  const javaPath = await ensureJava(javaMajor, report);

  const pct = (label) => (p) => report({ message: label, progress: p });
  let launch;
  let loaderVersion = server.loaderVersion || null;

  // Quita el jar anterior al reinstalar/cambiar versión.
  if (server.launch?.type === 'jar' && server.launch.jar) {
    fs.rmSync(path.join(dir, server.launch.jar), { force: true });
  }

  switch (type) {
    case 'vanilla': {
      const url = await vanillaServerUrl(mcVersion);
      await download(url, path.join(dir, 'server.jar'), pct(`Descargando servidor oficial ${mcVersion}…`));
      launch = { type: 'jar', jar: 'server.jar' };
      break;
    }
    case 'paper': {
      const build = await paperBuild(mcVersion);
      await download(build.url, path.join(dir, 'paper.jar'), pct(`Descargando Paper ${mcVersion} build #${build.build}…`));
      loaderVersion = String(build.build);
      launch = { type: 'jar', jar: 'paper.jar' };
      break;
    }
    case 'fabric': {
      const fabric = await fabricLauncherUrl(mcVersion, server.modpack ? loaderVersion : null);
      await download(fabric.url, path.join(dir, 'fabric-server-launch.jar'), pct(`Descargando Fabric ${fabric.loader}…`));
      loaderVersion = fabric.loader;
      launch = { type: 'jar', jar: 'fabric-server-launch.jar' };
      break;
    }
    case 'forge':
    case 'neoforge': {
      if (!loaderVersion) throw new HttpError(400, `Elige una versión de ${type === 'forge' ? 'Forge' : 'NeoForge'}`);
      const url = type === 'forge' ? forgeInstallerUrl(mcVersion, loaderVersion) : neoforgeInstallerUrl(loaderVersion);
      const installer = path.join(dir, 'installer.jar');
      await download(url, installer, pct(`Descargando instalador de ${type === 'forge' ? 'Forge' : 'NeoForge'} ${loaderVersion}…`));
      report({ message: 'Ejecutando el instalador (puede tardar varios minutos)…', progress: null });
      await runInstaller(javaPath, 'installer.jar', dir, report);
      fs.rmSync(installer, { force: true });
      fs.rmSync(path.join(dir, 'installer.jar.log'), { force: true });
      // run.bat / run.sh y user_jvm_args.txt no se usan: el panel controla la memoria.
      launch = detectForgeLaunch(dir, loaderVersion);
      break;
    }
    default:
      throw new HttpError(400, `Tipo desconocido: ${type}`);
  }

  for (const sub of { paper: ['plugins'], fabric: ['mods'], forge: ['mods'], neoforge: ['mods'], vanilla: [] }[type]) {
    fs.mkdirSync(path.join(dir, sub), { recursive: true });
  }
  writeDefaults({ ...server });
  return { launch, loaderVersion, javaMajor };
}

/** Instala (o reinstala) en segundo plano. El progreso viaja por WebSocket. */
export function startInstall(id) {
  if (running.has(id)) throw new HttpError(409, 'Ya hay una instalación en curso para este servidor');
  const server = getServer(id);
  if (!server) throw new HttpError(404, 'Servidor no encontrado');
  running.add(id);
  updateServer(id, { installState: 'installing', installError: null });
  bus.emit('servers');
  const report = reporter(id);

  doInstall(server, report)
    .then(async (result) => {
      // Un modpack recién importado: descarga sus mods y copia sus archivos de configuración.
      if (server.modpack?.pendingApply) {
        const { applyModpack } = await import('./modpack.js');
        await applyModpack(id, report);
      }
      return result;
    })
    .then(({ launch, loaderVersion, javaMajor }) => {
      updateServer(id, { installState: 'ready', launch, loaderVersion, javaMajor, installedAt: new Date().toISOString() });
      bus.emit('install', id, { state: 'ready', message: 'Instalación completa. ¡Ya puedes iniciar el servidor!', progress: 1 });
    })
    .catch((err) => {
      console.error(`[install ${id}]`, err);
      updateServer(id, { installState: 'error', installError: err.message });
      bus.emit('install', id, { state: 'error', message: err.message, progress: null });
    })
    .finally(() => {
      running.delete(id);
      bus.emit('servers');
    });
}
