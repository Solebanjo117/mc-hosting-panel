import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { serverDir } from '../config.js';
import { db, getServer } from '../db.js';
import { bus } from '../lib/bus.js';
import { HttpError, sleep } from '../lib/util.js';
import { ensureJava, requiredJava } from './java.js';
import { launchArgs } from './installer.js';
import { getStats } from './procstats.js';
import { applyGeyserConfig } from './geyserConfig.js';
import { applyConfig as applyMapConfig, followActiveWorld, takePendingUpdates } from './worldMap.js';
import { aikarFlags } from './optimize.js';
import { analyze } from './crashAnalyzer.js';
import { observe as observeConnections, tick as tickProtection } from './floodGuard.js';
import { compareVersions } from '../lib/util.js';

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
    this.tps = null; // { value, at }
    this.tpsSupported = true;
    this.silent = null; // { until, patterns }
    this.xbox = null; // estado de inicio de sesión de MCXboxBroadcast
    this.lastCrash = null; // { at, code, findings }
  }

  snapshot() {
    return {
      status: this.status,
      players: [...this.players],
      startedAt: this.startedAt,
      stats: this.stats,
      tps: this.tps?.value ?? null,
      pid: this.proc?.pid || null,
      xbox: this.xbox,
      lastCrash: this.lastCrash,
      drill: this.drill || null,
    };
  }

  setStatus(status) {
    this.status = status;
    bus.emit('status', this.id, this.snapshot());
  }

  pushLine(line) {
    // Las respuestas a comandos internos del panel (tps) no se muestran en la consola.
    if (this.silent && Date.now() < this.silent.until && this.silent.patterns.some((r) => r.test(line))) {
      this.parse(line);
      return;
    }
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
    this.parseExtras(line);
    if (this.status === 'starting' && /Done \(\d+[.,]?\d*s\)!/.test(line)) {
      this.crashCount = 0;
      this.setStatus('running');
      if (this.geyserPending) this.finishGeyserSetup();
      if (this.mapPending) this.finishMapSetup();
      this.requestMapUpdates();
    }
    let m = line.match(/: ([A-Za-z0-9_.]{2,17}) joined the game/);
    if (m) {
      this.players.add(m[1]);
      bus.emit('status', this.id, this.snapshot());
      return;
    }
    m = line.match(/: ([A-Za-z0-9_.]{2,17}) left the game/);
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

  /** TPS, inicio de sesión de Xbox (MCXboxBroadcast) y comandos desconocidos. */
  parseExtras(line) {
    observeConnections(this, line);
    let m = line.match(/TPS from last 1m, 5m, 15m: (?:§.)?\*?([\d.]+)/);
    if (m) {
      this.tps = { value: Math.min(20, Number(m[1])), at: Date.now() };
      return;
    }
    m = line.match(/Average time per tick: ([\d.]+) ?ms/);
    if (m) {
      const mspt = Number(m[1]);
      this.tps = { value: Math.round(Math.min(20, mspt > 0 ? 1000 / mspt : 20) * 10) / 10, at: Date.now() };
      return;
    }
    if (this.silent && Date.now() < this.silent.until && /Unknown (?:or incomplete )?command|Unknown command|Incorrect argument/i.test(line)) {
      this.tpsSupported = false;
      return;
    }
    m = line.match(/use a web browser to open the page (\S+) and enter the code (\S+?)\.? to authenticate/);
    if (m) {
      this.xbox = { state: 'login', url: m[1], code: m[2], at: new Date().toISOString() };
      bus.emit('status', this.id, this.snapshot());
      return;
    }
    m = line.match(/Successfully authenticated as (.+?) \((\d+)\)/);
    if (m) {
      this.xbox = { state: 'authenticated', gamertag: m[1], at: new Date().toISOString() };
      const server = getServer(this.id);
      if (server?.bedrock) {
        server.bedrock.xboxGamertag = m[1];
        db.save();
      }
      bus.emit('status', this.id, this.snapshot());
      return;
    }
    if (/Creation of Xbox LIVE session was successful/.test(line)) {
      this.xbox = { ...(this.xbox || {}), state: 'live', at: new Date().toISOString() };
      bus.emit('status', this.id, this.snapshot());
    }
  }

  /** Envía un comando sin mostrarlo ni mostrar su respuesta en la consola. */
  silentCommand(command, patterns, ms = 3000) {
    if (!this.proc) return;
    this.silent = { until: Date.now() + ms, patterns };
    this.proc.stdin.write(`${command}\n`);
  }

  /** Pide el TPS al servidor: "tps" en Paper, "tick query" en Minecraft 1.20.3+. */
  pollTps() {
    if (this.status !== 'running' || !this.tpsSupported) return;
    const server = getServer(this.id);
    if (!server) return;
    if (server.type === 'paper') {
      this.silentCommand('tps', [/TPS from last/, /Unknown command/i]);
    } else if (/^\d{2}\./.test(server.mcVersion) || compareVersions(server.mcVersion, '1.20.3') >= 0) {
      this.silentCommand('tick query', [
        /The game is (running|frozen|sprinting|stepping)/,
        /Target tick rate/,
        /Average time per tick/,
        /Percentiles|P50|P95|P99|Sample/i,
        /Unknown (or incomplete )?command|Incorrect argument|<--\[HERE\]/i,
      ]);
    } else {
      this.tpsSupported = false;
    }
  }

  /**
   * La primera vez Geyser crea su config.yml al arrancar, con el puerto 19132.
   * Cuando aparece, el panel pone el puerto de este servidor y recarga Geyser.
   */
  async finishGeyserSetup() {
    this.geyserPending = false;
    for (let attempt = 0; attempt < 10 && this.proc; attempt++) {
      await sleep(3000);
      const server = getServer(this.id);
      if (!server?.bedrock?.enabled) return;
      const result = applyGeyserConfig(server);
      if (result === 'missing') continue;
      if (result === 'changed') {
        this.panelLine(`Configurando Geyser en el puerto UDP ${server.bedrock.port}…`);
        try {
          this.send('geyser reload');
        } catch {
          /* el servidor se apagó */
        }
      }
      return;
    }
    if (this.proc) this.panelLine('Geyser no creó su configuración. Revisa que el plugin/mod de Geyser se haya cargado sin errores.');
  }

  /** BlueMap crea su configuración en el primer arranque: el panel la ajusta y lo recarga. */
  /** Tras un borrado en frío del mapa, le pide a BlueMap que lo dibuje (cuando ya cargó sus recursos). */
  async requestMapUpdates() {
    const server = getServer(this.id);
    if (!server?.map?.enabled) return;
    const maps = takePendingUpdates(server);
    if (!maps.length) return;
    await sleep(15_000); // BlueMap carga (o descarga) sus recursos después de "Done"
    if (!this.proc) return;
    for (const id of maps) this.send(`bluemap update ${id}`);
    this.panelLine(`BlueMap vuelve a dibujar el mapa (${maps.join(', ')}). Tarda unos minutos.`);
  }

  async finishMapSetup() {
    this.mapPending = false;
    for (let attempt = 0; attempt < 20 && this.proc; attempt++) {
      await sleep(3000);
      const server = getServer(this.id);
      if (!server?.map?.enabled) return;
      const result = applyMapConfig(server);
      if (result === 'missing') continue;
      if (result === 'changed') {
        this.panelLine(`Configurando el mapa (BlueMap) en el puerto ${server.map.port}, solo para esta PC…`);
        try {
          this.send('bluemap reload');
        } catch {
          /* el servidor se apagó */
        }
      }
      return;
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
    this.tps = null;
    this.tpsSupported = true;
    this.xbox = null;
    this.lastCrash = null;
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
      // Con los parámetros de Aikar la memoria mínima y máxima son iguales (así lo recomienda Paper).
      `-Xms${server.aikarFlags ? mem : Math.min(mem, 1024)}M`,
      `-Xmx${mem}M`,
      ...(server.aikarFlags ? aikarFlags(mem) : []),
      '-Dfile.encoding=UTF-8',
      '-Dstdout.encoding=UTF-8',
      '-Dstderr.encoding=UTF-8',
      ...String(server.jvmArgs || '')
        .split(/\s+/)
        .filter(Boolean),
      ...launchArgs(server.launch),
      'nogui',
    ];

    this.geyserPending = false;
    if (server.bedrock?.enabled) {
      const geyser = applyGeyserConfig(server);
      if (geyser === 'missing') this.geyserPending = true;
      else if (geyser === 'changed') this.panelLine(`Geyser configurado en el puerto UDP ${server.bedrock.port}.`);
    }

    this.mapPending = false;
    if (server.map?.enabled) {
      try {
        const moved = followActiveWorld(server);
        if (moved) this.panelLine(moved);
      } catch (err) {
        this.panelLine(`No se pudo ajustar el mapa al mundo actual: ${err.message}`);
      }
      if (applyMapConfig(server) === 'missing') this.mapPending = true;
    }

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
    this.tps = null;
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
    const findings = analyze(this.lines.slice(-400).join('\n'));
    this.lastCrash = { at: new Date().toISOString(), code, findings };
    for (const f of findings.slice(0, 3)) this.panelLine(`Posible causa: ${f.title}. ${f.fix}`);
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

  /** Simulacro de caída: mata el proceso como lo haría un fallo real para probar el reinicio y los avisos. */
  drillCrash() {
    if (!this.proc || this.status !== 'running') throw new HttpError(409, 'El servidor tiene que estar encendido para el simulacro');
    this.manualStop = false;
    this.drill = { at: new Date().toISOString() };
    this.panelLine('Simulacro de caída: el panel va a cerrar el proceso de golpe para comprobar el reinicio automático y las notificaciones.');
    this.proc.kill('SIGKILL');
    return this.drill;
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

setInterval(() => tickProtection((id) => instances.get(id)), 20_000).unref();

export async function autoStartServers() {
  // Los que estaban encendidos cuando el panel se reinició para actualizarse vuelven a encender.
  const resume = new Set(db.data.settings.resumeAfterRestart || []);
  if (resume.size) {
    delete db.data.settings.resumeAfterRestart;
    db.flush();
  }
  for (const server of db.data.servers) {
    if ((server.autoStart || resume.has(server.id)) && server.installState === 'ready') {
      instance(server.id)
        .start()
        .catch((err) => console.error(`[autostart ${server.name}]`, err.message));
    }
  }
}

/** Antes de reiniciar el panel (actualización): recordar cuáles encender de nuevo. */
export function rememberRunning() {
  db.data.settings.resumeAfterRestart = allInstances()
    .filter((i) => i.proc)
    .map((i) => i.id);
  db.flush();
}

/** Al cerrar el panel se apagan los servidores para no dejar Java huérfano ocupando el puerto. */
export async function stopAll(timeoutMs = 20_000) {
  const live = allInstances().filter((i) => i.proc);
  await Promise.race([Promise.all(live.map((i) => i.stop())), sleep(timeoutMs)]);
  for (const i of allInstances()) if (i.proc) i.proc.kill('SIGKILL');
}
