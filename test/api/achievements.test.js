import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startMocks } from '../helpers/mocks.js';
import { startPanel, hasJava } from '../helpers/panel.js';

/** Caso de uso: "Quiero que el servidor celebre lo que mi grupo logra junto." */
describe('Logros del servidor', { skip: !hasJava() && 'Se necesita Java' }, () => {
  let mocks;
  let panel;
  let c;
  let s;
  before(async () => {
    mocks = await startMocks();
    panel = await startPanel({ mocks });
    c = panel.client;
    s = await panel.createServer({ name: 'Logros', type: 'paper', mcVersion: '1.21.4' });
  });
  after(async () => {
    await panel?.close();
    await mocks?.close();
  });

  it('lista todos los logros con su avance y desbloquea "Previsor" al décimo respaldo', async () => {
    const a = await c.ok('GET', `/api/servers/${s.id}/achievements`);
    assert.ok(a.total >= 15);
    assert.equal(a.unlocked, 0);
    const prev = a.items.find((x) => x.id === 'respaldos-10');
    assert.equal(prev.at, null);
    for (let i = 0; i < 10; i++) await c.ok('POST', `/api/servers/${s.id}/backups`, { mode: 'mundo' });
    const b = await c.ok('GET', `/api/servers/${s.id}/achievements`);
    const got = b.items.find((x) => x.id === 'respaldos-10');
    assert.ok(got.at, 'desbloqueado');
    assert.equal(got.progress, 1);
    assert.equal(b.unlocked, 1);
    const act = await c.ok('GET', `/api/servers/${s.id}/activity?filter=server`);
    assert.ok(act.events.some((e) => e.type === 'achievement' && e.detail === 'Previsor'), 'queda en la línea de tiempo');
  });
});
