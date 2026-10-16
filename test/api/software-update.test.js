import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startMocks, sha1 } from '../helpers/mocks.js';
import { startPanel, hasJava, waitFor } from '../helpers/panel.js';

/**
 * Casos de uso:
 *  - "Salió un build nuevo de Paper: quiero actualizar con un clic, con respaldo antes."
 *  - "Salió una versión nueva de Minecraft: quiero saber qué plugins no van a funcionar, actualizar
 *     y que los plugins se actualicen solos."
 *  - "Algo salió mal: quiero volver a como estaba."
 */
describe('Actualizar Paper / Minecraft con un clic', { skip: !hasJava() && 'Se necesita Java' }, () => {
  let mocks;
  let panel;
  let c;

  const waitJob = (id) =>
    waitFor(
      async () => {
        const { job } = await c.ok('GET', `/api/servers/${id}/software/job`);
        return job && !job.running ? job : null;
      },
      { timeout: 90_000, message: 'que termine la actualización' }
    );

  before(async () => {
    mocks = await startMocks();
    panel = await startPanel({ mocks });
    c = panel.client;
  });
  after(async () => {
    await panel?.close();
    await mocks?.close();
  });

  describe('build nuevo de Paper', () => {
    let s;
    before(async () => {
      mocks.state.paperBuild = 120;
      s = await panel.createServer({ name: 'Paper al día', type: 'paper', mcVersion: '1.21.4' });
    });

    it('al día no ofrece nada', async () => {
      const st = await c.ok('GET', `/api/servers/${s.id}/software`);
      assert.deepEqual(st.current, { mcVersion: '1.21.4', loader: '120' });
      assert.equal(st.loader.available, false);
      assert.equal(st.minecraft.available, false);
    });

    it('con un build nuevo: apaga, respalda, actualiza y vuelve a encender', async () => {
      mocks.state.paperBuild = 125;
      const st = await c.ok('GET', `/api/servers/${s.id}/software`);
      assert.equal(st.loader.available, true);
      assert.equal(st.loader.latestLabel, 'build #125');

      await panel.start(s.id);
      const r = await c.post(`/api/servers/${s.id}/software/update`, { target: 'loader' });
      assert.equal(r.status, 202);
      const job = await waitJob(s.id);
      assert.equal(job.error, null, job.log.join('\n'));
      assert.ok(job.log.some((l) => /Apagando/.test(l)));
      assert.ok(job.log.some((l) => /Respaldo listo/.test(l)));

      const { backups } = await c.ok('GET', `/api/servers/${s.id}/backups`);
      assert.ok(backups.some((b) => /antes-de-actualizar/.test(b.file)), 'hay respaldo de antes');
      const after = (await c.ok('GET', `/api/servers/${s.id}`));
      assert.equal(after.loaderVersion, '125');
      await panel.waitStatus(s.id, 'running', 30_000);
      assert.equal(panel.readDb().servers.find((x) => x.id === s.id).lastSoftwareUpdate.from.loaderVersion, '120');

      const again = await c.ok('GET', `/api/servers/${s.id}/software`);
      assert.equal(again.loader.available, false);
      await panel.stop(s.id);
    });

    it('no se pueden lanzar dos a la vez ni bajar de versión con esto', async () => {
      assert.equal((await c.post(`/api/servers/${s.id}/software/update`, { target: 'minecraft', mcVersion: '1.20.1' })).status, 400);
      assert.equal((await c.post(`/api/servers/${s.id}/software/update`, { target: 'otro' })).status, 400);
    });
  });

  describe('versión nueva de Minecraft con plugins', () => {
    let s;
    let dir;
    before(async () => {
      mocks.state.paperBuild = 118;
      s = await panel.createServer({ name: 'Paper viejo', type: 'paper', mcVersion: '1.20.1' });
      mocks.state.paperBuild = 130;
      dir = panel.serverDir(s.id);
      await c.ok('POST', `/api/servers/${s.id}/content/install`, { projectId: 'luckperms' });
      fs.writeFileSync(path.join(dir, 'plugins', 'MiPlugin.jar'), 'subido a mano');
      fs.writeFileSync(path.join(dir, 'world-marca.txt'), 'antes');
      mocks.state.modrinthUpdates[sha1(fs.readFileSync(path.join(dir, 'plugins', 'luckperms-1.0.0.jar')))] = { project: 'luckperms' };
    });

    it('dice qué plugins tienen versión para la nueva y cuáles no', async () => {
      const st = await c.ok('GET', `/api/servers/${s.id}/software`);
      assert.equal(st.minecraft.available, true);
      assert.equal(st.minecraft.latest, '1.21.4');
      assert.equal(st.minecraft.content.total, 2);
      assert.deepEqual(st.minecraft.content.ready.map((r) => [r.title, r.newVersion]), [['LuckPerms', '2.0.0']]);
      assert.deepEqual(st.minecraft.content.missing.map((r) => r.filename), ['MiPlugin.jar']);
      const req = mocks.state.requests.findLast((x) => x.path === '/modrinth/version_files/update');
      assert.deepEqual(JSON.parse(req.body).game_versions, ['1.21.4']);
    });

    it('actualiza Minecraft y los plugins que tienen versión nueva', async () => {
      await c.ok('POST', `/api/servers/${s.id}/software/update`, { target: 'minecraft' });
      const job = await waitJob(s.id);
      assert.equal(job.error, null, job.log.join('\n'));
      const srv = await c.ok('GET', `/api/servers/${s.id}`);
      assert.equal(srv.mcVersion, '1.21.4');
      assert.equal(srv.loaderVersion, '130');
      assert.deepEqual(fs.readdirSync(path.join(dir, 'plugins')).filter((f) => f.endsWith('.jar')).sort(), ['MiPlugin.jar', 'luckperms-2.0.0.jar']);
      assert.ok(job.log.some((l) => /Actualizados: luckperms-2.0.0.jar/.test(l)));
      const act = await c.ok('GET', `/api/servers/${s.id}/activity`).catch(() => null);
      if (act?.events) assert.ok(act.events.some((e) => e.type === 'update'));
    });

    it('deshacer vuelve a la versión anterior con sus plugins', async () => {
      fs.writeFileSync(path.join(dir, 'world-marca.txt'), 'después');
      await c.ok('POST', `/api/servers/${s.id}/software/undo`);
      const job = await waitJob(s.id);
      assert.equal(job.error, null, job.log.join('\n'));
      const srv = await c.ok('GET', `/api/servers/${s.id}`);
      assert.equal(srv.mcVersion, '1.20.1');
      assert.equal(srv.loaderVersion, '118', 'el jar del respaldo es el de antes');
      assert.deepEqual(fs.readdirSync(path.join(dir, 'plugins')).filter((f) => f.endsWith('.jar')).sort(), ['MiPlugin.jar', 'luckperms-1.0.0.jar']);
      assert.equal(fs.readFileSync(path.join(dir, 'world-marca.txt'), 'utf8'), 'antes');
      assert.equal((await c.post(`/api/servers/${s.id}/software/undo`)).status, 404, 'no hay nada más que deshacer');
    });
  });

  it('Vanilla solo se actualiza de versión de Minecraft', async () => {
    const v = await panel.createServer({ name: 'Vanilla', type: 'vanilla', mcVersion: '1.20.1' });
    const st = await c.ok('GET', `/api/servers/${v.id}/software`);
    assert.equal(st.loader, null);
    assert.equal(st.minecraft.latest, '1.21.4');
    assert.equal((await c.post(`/api/servers/${v.id}/software/update`, { target: 'loader' })).status, 400);
  });
});
