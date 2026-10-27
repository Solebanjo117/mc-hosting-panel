import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { startPanel, Client, ADMIN, ROOT, waitFor, freePort } from '../helpers/panel.js';

/**
 * Caso de uso: "La primera vez creo mi usuario; después solo entro yo, con contraseña,
 * y nadie puede adivinarla a fuerza de intentos ni usar mi sesión desde otra página".
 */
describe('Cuenta y sesión', () => {
  let panel;
  before(async () => {
    panel = await startPanel({ setup: false });
  });
  after(() => panel?.close());

  it('la primera vez pide crear la cuenta, valida usuario y contraseña, y solo deja hacerlo una vez', async () => {
    const c = new Client(panel.base);
    assert.deepEqual((await c.get('/api/auth/status')).body, { setupRequired: true, authenticated: false, username: null });
    assert.equal((await c.post('/api/auth/setup', { username: 'a', password: 'clave-segura-123' })).status, 400);
    assert.equal((await c.post('/api/auth/setup', { username: 'admin', password: 'corta' })).status, 400);
    assert.equal((await c.post('/api/auth/setup', ADMIN)).status, 200);
    assert.deepEqual((await c.get('/api/auth/status')).body, { setupRequired: false, authenticated: true, username: 'admin' });
    const other = new Client(panel.base);
    assert.equal((await other.post('/api/auth/setup', { username: 'intruso', password: 'otra-clave-123' })).status, 409);
    panel.client = c;
  });

  it('sin sesión todo devuelve 401', async () => {
    const anon = new Client(panel.base);
    for (const url of ['/api/servers', '/api/system/info', '/api/integrations/dns', '/api/auth/log']) {
      assert.equal((await anon.get(url)).status, 401, url);
    }
    assert.equal((await anon.post('/api/servers', { name: 'x' })).status, 401);
  });

  it('inicia y cierra sesión, y registra cada intento', async () => {
    const c = new Client(panel.base);
    assert.equal((await c.post('/api/auth/login', { username: 'admin', password: 'mala-clave-1' })).status, 401);
    assert.equal((await c.post('/api/auth/login', ADMIN)).status, 200);
    assert.equal((await c.get('/api/servers')).status, 200);
    const log = await c.ok('GET', '/api/auth/log');
    assert.equal(log[0].ok, true);
    assert.equal(log[1].ok, false);
    assert.equal(log[1].username, 'admin');
    await c.ok('POST', '/api/auth/logout');
    assert.equal((await c.get('/api/servers')).status, 401);
  });

  it('bloquea un rato después de 8 intentos fallidos (aunque luego acierte)', async () => {
    const c = new Client(panel.base);
    let last;
    for (let i = 0; i < 8; i++) last = await c.post('/api/auth/login', { username: 'admin', password: `intento-${i}-xx` });
    assert.equal(last.status, 401);
    const r = await c.post('/api/auth/login', ADMIN);
    assert.equal(r.status, 429);
    assert.match(r.body.error, /Demasiados intentos/);
  });

  it('detrás de un proxy en la misma máquina (Caddy) cuenta los intentos de cada visitante por separado', async () => {
    // El bloqueo de la prueba anterior es de esta máquina; un visitante que llega por el proxy no hereda ese bloqueo.
    const via = (ip) => ({ headers: { 'x-forwarded-for': ip } });
    const otro = new Client(panel.base);
    const ok = await otro.post('/api/auth/login', ADMIN, via('203.0.113.9'));
    assert.equal(ok.status, 200, ok.text);
    const atacante = new Client(panel.base);
    for (let i = 0; i < 8; i++) await atacante.post('/api/auth/login', { username: 'admin', password: `x-${i}-xxxx` }, via('198.51.100.7'));
    assert.equal((await atacante.post('/api/auth/login', ADMIN, via('198.51.100.7'))).status, 429, 'el atacante queda bloqueado');
    assert.equal((await new Client(panel.base).post('/api/auth/login', ADMIN, via('203.0.113.10'))).status, 200, 'los demás siguen entrando');
    const log = await otro.ok('GET', '/api/auth/log');
    assert.ok(log.some((e) => e.ip === '198.51.100.7'), 'el historial muestra la IP real');
  });

  it('cambiar la contraseña cierra las demás sesiones', async () => {
    const a = panel.client;
    const b = new Client(panel.base);
    b.cookie = a.cookie; // otra pestaña/dispositivo con la misma sesión anterior
    assert.equal((await a.post('/api/auth/password', { current: 'equivocada', password: 'nueva-clave-456' })).status, 401);
    assert.equal((await a.post('/api/auth/password', { current: ADMIN.password, password: 'corta' })).status, 400);
    await a.ok('POST', '/api/auth/password', { current: ADMIN.password, password: 'nueva-clave-456' });
    assert.equal((await a.get('/api/servers')).status, 200, 'la sesión actual sigue');
    assert.equal((await b.get('/api/servers')).status, 401, 'la sesión vieja ya no sirve');
  });

  it('rechaza acciones que vienen de otra página web (CSRF)', async () => {
    const c = panel.client;
    const r = await c.request('PUT', '/api/system/quick-commands', { body: { reset: true }, headers: { origin: 'https://pagina-mala.com' } });
    assert.equal(r.status, 403);
    assert.match(r.body.error, /no viene del panel/);
    const same = await c.request('PUT', '/api/system/quick-commands', { body: { reset: true }, headers: { origin: panel.base } });
    assert.equal(same.status, 200);
  });

  it('manda cabeceras de seguridad (sin iframes ajenos ni scripts de fuera)', async () => {
    const r = await panel.client.get('/api/auth/status');
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  });

  it('una ruta inexistente de la API responde 404 en JSON', async () => {
    const r = await panel.client.get('/api/no-existe');
    assert.equal(r.status, 404);
    assert.ok(r.body.error);
  });
});

/**
 * Caso de uso: "Olvidé la contraseña del panel: la cambio desde la PC donde corre, sin perder nada".
 */
describe('Olvidé mi contraseña', () => {
  /** Corre el script de restablecer con las respuestas ya escritas. */
  function resetScript(dataDir, port, answers) {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, ['scripts/restablecer-contrasena.mjs'], {
        cwd: ROOT,
        env: { ...process.env, MCP_DATA_DIR: dataDir, PORT: String(port) },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let out = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (out += d));
      child.on('exit', (code) => resolve({ code, out }));
      child.stdin.end(answers.join('\n') + '\n');
    });
  }

  let panel;
  before(async () => {
    panel = await startPanel();
  });
  after(() => panel?.close());

  it('con el panel abierto: muestra el usuario, cambia la contraseña al momento y cierra las sesiones', async () => {
    const old = panel.client;
    // Alguien se equivocó tantas veces que quedó bloqueado: restablecer también lo desbloquea.
    const c = new Client(panel.base);
    for (let i = 0; i < 8; i++) await c.post('/api/auth/login', { username: 'admin', password: `intento-${i}-xx` });
    assert.equal((await c.post('/api/auth/login', ADMIN)).status, 429);

    const r = await resetScript(panel.dataDir, panel.port, ['', 'olvidada-123', 'olvidada-123']);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /Tu usuario es: admin/);
    assert.match(r.out, /Ya puedes entrar como "admin"/);
    assert.ok(!fs.existsSync(path.join(panel.dataDir, 'restablecer-contrasena.json')), 'el panel lo aplicó y lo borró');
    assert.ok(!r.out.includes('olvidada-123'), 'la contraseña no se muestra');

    assert.equal((await old.get('/api/servers')).status, 401, 'la sesión de antes ya no sirve');
    assert.equal((await c.post('/api/auth/login', ADMIN)).status, 401, 'la contraseña vieja ya no sirve');
    await c.ok('POST', '/api/auth/login', { username: 'admin', password: 'olvidada-123' });
    const log = await c.ok('GET', '/api/auth/log');
    assert.ok(log.some((l) => l.reset && l.ip === 'esta PC' && l.username === 'admin'));
    panel.client = c;
  });

  it('también puede cambiar el usuario, y no acepta contraseñas cortas o que no coinciden', async () => {
    let r = await resetScript(panel.dataDir, panel.port, ['', 'corta', 'otra-clave-1', 'no-igual-1', 'x', 'y', 'z']);
    assert.equal(r.code, 1);
    assert.match(r.out, /muy corta/);
    assert.match(r.out, /No coinciden/);
    assert.match(r.out, /No se cambió nada/);
    r = await resetScript(panel.dataDir, panel.port, ['a b', 'clave-segura-9', 'clave-segura-9']);
    assert.equal(r.code, 1, 'usuario inválido');

    r = await resetScript(panel.dataDir, panel.port, ['juan', 'clave-segura-9', 'clave-segura-9']);
    assert.equal(r.code, 0, r.out);
    const c = new Client(panel.base);
    assert.equal((await c.post('/api/auth/login', { username: 'admin', password: 'clave-segura-9' })).status, 401);
    await c.ok('POST', '/api/auth/login', { username: 'juan', password: 'clave-segura-9' });
    assert.ok(panel.readDb().servers, 'lo demás sigue igual');
  });

  it('ignora un archivo de restablecer que no es válido', async () => {
    const file = path.join(panel.dataDir, 'restablecer-contrasena.json');
    fs.writeFileSync(file, JSON.stringify({ username: 'juan', passwordHash: 'texto-plano' }));
    await waitFor(() => !fs.existsSync(file), { message: 'que lo descarte' });
    await new Client(panel.base).ok('POST', '/api/auth/login', { username: 'juan', password: 'clave-segura-9' });
  });

  it('con el panel cerrado: se aplica al abrirlo', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-reset-'));
    try {
      fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({ admin: { username: 'admin', passwordHash: '$2b$12$' + 'x'.repeat(53) }, settings: {} }));
      const r = await resetScript(dir, await freePort(), ['', 'al-abrir-123', 'al-abrir-123']);
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /Se aplicará cuando abras el panel/);
      const pending = fs.readFileSync(path.join(dir, 'restablecer-contrasena.json'), 'utf8');

      const p = await startPanel({ setup: false, db: { admin: { username: 'admin', passwordHash: '$2b$12$' + 'x'.repeat(53) } }, beforeStart: (d) => fs.writeFileSync(path.join(d, 'restablecer-contrasena.json'), pending) });
      try {
        await new Client(p.base).ok('POST', '/api/auth/login', { username: 'admin', password: 'al-abrir-123' });
      } finally {
        await p.close();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
