import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { startMocks, sha1 } from '../helpers/mocks.js';
import { startPanel, hasJava, waitFor } from '../helpers/panel.js';
import { rawZip } from '../helpers/zip.js';
import { parseNbt } from '../../server/lib/nbt.js';

/** Un mod de Fabric de mentira: "*" sirve en todos lados, "client" solo en el juego. */
const fabricJar = (id, environment = '*') => rawZip({ 'fabric.mod.json': JSON.stringify({ schemaVersion: 1, id, version: '1.0.0', environment }) });
/** Un mod de Forge solo de cliente que no lo declara (se reconoce por su modId). */
const forgeClientJar = () => rawZip({ 'META-INF/mods.toml': 'modLoader="javafml"\n[[mods]]\nmodId="oculus"\nversion="1.0"\n' });

const zipEntries = (buf) => new AdmZip(buf).getEntries().map((e) => e.entryName);
const zipJson = (buf, name) => JSON.parse(new AdmZip(buf).getEntry(name).getData().toString('utf8'));

/**
 * Casos de uso:
 *  - "Quiero crear un servidor con un modpack de CurseForge."
 *  - "Salió una versión nueva del modpack: quiero actualizar sin perder el mundo."
 *  - "Mis amigos no tienen el modpack: ¿cómo se los paso?"
 */
describe('Modpacks: CurseForge, actualizar y archivo para los jugadores', { skip: !hasJava() && 'Se necesita Java' }, () => {
  let mocks;
  let panel;
  let c;
  let cfServer;
  let mrServer;

  /** Modpack de CurseForge con un poco de todo. */
  function setupCurseForgePack() {
    const st = mocks.state;
    const { cfMod, cfFile } = st;
    Object.assign(st.cf.mods, {
      2001: cfMod(2001, 'pack-de-prueba', 'Pack de Prueba', {
        classId: 4471,
        latestFilesIndexes: [{ gameVersion: '1.21.4', modLoader: 4 }],
      }),
      2002: cfMod(2002, 'pack-cerrado', 'Pack Cerrado', { classId: 4471, latestFilesIndexes: [] }),
      3001: cfMod(3001, 'mod-comun', 'Mod Común'),
      3002: cfMod(3002, 'minimapa', 'Minimapa'),
      3003: cfMod(3003, 'texturas', 'Texturas HD', { classId: 12 }),
      3004: cfMod(3004, 'mod-cerrado', 'Mod Cerrado', { allowModDistribution: false }),
      3005: cfMod(3005, 'datapack-cf', 'Datapack CF', { classId: 6945 }),
      3006: cfMod(3006, 'graficos', 'Gráficos Forge'),
    });
    st.files['mod-comun-1.jar'] = fabricJar('mod-comun');
    st.files['minimapa-1.jar'] = fabricJar('minimapa', 'client');
    st.files['datapack-cf.zip'] = rawZip({ 'pack.mcmeta': '{}' });
    st.files['graficos.jar'] = forgeClientJar();
    Object.assign(st.cf.files, {
      6001: cfFile(6001, 2001, 'pack-de-prueba-1.0.zip', { displayName: 'Pack de Prueba 1.0', gameVersions: ['1.21.4', 'Fabric'] }),
      6002: cfFile(6002, 2001, 'pack-de-prueba-server-1.0.zip', { isServerPack: true }),
      6003: cfFile(6003, 2002, 'pack-cerrado-1.0.zip', { downloadUrl: null, gameVersions: ['1.21.4', 'Fabric'] }),
      7001: cfFile(7001, 3001, 'mod-comun-1.jar', { hashes: [{ algo: 1, value: sha1(st.files['mod-comun-1.jar']) }] }),
      7002: cfFile(7002, 3002, 'minimapa-1.jar'),
      7003: cfFile(7003, 3003, 'texturas.zip'),
      7004: cfFile(7004, 3004, 'mod-cerrado.jar', { downloadUrl: null }),
      7005: cfFile(7005, 3005, 'datapack-cf.zip'),
      7006: cfFile(7006, 3006, 'graficos.jar'),
    });
    const manifest = {
      minecraft: { version: '1.21.4', modLoaders: [{ id: 'fabric-0.16.10', primary: true }] },
      manifestType: 'minecraftModpack',
      manifestVersion: 1,
      name: 'Pack de Prueba',
      version: '1.0',
      author: 'tester',
      files: [
        { projectID: 3001, fileID: 7001, required: true },
        { projectID: 3002, fileID: 7002, required: true },
        { projectID: 3003, fileID: 7003, required: true },
        { projectID: 3004, fileID: 7004, required: true },
        { projectID: 3005, fileID: 7005, required: true },
        { projectID: 3006, fileID: 7006, required: true },
        { projectID: 9999, fileID: 9999, required: false },
      ],
      overrides: 'overrides',
    };
    st.files['pack-de-prueba-1.0.zip'] = rawZip({
      'manifest.json': JSON.stringify(manifest),
      'overrides/config/pack.toml': 'pack = true',
      'overrides/mods/embebido.jar': fabricJar('embebido'),
      'overrides/mods/cliente-embebido.jar': fabricJar('cliente-embebido', 'client'),
      'overrides/resourcepacks/hd.zip': 'textura',
    });
  }

  /** Modpack de Modrinth en dos versiones. */
  function setupModrinthPack() {
    const st = mocks.state;
    st.files['del-pack.jar'] = fabricJar('del-pack');
    st.files['nuevo-en-v2.jar'] = fabricJar('nuevo-en-v2');
    st.files['shaders.jar'] = fabricJar('shaders', 'client');
    const cdn = (name) => `https://cdn.modrinth.com/data/AAAA1111/versions/BBBB2222/${name}`;
    const file = (name, env = { client: 'required', server: 'required' }) => ({ path: `mods/${name}`, hashes: { sha1: sha1(st.files[name]) }, downloads: [cdn(name)], env, fileSize: 10 });
    const pack = (version, files) =>
      rawZip({
        'modrinth.index.json': JSON.stringify({ formatVersion: 1, game: 'minecraft', versionId: version, name: 'Cool Pack', dependencies: { minecraft: '1.21.4', 'fabric-loader': '0.16.10' }, files }),
        'overrides/config/cool.toml': `version = "${version}"`,
        'server-overrides/config/solo-servidor.toml': 'x = 1',
      });
    st.files['cool-pack-1.0.0.mrpack'] = pack('1.0.0', [file('del-pack.jar'), file('shaders.jar', { client: 'required', server: 'unsupported' })]);
    st.files['cool-pack-2.0.0.mrpack'] = pack('2.0.0', [file('nuevo-en-v2.jar'), file('shaders.jar', { client: 'required', server: 'unsupported' })]);
  }

  before(async () => {
    mocks = await startMocks();
    panel = await startPanel({ mocks });
    c = panel.client;
    setupCurseForgePack();
    setupModrinthPack();
  });
  after(async () => {
    await panel?.close();
    await mocks?.close();
  });

  describe('CurseForge', () => {
    it('pide la clave de CurseForge para buscar modpacks', async () => {
      const r = await c.get('/api/integrations/modpacks/search?source=curseforge');
      assert.equal(r.status, 409);
      assert.match(r.body.error, /clave de CurseForge/);
      await c.ok('PUT', '/api/integrations/curseforge', { apiKey: 'cf-key-123' });
    });

    it('busca modpacks y lista sus versiones (sin los "server packs")', async () => {
      const r = await c.ok('GET', '/api/integrations/modpacks/search?source=curseforge&query=pack');
      assert.deepEqual(r.results.map((x) => x.title).sort(), ['Pack Cerrado', 'Pack de Prueba']);
      const p = r.results.find((x) => x.id === '2001');
      assert.deepEqual([p.loaders, p.versions], [['fabric'], ['1.21.4']]);
      const req = mocks.state.requests.findLast((x) => x.path === '/curseforge/mods/search');
      assert.equal(new URLSearchParams(req.query).get('classId'), '4471');
      const versions = await c.ok('GET', '/api/integrations/modpacks/2001/versions?source=curseforge');
      assert.deepEqual(versions.map((v) => [v.id, v.loaders]), [['6001', ['fabric']]]);
    });

    it('si el autor no deja descargarlo desde otras apps, explica cómo subirlo a mano', async () => {
      const r = await c.post('/api/integrations/modpacks/import', { source: 'curseforge', projectId: '2002', eula: true });
      assert.equal(r.status, 422);
      assert.match(r.body.error, /no permite descargarlo desde otras apps.*curseforge\.com\/minecraft\/modpacks\/pack-cerrado\/files\/6003.*Subir archivo/);
    });

    it('crea el servidor: baja los mods, omite los del juego y avisa los que hay que bajar a mano', async () => {
      const r = await c.ok('POST', '/api/integrations/modpacks/import', { source: 'curseforge', projectId: '2001', eula: true, memoryMb: 2048 });
      cfServer = await panel.waitInstalled(r.id);
      assert.deepEqual([cfServer.type, cfServer.mcVersion, cfServer.loaderVersion], ['fabric', '1.21.4', '0.16.10']);
      const dir = panel.serverDir(cfServer.id);
      const mods = fs.readdirSync(path.join(dir, 'mods')).sort();
      assert.deepEqual(mods, ['embebido.jar', 'mod-comun-1.jar'], 'solo los mods que sirven en el servidor');
      assert.ok(fs.existsSync(path.join(dir, 'world', 'datapacks', 'datapack-cf.zip')), 'los datapacks van a la carpeta del mundo');
      assert.ok(fs.existsSync(path.join(dir, 'config', 'pack.toml')));

      const st = await c.ok('GET', `/api/servers/${cfServer.id}/modpack`);
      assert.equal(st.modpack.format, 'curseforge');
      assert.equal(st.modpack.page, 'https://www.curseforge.com/minecraft/modpacks/pack-de-prueba');
      assert.deepEqual(st.modpack.clientOnly, ['cliente-embebido.jar', 'graficos.jar', 'minimapa-1.jar']);
      assert.equal(st.modpack.failed.length, 1);
      assert.match(st.modpack.failed[0], /Mod Cerrado: su autor no permite descargarlo.*mod-cerrado\/files\/7004.*carpeta mods/);
      const items = (await c.ok('GET', `/api/servers/${cfServer.id}/content/installed`)).items;
      const comun = items.find((i) => i.filename === 'mod-comun-1.jar');
      assert.deepEqual([comun.source, comun.title, comun.managedBy], ['curseforge', 'Mod Común', 'modpack']);
      await panel.start(cfServer.id);
      await panel.stop(cfServer.id);
    });

    it('también acepta el .zip de CurseForge subido a mano y reconoce un "server pack"', async () => {
      const form = new FormData();
      form.append('file', new Blob([mocks.state.files['pack-de-prueba-1.0.zip']]), 'pack.zip');
      const r = await c.request('POST', '/api/integrations/modpacks/inspect', { form });
      assert.equal(r.status, 200, r.text);
      assert.deepEqual([r.body.format, r.body.type, r.body.name, r.body.serverFiles], ['curseforge', 'fabric', 'Pack de Prueba', 6]);
      const serverPack = new FormData();
      serverPack.append('file', new Blob([rawZip({ 'Pack/mods/a.jar': 'x', 'Pack/start.bat': 'java' })]), 'server.zip');
      const bad = await c.request('POST', '/api/integrations/modpacks/inspect', { form: serverPack });
      assert.equal(bad.status, 400);
      assert.match(bad.body.error, /server pack/);
    });
  });

  describe('Actualizar un modpack', () => {
    it('avisa cuando hay una versión nueva', async () => {
      const r = await c.ok('POST', '/api/integrations/modpacks/import', { projectId: 'cool-pack', eula: true, memoryMb: 2048 });
      mrServer = await panel.waitInstalled(r.id);
      let st = await c.ok('GET', `/api/servers/${mrServer.id}/modpack`);
      assert.equal(st.modpack.version, '1.0.0');
      assert.equal(st.modpack.page, 'https://modrinth.com/modpack/cool-pack');
      assert.deepEqual(st.updates, []);
      mocks.state.modrinthUpdates.algo = { project: 'cool-pack' };
      st = await c.ok('GET', `/api/servers/${mrServer.id}/modpack`);
      assert.deepEqual(st.updates.map((u) => [u.id, u.number, u.compatible]), [['v-cool-pack-2', '2.0.0', true]]);
    });

    it('actualiza: respalda antes, cambia los mods del pack y conserva el mundo y tus mods', async () => {
      const dir = panel.serverDir(mrServer.id);
      await panel.start(mrServer.id);
      assert.equal((await c.post(`/api/servers/${mrServer.id}/modpack/update`, { versionId: 'v-cool-pack-2' })).status, 409, 'apagado primero');
      await panel.stop(mrServer.id);
      fs.writeFileSync(path.join(dir, 'world', 'marca.txt'), 'mi mundo');
      fs.writeFileSync(path.join(dir, 'mods', 'mio.jar'), fabricJar('mio'));

      const r = await c.ok('POST', `/api/servers/${mrServer.id}/modpack/update`, { versionId: 'v-cool-pack-2' });
      assert.equal(r.version, '2.0.0');
      assert.equal(r.changedMinecraft, false);
      const s = await panel.waitInstalled(mrServer.id);
      assert.equal(s.installState, 'ready');
      const mods = fs.readdirSync(path.join(dir, 'mods')).sort();
      assert.deepEqual(mods, ['mio.jar', 'nuevo-en-v2.jar'], 'quitó el mod viejo del pack y dejó el tuyo');
      assert.equal(fs.readFileSync(path.join(dir, 'world', 'marca.txt'), 'utf8'), 'mi mundo');
      assert.match(fs.readFileSync(path.join(dir, 'config', 'cool.toml'), 'utf8'), /2\.0\.0/);
      const backups = (await c.ok('GET', `/api/servers/${mrServer.id}/backups`)).backups;
      assert.ok(backups.some((b) => b.file.endsWith('-completo-antes-de-actualizar-modpack.zip')));
      const st = await c.ok('GET', `/api/servers/${mrServer.id}/modpack`);
      assert.equal(st.modpack.version, '2.0.0');
      assert.deepEqual(st.updates, [], 'ya está en la última');
      await panel.start(mrServer.id);
      await panel.stop(mrServer.id);
    });

    it('acepta subir el archivo de la versión nueva, pero no uno de otro loader', async () => {
      const forgePack = rawZip({ 'modrinth.index.json': JSON.stringify({ name: 'Otro', dependencies: { minecraft: '1.20.1', forge: '47.3.0' }, files: [] }) });
      const form = new FormData();
      form.append('file', new Blob([forgePack]), 'otro.mrpack');
      const r = await c.request('POST', `/api/servers/${mrServer.id}/modpack/update`, { form });
      assert.equal(r.status, 400);
      assert.match(r.body.error, /usa Forge y tu servidor es Fabric/);
      const same = new FormData();
      same.append('file', new Blob([mocks.state.files['cool-pack-1.0.0.mrpack']]), 'cool-1.mrpack');
      const ok = await c.request('POST', `/api/servers/${mrServer.id}/modpack/update`, { form: same });
      assert.equal(ok.status, 200, ok.text);
      await panel.waitInstalled(mrServer.id);
      assert.deepEqual(fs.readdirSync(path.join(panel.serverDir(mrServer.id), 'mods')).sort(), ['del-pack.jar', 'mio.jar']);
    });
  });

  describe('Para los jugadores', () => {
    it('Modrinth: el pack original (con sus mods del juego) + tus mods + el servidor ya en la lista', async () => {
      await c.ok('POST', `/api/servers/${mrServer.id}/content/install`, { projectId: 'lithium' });
      await c.ok('POST', `/api/servers/${mrServer.id}/content/install`, { projectId: 'servercore' });
      const res = await c.request('GET', `/api/servers/${mrServer.id}/modpack/players`, { raw: true });
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-disposition'), /Cool Pack - para jugadores\.mrpack/);
      const summary = JSON.parse(decodeURIComponent(res.headers.get('x-pack-summary')));
      assert.deepEqual(summary.linked, ['Lithium']);
      assert.deepEqual(summary.embedded, ['mio']);
      assert.deepEqual(summary.serverOnly, ['ServerCore'], 'los mods solo de servidor no se mandan');
      assert.equal(summary.address, `203.0.113.7:${mrServer.port}`);

      const buf = Buffer.from(await res.arrayBuffer());
      const index = zipJson(buf, 'modrinth.index.json');
      const paths = index.files.map((f) => f.path).sort();
      assert.deepEqual(paths, ['mods/del-pack.jar', 'mods/lithium-1.0.0.jar', 'mods/shaders.jar'], 'incluye los shaders del pack (sí sirven en el juego)');
      const lithium = index.files.find((f) => f.path === 'mods/lithium-1.0.0.jar');
      assert.equal(lithium.env.client, 'optional');
      assert.ok(lithium.hashes.sha1 && lithium.hashes.sha512);
      const entries = zipEntries(buf);
      assert.ok(entries.includes('overrides/mods/mio.jar'));
      assert.ok(entries.includes('overrides/config/cool.toml'));
      assert.ok(!entries.some((e) => e.startsWith('server-overrides/')));
      const dat = parseNbt(new AdmZip(buf).getEntry('overrides/servers.dat').getData());
      const entry = dat.root.value[0].value[0].value;
      assert.deepEqual(entry.map((t) => [t.name, t.value]), [['name', mrServer.name], ['ip', `203.0.113.7:${mrServer.port}`]]);
    });

    it('CurseForge: el manifest original + tus mods de CurseForge por referencia', async () => {
      await c.ok('POST', `/api/servers/${cfServer.id}/content/install`, { source: 'curseforge', projectId: '1001' });
      const res = await c.request('GET', `/api/servers/${cfServer.id}/modpack/players`, { raw: true });
      assert.match(res.headers.get('content-disposition'), /Pack de Prueba - para jugadores\.zip/);
      const buf = Buffer.from(await res.arrayBuffer());
      const manifest = zipJson(buf, 'manifest.json');
      assert.ok(manifest.files.some((f) => f.projectID === 1001 && f.fileID === 5001));
      assert.ok(manifest.files.some((f) => f.projectID === 3002), 'el minimapa sí va para los jugadores');
      const entries = zipEntries(buf);
      assert.ok(entries.includes('overrides/servers.dat'));
      assert.ok(entries.includes('overrides/mods/cliente-embebido.jar'));
    });

    it('un servidor con mods pero sin modpack también arma su archivo; uno de plugins no lo necesita', async () => {
      const fabric = await panel.createServer({ name: 'Solo mods', type: 'fabric', mcVersion: '1.21.4' });
      await c.ok('POST', `/api/servers/${fabric.id}/content/install`, { projectId: 'needs-api' });
      const res = await c.request('GET', `/api/servers/${fabric.id}/modpack/players`, { raw: true });
      assert.match(res.headers.get('content-disposition'), /Solo mods - para jugadores\.mrpack/);
      const index = zipJson(Buffer.from(await res.arrayBuffer()), 'modrinth.index.json');
      assert.deepEqual(index.dependencies, { minecraft: '1.21.4', 'fabric-loader': '0.16.10' });
      assert.deepEqual(index.files.map((f) => f.path).sort(), ['mods/fabric-api-1.0.0.jar', 'mods/needs-api-1.0.0.jar']);
      const st = await c.ok('GET', `/api/servers/${fabric.id}/modpack`);
      assert.deepEqual([st.modpack, st.mods], [null, true]);

      const paper = await panel.createServer({ name: 'Plugins', type: 'paper', mcVersion: '1.21.4' });
      const p = await c.get(`/api/servers/${paper.id}/modpack/players`);
      assert.equal(p.status, 400);
      assert.match(p.body.error, /sin instalar nada/);
    });
  });

  it('copiar el servidor copia el modpack; borrarlo borra el archivo guardado', async () => {
    const copy = (await c.post(`/api/servers/${cfServer.id}/clone`, { name: 'Copia del pack' })).body;
    const packs = () => fs.readdirSync(path.join(panel.dataDir, 'modpacks'));
    assert.ok(packs().includes(`${copy.id}.zip`));
    const res = await c.request('GET', `/api/servers/${copy.id}/modpack/players`, { raw: true });
    assert.equal(res.status, 200);
    await c.ok('DELETE', `/api/servers/${copy.id}`);
    await waitFor(() => !packs().includes(`${copy.id}.zip`), { message: 'que se borre el modpack guardado' });
  });
});
