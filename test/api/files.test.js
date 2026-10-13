import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { startMocks } from '../helpers/mocks.js';
import { startPanel, hasJava } from '../helpers/panel.js';
import { rawZip, zipNames } from '../helpers/zip.js';
import { writeNbt } from '../../server/lib/nbt.js';

/**
 * Caso de uso: "Quiero ver, editar, subir y descargar los archivos de mi servidor desde el navegador,
 * sin poder romper el mundo mientras está encendido ni salirme de la carpeta del servidor".
 */
describe('Administrador de archivos', { skip: !hasJava() && 'Se necesita Java' }, () => {
  let mocks;
  let panel;
  let c;
  let s;
  let F;
  let dir;
  before(async () => {
    mocks = await startMocks();
    panel = await startPanel({ mocks });
    c = panel.client;
    s = await panel.createServer({ name: 'Archivos', type: 'vanilla', mcVersion: '1.21.4' });
    F = `/api/servers/${s.id}/files`;
    dir = panel.serverDir(s.id);
  });
  after(async () => {
    await panel?.close();
    await mocks?.close();
  });

  it('lista carpetas primero y marca qué se puede editar', async () => {
    fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'config', 'mod.toml'), 'a = 1\n');
    const r = await c.ok('GET', `${F}?path=`);
    assert.equal(r.path, '');
    const firstFile = r.entries.findIndex((e) => e.type === 'file');
    assert.ok(r.entries.slice(0, firstFile).every((e) => e.type === 'dir'));
    assert.equal(r.entries.find((e) => e.name === 'server.properties').editable, true);
    assert.equal(r.entries.find((e) => e.name === 'server.jar').editable, false);
    assert.equal((await c.get(`${F}?path=no-existe`)).status, 404);
  });

  it('lee y guarda archivos de texto (creando carpetas si faltan)', async () => {
    await c.ok('PUT', `${F}/content`, { path: 'plugins/Mi/config.yml', content: 'hola: ñ\n' });
    assert.equal(fs.readFileSync(path.join(dir, 'plugins/Mi/config.yml'), 'utf8'), 'hola: ñ\n');
    const r = await c.ok('GET', `${F}/content?path=plugins/Mi/config.yml`);
    assert.equal(r.content, 'hola: ñ\n');
    assert.equal((await c.put(`${F}/content`, { path: 'x.txt', content: 5 })).status, 400);
  });

  it('nunca sale de la carpeta del servidor', async () => {
    for (const bad of ['../../db.json', '..%2F..%2Fdb.json', 'world/../../otro']) {
      const r = await c.get(`${F}/content?path=${bad}`);
      assert.equal(r.status, 400, bad);
    }
    assert.equal((await c.put(`${F}/content`, { path: '../fuera.txt', content: 'x' })).status, 400);
    assert.ok(!fs.existsSync(path.join(dir, '..', 'fuera.txt')));
    assert.equal((await c.post(`${F}/delete`, { paths: ['../'] })).status, 400);
    assert.equal((await c.post(`${F}/delete`, { paths: [''] })).status, 400, 'no borra la carpeta raíz');
  });

  it('sube archivos y carpetas completas, limpiando nombres peligrosos', async () => {
    const form = new FormData();
    form.append('files', new Blob(['uno']), 'a.txt');
    form.append('paths', 'subida/a.txt');
    form.append('files', new Blob(['dos']), 'b.txt');
    form.append('paths', '../../escapado/b.txt');
    form.append('files', new Blob(['tres']), 'c.txt');
    form.append('paths', 'subida/ra:ro?.txt');
    const r = await c.request('POST', `${F}/upload?path=`, { form });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.saved, ['subida/a.txt', 'escapado/b.txt', 'subida/ra_ro_.txt']);
    assert.equal(fs.readFileSync(path.join(dir, 'escapado', 'b.txt'), 'utf8'), 'dos');
    assert.ok(!fs.existsSync(path.join(dir, '..', '..', 'escapado')));
  });

  it('crea carpetas, renombra, copia y mueve (sin pisar archivos)', async () => {
    await c.ok('POST', `${F}/mkdir`, { path: 'destino' });
    await c.ok('POST', `${F}/rename`, { from: 'subida/a.txt', to: 'subida/renombrado.txt' });
    assert.equal((await c.post(`${F}/rename`, { from: 'subida/renombrado.txt', to: 'subida/ra_ro_.txt' })).status, 409);
    await c.ok('POST', `${F}/copy`, { paths: ['subida/renombrado.txt'], dest: 'destino' });
    const again = await c.ok('POST', `${F}/copy`, { paths: ['subida/renombrado.txt'], dest: 'destino' });
    assert.deepEqual(again.done, ['renombrado (2).txt']);
    await c.ok('POST', `${F}/move`, { paths: ['subida'], dest: 'destino' });
    assert.ok(fs.existsSync(path.join(dir, 'destino', 'subida', 'ra_ro_.txt')));
    assert.ok(!fs.existsSync(path.join(dir, 'subida')));
    const self = await c.post(`${F}/move`, { paths: ['destino'], dest: 'destino/subida' });
    assert.equal(self.status, 400, 'no se puede mover una carpeta dentro de sí misma');
  });

  it('busca por nombre en todas las subcarpetas', async () => {
    const r = await c.ok('GET', `${F}/search?q=RENOMBRADO`);
    assert.deepEqual(r.results.map((x) => x.path).sort(), ['destino/renombrado (2).txt', 'destino/renombrado.txt', 'destino/subida/renombrado.txt']);
    assert.equal((await c.get(`${F}/search?q=a`)).status, 400);
  });

  it('comprime, descarga (archivo, carpeta y selección) y extrae zips', async () => {
    const comp = await c.ok('POST', `${F}/compress`, { paths: ['destino'], name: 'respaldo' });
    assert.equal(comp.name, 'respaldo.zip');
    const one = await c.request('GET', `${F}/download?path=destino/renombrado.txt`, { raw: true });
    assert.equal(await one.text(), 'uno');
    const folder = Buffer.from(await (await c.request('GET', `${F}/download?path=destino`, { raw: true })).arrayBuffer());
    assert.ok(zipNames(folder).includes('destino/subida/ra_ro_.txt'));
    const many = Buffer.from(await (await c.request('GET', `${F}/download-many?paths=${encodeURIComponent(JSON.stringify(['server.properties', 'destino/subida']))}`, { raw: true })).arrayBuffer());
    assert.ok(zipNames(many).includes('server.properties'));
    assert.ok(zipNames(many).some((n) => n.startsWith('subida/')));

    await c.ok('POST', `${F}/delete`, { paths: ['destino'] });
    const ext = await c.ok('POST', `${F}/extract`, { path: 'respaldo.zip' });
    assert.ok(ext.entries > 0);
    assert.equal(fs.readFileSync(path.join(dir, 'destino', 'renombrado.txt'), 'utf8'), 'uno');
    assert.equal((await c.post(`${F}/extract`, { path: 'server.properties' })).status, 400);
  });

  it('un zip con rutas "../" no puede escribir fuera de la carpeta (zip slip)', async () => {
    fs.writeFileSync(path.join(dir, 'malo.zip'), rawZip({ 'bien.txt': 'ok', '../../../malo.txt': 'mal' }));
    const r = await c.post(`${F}/extract`, { path: 'malo.zip' });
    assert.equal(r.status, 400);
    assert.ok(!fs.existsSync(path.resolve(dir, '../../../malo.txt')));
    assert.ok(!fs.existsSync(path.resolve(dir, '..', 'malo.txt')));
  });

  it('edita archivos NBT (level.dat) y guarda una copia del original', async () => {
    const levelDat = path.join(dir, 'world', 'level.dat');
    fs.mkdirSync(path.dirname(levelDat), { recursive: true });
    fs.writeFileSync(levelDat, writeNbt({ compression: 'gzip', rootName: '', root: { type: 'compound', value: [{ name: 'Data', type: 'compound', value: [{ name: 'LevelName', type: 'string', value: 'Viejo' }, { name: 'SpawnY', type: 'int', value: 64 }] }] } }));
    const r = await c.ok('GET', `${F}/nbt?path=world/level.dat`);
    assert.equal(r.compression, 'gzip');
    const data = r.root.value.find((t) => t.name === 'Data');
    data.value.find((t) => t.name === 'LevelName').value = 'Nuevo';
    const saved = await c.ok('PUT', `${F}/nbt`, { path: 'world/level.dat', compression: r.compression, rootName: r.rootName, root: r.root });
    assert.equal(saved.backup, 'world/level.dat.panel-bak');
    const raw = zlib.gunzipSync(fs.readFileSync(levelDat)).toString('latin1');
    assert.match(raw, /Nuevo/);
    assert.ok(fs.existsSync(`${levelDat}.panel-bak`));
    fs.writeFileSync(path.join(dir, 'roto.dat'), 'esto no es nbt');
    assert.equal((await c.get(`${F}/nbt?path=roto.dat`)).status, 422);
    const bad = await c.put(`${F}/nbt`, { path: 'world/level.dat', compression: 'gzip', rootName: '', root: { type: 'int', value: 'no' } });
    assert.equal(bad.status, 400);
  });

  it('lista los jugadores con datos guardados (playerdata) con su nombre', async () => {
    const uuid = '069a79f4-44e9-4726-a5be-fca90e38aaf5';
    fs.mkdirSync(path.join(dir, 'world', 'playerdata'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'world', 'playerdata', `${uuid}.dat`), writeNbt({ compression: 'gzip', rootName: '', root: { type: 'compound', value: [] } }));
    fs.writeFileSync(path.join(dir, 'usercache.json'), JSON.stringify([{ name: 'Notch', uuid }]));
    const r = await c.ok('GET', `${F}/players`);
    assert.deepEqual(r.players.map((p) => [p.name, p.path]), [['Notch', `world/playerdata/${uuid}.dat`]]);
  });

  it('con el servidor encendido protege el mundo (pero deja tocar datapacks y lo demás)', async () => {
    await panel.start(s.id);
    try {
      const list = await c.ok('GET', `${F}?path=world`);
      assert.equal(list.protected, true);
      assert.equal(list.running, true);
      for (const [url, body] of [
        [`${F}/delete`, { paths: ['world/level.dat'] }],
        [`${F}/rename`, { from: 'world/level.dat', to: 'world/x.dat' }],
        [`${F}/move`, { paths: ['server.properties'], dest: 'world' }],
        [`${F}/mkdir`, { path: 'world_nether/nueva' }],
        [`${F}/nbt`, null],
      ]) {
        const r = body ? await c.post(url, body) : await c.put(url, { path: 'world/level.dat', compression: 'gzip', rootName: '', root: { type: 'compound', value: [] } });
        assert.equal(r.status, 409, url);
      }
      const form = new FormData();
      form.append('files', new Blob(['x']), 'r.mca');
      form.append('paths', 'region/r.mca');
      assert.equal((await c.request('POST', `${F}/upload?path=world`, { form })).status, 409);
      await c.ok('POST', `${F}/mkdir`, { path: 'world/datapacks/mio' });
      await c.ok('POST', `${F}/mkdir`, { path: 'plugins/otra' });
      assert.ok(fs.existsSync(path.join(dir, 'world', 'level.dat')));
    } finally {
      await panel.stop(s.id);
    }
    await c.ok('POST', `${F}/delete`, { paths: ['world/datapacks/mio'] });
  });
});
