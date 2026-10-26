import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startMocks } from '../helpers/mocks.js';
import { startPanel, hasJava, waitFor } from '../helpers/panel.js';

/**
 * Casos de uso:
 *  - "Quiero que el servidor se encienda solo por las tardes y se apague cuando no haya nadie."
 *  - "Quiero cerrar el servidor un rato sin apagarlo, con un aviso, y que entren solo los que ayudan."
 *  - "Quiero comprobar que si se cae, se reinicia solo."
 *  - "Quiero que mis respaldos también queden en OneDrive."
 */
describe('Horario de energía, mantenimiento, simulacro y copia en la nube', { skip: !hasJava() && 'Se necesita Java' }, () => {
  let mocks;
  let panel;
  let c;
  let s;
  let dir;
  before(async () => {
    mocks = await startMocks();
    panel = await startPanel({ mocks });
    c = panel.client;
    s = await panel.createServer({ name: 'Operaciones', type: 'paper', mcVersion: '1.21.4' });
    dir = panel.serverDir(s.id);
  });
  after(async () => {
    await panel?.close();
    await mocks?.close();
  });

  it('horario de energía: valida la cuadrícula y la guarda', async () => {
    const p = await c.ok('GET', `/api/servers/${s.id}/power`);
    assert.equal(p.enabled, false);
    assert.equal(p.grid.length, 7);
    assert.equal((await c.put(`/api/servers/${s.id}/power`, { grid: [[true]] })).status, 400);
    const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, (_, h) => h >= 16));
    const saved = await c.ok('PUT', `/api/servers/${s.id}/power`, { enabled: true, grid, stopIfEmpty: false });
    assert.equal(saved.enabled, true);
    assert.equal(saved.grid[0][16], true);
    assert.equal(saved.grid[0][3], false);
    assert.equal(saved.stopIfEmpty, false);
    await c.ok('PUT', `/api/servers/${s.id}/power`, { enabled: false });
  });

  it('mantenimiento: cambia el MOTD y la lista blanca, y los restaura al terminar', async () => {
    await c.ok('PUT', `/api/servers/${s.id}/properties`, { motd: 'Mi servidor', 'white-list': 'false' });
    const before = fs.readFileSync(path.join(dir, 'server.properties'), 'utf8');
    assert.match(before, /motd=Mi servidor/);
    const m = await c.ok('POST', `/api/servers/${s.id}/maintenance`, { message: 'Volvemos a las 8', helpers: ['Ana', 'mal nombre!!'], until: 'hoy 20:00' });
    assert.equal(m.active, true);
    assert.deepEqual(m.helpers, ['Ana'], 'los nombres inválidos se descartan');
    const during = await c.ok('GET', `/api/servers/${s.id}/properties`);
    assert.equal(during.motd, '§6🔧 Volvemos a las 8 §7(hoy 20:00)');
    assert.equal(during['white-list'], 'true');
    const list = JSON.parse(fs.readFileSync(path.join(dir, 'whitelist.json'), 'utf8'));
    assert.ok(list.some((e) => e.name === 'Ana'));
    assert.equal((await c.post(`/api/servers/${s.id}/maintenance`, {})).status, 409, 'no se entra dos veces');
    const pub = await c.ok('PUT', `/api/servers/${s.id}/public`, { enabled: true });
    assert.ok(pub.enabled);
    const page = await c.ok('GET', `/api/public/${s.id}`);
    assert.equal(page.maintenance.message, 'Volvemos a las 8', 'la página pública lo anuncia');

    const done = await c.ok('DELETE', `/api/servers/${s.id}/maintenance`);
    assert.equal(done.active, false);
    const after = await c.ok('GET', `/api/servers/${s.id}/properties`);
    assert.equal(after.motd, 'Mi servidor');
    assert.equal(after['white-list'], 'false');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'whitelist.json'), 'utf8')), []);
  });

  it('simulacro: solo encendido; se cae y se reinicia solo', async () => {
    assert.equal((await c.post(`/api/servers/${s.id}/drill`)).status, 409);
    await c.ok('PATCH', `/api/servers/${s.id}`, { autoRestart: true });
    await panel.start(s.id);
    const r = await c.ok('POST', `/api/servers/${s.id}/drill`);
    assert.ok(r.at);
    assert.equal(r.autoRestart, true);
    await panel.waitStatus(s.id, 'crashed', 15000);
    const again = await panel.waitStatus(s.id, 'running', 40000);
    assert.equal(again.status, 'running');
    const act = await c.ok('GET', `/api/servers/${s.id}/activity?filter=server`);
    assert.ok(act.events.some((e) => e.type === 'drill'), 'queda en la línea de tiempo');
    await panel.stop(s.id);
  });

  it('copia en la nube: valida la carpeta, copia el respaldo y la Revisión lo confirma', async () => {
    const cloud = fs.mkdtempSync(path.join(os.tmpdir(), 'nube-'));
    assert.equal((await c.put('/api/system/backup-mirror', { path: path.join(os.tmpdir(), 'no-existe-' + Date.now(), 'x', 'y') })).status, 400);
    const cfg = await c.ok('PUT', '/api/system/backup-mirror', { path: path.join(cloud, 'MC Hosting Panel') });
    assert.ok(fs.existsSync(cfg.path));
    const b = await c.ok('POST', `/api/servers/${s.id}/backups`, { mode: 'mundo' });
    const copy = path.join(cfg.path, 'Operaciones', b.file);
    await waitFor(() => fs.existsSync(copy), { timeout: 10000, message: 'la copia en la nube' });
    const health = await c.ok('GET', `/api/servers/${s.id}/health`);
    const item = health.checks.find((x) => x.id === 'mirror');
    assert.equal(item.level, 'ok', JSON.stringify(item));
    await c.ok('PUT', '/api/system/backup-mirror', { path: '' });
    assert.equal((await c.ok('GET', '/api/system/backup-mirror')).path, '');
  });
});
