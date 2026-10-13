import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startMocks, sha1 } from '../helpers/mocks.js';
import { startPanel, hasJava } from '../helpers/panel.js';
import { rawZip } from '../helpers/zip.js';

/**
 * Casos de uso:
 *  - "Quiero buscar e instalar datapacks también en mi servidor de Paper, Fabric o Forge."
 *  - "Quiero aplicarlos sin reiniciar, y saber cuáles cambian la generación del mundo."
 *  - "Al crear un mundo nuevo, quiero que tenga los mismos datapacks."
 */
describe('Datapacks', { skip: !hasJava() && 'Se necesita Java' }, () => {
  let mocks;
  let panel;
  let c;
  let paper;
  let dir;
  const D = (s, extra = '') => `/api/servers/${s.id}/content`;
  const K = 'kind=datapack';

  before(async () => {
    mocks = await startMocks();
    // Terralith trae generación de mundo; Herramientas solo funciones.
    mocks.state.files['terralith-pack-1.0.0.zip'] = rawZip({ 'pack.mcmeta': '{"pack":{}}', 'data/terralith/worldgen/biome/bosque.json': '{}' });
    mocks.state.files['herramientas-pack-1.0.0.zip'] = rawZip({ 'pack.mcmeta': '{"pack":{}}', 'data/herramientas/function/hola.mcfunction': 'say hola' });
    panel = await startPanel({ mocks });
    c = panel.client;
    paper = await panel.createServer({ name: 'Paper con datapacks', type: 'paper', mcVersion: '1.21.4' });
    dir = panel.serverDir(paper.id);
  });
  after(async () => {
    await panel?.close();
    await mocks?.close();
  });

  it('en Paper se buscan datapacks aparte de los plugins', async () => {
    const r = await c.ok('GET', `${D(paper)}/search?${K}`);
    assert.equal(r.kind, 'datapack');
    assert.deepEqual(r.sources, ['modrinth'], 'Hangar no tiene datapacks');
    assert.deepEqual(r.results.map((x) => [x.title, x.worldgen]).sort(), [['Herramientas Extra', false], ['Terralith', true]]);
    const req = mocks.state.requests.findLast((x) => x.path === '/modrinth/search');
    assert.deepEqual(JSON.parse(new URLSearchParams(req.query).get('facets'))[0], ['project_type:datapack']);
    const plugins = await c.ok('GET', `${D(paper)}/search`);
    assert.equal(plugins.kind, 'plugin', 'sin kind sigue mostrando plugins');
    assert.equal((await c.get(`${D(paper)}/search?${K}&source=hangar`)).status, 400);
  });

  it('instala en la carpeta del mundo activo y avisa si cambia la generación del mundo', async () => {
    const r = await c.ok('POST', `${D(paper)}/install?${K}`, { projectId: 'terralith-pack' });
    assert.equal(r.installed[0].worldgen, true);
    await c.ok('POST', `${D(paper)}/install`, { projectId: 'herramientas-pack', kind: 'datapack' });
    assert.deepEqual(fs.readdirSync(path.join(dir, 'world', 'datapacks')).sort(), ['herramientas-pack-1.0.0.zip', 'terralith-pack-1.0.0.zip']);
    const list = await c.ok('GET', `${D(paper)}/installed?${K}`);
    assert.equal(list.folder, 'world/datapacks');
    assert.deepEqual(list.items.map((i) => [i.title, i.worldgen, i.source]), [['Herramientas Extra', false, 'modrinth'], ['Terralith', true, 'modrinth']]);
    const plugins = await c.ok('GET', `${D(paper)}/installed`);
    assert.ok(!plugins.items.some((i) => /pack/.test(i.filename)), 'no se mezclan con los plugins');
  });

  it('reconoce datapacks en carpeta (subidos a mano) y los zip desactivados', async () => {
    const folder = path.join(dir, 'world', 'datapacks', 'mi-pack');
    fs.mkdirSync(path.join(folder, 'data', 'mio', 'worldgen', 'structure'), { recursive: true });
    fs.writeFileSync(path.join(folder, 'pack.mcmeta'), '{}');
    fs.mkdirSync(path.join(dir, 'world', 'datapacks', 'no-es-pack'), { recursive: true });
    let list = await c.ok('GET', `${D(paper)}/installed?${K}`);
    const mine = list.items.find((i) => i.filename === 'mi-pack');
    assert.deepEqual([mine.folder, mine.worldgen, mine.enabled], [true, true, true]);
    assert.ok(!list.items.some((i) => i.filename === 'no-es-pack'), 'una carpeta sin pack.mcmeta no es datapack');
    const t = await c.post(`${D(paper)}/toggle?${K}`, { filename: 'mi-pack', enabled: false });
    assert.equal(t.status, 400);
    assert.match(t.body.error, /carpeta no se pueden desactivar/);

    list = await c.ok('POST', `${D(paper)}/toggle?${K}`, { filename: 'herramientas-pack-1.0.0.zip', enabled: false });
    assert.equal(list.items.find((i) => i.filename === 'herramientas-pack-1.0.0.zip').enabled, false);
    assert.ok(fs.existsSync(path.join(dir, 'world', 'datapacks', 'herramientas-pack-1.0.0.zip.disabled')));
    await c.ok('POST', `${D(paper)}/toggle?${K}`, { filename: 'herramientas-pack-1.0.0.zip', enabled: true });

    list = await c.ok('POST', `${D(paper)}/uninstall?${K}`, { filename: 'mi-pack' });
    assert.ok(!fs.existsSync(folder), 'borra la carpeta completa');
    assert.equal((await c.post(`${D(paper)}/uninstall?${K}`, { filename: '..' })).status, 400);
    assert.ok(fs.existsSync(path.join(dir, 'world')), 'no borra el mundo');
  });

  it('aplica los cambios sin reiniciar con minecraft:reload (no el /reload de plugins de Paper)', async () => {
    const off = await c.post(`${D(paper)}/reload`);
    assert.equal(off.status, 409);
    assert.match(off.body.error, /se aplican solos al encenderlo/);
    await panel.start(paper.id);
    try {
      const r = await c.ok('POST', `${D(paper)}/reload`);
      assert.equal(r.ok, true);
      assert.deepEqual(r.worldgen, ['Terralith'], 'recuerda cuáles necesitan reiniciar');
      const text = await panel.consoleText(paper.id);
      assert.match(text, /> minecraft:reload/);
      assert.doesNotMatch(text, /> reload\b/);
    } finally {
      await panel.stop(paper.id);
    }
  });

  it('busca actualizaciones de datapacks y las instala en la misma carpeta', async () => {
    const file = path.join(dir, 'world', 'datapacks', 'herramientas-pack-1.0.0.zip');
    mocks.state.modrinthUpdates[sha1(fs.readFileSync(file))] = { project: 'herramientas-pack' };
    const ups = await c.ok('GET', `${D(paper)}/updates?${K}`);
    assert.deepEqual(ups.map((u) => [u.filename, u.newVersion]), [['herramientas-pack-1.0.0.zip', '2.0.0']]);
    const req = mocks.state.requests.findLast((x) => x.path === '/modrinth/version_files/update');
    assert.deepEqual(JSON.parse(req.body).loaders, ['datapack']);
    await c.ok('POST', `${D(paper)}/update?${K}`, ups[0]);
    const files = fs.readdirSync(path.join(dir, 'world', 'datapacks')).filter((f) => f.endsWith('.zip')).sort();
    assert.deepEqual(files, ['herramientas-pack-2.0.0.zip', 'terralith-pack-1.0.0.zip']);
  });

  it('CurseForge también tiene datapacks (con clave)', async () => {
    const { cfMod, cfFile } = mocks.state;
    mocks.state.cf.mods[4001] = cfMod(4001, 'datapack-cf', 'Datapack de CurseForge', { classId: 6945 });
    mocks.state.cf.files[8001] = cfFile(8001, 4001, 'datapack-cf.zip');
    await c.ok('PUT', '/api/integrations/curseforge', { apiKey: 'cf-key-123' });
    const r = await c.ok('GET', `${D(paper)}/search?${K}&source=curseforge`);
    assert.deepEqual(r.results.map((x) => x.title), ['Datapack de CurseForge']);
    const req = mocks.state.requests.findLast((x) => x.path === '/curseforge/mods/search');
    assert.equal(new URLSearchParams(req.query).get('classId'), '6945');
    await c.ok('POST', `${D(paper)}/install?${K}`, { source: 'curseforge', projectId: '4001' });
    assert.ok(fs.existsSync(path.join(dir, 'world', 'datapacks', 'datapack-cf.zip')));
    await c.ok('PUT', '/api/integrations/curseforge', { apiKey: '' });
  });

  it('en Fabric conviven mods y datapacks del mismo proyecto sin pisarse', async () => {
    const fabric = await panel.createServer({ name: 'Fabric', type: 'fabric', mcVersion: '1.21.4' });
    await c.ok('POST', `/api/servers/${fabric.id}/content/install`, { projectId: 'lithium' });
    await c.ok('POST', `/api/servers/${fabric.id}/content/install?${K}`, { projectId: 'terralith-pack' });
    await c.ok('POST', `/api/servers/${fabric.id}/content/install?${K}`, { projectId: 'terralith-pack' });
    const fdir = panel.serverDir(fabric.id);
    assert.deepEqual(fs.readdirSync(path.join(fdir, 'mods')), ['lithium-1.0.0.jar']);
    assert.deepEqual(fs.readdirSync(path.join(fdir, 'world', 'datapacks')), ['terralith-pack-1.0.0.zip'], 'reinstalar no duplica');
  });

  it('al crear un mundo nuevo se pueden copiar los datapacks (antes de generarlo)', async () => {
    fs.writeFileSync(path.join(dir, 'world', 'datapacks', 'viejo.zip.disabled'), rawZip({ 'pack.mcmeta': '{}' }));
    let worlds = await c.ok('GET', `/api/servers/${paper.id}/worlds`);
    assert.equal(worlds.worlds.find((w) => w.name === 'world').datapacks, 3, 'cuenta los activos');

    const r = await c.ok('POST', `/api/servers/${paper.id}/worlds`, { name: 'Nuevo', copyDatapacks: true });
    assert.equal(r.copiedDatapacks, 3);
    assert.equal(r.active, 'Nuevo');
    assert.deepEqual(fs.readdirSync(path.join(dir, 'Nuevo', 'datapacks')).sort(), ['datapack-cf.zip', 'herramientas-pack-2.0.0.zip', 'terralith-pack-1.0.0.zip', 'viejo.zip.disabled']);
    const list = await c.ok('GET', `${D(paper)}/installed?${K}`);
    assert.equal(list.folder, 'Nuevo/datapacks', 'ahora trabaja con el mundo nuevo');
    assert.equal(list.items.find((i) => i.filename === 'terralith-pack-1.0.0.zip').title, 'Terralith', 'conserva el nombre');

    await panel.start(paper.id);
    await panel.stop(paper.id);
    assert.ok(fs.existsSync(path.join(dir, 'Nuevo', 'level.dat')), 'se generó con sus datapacks');

    const empty = await c.ok('POST', `/api/servers/${paper.id}/worlds`, { name: 'Limpio' });
    assert.equal(empty.copiedDatapacks, 0);
    assert.ok(!fs.existsSync(path.join(dir, 'Limpio', 'datapacks')));
    worlds = await c.ok('GET', `/api/servers/${paper.id}/worlds`);
    assert.equal(worlds.worlds.find((w) => w.name === 'Limpio').datapacks, 0);
  });
});
