import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { startMocks } from '../helpers/mocks.js';
import { startPanel, Client, hasJava, waitFor } from '../helpers/panel.js';

/**
 * Caso de uso: "Quiero que un amigo modere mi servidor de survival (consola y jugadores) sin que pueda
 * tocar los archivos, los ajustes ni mi otro servidor; y que otro solo pueda mirar".
 */
describe('Usuarios y roles', { skip: !hasJava() && 'Se necesita Java' }, () => {
  let mocks;
  let panel;
  let owner;
  let survival;
  let creativo;
  let modId;
  const mod = new Client('');
  const viewer = new Client('');

  before(async () => {
    mocks = await startMocks();
    panel = await startPanel({ mocks });
    owner = panel.client;
    mod.base = panel.base;
    viewer.base = panel.base;
    survival = await panel.createServer({ name: 'Survival', type: 'vanilla', mcVersion: '1.21.4' });
    creativo = await panel.createServer({ name: 'Creativo', type: 'vanilla', mcVersion: '1.21.4', port: 25570 });
  });
  after(async () => {
    await panel?.close();
    await mocks?.close();
  });

  it('el dueño crea cuentas con rol y servidores; valida nombre, contraseña, rol y duplicados', async () => {
    assert.equal((await owner.post('/api/auth/users', { username: 'ab', password: 'clave-segura-123', role: 'moderator', servers: '*' })).status, 400);
    assert.equal((await owner.post('/api/auth/users', { username: 'mod', password: 'corta', role: 'moderator', servers: '*' })).status, 400);
    assert.equal((await owner.post('/api/auth/users', { username: 'mod', password: 'clave-segura-123', role: 'owner', servers: '*' })).status, 400, 'no se puede crear otro dueño');
    assert.equal((await owner.post('/api/auth/users', { username: 'mod', password: 'clave-segura-123', role: 'moderator', servers: ['no-existe'] })).status, 400);
    assert.equal(
      (await owner.post('/api/auth/users', { username: 'Admin', password: 'clave-segura-123', role: 'moderator', servers: '*' })).status,
      409,
      'el nombre del dueño está tomado (sin distinguir mayúsculas)'
    );

    const created = await owner.ok('POST', '/api/auth/users', { username: 'mod', password: 'clave-segura-123', role: 'moderator', servers: [survival.id] });
    modId = created.id;
    assert.deepEqual(created.servers, [survival.id]);
    assert.equal(created.passwordHash, undefined, 'no se devuelve el hash');
    assert.equal((await owner.post('/api/auth/users', { username: 'MOD', password: 'clave-segura-123', role: 'viewer', servers: '*' })).status, 409);
    await owner.ok('POST', '/api/auth/users', { username: 'mirón', password: 'clave-segura-123', role: 'viewer', servers: '*' }).catch(() => {});
    const v = await owner.ok('POST', '/api/auth/users', { username: 'miron', password: 'clave-segura-123', role: 'viewer', servers: '*' });
    assert.equal(v.role, 'viewer');
    const list = await owner.ok('GET', '/api/auth/users');
    assert.deepEqual(
      list.map((u) => u.username),
      ['mod', 'miron']
    );
  });

  it('cada cuenta entra con su contraseña y ve su rol', async () => {
    assert.equal((await mod.post('/api/auth/login', { username: 'mod', password: 'otra-clave-123' })).status, 401);
    const r = await mod.ok('POST', '/api/auth/login', { username: 'mod', password: 'clave-segura-123' });
    assert.equal(r.role, 'moderator');
    const st = await mod.ok('GET', '/api/auth/status');
    assert.equal(st.role, 'moderator');
    assert.deepEqual(st.servers, [survival.id]);
    await viewer.ok('POST', '/api/auth/login', { username: 'miron', password: 'clave-segura-123' });
    assert.equal((await viewer.ok('GET', '/api/auth/status')).servers, '*');
    const users = await owner.ok('GET', '/api/auth/users');
    assert.ok(users.find((u) => u.username === 'mod').lastLoginAt, 'se anota la última entrada');
  });

  it('el moderador solo ve sus servidores: el otro no existe para él', async () => {
    const list = await mod.ok('GET', '/api/servers');
    assert.deepEqual(
      list.map((s) => s.id),
      [survival.id]
    );
    assert.equal((await mod.get(`/api/servers/${creativo.id}`)).status, 404);
    assert.equal((await mod.post(`/api/servers/${creativo.id}/start`)).status, 404);
    const dash = await mod.ok('GET', '/api/system/dashboard');
    assert.deepEqual(
      dash.servers.map((s) => s.id),
      [survival.id]
    );
    const overview = await mod.ok('GET', '/api/system/metrics?range=1h');
    assert.deepEqual(
      overview.servers.map((s) => s.id),
      [survival.id]
    );
    assert.equal(overview.now.totals.servers, 1);
    assert.equal((await viewer.ok('GET', '/api/servers')).length, 2, 'el observador con "*" ve los dos');
  });

  it('el moderador opera su servidor pero no toca archivos, ajustes ni el panel', async () => {
    assert.equal((await mod.ok('GET', `/api/servers/${survival.id}`)).id, survival.id);
    assert.equal((await mod.get(`/api/servers/${survival.id}/console`)).status, 200);
    assert.equal((await mod.get(`/api/servers/${survival.id}/players`)).status, 200);
    assert.equal((await mod.get(`/api/servers/${survival.id}/backups`)).status, 200);
    assert.equal((await mod.post(`/api/servers/${survival.id}/players`, { action: 'whitelist-add', name: 'Notch' })).status, 200);
    assert.equal((await mod.post(`/api/servers/${survival.id}/positions/watch`, { on: true })).status, 200);
    const cmd = await mod.post(`/api/servers/${survival.id}/command`, { command: 'list' });
    assert.notEqual(cmd.status, 403, 'mandar comandos está permitido (aunque apagado responda otra cosa)');

    for (const [method, url, body] of [
      ['GET', `/api/servers/${survival.id}/files?path=`],
      ['GET', `/api/servers/${survival.id}/files/content?path=server.properties`],
      ['PUT', `/api/servers/${survival.id}/properties`, { motd: 'x' }],
      ['PATCH', `/api/servers/${survival.id}`, { memoryMb: 2048 }],
      ['POST', `/api/servers/${survival.id}/clone`, { name: 'Copia' }],
      ['DELETE', `/api/servers/${survival.id}`],
      ['POST', `/api/servers/${survival.id}/schedules`, { type: 'message', text: 'x', cron: '0 0 * * *' }],
      ['POST', `/api/servers/${survival.id}/content/install`, { projectId: 'x' }],
      ['POST', '/api/servers', { name: 'Nuevo', type: 'vanilla', mcVersion: '1.21.4', eula: true }],
      ['GET', '/api/system/network'],
      ['GET', '/api/system/update'],
      ['GET', '/api/integrations/dns'],
      ['PUT', '/api/system/settings', { remoteAccess: 'any' }],
      ['PUT', '/api/system/appearance', { accent: 'gold' }],
      ['GET', '/api/auth/users'],
      ['GET', '/api/auth/log'],
      ['POST', '/api/auth/users', { username: 'otro', password: 'clave-segura-123', role: 'viewer', servers: '*' }],
    ]) {
      const r = await mod.request(method, url, body === undefined ? {} : { body });
      assert.equal(r.status, 403, `${method} ${url} → ${r.status}`);
    }
    // Lo que todos pueden leer.
    for (const url of ['/api/system/info', '/api/system/quick-commands', '/api/system/appearance', '/api/system/docs/puertos']) {
      assert.equal((await mod.get(url)).status, 200, url);
    }
    assert.equal((await owner.get(`/api/servers/${survival.id}/files?path=`)).status, 200, 'el dueño sí');
  });

  it('el observador solo mira', async () => {
    assert.equal((await viewer.get(`/api/servers/${survival.id}/console`)).status, 200);
    assert.equal((await viewer.get(`/api/servers/${creativo.id}/players`)).status, 200);
    assert.equal((await viewer.post(`/api/servers/${survival.id}/command`, { command: 'list' })).status, 403);
    assert.equal((await viewer.post(`/api/servers/${survival.id}/start`)).status, 403);
    assert.equal((await viewer.post(`/api/servers/${survival.id}/players`, { action: 'kick', name: 'Notch' })).status, 403);
    assert.equal((await viewer.post(`/api/servers/${survival.id}/backups`, { mode: 'mundo' })).status, 403);
    assert.equal((await viewer.get(`/api/servers/${survival.id}/files?path=`)).status, 403);
  });

  it('por WebSocket cada cuenta recibe solo lo de sus servidores', async () => {
    const connect = (cookie) =>
      new Promise((resolve, reject) => {
        const ws = new WebSocket(`${panel.base.replace('http', 'ws')}/ws`, { headers: { cookie, origin: panel.base } });
        ws.messages = [];
        ws.on('message', (d) => ws.messages.push(JSON.parse(d)));
        ws.once('open', () => resolve(ws));
        ws.once('error', reject);
      });
    const ws = await connect(mod.cookie);
    try {
      ws.send(JSON.stringify({ type: 'subscribe', id: creativo.id }));
      ws.send(JSON.stringify({ type: 'subscribe', id: survival.id }));
      await waitFor(() => ws.messages.find((m) => m.type === 'console-history' && m.id === survival.id), { message: 'historial del suyo' });
      assert.ok(!ws.messages.some((m) => m.id === creativo.id), 'del otro servidor no llega nada');
      await panel.start(creativo.id);
      await waitFor(() => owner.ok('GET', `/api/servers/${creativo.id}`).then((s) => s.runtime.status === 'running'), { message: 'creativo encendido' });
      await new Promise((r) => setTimeout(r, 300));
      assert.ok(!ws.messages.some((m) => m.type === 'status' && m.id === creativo.id), 'ni su estado');
      await panel.stop(creativo.id);
    } finally {
      ws.close();
    }
  });

  it('el dueño cambia rol y servidores, pone otra contraseña (cierra sus sesiones) y quita la cuenta', async () => {
    await owner.ok('PUT', `/api/auth/users/${modId}`, { servers: '*' });
    assert.equal((await mod.ok('GET', '/api/servers')).length, 2, 'ahora ve los dos');
    await owner.ok('PUT', `/api/auth/users/${modId}`, { role: 'viewer' });
    assert.equal((await mod.post(`/api/servers/${survival.id}/command`, { command: 'list' })).status, 403, 'ya solo mira');
    assert.equal((await owner.put(`/api/auth/users/${modId}`, { username: 'miron' })).status, 409);

    await owner.ok('PUT', `/api/auth/users/${modId}`, { password: 'nueva-clave-456' });
    assert.equal((await mod.get('/api/servers')).status, 401, 'la sesión vieja ya no sirve');
    assert.equal((await mod.post('/api/auth/login', { username: 'mod', password: 'clave-segura-123' })).status, 401);
    await mod.ok('POST', '/api/auth/login', { username: 'mod', password: 'nueva-clave-456' });
    await mod.ok('POST', '/api/auth/password', { current: 'nueva-clave-456', password: 'la-mia-789' });
    assert.equal((await mod.get('/api/servers')).status, 200, 'cambiar su propia contraseña mantiene esta sesión');

    await owner.ok('DELETE', `/api/auth/users/${modId}`);
    assert.equal((await mod.get('/api/servers')).status, 401, 'sin cuenta no hay sesión');
    assert.equal((await owner.del(`/api/auth/users/${modId}`)).status, 404);
    assert.equal((await mod.post('/api/auth/login', { username: 'mod', password: 'la-mia-789' })).status, 401);
  });

  it('al borrar un servidor sale de las listas de las cuentas', async () => {
    const u = await owner.ok('POST', '/api/auth/users', { username: 'temporal', password: 'clave-segura-123', role: 'viewer', servers: [survival.id, creativo.id] });
    await owner.ok('DELETE', `/api/servers/${creativo.id}`);
    const after = (await owner.ok('GET', '/api/auth/users')).find((x) => x.id === u.id);
    assert.deepEqual(after.servers, [survival.id]);
  });
});
