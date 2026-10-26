import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { DATA_DIR, IS_WINDOWS, serverDir } from '../config.js';
import { db, getServer } from '../db.js';
import { HttpError } from '../lib/util.js';
import { installedJavas, requiredJava } from './java.js';
import { instance } from './processManager.js';
import { isPortFree } from './network.js';
import { listBackups } from './backups.js';
import { check as mirrorCheck } from './backupMirror.js';
import { audit } from './security.js';
import * as playit from './playit.js';
import { systemInfo } from './procstats.js';
import { status as optimizeStatus } from './optimize.js';

/**
 * Revisión general de un servidor en una sola lista: lo que falta para que funcione
 * y lo que conviene arreglar. Cada punto: ok | info | warn | bad, con la pestaña donde se arregla.
 */

const DAY = 24 * 3600_000;

// --- Firewall de Windows (se consulta con netsh y se guarda un minuto) -----------------

let firewallCache = { at: 0, ports: null };

function firewallPorts() {
  if (!IS_WINDOWS) return Promise.resolve(null);
  if (Date.now() - firewallCache.at < 60_000) return Promise.resolve(firewallCache.ports);
  return new Promise((resolve) => {
    execFile('netsh', ['advfirewall', 'firewall', 'show', 'rule', 'name=all', 'dir=in'], { windowsHide: true, timeout: 8000, maxBuffer: 32 * 1024 * 1024 }, (err, out) => {
      if (err) return resolve(null);
      // Funciona con Windows en inglés y en español ("LocalPort" / "Puerto local").
      const ports = { tcp: new Set(), udp: new Set() };
      for (const block of String(out).split(/\r?\n\s*\r?\n/)) {
        const enabled = /^(Enabled|Habilitada)\s*:\s*(Yes|Sí|Si)/im.test(block);
        const allow = /^(Action|Acción)\s*:\s*(Allow|Permitir)/im.test(block);
        const proto = block.match(/^(Protocol|Protocolo)\s*:\s*(\w+)/im)?.[2]?.toLowerCase();
        const local = block.match(/^(LocalPort|Puerto local)\s*:\s*(.+)$/im)?.[2]?.trim();
        if (!enabled || !allow || !local || !['tcp', 'udp'].includes(proto)) continue;
        for (const part of local.split(',')) {
          const [a, b] = part.trim().split('-').map(Number);
          if (Number.isInteger(a)) for (let p = a; p <= (b || a) && p - a < 2000; p++) ports[proto].add(p);
        }
      }
      firewallCache = { at: Date.now(), ports };
      resolve(ports);
    });
  });
}

function diskFree() {
  try {
    const st = fs.statfsSync(DATA_DIR);
    return st.bavail * st.bsize;
  } catch {
    return null;
  }
}

function eulaAccepted(id) {
  try {
    return /^\s*eula\s*=\s*true/im.test(fs.readFileSync(path.join(serverDir(id), 'eula.txt'), 'utf8'));
  } catch {
    return false;
  }
}

const GB = 1024 ** 3;

export async function healthCheck(id) {
  const server = getServer(id);
  if (!server) throw new HttpError(404, 'Servidor no encontrado');
  const inst = instance(id);
  const running = Boolean(inst.proc);
  const checks = [];
  const add = (level, idKey, title, detail = '', tab = null) => checks.push({ id: idKey, level, title, detail, tab });

  // Instalación y arranque
  if (server.installState !== 'ready') add(server.installState === 'error' ? 'bad' : 'info', 'install', 'El servidor no está instalado todavía', server.installError || '', 'ajustes');
  else add('ok', 'install', 'Servidor instalado');

  if (server.installState === 'ready') {
    if (eulaAccepted(id)) add('ok', 'eula', 'EULA de Minecraft aceptada');
    else add('warn', 'eula', 'Falta aceptar la EULA de Minecraft', 'El panel la acepta al encender si la marcaste al crear el servidor.', 'ajustes');
  }

  let major = null;
  try {
    major = await requiredJava(server.mcVersion);
  } catch {
    /* sin dato */
  }
  const custom = db.data.settings.javaPaths?.[major];
  if (major && (custom || installedJavas().some((j) => j.major === major))) add('ok', 'java', `Java ${major} listo`);
  else if (major) add('info', 'java', `Java ${major} se descargará al encender`, 'El panel lo baja solo la primera vez (unos 50 MB).');

  // Puerto
  if (!running && server.installState === 'ready') {
    if (await isPortFree(server.port)) add('ok', 'port', `Puerto ${server.port} libre`);
    else add('bad', 'port', `Otro programa está usando el puerto ${server.port}`, 'Cierra el otro servidor o cambia el puerto en Ajustes.', 'ajustes');
  }

  // Cómo entran tus amigos
  const viaPlayit = Boolean(server.playit?.enabled);
  if (viaPlayit) {
    const st = playit.status();
    if (st.status === 'connected' || st.status === 'running') add('ok', 'tunnel', 'Túnel de playit.gg activo');
    else add('warn', 'tunnel', 'El agente de playit no está conectado', 'Revísalo en Ajustes del panel → Túneles de playit.gg.', 'conexion');
  } else {
    const fw = await firewallPorts();
    if (fw) {
      if (fw.tcp.has(Number(server.port))) add('ok', 'firewall', `Firewall de Windows permite el puerto ${server.port}`);
      else add('warn', 'firewall', `El Firewall de Windows no tiene regla para el puerto ${server.port}`, 'Ejecuta scripts\\abrir-firewall.bat o usa el comando de la pestaña Conexión.', 'conexion');
      if (server.bedrock?.enabled && !fw.udp.has(Number(server.bedrock.port))) {
        add('warn', 'firewall-udp', `Falta la regla UDP ${server.bedrock.port} para Bedrock`, 'Ejecuta scripts\\abrir-firewall.bat y elige la opción 2.', 'conexion');
      }
    }
    add('info', 'internet', 'Sin túnel: tus amigos de fuera necesitan el puerto abierto en tu router', 'Si tu internet tiene CGNAT, crea un túnel de playit.gg.', 'conexion');
  }

  if (server.dns?.enabled) {
    if (server.dns.applied?.ok) add('ok', 'dns', 'Dominio actualizado');
    else add('bad', 'dns', 'El dominio no se pudo actualizar', server.dns.applied?.error || '', 'conexion');
  }

  // Respaldos
  const backups = listBackups(id);
  const last = backups[0] ? Date.parse(backups[0].createdAt) : null;
  const auto = server.backupSchedule?.enabled || (server.schedules || []).some((t) => t.enabled && (t.action === 'backup' || t.backupBefore));
  if (!last) add('warn', 'backup', 'Todavía no hay respaldos', 'Haz uno o activa los respaldos automáticos.', 'respaldos');
  else if (Date.now() - last > 3 * DAY) add('warn', 'backup', `El último respaldo es de hace ${Math.floor((Date.now() - last) / DAY)} días`, auto ? '' : 'Activa los respaldos automáticos.', 'respaldos');
  else add('ok', 'backup', 'Respaldo reciente', auto ? 'Respaldos automáticos activos.' : 'Considera activar los automáticos.');
  const mirror = mirrorCheck(id, backups[0]?.file);
  if (mirror.configured) {
    if (mirror.ok) add('ok', 'mirror', 'Respaldos copiados a la nube');
    else add('warn', 'mirror', 'La copia de respaldos en la nube se quedó atrás', mirror.reason, 'respaldos');
  }

  // Recursos de la PC
  const free = diskFree();
  if (free != null) {
    if (free < GB) add('bad', 'disk', `Queda muy poco disco: ${(free / GB).toFixed(1)} GB`, 'Borra respaldos viejos o mundos que no uses.', 'respaldos');
    else if (free < 5 * GB) add('warn', 'disk', `Queda poco disco: ${(free / GB).toFixed(1)} GB`, 'Los respaldos y mapas ocupan espacio.', 'respaldos');
    else add('ok', 'disk', `${(free / GB).toFixed(0)} GB libres en disco`);
  }
  const sys = systemInfo();
  const reserved = db.data.servers.filter((s) => s.id === id || instance(s.id).proc).reduce((n, s) => n + Number(s.memoryMb || 0), 0);
  if (reserved > sys.totalMemMb * 0.85) {
    add('warn', 'ram', 'Los servidores piden casi toda la RAM de la PC', `Reservados ${(reserved / 1024).toFixed(1)} GB de ${(sys.totalMemMb / 1024).toFixed(0)} GB. Baja la memoria o apaga otro servidor.`, 'ajustes');
  } else if (server.type !== 'paper' && server.type !== 'vanilla' && server.memoryMb < 4096) {
    add('warn', 'ram', 'Poca memoria para un servidor con mods', 'Con mods conviene darle 4 GB o más.', 'ajustes');
  } else add('ok', 'ram', `${(server.memoryMb / 1024).toFixed(1).replace('.0', '')} GB de RAM asignados`);

  // Estado en vivo
  if (inst.lastCrash && Date.now() - Date.parse(inst.lastCrash.at || 0) < DAY) add('warn', 'crash', 'El servidor se cayó en las últimas 24 horas', 'Revisa la causa en Logs.', 'logs');
  if (running && inst.tps?.value != null && inst.tps.value < 15) add('warn', 'tps', `TPS bajo: ${inst.tps.value}`, 'El servidor va lento. Revisa Rendimiento.', 'rendimiento');

  // Optimización de un clic
  if (server.installState === 'ready') {
    try {
      const o = optimizeStatus(id);
      if (o.pending) add('info', 'optimize', `${o.pending} ${o.pending === 1 ? 'ajuste' : 'ajustes'} de rendimiento sin aplicar`, 'Aplícalos con un clic en Ajustes → Optimización.', 'ajustes');
      else add('ok', 'optimize', 'Servidor optimizado');
    } catch {
      /* sin datos */
    }
  }

  // Seguridad (resumen de la otra revisión)
  try {
    const findings = audit(id).findings || [];
    const bad = findings.filter((f) => f.level === 'critical').length;
    const warn = findings.filter((f) => f.level === 'warning').length;
    if (bad) add('bad', 'security', `${bad} problema${bad > 1 ? 's' : ''} de seguridad importante${bad > 1 ? 's' : ''}`, '', 'seguridad');
    else if (warn) add('warn', 'security', `${warn} recomendación${warn > 1 ? 'es' : ''} de seguridad`, '', 'seguridad');
    else add('ok', 'security', 'Seguridad revisada');
  } catch {
    /* sin propiedades todavía */
  }

  const rank = { bad: 3, warn: 2, info: 1, ok: 0 };
  const worst = checks.reduce((w, c) => (rank[c.level] > rank[w] ? c.level : w), 'ok');
  return {
    level: worst,
    counts: { bad: checks.filter((c) => c.level === 'bad').length, warn: checks.filter((c) => c.level === 'warn').length },
    checks: checks.sort((a, b) => rank[b.level] - rank[a.level]),
  };
}
