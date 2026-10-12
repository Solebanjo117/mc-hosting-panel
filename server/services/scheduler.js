import crypto from 'node:crypto';
import { db, getServer } from '../db.js';
import { bus } from '../lib/bus.js';
import { HttpError, sleep } from '../lib/util.js';
import { instance, isRunning } from './processManager.js';
import { createBackup } from './backups.js';

/**
 * Tareas programadas por servidor. Usan la hora de esta PC.
 *  when: { type: 'daily', time: 'HH:MM', days: [0..6] }  (0 = domingo)
 *        { type: 'interval', minutes: N }
 *  action: restart | stop | start | backup | command | message
 * Para reiniciar/apagar, los avisos empiezan `warnMinutes` antes de la hora indicada.
 */

export const ACTIONS = ['restart', 'stop', 'start', 'backup', 'command', 'message'];
const running = new Set(); // ids de tareas en curso

function list(server) {
  if (!Array.isArray(server.schedules)) server.schedules = [];
  return server.schedules;
}

function log(server, task, result) {
  if (!Array.isArray(server.scheduleLog)) server.scheduleLog = [];
  server.scheduleLog.unshift({ at: new Date().toISOString(), taskId: task.id, action: task.action, result });
  server.scheduleLog = server.scheduleLog.slice(0, 30);
  db.save();
}

function validate(input) {
  const action = String(input.action || '');
  if (!ACTIONS.includes(action)) throw new HttpError(400, 'Acción inválida');
  const when = input.when || {};
  let cleanWhen;
  if (when.type === 'interval') {
    const minutes = Math.round(Number(when.minutes));
    if (!(minutes >= 5 && minutes <= 7 * 24 * 60)) throw new HttpError(400, 'El intervalo debe ser de 5 minutos a 7 días');
    cleanWhen = { type: 'interval', minutes };
  } else {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(when.time || '')) throw new HttpError(400, 'Hora inválida (usa HH:MM)');
    const days = [...new Set((when.days || []).map(Number).filter((d) => d >= 0 && d <= 6))].sort();
    if (!days.length) throw new HttpError(400, 'Elige al menos un día');
    cleanWhen = { type: 'daily', time: when.time, days };
  }
  const task = {
    action,
    when: cleanWhen,
    enabled: input.enabled !== false,
    warnMinutes: ['restart', 'stop'].includes(action) ? Math.min(60, Math.max(0, Math.round(Number(input.warnMinutes) || 0))) : 0,
    backupBefore: action === 'restart' ? Boolean(input.backupBefore) : false,
    command: action === 'command' ? String(input.command || '').replace(/^\//, '').trim().slice(0, 500) : '',
    message: action === 'message' ? String(input.message || '').trim().slice(0, 250) : '',
    label: String(input.label || '').trim().slice(0, 60),
  };
  if (action === 'command' && !task.command) throw new HttpError(400, 'Escribe el comando');
  if (action === 'message' && !task.message) throw new HttpError(400, 'Escribe el mensaje');
  return task;
}

function dayKey(d) {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** Próximo momento en que la tarea arranca (incluye el tiempo de aviso). */
export function nextRun(task, from = new Date()) {
  if (!task.enabled) return null;
  if (task.when.type === 'interval') {
    const last = task.lastRun ? Date.parse(task.lastRun) : Date.parse(task.createdAt);
    return new Date(Math.max(last + task.when.minutes * 60_000, from.getTime()));
  }
  const [h, m] = task.when.time.split(':').map(Number);
  for (let i = 0; i < 8; i++) {
    const d = new Date(from);
    d.setDate(d.getDate() + i);
    d.setHours(h, m, 0, 0);
    const start = new Date(d.getTime() - task.warnMinutes * 60_000);
    if (task.when.days.includes(d.getDay()) && start >= from && task.lastRunKey !== `${dayKey(d)}@${task.when.time}`) return d;
  }
  return null;
}

export function listTasks(id) {
  const server = getServer(id);
  if (!server) throw new HttpError(404, 'Servidor no encontrado');
  return {
    tasks: list(server).map((t) => ({ ...t, nextRun: nextRun(t)?.toISOString() || null, running: running.has(t.id) })),
    log: server.scheduleLog || [],
  };
}

export function saveTask(id, input, taskId) {
  const server = getServer(id);
  if (!server) throw new HttpError(404, 'Servidor no encontrado');
  const clean = validate(input);
  const tasks = list(server);
  if (taskId) {
    const existing = tasks.find((t) => t.id === taskId);
    if (!existing) throw new HttpError(404, 'Tarea no encontrada');
    Object.assign(existing, clean);
  } else {
    tasks.push({ id: crypto.randomUUID().slice(0, 8), createdAt: new Date().toISOString(), lastRun: null, ...clean });
  }
  db.save();
  return listTasks(id);
}

export function deleteTask(id, taskId) {
  const server = getServer(id);
  if (!server) throw new HttpError(404, 'Servidor no encontrado');
  server.schedules = list(server).filter((t) => t.id !== taskId);
  db.save();
  return listTasks(id);
}

function fmtMinutes(min) {
  if (min >= 1) return `${min} ${min === 1 ? 'minuto' : 'minutos'}`;
  return `${Math.round(min * 60)} segundos`;
}

/** Avisa en el chat a los 5, 1 minutos y 10 segundos (según el tiempo de aviso) y luego espera. */
async function countdown(inst, warnMinutes, verb) {
  const marks = [warnMinutes, 5, 1, 1 / 6].filter((m, i, arr) => m <= warnMinutes && m > 0 && arr.indexOf(m) === i).sort((a, b) => b - a);
  let remaining = warnMinutes;
  for (const mark of marks) {
    await sleep((remaining - mark) * 60_000);
    remaining = mark;
    if (!inst.proc) return false;
    inst.send(`say El servidor se ${verb} en ${fmtMinutes(mark)}.`);
  }
  await sleep(remaining * 60_000);
  return Boolean(inst.proc);
}

export async function runTask(id, task) {
  if (running.has(task.id)) return 'ya en curso';
  running.add(task.id);
  bus.emit('servers');
  const inst = instance(id);
  const on = isRunning(id) && inst.status === 'running';
  try {
    switch (task.action) {
      case 'restart': {
        if (!on) return 'omitida: el servidor estaba apagado';
        if (task.warnMinutes && !(await countdown(inst, task.warnMinutes, 'reiniciará'))) return 'cancelada: el servidor se apagó';
        if (task.backupBefore) {
          inst.send('say Guardando un respaldo antes de reiniciar…');
          await createBackup(id, 'mundo', 'programado');
        }
        await inst.restart();
        return 'reiniciado';
      }
      case 'stop': {
        if (!on) return 'omitida: el servidor ya estaba apagado';
        if (task.warnMinutes && !(await countdown(inst, task.warnMinutes, 'apagará'))) return 'cancelada';
        await inst.stop();
        return 'apagado';
      }
      case 'start':
        if (isRunning(id)) return 'omitida: ya estaba encendido';
        await inst.start();
        return 'encendido';
      case 'backup':
        await createBackup(id, 'mundo', 'programado');
        return 'respaldo creado';
      case 'command':
        if (!on) return 'omitida: el servidor estaba apagado';
        inst.send(task.command);
        return 'enviado';
      case 'message':
        if (!on) return 'omitida: el servidor estaba apagado';
        inst.send(`say ${task.message}`);
        return 'enviado';
      default:
        return 'acción desconocida';
    }
  } catch (err) {
    return `error: ${err.message}`;
  } finally {
    running.delete(task.id);
    bus.emit('servers');
  }
}

function due(task, now) {
  if (!task.enabled) return false;
  if (task.when.type === 'interval') {
    const last = task.lastRun ? Date.parse(task.lastRun) : Date.parse(task.createdAt);
    return now.getTime() - last >= task.when.minutes * 60_000;
  }
  const [h, m] = task.when.time.split(':').map(Number);
  const target = new Date(now);
  target.setHours(h, m, 0, 0);
  // Si el aviso empieza el día anterior (p. ej. 00:02 con 5 min de aviso), revisa la fecha de mañana.
  const candidates = [target, new Date(target.getTime() + 24 * 3600_000)];
  for (const t of candidates) {
    const s = t.getTime() - task.warnMinutes * 60_000;
    const key = `${dayKey(t)}@${task.when.time}`;
    // Ventana de 3 minutos: si la PC estaba apagada a esa hora, no se ejecuta tarde.
    if (task.when.days.includes(t.getDay()) && now.getTime() >= s && now.getTime() - s < 3 * 60_000 && task.lastRunKey !== key) {
      task.lastRunKey = key;
      return true;
    }
  }
  return false;
}

setInterval(() => {
  const now = new Date();
  for (const server of db.data.servers) {
    for (const task of list(server)) {
      if (running.has(task.id) || !due(task, now)) continue;
      task.lastRun = now.toISOString();
      db.save();
      runTask(server.id, task).then((result) => {
        const s = getServer(server.id);
        if (s) log(s, task, result);
      });
    }
  }
}, 15_000).unref();
