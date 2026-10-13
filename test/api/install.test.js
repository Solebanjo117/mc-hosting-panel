import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startMocks } from '../helpers/mocks.js';
import { startPanel, hasJava } from '../helpers/panel.js';

/**
 * Caso de uso: "Quiero crear un servidor del tipo y versión que elija, que el panel lo descargue
 * con todo lo necesario y lo deje listo para encender."
 */
describe('Crear e instalar servidores', { skip: !hasJava() && 'Se necesita Java instalado para estas pruebas' }, () => {
  let mocks;
  let panel;
  before(async () => {
    mocks = await startMocks();
    panel = await startPanel({ mocks });
  });
  after(async () => {
    await panel?.close();
    await mocks?.close();
  });

  it('lista las versiones de cada tipo de servidor', async () => {
    const c = panel.client;
    const vanilla = await c.ok('GET', '/api/system/versions/vanilla');
    assert.deepEqual(vanilla.map((v) => v.id), ['1.21.4', '1.20.1', '1.16.5']);
    const paper = await c.ok('GET', '/api/system/versions/paper');
    assert.ok(paper.some((v) => v.id === '1.21.4'));
    assert.ok(!paper.some((v) => v.id.includes('rc')), 'no muestra versiones de prueba de Paper');
    const fabric = await c.ok('GET', '/api/system/versions/fabric');
    assert.deepEqual(fabric.map((v) => v.id), ['1.21.4'], 'solo versiones estables de Fabric');
    const forge = await c.ok('GET', '/api/system/versions/forge');
    assert.equal(forge[0].id, '1.20.1');
    assert.ok(forge[0].loaders.some((l) => /recomendada/.test(l.label)));
    const neo = await c.ok('GET', '/api/system/versions/neoforge');
    assert.ok(neo.some((v) => v.id === '1.21.1'), 'NeoForge 21.1.x es Minecraft 1.21.1');
    assert.ok(!neo.some((v) => v.id.startsWith('0.')), 'ignora versiones de prueba antiguas');
  });

  for (const [type, extra, jar] of [
    ['vanilla', {}, 'server.jar'],
    ['paper', {}, 'paper.jar'],
    ['fabric', {}, 'fabric-server-launch.jar'],
  ]) {
    it(`instala y enciende un servidor ${type}`, async () => {
      const s = await panel.createServer({ name: `Servidor ${type}`, type, mcVersion: '1.21.4', ...extra });
      assert.equal(s.installState, 'ready');
      assert.equal(s.launch.type, 'jar');
      assert.equal(s.launch.jar, jar);
      const dir = panel.serverDir(s.id);
      assert.ok(fs.existsSync(path.join(dir, jar)), 'descargó el jar');
      assert.match(fs.readFileSync(path.join(dir, 'eula.txt'), 'utf8'), /eula=true/);
      const props = fs.readFileSync(path.join(dir, 'server.properties'), 'utf8');
      assert.match(props, new RegExp(`server-port=${s.port}`));
      if (type === 'paper') assert.equal(s.loaderVersion, '120', 'usa el build STABLE más reciente');
      if (type === 'fabric') assert.equal(s.loaderVersion, '0.16.10');

      const rt = await panel.start(s.id);
      assert.equal(rt.status, 'running');
      await panel.stop(s.id);
    });
  }

  for (const [type, mcVersion, loaderVersion] of [
    ['forge', '1.20.1', '47.3.0'],
    ['neoforge', '1.21.1', '21.1.77'],
  ]) {
    it(`instala ${type} ejecutando su instalador y arranca con el archivo de argumentos`, async () => {
      const s = await panel.createServer({ name: `Servidor ${type}`, type, mcVersion, loaderVersion });
      assert.equal(s.launch.type, 'args');
      assert.ok(fs.existsSync(path.join(panel.serverDir(s.id), s.launch.argsDir)));
      assert.ok(!fs.existsSync(path.join(panel.serverDir(s.id), 'installer.jar')), 'borra el instalador');
      await panel.start(s.id);
      await panel.stop(s.id);
    });
  }

  it('pide la versión de Forge si no se elige', async () => {
    const r = await panel.client.post('/api/servers', { name: 'Sin loader', type: 'forge', mcVersion: '1.20.1', memoryMb: 1024, eula: true });
    if (r.status === 201 || r.status === 200) {
      const s = await panel.client.ok('GET', `/api/servers/${r.body.id}`);
      const final = await (async () => {
        for (let i = 0; i < 50; i++) {
          const x = await panel.client.ok('GET', `/api/servers/${s.id}`);
          if (x.installState !== 'installing') return x;
          await new Promise((res) => setTimeout(res, 100));
        }
        return null;
      })();
      assert.equal(final.installState, 'error');
      assert.match(final.installError, /versión de Forge/);
    } else {
      assert.equal(r.status, 400);
    }
  });

  it('rechaza puertos ocupados por otro servidor y nombres vacíos', async () => {
    const list = await panel.client.ok('GET', '/api/servers');
    const taken = list[0].port;
    const r = await panel.client.post('/api/servers', { name: 'Choca', type: 'paper', mcVersion: '1.21.4', memoryMb: 1024, port: taken, eula: true });
    assert.equal(r.status, 409);
    const r2 = await panel.client.post('/api/servers', { name: '', type: 'paper', mcVersion: '1.21.4', memoryMb: 1024, eula: true });
    assert.equal(r2.status, 400);
  });

  it('cada servidor nuevo recibe un puerto distinto', async () => {
    const list = await panel.client.ok('GET', '/api/servers');
    const ports = list.map((s) => s.port);
    assert.equal(new Set(ports).size, ports.length);
  });

  it('reinstala en otra versión conservando el mundo', async () => {
    const s = await panel.createServer({ name: 'Cambio de versión', type: 'vanilla', mcVersion: '1.20.1' });
    const marker = path.join(panel.serverDir(s.id), 'world', 'marca.txt');
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(marker, 'mi mundo');
    await panel.client.ok('POST', `/api/servers/${s.id}/reinstall`, { mcVersion: '1.21.4' });
    const after = await panel.waitInstalled(s.id);
    assert.equal(after.mcVersion, '1.21.4');
    assert.equal(fs.readFileSync(marker, 'utf8'), 'mi mundo');
  });
});
