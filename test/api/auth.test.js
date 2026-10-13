import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startPanel, Client, ADMIN } from '../helpers/panel.js';

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
