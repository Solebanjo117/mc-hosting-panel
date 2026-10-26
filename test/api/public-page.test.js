import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startMocks } from '../helpers/mocks.js';
import { startPanel, hasJava, Client } from '../helpers/panel.js';

/** Caso de uso: "Quiero mandarles a mis amigos un enlace donde vean si el servidor está encendido y cómo entrar." */
describe('Página pública e invitación', { skip: !hasJava() && 'Se necesita Java' }, () => {
  let mocks;
  let panel;
  let c;
  let s;
  before(async () => {
    mocks = await startMocks();
    panel = await startPanel({ mocks });
    c = panel.client;
    s = await panel.createServer({ name: 'Público', type: 'paper', mcVersion: '1.21.4' });
  });
  after(async () => {
    await panel?.close();
    await mocks?.close();
  });

  it('está apagada por defecto y no se ve sin activarla', async () => {
    const anon = new Client(panel.base);
    assert.equal((await anon.get(`/api/public/${s.id}`)).status, 404);
    const cfg = await c.ok('GET', `/api/servers/${s.id}/public`);
    assert.equal(cfg.enabled, false);
  });

  it('al activarla se ve sin sesión, con estado, MOTD, jugadores y dirección', async () => {
    await c.ok('PUT', `/api/servers/${s.id}/public`, { enabled: true, message: 'Jugamos los viernes' });
    const anon = new Client(panel.base);
    const r = await anon.get(`/api/public/${s.id}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.name, 'Público');
    assert.equal(r.body.status, 'stopped');
    assert.equal(r.body.message, 'Jugamos los viernes');
    assert.ok(Array.isArray(r.body.players));
    assert.ok(r.body.address && r.body.address.java && /:\d+$/.test(r.body.address.java), 'IP pública con puerto');
    assert.equal(r.body.playerCount, 0);
    assert.equal(r.body.maxPlayers, 20);
  });

  it('respeta lo que se decide ocultar', async () => {
    await c.ok('PUT', `/api/servers/${s.id}/public`, { showPlayers: false, showAddress: false });
    const anon = new Client(panel.base);
    const r = await anon.get(`/api/public/${s.id}`);
    assert.equal(r.body.players, null);
    assert.equal(r.body.address, null);
    assert.equal((await anon.get(`/api/public/${s.id}/icon`)).status, 404, 'sin ícono');
    await c.ok('PUT', `/api/servers/${s.id}/public`, { enabled: false });
    assert.equal((await anon.get(`/api/public/${s.id}`)).status, 404);
  });
});
