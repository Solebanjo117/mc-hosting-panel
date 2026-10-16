import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startMocks } from '../helpers/mocks.js';
import { startPanel, hasJava, waitFor } from '../helpers/panel.js';

/**
 * Casos de uso:
 *  - "Quiero generar el mundo por adelantado para que explorar no dé tirones."
 *  - "Quiero ver cuánto falta, pausarlo si vamos a jugar y continuarlo después."
 */
describe('Pregenerar el mundo (Chunky)', { skip: !hasJava() && 'Se necesita Java' }, () => {
  let mocks;
  let panel;
  let c;
  let paper;
  const P = (s) => `/api/servers/${s.id}/pregen`;
  const task = async (s) => (await c.ok('GET', P(s))).task;
  const waitState = (s, state, timeout = 20_000) =>
    waitFor(async () => ((await task(s))?.state === state ? task(s) : null), { timeout, message: `pregeneración ${state}` });

  before(async () => {
    mocks = await startMocks();
    panel = await startPanel({ mocks });
    c = panel.client;
    paper = await panel.createServer({ name: 'Mundo grande', type: 'paper', mcVersion: '1.21.4' });
  });
  after(async () => {
    await panel?.close();
    await mocks?.close();
  });

  it('no está en Vanilla', async () => {
    const v = await panel.createServer({ name: 'Vanilla', type: 'vanilla', mcVersion: '1.21.4' });
    const st = await c.ok('GET', P(v));
    assert.equal(st.supported, false);
    assert.equal((await c.post(`${P(v)}/install`)).status, 400);
  });

  it('calcula cuántos chunks y cuánto disco ocupa', async () => {
    const sq = await c.ok('GET', `${P(paper)}/estimate?radius=5000`);
    assert.equal(sq.chunks, 625 * 625);
    assert.ok(sq.diskMb > 1000 && sq.diskMb < 2000, `${sq.diskMb} MB`);
    const circle = await c.ok('GET', `${P(paper)}/estimate?radius=5000&shape=circle`);
    assert.ok(circle.chunks < sq.chunks);
  });

  it('pide instalar Chunky y encender el servidor', async () => {
    let st = await c.ok('GET', P(paper));
    assert.deepEqual([st.supported, st.installed, st.running, st.task], [true, false, false, null]);
    assert.equal((await c.post(`${P(paper)}/start`, { radius: 500 })).status, 409);
    st = await c.ok('POST', `${P(paper)}/install`);
    assert.equal(st.installed, true);
    assert.ok(fs.existsSync(path.join(panel.serverDir(paper.id), 'plugins', 'chunky-1.0.0.jar')));
    assert.match((await c.post(`${P(paper)}/start`, { radius: 500 })).body.error, /Enciende el servidor/);
  });

  it('pregenera mostrando el avance, se pausa, continúa y termina', async () => {
    await panel.start(paper.id);
    assert.equal((await c.post(`${P(paper)}/start`, { radius: 5 })).status, 400, 'radio demasiado chico');
    assert.equal((await c.post(`${P(paper)}/start`, { radius: 500, dimension: 'luna' })).status, 400);

    const st = await c.ok('POST', `${P(paper)}/start`, { radius: 500, border: true });
    assert.equal(st.task.state, 'running');
    assert.equal(st.task.world, 'world');
    assert.equal(st.task.total, 63 * 63);
    const text = await panel.consoleText(paper.id);
    for (const cmd of ['chunky quiet 5', 'chunky world world', 'chunky spawn', 'chunky shape square', 'chunky radius 500', 'chunky start', 'worldborder set 1000']) {
      assert.ok(text.includes(`> ${cmd}`), `mandó "${cmd}"`);
    }
    assert.equal((await c.post(`${P(paper)}/start`, { radius: 500 })).status, 409, 'una a la vez');

    const progressing = await waitFor(async () => {
      const t = await task(paper);
      return t.percent > 0 && t.percent < 100 ? t : null;
    });
    assert.ok(progressing.processed > 0);
    assert.equal(progressing.rate, 312.5);
    assert.match(progressing.eta, /^0:00:\d\d$/);

    let r = await c.ok('POST', `${P(paper)}/pause`);
    assert.equal(r.task.state, 'paused');
    assert.match(await panel.consoleText(paper.id), /> chunky pause world/);
    assert.equal((await c.post(`${P(paper)}/pause`)).status, 409);
    r = await c.ok('POST', `${P(paper)}/continue`);
    assert.equal(r.task.state, 'running');

    const done = await waitState(paper, 'done');
    assert.equal(done.percent, 100);
    assert.equal(done.processed, 63 * 63);
    assert.equal(done.totalTime, '0:00:06');
    await waitFor(() => panel.readDb().servers.find((s) => s.id === paper.id).pregen?.state === 'done', { message: 'que se guarde' });
  });

  it('si ya hay una tarea, confirma y empieza de nuevo; también se puede cancelar', async () => {
    await c.ok('POST', `${P(paper)}/start`, { radius: 300, dimension: 'nether', center: 'xz', x: 100, z: -50 });
    await waitFor(async () => (await task(paper)).percent > 0);
    await c.ok('POST', `${P(paper)}/pause`);
    const again = await c.ok('POST', `${P(paper)}/start`, { radius: 300, dimension: 'nether', center: 'xz', x: 100, z: -50 });
    assert.equal(again.task.state, 'running');
    const text = await panel.consoleText(paper.id);
    assert.ok(text.includes('> chunky world world_nether'));
    assert.ok(text.includes('> chunky center 100 -50'));
    assert.ok(text.includes('> chunky confirm'), 'confirma reemplazar la tarea anterior');
    const r = await c.ok('POST', `${P(paper)}/cancel`);
    assert.equal(r.task.state, 'cancelled');
  });

  it('si se apaga a mitad, queda interrumpida para continuar después', async () => {
    await c.ok('POST', `${P(paper)}/start`, { radius: 500 });
    await panel.stop(paper.id);
    assert.equal((await task(paper)).state, 'interrupted');
    assert.equal((await c.post(`${P(paper)}/continue`)).status, 409, 'hay que encender primero');
    await panel.start(paper.id);
    const r = await c.ok('POST', `${P(paper)}/continue`);
    assert.equal(r.task.state, 'running');
    await c.ok('POST', `${P(paper)}/cancel`);
    const cleared = await c.ok('DELETE', P(paper));
    assert.equal(cleared.task, null);
    await panel.stop(paper.id);
  });

  it('instalado con el servidor encendido, pide reiniciar; en Fabric usa los nombres de dimensión', async () => {
    const fabric = await panel.createServer({ name: 'Fabric', type: 'fabric', mcVersion: '1.21.4' });
    await panel.start(fabric.id);
    try {
      const st = await c.ok('POST', `${P(fabric)}/install`);
      assert.equal(st.needsRestart, true);
      assert.match((await c.post(`${P(fabric)}/start`, { radius: 200 })).body.error, /Reinicia/);
      await panel.stop(fabric.id);
      await panel.start(fabric.id);
      await c.ok('POST', `${P(fabric)}/start`, { radius: 200, dimension: 'end' });
      assert.match(await panel.consoleText(fabric.id), /> chunky world minecraft:the_end/);
      await waitState(fabric, 'done');
    } finally {
      await panel.stop(fabric.id);
    }
  });
});
