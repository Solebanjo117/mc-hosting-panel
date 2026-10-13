import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import dgram from 'node:dgram';
import { startMocks } from '../helpers/mocks.js';
import { startPanel, hasJava, waitFor } from '../helpers/panel.js';
import { makePng } from '../helpers/zip.js';

function freeUdpPort() {
  return new Promise((resolve) => {
    const s = dgram.createSocket('udp4');
    s.bind(0, '0.0.0.0', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/**
 * Casos de uso:
 *  - "Quiero ver el mapa de mi mundo dentro del panel."
 *  - "Quiero que el panel me diga qué está mal y lo optimice con un clic."
 *  - "Quiero copiar mi servidor para probar cosas sin romper el original."
 *  - "Quiero cambiar el ícono y el mensaje (MOTD) que se ven en la lista de servidores."
 *  - "Quiero comandos rápidos con listas de objetos, efectos y jugadores."
 */
describe('Mapa, revisión, optimización, copias, ícono y comandos rápidos', { skip: !hasJava() && 'Se necesita Java' }, () => {
  let mocks;
  let panel;
  let c;
  let paper;
  let fabric;
  before(async () => {
    mocks = await startMocks();
    panel = await startPanel({ mocks });
    c = panel.client;
    paper = await panel.createServer({ name: 'Principal', type: 'paper', mcVersion: '1.21.4', memoryMb: 1024 });
    fabric = await panel.createServer({ name: 'Con mods', type: 'fabric', mcVersion: '1.21.4' });
  });
  after(async () => {
    await panel?.close();
    await mocks?.close();
  });

  describe('Mapa (BlueMap)', () => {
    let fakeMap;
    after(() => fakeMap?.close());

    it('no está disponible en Vanilla', async () => {
      const v = await panel.createServer({ name: 'Vanilla', type: 'vanilla', mcVersion: '1.21.4' });
      const st = await c.ok('GET', `/api/servers/${v.id}/map`);
      assert.equal(st.supported, false);
      assert.equal((await c.post(`/api/servers/${v.id}/map`, {})).status, 400);
    });

    it('lo instala, le da un puerto propio y ajusta su configuración al encender', async () => {
      const st = await c.ok('POST', `/api/servers/${paper.id}/map`, {});
      assert.equal(st.enabled, true);
      assert.equal(st.installed, true);
      assert.ok(st.port >= 8100);
      assert.equal(st.configured, false, 'BlueMap crea su configuración en el primer arranque');
      const dir = path.join(panel.serverDir(paper.id), 'plugins', 'BlueMap');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'core.conf'), '# Acepta descargar recursos de Mojang\naccept-download: false\n');
      fs.writeFileSync(path.join(dir, 'webserver.conf'), 'enabled: true\nport: 8100\n#ip: "0.0.0.0"\n');
      await panel.start(paper.id);
      await panel.stop(paper.id);
      assert.match(fs.readFileSync(path.join(dir, 'core.conf'), 'utf8'), /^accept-download: true$/m);
      const web = fs.readFileSync(path.join(dir, 'webserver.conf'), 'utf8');
      assert.match(web, new RegExp(`^port: ${st.port}$`, 'm'));
      assert.match(web, /^ip: "127\.0\.0\.1"$/m, 'solo escucha en esta PC');
      assert.equal((await c.ok('GET', `/api/servers/${paper.id}/map`)).configured, true);
    });

    it('muestra el mapa dentro del panel (con la sesión del panel) y explica si aún no responde', async () => {
      const { port } = await c.ok('GET', `/api/servers/${paper.id}/map`);
      const down = await c.get(`/api/servers/${paper.id}/map/view/`);
      assert.equal(down.status, 502);
      assert.match(down.text, /El mapa todavía no responde/);

      fakeMap = http.createServer((req, res) => {
        res.setHeader('x-frame-options', 'DENY');
        res.end(`BlueMap ${req.url}`);
      });
      const listening = await new Promise((resolve) => {
        fakeMap.once('error', () => resolve(false));
        fakeMap.listen(port, '127.0.0.1', () => resolve(true));
      });
      if (!listening) return; // el puerto lo usa otro programa en esta PC
      const r = await c.get(`/api/servers/${paper.id}/map/view/maps/world/settings.json?x=1`);
      assert.equal(r.status, 200);
      assert.equal(r.text, 'BlueMap /maps/world/settings.json?x=1');
      assert.equal(r.headers.get('x-frame-options'), null, 'se puede mostrar dentro del panel');
      assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'self'/);
      assert.equal((await c.post(`/api/servers/${paper.id}/map/view/x`, {})).status, 405, 'solo lectura');
      const { Client } = await import('../helpers/panel.js');
      assert.equal((await new Client(panel.base).get(`/api/servers/${paper.id}/map/view/`)).status, 401, 'sin sesión no hay mapa');
    });
  });

  describe('Revisión general', () => {
    it('revisa instalación, puerto, respaldos, disco, RAM, seguridad y optimización', async () => {
      const h = await c.ok('GET', `/api/servers/${paper.id}/health`);
      const byId = Object.fromEntries(h.checks.map((x) => [x.id, x]));
      for (const id of ['install', 'eula', 'java', 'port', 'backup', 'disk', 'ram', 'security', 'optimize']) assert.ok(byId[id], `falta ${id}`);
      assert.equal(byId.install.level, 'ok');
      assert.equal(byId.port.level, 'ok');
      assert.equal(byId.backup.level, 'warn');
      assert.equal(byId.backup.tab, 'respaldos', 'lleva a la pestaña donde se arregla');
      assert.equal(h.level, h.checks[0].level, 'lo más grave primero');
    });

    it('detecta un puerto ocupado por otro programa y una caída reciente', async () => {
      const blocker = http.createServer();
      await new Promise((r) => blocker.listen(fabric.port, '0.0.0.0', r));
      try {
        const h = await c.ok('GET', `/api/servers/${fabric.id}/health`);
        assert.equal(h.checks.find((x) => x.id === 'port').level, 'bad');
        assert.equal(h.level, 'bad');
      } finally {
        await new Promise((r) => blocker.close(r));
      }
      await panel.start(fabric.id);
      await panel.command(fabric.id, 'crash');
      await panel.waitStatus(fabric.id, 'crashed');
      const h = await c.ok('GET', `/api/servers/${fabric.id}/health`);
      assert.equal(h.checks.find((x) => x.id === 'crash').level, 'warn');
    });
  });

  describe('Optimización de un clic', () => {
    it('lista lo pendiente según el tipo de servidor', async () => {
      const dir = panel.serverDir(paper.id);
      fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'config', 'paper-world-defaults.yml'),
        'chunks:\n  max-auto-save-chunks-per-tick: 24\n  prevent-moving-into-unloaded-chunks: false\ncollisions:\n  max-entity-collisions: 8\nenvironment:\n  optimize-explosions: false\ntick-rates:\n  mob-spawner: 1\n'
      );
      await c.ok('PUT', `/api/servers/${paper.id}/properties`, { 'view-distance': '16' });
      const st = await c.ok('GET', `/api/servers/${paper.id}/optimize`);
      const ids = st.items.map((i) => i.id);
      assert.ok(ids.includes('aikar'));
      assert.ok(ids.includes('view-distance'));
      assert.ok(ids.includes('sync-chunk-writes'));
      assert.ok(ids.includes('paper:chunks.max-auto-save-chunks-per-tick'));
      assert.ok(!ids.some((i) => i.startsWith('mod:')), 'Paper no usa mods');
      assert.equal(st.items.find((i) => i.id === 'view-distance').label, 'Distancia de visión: 16 → 10');
      const f = await c.ok('GET', `/api/servers/${fabric.id}/optimize`);
      assert.deepEqual(f.items.filter((i) => i.id.startsWith('mod:')).map((i) => i.id), ['mod:lithium', 'mod:ferrite-core', 'mod:modernfix']);
      assert.ok(!f.items.some((i) => i.id === 'sync-chunk-writes'));
    });

    it('aplica todo: parámetros de Aikar al arrancar, server.properties y Paper', async () => {
      const r = await c.ok('POST', `/api/servers/${paper.id}/optimize`, {});
      assert.equal(r.pending, 0);
      assert.deepEqual(r.errors, []);
      const props = await c.ok('GET', `/api/servers/${paper.id}/properties`);
      assert.equal(props['view-distance'], '10');
      assert.equal(props['simulation-distance'], '8');
      assert.equal(props['sync-chunk-writes'], 'false');
      const yml = fs.readFileSync(path.join(panel.serverDir(paper.id), 'config', 'paper-world-defaults.yml'), 'utf8');
      assert.match(yml, /max-auto-save-chunks-per-tick: 8/);
      assert.match(yml, /max-entity-collisions: 2/);
      assert.ok(fs.existsSync(path.join(panel.serverDir(paper.id), 'config', 'paper-world-defaults.yml.panel-bak')));

      await panel.start(paper.id);
      await panel.command(paper.id, 'args');
      await panel.waitConsole(paper.id, /JVM .*-XX:\+UseG1GC/);
      const line = (await panel.consoleText(paper.id)).split('\n').find((l) => l.includes('JVM '));
      assert.match(line, /-Xms1024M/);
      assert.match(line, /-Xmx1024M/);
      assert.match(line, /-XX:G1HeapRegionSize=8M/);
      await panel.stop(paper.id);
    });

    it('deshace todo, incluso claves que antes no existían', async () => {
      const r = await c.ok('POST', `/api/servers/${paper.id}/optimize`, { undo: true });
      assert.ok(r.pending > 0);
      const props = await c.ok('GET', `/api/servers/${paper.id}/properties`);
      assert.equal(props['view-distance'], '16');
      assert.equal(props['simulation-distance'], '10', 'vuelve al valor por defecto de Minecraft');
      const yml = fs.readFileSync(path.join(panel.serverDir(paper.id), 'config', 'paper-world-defaults.yml'), 'utf8');
      assert.match(yml, /max-auto-save-chunks-per-tick: 24/);
      assert.equal((await c.ok('GET', `/api/servers/${paper.id}`)).aikarFlags, false);
      assert.equal((await c.post(`/api/servers/${paper.id}/optimize`, { undo: true })).status, 409);
    });

    it('puede aplicar solo lo elegido; en Fabric instala los mods de rendimiento', async () => {
      const one = await c.ok('POST', `/api/servers/${paper.id}/optimize`, { only: ['aikar'] });
      assert.equal(one.items.find((i) => i.id === 'aikar').applied, true);
      assert.equal(one.items.find((i) => i.id === 'view-distance').applied, false);
      const f = await c.ok('POST', `/api/servers/${fabric.id}/optimize`, { only: ['mod:lithium', 'mod:ferrite-core', 'mod:modernfix'] });
      assert.deepEqual(f.results, ['Lithium instalado', 'FerriteCore instalado', 'ModernFix instalado']);
      const mods = fs.readdirSync(path.join(panel.serverDir(fabric.id), 'mods'));
      for (const m of ['lithium-1.0.0.jar', 'ferrite-core-1.0.0.jar', 'modernfix-1.0.0.jar']) assert.ok(mods.includes(m), m);
    });
  });

  describe('Copiar un servidor', () => {
    it('copia archivos y ajustes, pero con puertos propios, sin dominio, túnel ni tareas activas', async () => {
      await c.ok('POST', `/api/servers/${paper.id}/bedrock/enable`, { port: await freeUdpPort() });
      await c.ok('POST', `/api/servers/${paper.id}/schedules`, { action: 'backup', when: { type: 'interval', minutes: 60 } });
      fs.mkdirSync(path.join(panel.serverDir(paper.id), 'logs'), { recursive: true });
      fs.writeFileSync(path.join(panel.serverDir(paper.id), 'logs', 'latest.log'), 'viejo');
      const src = await c.ok('GET', `/api/servers/${paper.id}`);
      const r = await c.post(`/api/servers/${paper.id}/clone`, { name: 'Pruebas' });
      assert.equal(r.status, 201, r.text);
      const copy = r.body;
      assert.equal(copy.name, 'Pruebas');
      assert.notEqual(copy.port, src.port);
      assert.notEqual(copy.bedrock.port, src.bedrock.port, 'puerto Bedrock propio');
      assert.notEqual(copy.map.port, src.map.port, 'puerto del mapa propio');
      assert.equal(copy.playit.enabled, false);
      assert.equal(copy.dns, undefined);
      assert.equal(copy.schedules[0].enabled, false);
      const dir = panel.serverDir(copy.id);
      assert.ok(fs.existsSync(path.join(dir, 'world', 'level.dat')));
      assert.ok(!fs.existsSync(path.join(dir, 'logs')), 'sin logs del original');
      assert.equal((await c.ok('GET', `/api/servers/${copy.id}/properties`))['server-port'], String(copy.port));
      await panel.start(copy.id);
      await panel.stop(copy.id);
    });
  });

  describe('Cómo se ve en la lista de servidores', () => {
    it('guarda el ícono si es un PNG de 64×64 y lo quita', async () => {
      const png = makePng(64, 64);
      const r = await c.ok('PUT', `/api/servers/${paper.id}/icon`, { png: `data:image/png;base64,${png.toString('base64')}` });
      assert.equal(r.restartRequired, false);
      assert.deepEqual(fs.readFileSync(path.join(panel.serverDir(paper.id), 'server-icon.png')), png);
      assert.ok((await c.ok('GET', `/api/servers/${paper.id}`)).iconAt > 0);
      const img = await c.request('GET', `/api/servers/${paper.id}/icon`, { raw: true });
      assert.equal(img.headers.get('content-type'), 'image/png');
      assert.match((await c.put(`/api/servers/${paper.id}/icon`, { png: makePng(128, 128).toString('base64') })).body.error, /64×64/);
      assert.match((await c.put(`/api/servers/${paper.id}/icon`, { png: Buffer.from('GIF89a........................').toString('base64') })).body.error, /PNG/);
      await c.ok('PUT', `/api/servers/${paper.id}/icon`, { remove: true });
      assert.equal((await c.get(`/api/servers/${paper.id}/icon`)).status, 404);
    });

    it('guarda el MOTD de dos líneas con colores', async () => {
      await c.ok('PUT', `/api/servers/${paper.id}/properties`, { motd: '§6§lMi servidor\n§7¡Bienvenidos!' });
      const p = await c.ok('GET', `/api/servers/${paper.id}/properties`);
      assert.equal(p.motd, '§6§lMi servidor\n§7¡Bienvenidos!');
    });
  });

  describe('Comandos rápidos', () => {
    it('trae los de fábrica y se pueden personalizar y restablecer', async () => {
      const def = await c.ok('GET', '/api/system/quick-commands');
      assert.equal(def.custom, false);
      assert.ok(def.types.includes('item'));
      const saved = await c.ok('PUT', '/api/system/quick-commands', { commands: [{ label: 'Dar diamantes', template: 'give {jugador} diamond {cantidad}' }] });
      assert.equal(saved.custom, true);
      assert.deepEqual(saved.commands[0].params.map((p) => p.type), ['player', 'number']);
      assert.equal((await c.put('/api/system/quick-commands', { commands: [{ label: 'x', template: 'a\nb' }] })).status, 400);
      const reset = await c.ok('PUT', '/api/system/quick-commands', { reset: true });
      assert.equal(reset.custom, false);
      assert.equal(reset.commands.length, def.commands.length);
    });

    it('da las listas del juego en español para elegir (objetos, efectos, encantamientos, criaturas)', async () => {
      const items = await c.ok('GET', `/api/servers/${paper.id}/gamedata/item`);
      assert.equal(items.version, '1.21.4');
      assert.deepEqual(items.list.find((i) => i.id === 'diamond_sword'), { id: 'diamond_sword', name: 'Espada de diamante' });
      assert.ok(!items.list.some((i) => i.id === 'air'));
      assert.equal(items.list.find((i) => i.id === 'stone').name, 'Piedra', 'los bloques también');
      const sorted = items.list.map((i) => i.name || i.id);
      assert.deepEqual(sorted, [...sorted].sort((a, b) => a.localeCompare(b, 'es')));
      assert.equal((await c.ok('GET', `/api/servers/${paper.id}/gamedata/effect`)).list.find((e) => e.id === 'speed').name, 'Velocidad');
      assert.equal((await c.ok('GET', `/api/servers/${paper.id}/gamedata/entity`)).list.find((e) => e.id === 'zombie').name, 'Zombi');
      assert.ok((await c.ok('GET', `/api/servers/${paper.id}/gamedata/enchantment`)).list.length > 0);
      assert.equal((await c.get(`/api/servers/${paper.id}/gamedata/recetas`)).status, 400);
      const before = mocks.requests('/mcmeta/').length;
      await c.ok('GET', `/api/servers/${fabric.id}/gamedata/item`);
      assert.equal(mocks.requests('/mcmeta/').length, before, 'guarda las listas en caché');
    });
  });

  describe('Ajustes del panel', () => {
    it('muestra información del sistema y de Java', async () => {
      const info = await c.ok('GET', '/api/system/info');
      assert.match(info.version, /^\d+\.\d+\.\d+/);
      assert.ok(info.system.totalMemMb > 0);
      assert.equal(info.types.paper.label, 'Paper');
      const java = await c.ok('GET', '/api/system/java');
      assert.ok(java.custom['21']);
      assert.equal((await c.post('/api/system/java/9')).status, 400);
    });

    it('cambia el acceso y el puerto del panel sin devolver tokens guardados', async () => {
      await c.ok('PUT', '/api/integrations/curseforge', { apiKey: 'cf-key-123' });
      const r = await c.ok('PUT', '/api/system/settings', { remoteAccess: 'local' });
      assert.deepEqual(Object.keys(r.settings).sort(), ['javaPaths', 'panelPort', 'remoteAccess']);
      assert.ok(!JSON.stringify(r).includes('cf-key-123'));
      assert.equal(r.settings.remoteAccess, 'local');
      assert.equal((await c.put('/api/system/settings', { remoteAccess: 'todos' })).status, 400);
      assert.equal((await c.put('/api/system/settings', { panelPort: 80 })).status, 400);
      const p = await c.ok('PUT', '/api/system/settings', { panelPort: 8123, remoteAccess: 'lan' });
      assert.equal(p.restartRequired, true);
      assert.equal(panel.readDb().settings.panelPort, 8123);
      await c.ok('PUT', '/api/system/settings', { panelPort: panel.port });
    });

    it('sirve la guía para abrir puertos', async () => {
      const r = await c.get('/api/system/docs/puertos');
      assert.equal(r.status, 200);
      assert.ok(r.text.length > 100);
      assert.equal((await c.get('/api/system/docs/..%2F..%2Fpackage.json')).status, 404);
    });
  });
});
