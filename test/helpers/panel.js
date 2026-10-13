import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Arranca el panel de verdad (node server/index.js) con una carpeta de datos temporal,
 * los servicios de internet simulados y Java del sistema para el servidor de Minecraft falso.
 */

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ADMIN = { username: 'admin', password: 'clave-segura-123' };

export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

let javaCache;
/** Ruta absoluta a java (del PATH o JAVA_HOME), o null si no hay Java instalado. */
export function findJava() {
  if (javaCache !== undefined) return javaCache;
  const exe = process.platform === 'win32' ? 'java.exe' : 'java';
  const candidates = [];
  if (process.env.JAVA_HOME) candidates.push(path.join(process.env.JAVA_HOME, 'bin', exe));
  try {
    const out = execFileSync(process.platform === 'win32' ? 'where' : 'which', ['java'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    candidates.push(...out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
  } catch {
    /* sin java en el PATH */
  }
  javaCache = candidates.find((c) => fs.existsSync(c)) || null;
  return javaCache;
}

export const hasJava = () => Boolean(findJava());

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(fn, { timeout = 15000, interval = 150, message = 'la condición' } = {}) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch (err) {
      last = err;
    }
    await sleep(interval);
  }
  throw new Error(`Se acabó el tiempo esperando ${message}. Último valor: ${last instanceof Error ? last.message : JSON.stringify(last)}`);
}

/** Cliente HTTP con la cookie de sesión. */
export class Client {
  constructor(base) {
    this.base = base;
    this.cookie = '';
  }

  async request(method, url, { body, form, headers = {}, raw = false } = {}) {
    const opts = { method, headers: { ...headers }, redirect: 'manual' };
    if (this.cookie) opts.headers.cookie = this.cookie;
    if (form) opts.body = form;
    else if (body !== undefined) {
      opts.headers['content-type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`${this.base}${url}`, opts);
    const set = res.headers.get('set-cookie');
    if (set) {
      const m = set.match(/mcp_token=([^;]*)/);
      if (m) this.cookie = m[1] ? `mcp_token=${m[1]}` : '';
    }
    if (raw) return res;
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* no es JSON */
    }
    return { status: res.status, body: json, text, headers: res.headers };
  }

  get(url, o) {
    return this.request('GET', url, o);
  }
  post(url, body, o = {}) {
    return this.request('POST', url, { ...o, body });
  }
  put(url, body, o = {}) {
    return this.request('PUT', url, { ...o, body });
  }
  patch(url, body, o = {}) {
    return this.request('PATCH', url, { ...o, body });
  }
  del(url, o) {
    return this.request('DELETE', url, o);
  }

  /** Igual que request pero falla si la respuesta no es 2xx; devuelve el cuerpo. */
  async ok(method, url, body) {
    const r = await this.request(method, url, body === undefined ? {} : { body });
    if (r.status < 200 || r.status >= 300) throw new Error(`${method} ${url} → ${r.status}: ${r.text.slice(0, 400)}`);
    return r.body;
  }
}

/**
 * Arranca un panel nuevo.
 *  - mocks: resultado de startMocks() (para redirigir internet).
 *  - setup: crea la cuenta de administrador e inicia sesión.
 *  - db: valores iniciales extra para db.json (por ejemplo settings).
 */
export async function startPanel({ mocks, setup = true, db = {}, env = {}, playitAgent = false } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
  const port = await freePort();
  const java = findJava();
  const javaPaths = java ? { 8: java, 17: java, 21: java, 25: java } : {};
  const initial = {
    admin: null,
    jwtSecret: null,
    servers: [],
    ...db,
    settings: { panelPort: port, javaPaths, ...(db.settings || {}) },
  };
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify(initial, null, 2));

  if (playitAgent) {
    // El agente de playit es un programa aparte; en las pruebas basta con uno que no haga nada.
    const dir = path.join(dataDir, 'playit');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'playit.toml'), 'secret_key = "abcdef0123456789abcdef0123456789"\n');
    // El "agente" solo se queda abierto (en Windows, una copia de node que se cierra al momento: el panel lo tolera).
    if (process.platform === 'win32') fs.copyFileSync(process.execPath, path.join(dir, 'playitd.exe'));
    else fs.writeFileSync(path.join(dir, 'playitd'), '#!/bin/sh\necho "playit connected"\nexec sleep 600\n', { mode: 0o755 });
  }

  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      MCP_DATA_DIR: dataDir,
      MCP_URL_REWRITE: mocks ? JSON.stringify(mocks.rewrite) : '{}',
      MCP_DNS_SERVERS: mocks?.dns || '127.0.0.1:9',
      OPEN_BROWSER: '0',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const exited = new Promise((r) => child.once('exit', r));

  const base = `http://127.0.0.1:${port}`;
  const client = new Client(base);
  await waitFor(
    async () => {
      if (child.exitCode !== null) throw new Error(`El panel se cerró al arrancar:\n${log}`);
      const r = await fetch(`${base}/api/auth/status`).catch(() => null);
      return r?.ok;
    },
    { timeout: 20000, message: 'que el panel arranque' }
  );

  if (setup) await client.ok('POST', '/api/auth/setup', ADMIN);

  const panel = {
    base,
    port,
    dataDir,
    client,
    get log() {
      return log;
    },
    serverDir: (id) => path.join(dataDir, 'servers', id),
    readDb: () => JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8')),

    /** Crea un servidor y espera a que termine de instalarse. */
    async createServer(body, { wait = true } = {}) {
      const s = await client.ok('POST', '/api/servers', { name: 'Prueba', type: 'paper', mcVersion: '1.21.4', memoryMb: 1024, eula: true, ...body });
      if (!wait) return s;
      return panel.waitInstalled(s.id);
    },

    async waitInstalled(id, timeout = 60000) {
      return waitFor(
        async () => {
          const s = await client.ok('GET', `/api/servers/${id}`);
          if (s.installState === 'error') throw Object.assign(new Error(`La instalación falló: ${s.installError}`), { fatal: true });
          return s.installState === 'ready' && !s.installing ? s : null;
        },
        { timeout, message: `que se instale ${id}` }
      ).catch((err) => {
        throw new Error(`${err.message}\n--- log del panel ---\n${log.slice(-3000)}`);
      });
    },

    async status(id) {
      return (await client.ok('GET', `/api/servers/${id}`)).runtime;
    },

    async waitStatus(id, wanted, timeout = 20000) {
      return waitFor(async () => ((await panel.status(id)).status === wanted ? panel.status(id) : null), { timeout, message: `estado ${wanted} en ${id}` });
    },

    async start(id) {
      await client.ok('POST', `/api/servers/${id}/start`);
      return panel.waitStatus(id, 'running', 30000);
    },

    async stop(id) {
      await client.ok('POST', `/api/servers/${id}/stop`);
      return panel.waitStatus(id, 'stopped', 30000);
    },

    async command(id, command) {
      return client.ok('POST', `/api/servers/${id}/command`, { command });
    },

    async consoleText(id) {
      const r = await client.ok('GET', `/api/servers/${id}/console`);
      return (r.lines || r).join('\n');
    },

    async waitConsole(id, regex, timeout = 15000) {
      return waitFor(async () => regex.test(await panel.consoleText(id)), { timeout, message: `${regex} en la consola` });
    },

    async close() {
      try {
        const list = (await client.get('/api/servers')).body || [];
        for (const s of list) {
          if (s.runtime?.pid) await client.post(`/api/servers/${s.id}/kill`).catch(() => {});
        }
      } catch {
        /* el panel ya no responde */
      }
      child.kill();
      await Promise.race([exited, sleep(5000)]);
      for (let i = 0; i < 10; i++) {
        try {
          fs.rmSync(dataDir, { recursive: true, force: true });
          break;
        } catch {
          await sleep(300); // Windows puede tardar en soltar los archivos
        }
      }
    },
  };
  return panel;
}
