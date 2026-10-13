import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startMocks, sha1 } from '../helpers/mocks.js';
import { startPanel, hasJava, waitFor } from '../helpers/panel.js';
import { rawZip } from '../helpers/zip.js';

/**
 * Caso de uso: "Quiero buscar e instalar plugins, mods y datapacks (Modrinth, Hangar y CurseForge)
 * con sus dependencias, desactivarlos, quitarlos y actualizarlos; e importar modpacks completos".
 */
describe('Mods, plugins, datapacks y modpacks', { skip: !hasJava() && 'Se necesita Java' }, () => {
  let mocks;
  let panel;
  let c;
  let paper;
  let fabric;
  let vanilla;
  const C = (s) => `/api/servers/${s.id}/content`;
  before(async () => {
    mocks = await startMocks();
    panel = await startPanel({ mocks });
    c = panel.client;
    paper = await panel.createServer({ name: 'Plugins', type: 'paper', mcVersion: '1.21.4' });
    fabric = await panel.createServer({ name: 'Mods', type: 'fabric', mcVersion: '1.21.4' });
    vanilla = await panel.createServer({ name: 'Datapacks', type: 'vanilla', mcVersion: '1.21.4' });
  });
  after(async () => {
    await panel?.close();
    await mocks?.close();
  });

  it('busca lo que corresponde a cada tipo de servidor', async () => {
    const plugins = await c.ok('GET', `${C(paper)}/search?query=luck`);
    assert.equal(plugins.kind, 'plugin');
    assert.deepEqual(plugins.sources, ['modrinth', 'hangar']);
    assert.deepEqual(plugins.results.map((r) => r.title), ['LuckPerms']);
    const req = mocks.state.requests.findLast((r) => r.path === '/modrinth/search');
    const facets = JSON.parse(new URLSearchParams(req.query).get('facets'));
    assert.deepEqual(facets, [['project_type:plugin'], ['categories:paper', 'categories:spigot', 'categories:bukkit', 'categories:purpur'], ['versions:1.21.4']]);

    const mods = await c.ok('GET', `${C(fabric)}/search?query=sodium`);
    assert.equal(mods.kind, 'mod');
    assert.equal(mods.results[0].clientOnly, true, 'avisa que Sodium es solo para el cliente');
    const packs = await c.ok('GET', `${C(vanilla)}/search`);
    assert.equal(packs.kind, 'datapack');
    assert.equal((await c.get(`${C(fabric)}/search?source=hangar`)).status, 400, 'Hangar es solo para Paper');
  });

  it('muestra el detalle de un proyecto (descripción, galería, enlaces)', async () => {
    const d = await c.ok('GET', `${C(paper)}/project?source=modrinth&projectId=luckperms`);
    assert.equal(d.title, 'LuckPerms');
    assert.equal(d.gallery.length, 1);
    assert.deepEqual(d.links, [{ label: 'Código fuente', url: 'https://example.com/src' }]);
    const h = await c.ok('GET', `${C(paper)}/project?source=hangar&projectId=EssentialsX`);
    assert.equal(h.body, '# Página principal');
  });

  it('instala un plugin de Modrinth en plugins/ y lo recuerda', async () => {
    const r = await c.ok('POST', `${C(paper)}/install`, { projectId: 'luckperms' });
    assert.deepEqual(r.installed.map((x) => [x.title, x.version, x.file]), [['LuckPerms', '1.0.0', 'luckperms-1.0.0.jar']]);
    assert.ok(fs.existsSync(path.join(panel.serverDir(paper.id), 'plugins', 'luckperms-1.0.0.jar')));
    const list = await c.ok('GET', `${C(paper)}/installed`);
    assert.deepEqual(list.items.map((i) => [i.title, i.source, i.enabled]), [['LuckPerms', 'modrinth', true]]);
  });

  it('instala de Hangar; si el autor solo da un enlace externo, explica cómo bajarlo', async () => {
    await c.ok('POST', `${C(paper)}/install`, { source: 'hangar', projectId: 'EssentialsX' });
    assert.ok(fs.existsSync(path.join(panel.serverDir(paper.id), 'plugins', 'EssentialsX-2.21.0.jar')));
    const ext = await c.post(`${C(paper)}/install`, { source: 'hangar', projectId: 'Externo' });
    assert.equal(ext.status, 422);
    assert.match(ext.body.error, /sitio externo.*https:\/\/example\.com\/plugin.*plugins/);
  });

  it('detecta archivos subidos a mano, los desactiva, reactiva y desinstala', async () => {
    const dir = path.join(panel.serverDir(paper.id), 'plugins');
    fs.writeFileSync(path.join(dir, 'Manual.jar'), 'a mano');
    let list = await c.ok('GET', `${C(paper)}/installed`);
    assert.equal(list.items.find((i) => i.filename === 'Manual.jar').source, 'manual');
    list = await c.ok('POST', `${C(paper)}/toggle`, { filename: 'Manual.jar', enabled: false });
    assert.ok(fs.existsSync(path.join(dir, 'Manual.jar.disabled')));
    assert.equal(list.items.find((i) => i.filename === 'Manual.jar').enabled, false);
    await c.ok('POST', `${C(paper)}/toggle`, { filename: 'Manual.jar', enabled: true });
    assert.ok(fs.existsSync(path.join(dir, 'Manual.jar')));
    list = await c.ok('POST', `${C(paper)}/uninstall`, { filename: 'Manual.jar' });
    assert.ok(!list.items.some((i) => i.filename === 'Manual.jar'));
    assert.equal((await c.post(`${C(paper)}/uninstall`, { filename: '../../server.properties' })).status, 400);
    assert.ok(fs.existsSync(path.join(panel.serverDir(paper.id), 'server.properties')));
  });

  it('busca actualizaciones por el hash del archivo (aunque se haya subido a mano) y las aplica', async () => {
    const file = path.join(panel.serverDir(paper.id), 'plugins', 'luckperms-1.0.0.jar');
    mocks.state.modrinthUpdates[sha1(fs.readFileSync(file))] = { project: 'luckperms' };
    const ups = await c.ok('GET', `${C(paper)}/updates`);
    assert.deepEqual(ups, [{ filename: 'luckperms-1.0.0.jar', projectId: 'luckperms', versionId: 'v-luckperms-2', newVersion: '2.0.0', newFile: 'luckperms-2.0.0.jar' }]);
    await c.ok('POST', `${C(paper)}/update`, ups[0]);
    assert.ok(!fs.existsSync(file), 'quita la versión vieja');
    assert.ok(fs.existsSync(path.join(panel.serverDir(paper.id), 'plugins', 'luckperms-2.0.0.jar')));
    const items = (await c.ok('GET', `${C(paper)}/installed`)).items;
    assert.equal(items.filter((i) => i.projectId === 'luckperms').length, 1);
    assert.equal(items.find((i) => i.projectId === 'luckperms').versionName, '2.0.0');
  });

  it('instala mods con sus dependencias obligatorias (Fabric API)', async () => {
    const r = await c.ok('POST', `${C(fabric)}/install`, { projectId: 'needs-api' });
    assert.deepEqual(r.installed.map((x) => [x.projectId, x.dependency]), [['needs-api', false], ['P7dR8mSH', true]]);
    const items = (await c.ok('GET', `${C(fabric)}/installed`)).items;
    assert.deepEqual(items.map((i) => i.title).sort(), ['Fabric API', 'Mod que necesita Fabric API']);
    const again = await c.ok('POST', `${C(fabric)}/install`, { projectId: 'needs-api' });
    assert.equal(again.installed.length, 1, 'no reinstala una dependencia que ya está');
  });

  it('avisa si no hay versión compatible con el servidor', async () => {
    const r = await c.post(`${C(paper)}/install`, { projectId: 'sodium', title: 'Sodium' });
    assert.equal(r.status, 404);
    assert.match(r.body.error, /No hay una versión de "Sodium" compatible con paper 1.21.4/);
  });

  it('en Vanilla instala datapacks en la carpeta del mundo', async () => {
    await c.ok('POST', `${C(vanilla)}/install`, { projectId: 'terralith-pack' });
    assert.ok(fs.existsSync(path.join(panel.serverDir(vanilla.id), 'world', 'datapacks', 'terralith-pack-1.0.0.zip')));
  });

  it('CurseForge: pide una clave válida y solo entonces aparece como fuente', async () => {
    assert.deepEqual(await c.ok('GET', '/api/integrations/curseforge'), { hasKey: false, hint: null });
    assert.equal((await c.get(`${C(fabric)}/search?source=curseforge`)).status, 400);
    const bad = await c.put('/api/integrations/curseforge', { apiKey: 'equivocada' });
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /no aceptó la clave/);
    assert.deepEqual(await c.ok('PUT', '/api/integrations/curseforge', { apiKey: ' cf-key-123 ' }), { hasKey: true, hint: '…-123' });
    const res = await c.ok('GET', `${C(fabric)}/search?source=curseforge&query=jei`);
    assert.ok(res.sources.includes('curseforge'));
    assert.deepEqual(res.results.map((r) => [r.id, r.blocked]), [['1001', false], ['1002', true]]);
    const req = mocks.state.requests.findLast((r) => r.path === '/curseforge/mods/search');
    const q = new URLSearchParams(req.query);
    assert.equal(q.get('gameId'), '432');
    assert.equal(q.get('classId'), '6');
    assert.equal(q.get('modLoaderType'), '4', 'Fabric');
    assert.equal(req.headers['x-api-key'], 'cf-key-123');
  });

  it('CurseForge: instala si el autor lo permite; si no, da el enlace para bajarlo a mano', async () => {
    await c.ok('POST', `${C(fabric)}/install`, { source: 'curseforge', projectId: '1001' });
    assert.ok(fs.existsSync(path.join(panel.serverDir(fabric.id), 'mods', 'jei-1.0.jar')));
    assert.equal((await c.ok('GET', `${C(fabric)}/installed`)).items.find((i) => i.filename === 'jei-1.0.jar').title, 'Just Enough Items');
    const blocked = await c.post(`${C(fabric)}/install`, { source: 'curseforge', projectId: '1002' });
    assert.equal(blocked.status, 422);
    assert.match(blocked.body.error, /no permite descargarlo desde otras apps.*curseforge\.com\/minecraft\/mc-mods\/bloqueado\/files\/5002/);
    await c.ok('PUT', '/api/integrations/curseforge', { apiKey: '' });
    assert.equal((await c.ok('GET', '/api/integrations/curseforge')).hasKey, false);
  });

  describe('Modpacks (.mrpack)', () => {
    const cdn = (name) => `https://cdn.modrinth.com/data/AAAA1111/versions/BBBB2222/${name}`;
    const pack = () => {
      mocks.state.files['del-pack.jar'] = 'mod del modpack';
      mocks.state.files['hash-malo.jar'] = 'otro contenido';
      const index = {
        formatVersion: 1,
        game: 'minecraft',
        versionId: '3.1',
        name: 'Mi Pack',
        dependencies: { minecraft: '1.21.4', 'fabric-loader': '0.16.10' },
        files: [
          { path: 'mods/del-pack.jar', hashes: { sha1: sha1(Buffer.from('mod del modpack')) }, downloads: [cdn('del-pack.jar')], env: { client: 'required', server: 'required' } },
          { path: 'mods/shaders.jar', hashes: {}, downloads: [cdn('shaders.jar')], env: { client: 'required', server: 'unsupported' } },
          { path: 'mods/hash-malo.jar', hashes: { sha1: '0000' }, downloads: [cdn('hash-malo.jar')] },
          { path: 'mods/de-mi-red.jar', hashes: {}, downloads: ['http://192.168.1.1/admin'] },
          { path: '../../fuera.jar', hashes: {}, downloads: [cdn('del-pack.jar')] },
        ],
      };
      return rawZip({ 'modrinth.index.json': JSON.stringify(index), 'overrides/config/pack.toml': 'x = 1', 'server-overrides/config/servidor.toml': 'y = 2' });
    };

    it('revisa el .mrpack antes de importarlo', async () => {
      const form = new FormData();
      form.append('file', new Blob([pack()]), 'pack.mrpack');
      const r = await c.request('POST', '/api/integrations/modpacks/inspect', { form });
      assert.equal(r.status, 200, r.text);
      assert.deepEqual(
        { type: r.body.type, mc: r.body.mcVersion, loader: r.body.loaderVersion, files: r.body.serverFiles, skipped: r.body.skippedClientFiles },
        { type: 'fabric', mc: '1.21.4', loader: '0.16.10', files: 4, skipped: 1 }
      );
      const bad = new FormData();
      bad.append('file', new Blob([rawZip({ 'otra.txt': 'x' })]), 'x.mrpack');
      assert.equal((await c.request('POST', '/api/integrations/modpacks/inspect', { form: bad })).status, 400);
      const quilt = new FormData();
      quilt.append('file', new Blob([rawZip({ 'modrinth.index.json': JSON.stringify({ dependencies: { minecraft: '1.21.4', 'quilt-loader': '1' } }) })]), 'q.mrpack');
      const q = await c.request('POST', '/api/integrations/modpacks/inspect', { form: quilt });
      assert.match(q.body.error, /Quilt/);
    });

    it('crea el servidor, baja solo los mods del servidor desde sitios permitidos y copia la configuración', async () => {
      const form = new FormData();
      form.append('file', new Blob([pack()]), 'pack.mrpack');
      form.append('eula', 'true');
      form.append('memoryMb', '2048');
      const r = await c.request('POST', '/api/integrations/modpacks/import', { form });
      assert.ok(r.status === 200 || r.status === 201, r.text);
      const id = r.body.id || r.body.server?.id;
      const s = await panel.waitInstalled(id);
      assert.equal(s.type, 'fabric');
      assert.equal(s.name, 'Mi Pack');
      const dir = panel.serverDir(id);
      assert.equal(fs.readFileSync(path.join(dir, 'mods', 'del-pack.jar'), 'utf8'), 'mod del modpack');
      assert.ok(!fs.existsSync(path.join(dir, 'mods', 'shaders.jar')), 'omite mods solo de cliente');
      assert.ok(!fs.existsSync(path.join(dir, 'mods', 'hash-malo.jar')), 'descarta archivos con hash distinto');
      assert.ok(!fs.existsSync(path.join(dir, 'mods', 'de-mi-red.jar')), 'no descarga de sitios no permitidos');
      assert.ok(!fs.existsSync(path.resolve(dir, '..', '..', 'fuera.jar')));
      assert.ok(fs.existsSync(path.join(dir, 'config', 'pack.toml')));
      assert.ok(fs.existsSync(path.join(dir, 'config', 'servidor.toml')));
      const db = panel.readDb().servers.find((x) => x.id === id);
      assert.equal(db.modpack.pendingApply, false);
      assert.equal(db.modpack.failed.length, 3);
      assert.ok(db.modpack.failed.some((f) => /no permitido/.test(f)));
      assert.ok(db.modpack.failed.some((f) => /ruta no permitida/.test(f)));
      assert.ok(!mocks.state.requests.some((x) => x.path.includes('admin')));
      const items = (await c.ok('GET', `/api/servers/${id}/content/installed`)).items;
      assert.equal(items.find((i) => i.filename === 'del-pack.jar').managedBy, 'modpack');
      await panel.start(id);
      await panel.stop(id);
    });

    it('busca modpacks en Modrinth y los importa directamente', async () => {
      const res = await c.ok('GET', '/api/integrations/modpacks/search?query=cool');
      assert.equal(res.results[0].slug, 'cool-pack');
      const versions = await c.ok('GET', '/api/integrations/modpacks/cool-pack/versions');
      assert.equal(versions[0].id, 'v-cool-pack-1');
      mocks.state.files['cool-pack-1.0.0.mrpack'] = pack();
      const r = await c.ok('POST', '/api/integrations/modpacks/import', { projectId: 'cool-pack', eula: true, name: 'Desde Modrinth' });
      const id = r.id || r.server?.id;
      const s = await panel.waitInstalled(id);
      assert.equal(s.name, 'Desde Modrinth');
      await waitFor(() => fs.existsSync(path.join(panel.serverDir(id), 'mods', 'del-pack.jar')));
    });
  });
});
