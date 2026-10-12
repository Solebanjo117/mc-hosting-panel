import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { serverDir } from '../config.js';
import { db, getServer } from '../db.js';
import { bus } from '../lib/bus.js';
import { HttpError, sleep } from '../lib/util.js';
import { ensureJava, requiredJava } from './java.js';
import { launchArgs } from './installer.js';
import { getStats } from './procstats.js';

const MAX_LINES = 1500;
const STOP_TIMEOUT_MS = 45_000;

class Instance {
  constructor(id) {
    this.id = id;
    this.status = 'stopped'; // stopped | starting | running | stopping | crashed
    this.proc = null;
    this.lines = [];
    this.players = new Set();
    this.startedAt = null;
    this.stats = null;
    this.manualStop = false;
    this.crashCount = 0;
    this.lineListeners = new Set();
    this.partial = '';
  }

  snapshot() {
    return {
      status: this.status,
      players: [...this.players],
      startedAt: this.startedAt,
      stats: this.stats,
      pid: this.proc?.pid || null,
    };
  }

  setStatus(status) {
    this.status = status;
    bus.emit('status', this.id, this.snapshot());
  }

  pushLine(line) {
    this.lines.push(line);
    if (this.lines.length > MAX_LINES) this.lines.splice(0, this.lines.length - MAX_LINES);
    bus.emit('console', this.id, line);
    for (const fn of this.lineListeners) fn(line);
    this.parse(line);
  }

  panelLine(text) {
    const t = new Date().toTimeString().slice(0, 8);
    this.pushLine(`[${t}] [Panel] ${text}`);
  }

  parse(line) {
    if (this.status === 'starting' && /Done \(\d+[.,]?\d*s\)!/.test(line)) {
      this.crashCount = 0;
      this.setStatus('running');
    }
    let m = line.match(/: ([A-Za-z0-9_.]{2,16}) joined the game/);
    if (m) {
      this.players.add(m[1]);
      bus.emit('status', this.id, this.snapshot());
      return;
    }
    m = line.match(/: ([A-Za-z0-9_.]{2,16}) left the game/);
    if (m) {
      this.players.delete(m[1]);
      bus.emit('status', this.id, this.snapshot());
      return;
    }
    // Respuesta al comando "list": "There are 2 of a max of 20 players online: Ana, Beto"
    m = line.match(/There are \d+ (?:of a max of|\/) ?\d+ players online:\s*(.*)$/);
    if (m) {
      this.players = new Set(m[1].split(',').map((s) => s.trim()).filter(Boolean));
      bus.emit('status', this.id, this.snapshot());
    }
  }

  /** Espera una línea que cumpla la expresión (útil para backups). */
  waitForLine(regex, timeoutMs) {
    return new Promise((resolve) => {
      const done = (ok) => {
        clearTimeout(timer);
        this.lineListeners.delete(listener);
        resolve(ok);
      };
      const listener = (line) => regex.test(line) && done(true);
      const timer = setTimeout(() => done(false), timeoutMs);
      this.lineListeners.add(listener);
    });
  }

  async start() {
    if (this.proc) throw new HttpError(409, 'El servidor ya está encendido');
    const server = getServer(this.id);
    if (!server) throw new HttpError(404, 'Servidor no encontrado');
    if (server.installState !== 'ready') throw new HttpError(409, 'El servidor todavía no está instalado');

    this.manualStop = false;
    this.players.clear();
    this.setStatus('starting');

    let javaPath = server.javaPath;
    if (!javaPath || !fs.existsSync(javaPath)) {
      const major = server.javaMajor || (await requiredJava(server.mcVersion));
      this.panelLine(`Preparando Java ${major}…`);
      try {
        javaPath = await ensureJava(major, ({ message }) => message && this.panelLine(message));
      } catch (err) {
        this.panelLine(`Error: ${err.message}`);
        this.setStatus('stopped');
        throw err;
      }
    }

    const mem = Math.max(512, Number(server.memoryMb) || 2048);
    const args = [
      `-Xms${Math.min(mem, 1024)}M`,
      `-Xmx${mem}M`,
      '-Dfile.encoding=UTF-8',
      '-Dstdout.encoding=UTF-8',
      '-Dstderr.encoding=UTF-8',
      ...String(server.jvmArgs || '')
        .split(/\s+/)
        .filter(Boolean),
      ...launchArgs(server.launch),
      'nogui',
    ];

    this.panelLine(`Iniciando: java ${args.join(' ')}`);
    const proc = spawn(javaPath, args, { cwd: serverDir(this.id), windowsHide: true });
    this.proc = proc;
    this.startedAt = new Date().toISOString();
    bus.emit('status', this.id, this.snapshot());

    const onData = (chunk) => {
      const text = this.partial + chunk.toString('utf8');
      const parts = text.split(/\r?\n/);
      this.partial = parts.pop();
      for (const p of parts) this.pushLine(p);
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', (err) => {
      this.panelLine(`No se pudo iniciar Java: ${err.message}`);
    });
    proc.on('exit', (code) => this.onExit(code));
  }

  onExit(code) {
    if (this.partial) this.pushLine(this.partial);
    this.partial = '';
    this.proc = null;
    this.startedAt = null;
    this.stats = null;
    this.players.clear();
    const server = getServer(this.id);
    if (this.manualStop || code === 0) {
      this.panelLine(`Servidor detenido (código ${code}).`);
      this.setStatus('stopped');
      if (this.restartAfterStop) {
        this.restartAfterStop = false;
        this.start().catch((e) => this.panelLine(`Error al reiniciar: ${e.message}`));
      }
      return;
    }
    this.panelLine(`El servidor se cerró inesperadamente (código ${code}).`);
    this.setStatus('crashed');
    if (server?.autoRestart && this.crashCount < 3) {
      this.crashCount += 1;
      this.panelLine(`Reinicio automático en 10 s (intento ${this.crashCount}/3)…`);
      setTimeout(() => {
        if (!this.proc && this.status === 'crashed') this.start().catch((e) => this.panelLine(`Error: ${e.message}`));
      }, 10_000);
    }
  }

  send(command) {
    if (!this.proc) throw new HttpError(409, 'El servidor está apagado');
    const clean = String(command).replace(/^\//, '').replace(/[\r\n]+/g, ' ').trim();
    if (!clean) return;
    this.pushLine(`> ${clean}`);
    this.proc.stdin.write(`${clean}\n`);
  }

  async stop() {
    if (!this.proc) {
      if (this.status !== 'stopped') this.setStatus('stopped');
      return;
    }
    if (this.status === 'stopping') return;
    this.manualStop = true;
    this.setStatus('stopping');
    const proc = this.proc;
    try {
      proc.stdin.write('stop\n');
    } catch {
      /* stdin cerrado */
    }
    const exited = await Promise.race([
      new Promise((r) => proc.once('exit', () => r(true))),
      sleep(STOP_TIMEOUT_MS).then(() => false),
    ]);
    if (!exited && this.proc === proc) {
      this.panelLine('No respondió a "stop"; forzando cierre.');
      proc.kill('SIGKILL');
    }
  }

  kill() {
    if (!this.proc) return;
    this.manualStop = true;
    this.panelLine('Cierre forzado.');
    this.proc.kill('SIGKILL');
  }

  async restart() {
    if (!this.proc) return this.start();
    this.restartAfterStop = true;
    await this.stop();
  }
}

const instances = new Map();

export function instance(id) {
  if (!instances.has(id)) instances.set(id, new Instance(id));
  return instances.get(id);
}

export function removeInstance(id) {
  instances.delete(id);
}

export function isRunning(id) {
  return Boolean(instances.get(id)?.proc);
}

export function allInstances() {
  return [...instances.values()];
}

/** Muestra CPU/RAM cada pocos segundos para los servidores encendidos. */
setInterval(async () => {
  const live = allInstances().filter((i) => i.proc?.pid);
  if (!live.length) return;
  const stats = await getStats(live.map((i) => i.proc.pid));
  for (const inst of live) {
    if (!inst.proc) continue;
    inst.stats = stats.get(inst.proc.pid) || inst.stats;
    bus.emit('status', inst.id, inst.snapshot());
  }
}, 3000).unref();

export async function autoStartServers() {
  for (const server of db.data.servers) {
    if (server.autoStart && server.installState === 'ready') {
      instance(server.id)
        .start()
        .catch((err) => console.error(`[autostart ${server.name}]`, err.message));
    }
  }
}

/** Al cerrar el panel se apagan los servidores para no dejar Java huérfano ocupando el puerto. */
export async function stopAll(timeoutMs = 20_000) {
  const live = allInstances().filter((i) => i.proc);
  await Promise.race([Promise.all(live.map((i) => i.stop())), sleep(timeoutMs)]);
  for (const i of allInstances()) if (i.proc) i.proc.kill('SIGKILL');
}
