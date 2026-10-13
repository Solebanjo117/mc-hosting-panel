import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import dgram from 'node:dgram';
import { startMocks } from '../helpers/mocks.js';
import { startPanel, hasJava } from '../helpers/panel.js';

/** Un puerto UDP libre para Bedrock. */
function freeUdpPort() {
  return new Promise((resolve) => {
    const s = dgram.createSocket('udp4');
    s.bind(0, '0.0.0.0', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

const GEYSER_CONFIG = `bedrock:
  # The port that will listen for connections
  port: 19132
  clone-remote-port: true
remote:
  address: auto
  port: 25565
  auth-type: online # online, offline o floodgate
`;

/**
 * Casos de uso:
 *  - "Quiero que mis amigos con celular, consola o Windows (Bedrock) entren a mi servidor de Java."
 *  - "Quiero comprobar si mi servidor se ve desde internet."
 */
describe('Bedrock (Geyser) y revisión de red', { skip: !hasJava() && 'Se necesita Java' }, () => {
  let mocks;
  let panel;
  let c;
  let paper;
  let old;
  let bedPort;
  before(async () => {
    mocks = await startMocks();
    panel = await startPanel({ mocks });
    c = panel.client;
    paper = await panel.createServer({ name: 'Crossplay', type: 'paper', mcVersion: '1.21.4' });
    old = await panel.createServer({ name: 'Versión vieja', type: 'paper', mcVersion: '1.20.1' });
    bedPort = await freeUdpPort();
  });
  after(async () => {
    await panel?.close();
    await mocks?.close();
  });

  it('explica cuándo no se puede (Vanilla y Forge)', async () => {
    const v = await panel.createServer({ name: 'Vanilla', type: 'vanilla', mcVersion: '1.21.4' });
    const st = await c.ok('GET', `/api/servers/${v.id}/bedrock`);
    assert.equal(st.supported, false);
    assert.match(st.reason, /Crea un servidor Paper/);
    assert.equal((await c.post(`/api/servers/${v.id}/bedrock/enable`, {})).status, 400);
  });

  it('activa Bedrock en Paper: instala Geyser y Floodgate', async () => {
    const st = await c.ok('GET', `/api/servers/${paper.id}/bedrock`);
    assert.equal(st.supported, true);
    assert.equal(st.viaVersion, false, 'en la versión más nueva no hace falta ViaVersion');
    assert.equal((await c.post(`/api/servers/${paper.id}/bedrock/enable`, { port: 80 })).status, 400, 'puertos bajos no');
    const r = await c.ok('POST', `/api/servers/${paper.id}/bedrock/enable`, { port: bedPort });
    assert.deepEqual(r.installed.map((x) => x.title).sort(), ['Floodgate', 'Geyser']);
    const plugins = fs.readdirSync(path.join(panel.serverDir(paper.id), 'plugins'));
    assert.ok(plugins.includes('floodgate-spigot.jar'));
    assert.ok(plugins.some((f) => f.startsWith('wKkoqHrH')));
    const after = await c.ok('GET', `/api/servers/${paper.id}/bedrock`);
    assert.equal(after.enabled, true);
    assert.equal(after.port, bedPort);
    assert.equal(after.items.length, 2);
  });

  it('en versiones viejas de Paper agrega ViaVersion (Geyser habla la versión más nueva)', async () => {
    const port2 = await freeUdpPort();
    const r = await c.ok('POST', `/api/servers/${old.id}/bedrock/enable`, { port: port2, floodgate: false });
    assert.deepEqual(r.installed.map((x) => x.title).sort(), ['Geyser', 'ViaVersion']);
    const conflict = await c.post(`/api/servers/${old.id}/bedrock/enable`, { port: bedPort });
    assert.equal(conflict.status, 409);
    assert.match(conflict.body.error, /ya lo usa Bedrock en "Crossplay"/);
  });

  it('ajusta el config.yml de Geyser al encender (puerto y autenticación con Floodgate)', async () => {
    const cfg = path.join(panel.serverDir(paper.id), 'plugins', 'Geyser-Spigot', 'config.yml');
    fs.mkdirSync(path.dirname(cfg), { recursive: true });
    fs.writeFileSync(cfg, GEYSER_CONFIG);
    await panel.start(paper.id);
    await panel.waitConsole(paper.id, new RegExp(`Geyser configurado en el puerto UDP ${bedPort}`));
    const text = fs.readFileSync(cfg, 'utf8');
    assert.match(text, new RegExp(`\\n  port: ${bedPort}\\n`));
    assert.match(text, /clone-remote-port: false/);
    assert.match(text, /auth-type: floodgate # online, offline o floodgate/, 'conserva los comentarios');
    assert.match(text, /remote:\n  address: auto\n  port: 25565/, 'no toca el puerto de Java');
    assert.equal((await c.ok('GET', `/api/servers/${paper.id}/bedrock`)).configPort, bedPort);
  });

  it('con el servidor encendido, administra jugadores de Bedrock con Floodgate', async () => {
    await c.ok('POST', `/api/servers/${paper.id}/players`, { action: 'whitelist-add', name: '.Gamer_Tag' });
    await panel.waitConsole(paper.id, /> fwhitelist add Gamer_Tag/);
    await panel.stop(paper.id);
    const off = await c.post(`/api/servers/${paper.id}/players`, { action: 'whitelist-add', name: '.Gamer_Tag' });
    assert.equal(off.status, 409);
    assert.match(off.body.error, /Floodgate/);
  });

  it('anuncia el servidor en Xbox Live (MCXboxBroadcast) y lo quita', async () => {
    const r = await c.ok('POST', `/api/servers/${paper.id}/bedrock/broadcast`, { enabled: true });
    assert.equal(r.broadcast.installed, true);
    const ext = path.join(panel.serverDir(paper.id), 'plugins', 'Geyser-Spigot', 'extensions');
    assert.ok(fs.existsSync(path.join(ext, 'MCXboxBroadcastExtension.jar')));
    fs.mkdirSync(path.join(ext, 'mcxboxbroadcast'), { recursive: true });
    fs.writeFileSync(path.join(ext, 'mcxboxbroadcast', 'cache.json'), '{}');
    assert.equal((await c.ok('GET', `/api/servers/${paper.id}/bedrock`)).broadcast.loggedIn, true);
    const off = await c.ok('POST', `/api/servers/${paper.id}/bedrock/broadcast`, { enabled: false, forgetAccount: true });
    assert.deepEqual([off.broadcast.installed, off.broadcast.loggedIn], [false, false]);
  });

  it('desactivar quita solo lo que instaló el panel para Bedrock', async () => {
    const own = path.join(panel.serverDir(paper.id), 'plugins', 'MiPlugin.jar');
    fs.writeFileSync(own, 'mío');
    await c.ok('POST', `/api/servers/${paper.id}/bedrock/disable`);
    const plugins = fs.readdirSync(path.join(panel.serverDir(paper.id), 'plugins')).filter((f) => f.endsWith('.jar'));
    assert.deepEqual(plugins, ['MiPlugin.jar']);
    assert.equal((await c.ok('GET', `/api/servers/${paper.id}/bedrock`)).enabled, false);
  });

  it('revisa si el servidor se ve desde internet (Java y Bedrock)', async () => {
    const r = await c.ok('GET', `/api/servers/${paper.id}/network/check`);
    assert.equal(r.host, '203.0.113.7', 'usa la IP pública');
    assert.equal(r.online, true);
    assert.equal(r.port, paper.port);
    assert.ok(mocks.state.requests.some((x) => x.path === `/mcsrvstat/3/203.0.113.7:${paper.port}`));

    await c.ok('GET', `/api/servers/${paper.id}/network/check?host=mc.midominio.com`);
    assert.ok(mocks.state.requests.some((x) => x.path === '/mcsrvstat/3/mc.midominio.com'), 'un dominio sin puerto respeta el SRV');

    mocks.state.mcsrvstatOnline = false;
    assert.equal((await c.ok('GET', `/api/servers/${paper.id}/network/check?host=1.2.3.4:25570`)).online, false);
    mocks.state.mcsrvstatOnline = true;

    assert.equal((await c.get(`/api/servers/${paper.id}/network/check?host=evil.com/x`)).status, 400);
    assert.equal((await c.get(`/api/servers/${paper.id}/network/check?host=1.2.3.4:abc`)).status, 400);
    assert.equal((await c.get(`/api/servers/${paper.id}/network/check?edition=bedrock`)).status, 409, 'Bedrock apagado');
    await c.ok('GET', `/api/servers/${old.id}/network/check?edition=bedrock`);
    assert.ok(mocks.state.requests.some((x) => x.path.startsWith('/mcsrvstat/bedrock/3/203.0.113.7:')));
  });

  it('muestra las IP de la PC y la pública', async () => {
    const r = await c.ok('GET', '/api/system/network');
    assert.equal(r.publicIp, '203.0.113.7');
    assert.ok(Array.isArray(r.localIps));
    assert.equal(r.remoteAccess, 'lan');
  });
});
