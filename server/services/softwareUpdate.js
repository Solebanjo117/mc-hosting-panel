import { getServer, updateServer } from '../db.js';
import { bus } from '../lib/bus.js';
import { HttpError, compareVersions } from '../lib/util.js';
import { listVersions, paperBuild, fabricLauncherUrl } from './versions.js';
import { instance, isRunning } from './processManager.js';
import { isInstalling, startInstall } from './installer.js';
import { createBackup, restoreBackup, listBackups } from './backups.js';
import { checkUpdates, applyUpdate, targetCompatibility } from './marketplace.js';
import { record } from './activity.js';

/**
 * Actualizar Paper / Fabric / Forge / NeoForge / Minecraft con un clic:
 *   1. si está encendido, se apaga con cuidado
 *   2. respaldo completo ("antes de actualizar")
 *   3. se instala la versión nueva (mundos, ajustes, mods y plugins se conservan)
 *   4. si cambió la versión de Minecraft, se actualizan los mods/plugins que tengan versión para la nueva
 *   5. si estaba encendido, se vuelve a encender
 * Y si algo sale mal, "Deshacer" reinstala la versión anterior y restaura el respaldo.
 */

const LOADER_NAME = { paper: 'Paper', fabric: 'Fabric Loader', forge: 'Forge', neoforge: 'NeoForge' };
const jobs = new Map(); // id -> estado del trabajo en curso o del último

function requireServer(id) {
  const s = getServer(id);
  if (!s) throw new HttpError(404, 'Servidor no encontrado');
  return s;
}

/** La versión del cargador más nueva para una versión de Minecraft. */
async function latestLoader(type, mcVersion) {
  if (type === 'paper') return String((await paperBuild(mcVersion)).build);
  if (type === 'fabric') return (await fabricLauncherUrl(mcVersion)).loader;
  if (type === 'forge' || type === 'neoforge') {
    const entry = (await listVersions(type)).find((v) => v.id === mcVersion);
    if (!entry?.loaders?.length) return null;
    // NeoForge publica betas: se prefiere la estable más nueva.
    return (entry.loaders.find((l) => !/beta/i.test(l.version)) || entry.loaders[0]).version;
  }
  return null;
}

/** La versión de Minecraft más nueva que este tipo de servidor puede instalar. */
async function latestMinecraft(type) {
  const list = await listVersions(type);
  const usable = list.filter((v) => (type === 'forge' || type === 'neoforge' ? v.loaders?.length : true)).map((v) => v.id);
  return usable.sort((a, b) => compareVersions(b, a))[0] || null;
}

const label = (type, loader) => (type === 'paper' ? `build #${loader}` : loader);

/** Qué se puede actualizar en este servidor. */
export async function softwareStatus(id) {
  const server = requireServer(id);
  const { type, mcVersion } = server;
  const out = {
    type,
    loaderName: LOADER_NAME[type] || null,
    current: { mcVersion, loader: server.loaderVersion || null },
    loader: null,
    minecraft: null,
    job: jobView(id),
    last: server.lastSoftwareUpdate || null,
    modpack: Boolean(server.modpack),
  };
  const errors = [];
  if (type !== 'vanilla') {
    try {
      const latest = await latestLoader(type, mcVersion);
      const current = server.loaderVersion;
      const newer = latest && (!current || (type === 'paper' ? Number(latest) > Number(current) : compareVersions(latest, current) > 0));
      // Un modpack fija su versión de Fabric/Forge: actualizarla podría romperlo.
      out.loader = { latest, latestLabel: latest && label(type, latest), available: Boolean(newer) && !server.modpack };
    } catch (err) {
      errors.push(err.message);
    }
  }
  try {
    const latest = await latestMinecraft(type);
    const available = Boolean(latest && compareVersions(latest, mcVersion) > 0);
    out.minecraft = { latest, available: available && !server.modpack };
    if (available && !server.modpack) {
      try {
        out.minecraft.content = await targetCompatibility(id, latest);
      } catch {
        out.minecraft.content = null; // sin Modrinth no se puede revisar, pero se puede actualizar igual
      }
    }
  } catch (err) {
    errors.push(err.message);
  }
  if (errors.length) out.error = errors[0];
  return out;
}

function jobView(id) {
  const j = jobs.get(id);
  return j ? { running: j.running, step: j.step, log: j.log.slice(-40), error: j.error, done: j.done, kind: j.kind, to: j.to } : null;
}

function newJob(id, kind, to) {
  const j = { running: true, step: null, log: [], error: null, done: false, kind, to };
  jobs.set(id, j);
  return j;
}

function stepper(id, j) {
  return (text) => {
    j.step = text;
    j.log.push(text);
    bus.emit('software-update', id, jobView(id));
    const inst = instance(id);
    inst.panelLine?.(text);
  };
}

function guard(server) {
  if (jobs.get(server.id)?.running) throw new HttpError(409, 'Ya se está actualizando este servidor');
  if (isInstalling(server.id)) throw new HttpError(409, 'El servidor se está instalando');
  if (server.installState !== 'ready') throw new HttpError(409, 'El servidor no está instalado correctamente; reinstálalo primero');
}

async function stopIfRunning(id, step) {
  if (!isRunning(id)) return false;
  step('Apagando el servidor (guardando el mundo)…');
  await instance(id).stop();
  return true;
}

async function install(id, step) {
  const r = await startInstall(id);
  if (!r.ok) throw new Error(r.error);
  step('Instalación lista.');
}

/**
 * target = 'loader': la versión más nueva del cargador para la misma versión de Minecraft (lo más seguro).
 * target = 'minecraft': otra versión de Minecraft (mcVersion o la más nueva) con su cargador más nuevo.
 */
export async function startSoftwareUpdate(id, { target, mcVersion = null, updateContent = true } = {}) {
  const server = requireServer(id);
  guard(server);
  if (!['loader', 'minecraft'].includes(target)) throw new HttpError(400, 'Elige qué actualizar');
  if (server.modpack) throw new HttpError(409, 'Este servidor viene de un modpack: actualiza el modpack, que trae sus versiones de Minecraft y mods.');
  if (target === 'loader' && server.type === 'vanilla') throw new HttpError(400, 'Vanilla no tiene cargador');

  const from = { mcVersion: server.mcVersion, loaderVersion: server.loaderVersion || null };
  let to;
  if (target === 'loader') {
    const loader = await latestLoader(server.type, server.mcVersion);
    if (!loader) throw new HttpError(404, 'No se encontró una versión del cargador para esta versión de Minecraft');
    to = { mcVersion: server.mcVersion, loaderVersion: loader };
  } else {
    const mc = mcVersion || (await latestMinecraft(server.type));
    if (!mc) throw new HttpError(404, 'No se encontró la versión de Minecraft');
    const list = await listVersions(server.type);
    if (!list.some((v) => v.id === mc)) throw new HttpError(400, `${LOADER_NAME[server.type] || 'Vanilla'} no tiene la versión ${mc}`);
    if (compareVersions(mc, server.mcVersion) < 0) throw new HttpError(400, 'Para bajar de versión usa "Cambiar versión o reinstalar" (puede dañar el mundo)');
    to = { mcVersion: mc, loaderVersion: server.type === 'vanilla' ? null : await latestLoader(server.type, mc) };
    if (server.type !== 'vanilla' && !to.loaderVersion) throw new HttpError(404, `No hay ${LOADER_NAME[server.type]} para Minecraft ${mc}`);
  }

  const j = newJob(id, target, to);
  const step = stepper(id, j);
  (async () => {
    let wasRunning = false;
    try {
      wasRunning = await stopIfRunning(id, step);
      step('Creando un respaldo completo por si quieres volver atrás…');
      const backup = await createBackup(id, 'completo', 'antes-de-actualizar');
      step(`Respaldo listo: ${backup.file}`);

      const what = target === 'loader' ? `${LOADER_NAME[server.type]} ${label(server.type, to.loaderVersion)}` : `Minecraft ${to.mcVersion}`;
      step(`Instalando ${what}…`);
      updateServer(id, { mcVersion: to.mcVersion, loaderVersion: to.loaderVersion, javaMajor: null });
      await install(id, step);

      const updated = [];
      const failed = [];
      if (target === 'minecraft' && updateContent && server.type !== 'vanilla' && to.mcVersion !== from.mcVersion) {
        step(`Buscando versiones de tus ${server.type === 'paper' ? 'plugins' : 'mods'} para ${to.mcVersion}…`);
        let ups = [];
        try {
          ups = await checkUpdates(id);
        } catch (err) {
          step(`No se pudo revisar en Modrinth: ${err.message}`);
        }
        for (const u of ups) {
          try {
            await applyUpdate(id, u);
            updated.push(u.newFile);
          } catch (err) {
            failed.push(`${u.filename}: ${err.message}`);
          }
        }
        if (updated.length) step(`Actualizados: ${updated.join(', ')}`);
        if (failed.length) step(`No se pudieron actualizar: ${failed.join('; ')}`);
      }

      updateServer(id, { lastSoftwareUpdate: { at: new Date().toISOString(), from, to, backup: backup.file, updated } });
      record(id, 'update', { detail: `${what} (antes ${from.mcVersion}${from.loaderVersion ? ` · ${label(server.type, from.loaderVersion)}` : ''})` });
      j.done = true;
      if (wasRunning) {
        step('Encendiendo el servidor…');
        await instance(id).start();
      }
      step(`Listo: ${what}.`);
    } catch (err) {
      j.error = err.message;
      step(`Error: ${err.message}`);
      // Si falló la instalación, el respaldo está intacto: "Deshacer" lo deja como antes.
    } finally {
      j.running = false;
      bus.emit('software-update', id, jobView(id));
      bus.emit('servers');
    }
  })();
  return jobView(id);
}

/** Vuelve a la versión de antes de la última actualización y restaura su respaldo. */
export async function undoSoftwareUpdate(id) {
  const server = requireServer(id);
  if (jobs.get(id)?.running) throw new HttpError(409, 'Ya se está actualizando este servidor');
  if (isInstalling(id)) throw new HttpError(409, 'El servidor se está instalando');
  const last = server.lastSoftwareUpdate;
  if (!last) throw new HttpError(404, 'No hay ninguna actualización que deshacer');
  if (!listBackups(id).some((b) => b.file === last.backup)) throw new HttpError(410, `Ya no existe el respaldo ${last.backup}`);

  const j = newJob(id, 'undo', last.from);
  const step = stepper(id, j);
  (async () => {
    let wasRunning = false;
    try {
      wasRunning = await stopIfRunning(id, step);
      step(`Reinstalando Minecraft ${last.from.mcVersion}${last.from.loaderVersion ? ` (${label(server.type, last.from.loaderVersion)})` : ''}…`);
      updateServer(id, { mcVersion: last.from.mcVersion, loaderVersion: last.from.loaderVersion, javaMajor: null });
      await install(id, step);
      step(`Restaurando el respaldo ${last.backup}…`);
      await restoreBackup(id, last.backup);
      // El respaldo trae el jar de antes (Paper, Fabric): la versión registrada vuelve a ser esa.
      updateServer(id, { lastSoftwareUpdate: null, loaderVersion: last.from.loaderVersion });
      record(id, 'update', { detail: `deshecha: de vuelta a ${last.from.mcVersion}` });
      j.done = true;
      if (wasRunning) {
        step('Encendiendo el servidor…');
        await instance(id).start();
      }
      step('Listo: el servidor quedó como antes de actualizar.');
    } catch (err) {
      j.error = err.message;
      step(`Error: ${err.message}`);
    } finally {
      j.running = false;
      bus.emit('software-update', id, jobView(id));
      bus.emit('servers');
    }
  })();
  return jobView(id);
}

export const softwareJob = jobView;
