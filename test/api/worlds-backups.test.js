import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startMocks } from '../helpers/mocks.js';
import { startPanel, hasJava, waitFor } from '../helpers/panel.js';
import { rawZip, zipNames } from '../helpers/zip.js';

/**
 * Casos de uso:
 *  - "Quiero tener varios mundos, crear uno nuevo con otra semilla, importar uno que descargué y cambiar entre ellos."
 *  - "Quiero respaldos (a mano o automáticos) y poder volver a uno si algo sale mal."
 */
describe('Mundos y respaldos', { skip: !hasJava() && 'Se necesita Java' }, () => {
  let mocks;
  let panel;
  let c;
  let s;
  let dir;
  const W = () => `/api/servers/${s.id}/worlds`;
  const B = () => `/api/servers/${s.id}/backups`;
  before(async () => {
    mocks = await startMocks();
    panel = await startPanel({ mocks });
    c = panel.client;
    s = await panel.createServer({ name: 'Mundos', type: 'paper', mcVersion: '1.21.4' });
    dir = panel.serverDir(s.id);
    // El servidor falso crea world/level.dat al encender.
    await panel.start(s.id);
    await panel.stop(s.id);
    fs.mkdirSync(path.join(dir, 'world_nether', 'DIM-1'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'world', 'marca.txt'), 'original');
  });
  after(async () => {
    await panel?.close();
    await mocks?.close();
  });

  it('lista el mundo activo con su Nether', async () => {
    const r = await c.ok('GET', W());
    assert.equal(r.active, 'world');
    assert.deepEqual(r.worlds.map((w) => [w.name, w.active, w.generated, w.dimensions]), [['world', true, true, 2]]);
  });

  it('crea un mundo nuevo con semilla y tipo (se genera al encender)', async () => {
    assert.equal((await c.post(W(), { name: 'mundo con ñ' })).status, 400);
    assert.equal((await c.post(W(), { name: 'x_nether' })).status, 400);
    assert.equal((await c.post(W(), { name: 'world' })).status, 409);
    const r = await c.ok('POST', W(), { name: 'Plano', seed: '12345', levelType: 'flat' });
    assert.equal(r.active, 'Plano');
    assert.equal(r.seed, '12345');
    const props = await c.ok('GET', `/api/servers/${s.id}/properties`);
    assert.equal(props['level-type'], 'minecraft:flat');
    assert.equal(r.worlds.find((w) => w.name === 'Plano').generated, false);
    await panel.start(s.id);
    assert.ok(fs.existsSync(path.join(dir, 'Plano', 'level.dat')), 'el servidor generó el mundo nuevo');
  });

  it('con el servidor encendido no deja cambiar, crear ni borrar mundos', async () => {
    assert.equal((await c.post(`${W()}/switch`, { name: 'world' })).status, 409);
    assert.equal((await c.post(W(), { name: 'Otro' })).status, 409);
    assert.equal((await c.del(`${W()}/world`)).status, 409);
    await panel.stop(s.id);
  });

  it('cambia de mundo y no deja borrar el activo', async () => {
    const r = await c.ok('POST', `${W()}/switch`, { name: 'world' });
    assert.equal(r.active, 'world');
    assert.equal((await c.post(`${W()}/switch`, { name: 'NoExiste' })).status, 404);
    assert.equal((await c.del(`${W()}/world`)).status, 409);
  });

  it('importa un mundo desde un .zip (aunque venga dentro de otra carpeta) y lo activa', async () => {
    const zip = rawZip({ 'Descargas/MiMapa/level.dat': '\n\0\0\0', 'Descargas/MiMapa/region/r.0.0.mca': 'region', 'Descargas/leeme.txt': 'x' });
    const form = new FormData();
    form.append('file', new Blob([zip]), 'mapa.zip');
    form.append('activate', 'true');
    const r = await c.request('POST', `${W()}/import`, { form });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.imported, 'MiMapa');
    assert.equal(r.body.active, 'MiMapa');
    assert.ok(fs.existsSync(path.join(dir, 'MiMapa', 'region', 'r.0.0.mca')));
    assert.ok(!fs.existsSync(path.join(dir, 'MiMapa', 'leeme.txt')));

    const again = new FormData();
    again.append('file', new Blob([zip]), 'mapa.zip');
    assert.equal((await c.request('POST', `${W()}/import`, { form: again })).body.imported, 'MiMapa-2', 'no pisa el que ya existe');

    const bad = new FormData();
    bad.append('file', new Blob([rawZip({ 'foto.png': 'x' })]), 'nada.zip');
    const b = await c.request('POST', `${W()}/import`, { form: bad });
    assert.equal(b.status, 400);
    assert.match(b.body.error, /falta level.dat/);

    const evil = new FormData();
    evil.append('file', new Blob([rawZip({ 'level.dat': 'x', '../../../fuera.txt': 'mal' })]), 'malo.zip');
    await c.request('POST', `${W()}/import`, { form: evil });
    assert.ok(!fs.existsSync(path.resolve(dir, '..', '..', '..', 'fuera.txt')));
    assert.ok(!fs.existsSync(path.resolve(dir, '..', 'fuera.txt')));
  });

  it('descarga un mundo con todas sus dimensiones y borra los que no se usan', async () => {
    await c.ok('POST', `${W()}/switch`, { name: 'world' });
    const res = await c.request('GET', `${W()}/world/download`, { raw: true });
    const names = zipNames(Buffer.from(await res.arrayBuffer()));
    assert.ok(names.includes('world/marca.txt'));
    assert.ok(names.some((n) => n.startsWith('world_nether/')));
    const r = await c.ok('DELETE', `${W()}/MiMapa-2`);
    assert.ok(!r.worlds.some((w) => w.name === 'MiMapa-2'));
    assert.equal((await c.get(`${W()}/..%2F..%2Fx/download`)).status, 400);
  });

  let fullBackup;
  it('crea respaldos completos y solo del mundo (sin librerías ni logs)', async () => {
    fs.mkdirSync(path.join(dir, 'logs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'logs', 'latest.log'), 'log');
    fullBackup = await c.ok('POST', B(), { mode: 'completo' });
    assert.equal(fullBackup.mode, 'completo');
    const full = zipNames(fs.readFileSync(path.join(panel.dataDir, 'backups', s.id, fullBackup.file)));
    assert.ok(full.includes('server.properties'));
    assert.ok(full.includes('world/marca.txt'));
    assert.ok(!full.some((n) => n.startsWith('logs/')));

    const world = await c.ok('POST', B(), { mode: 'mundo' });
    const names = zipNames(fs.readFileSync(path.join(panel.dataDir, 'backups', s.id, world.file)));
    assert.ok(names.every((n) => /^world(_nether|_the_end)?\//.test(n)), names.join());
    const list = await c.ok('GET', B());
    assert.equal(list.backups.length, 2);
  });

  it('con el servidor encendido congela el guardado mientras respalda (save-off / save-all / save-on)', async () => {
    await panel.start(s.id);
    try {
      await c.ok('POST', B(), { mode: 'mundo' });
      const text = await panel.consoleText(s.id);
      const i = text.indexOf('> save-off');
      assert.ok(i >= 0);
      assert.ok(text.indexOf('> save-all flush') > i);
      await panel.waitConsole(s.id, /> save-on/);
      await panel.waitConsole(s.id, /Respaldo creado/);
      assert.equal((await c.post(`${B()}/${fullBackup.file}/restore`)).status, 409, 'no restaura con el servidor encendido');
    } finally {
      await panel.stop(s.id);
    }
  });

  it('restaura un respaldo: vuelve el mundo como estaba y conserva lo que no venía en el respaldo', async () => {
    fs.writeFileSync(path.join(dir, 'world', 'marca.txt'), 'dañado');
    fs.writeFileSync(path.join(dir, 'world', 'nuevo.txt'), 'después del respaldo');
    const r = await c.ok('POST', `${B()}/${fullBackup.file}/restore`);
    assert.ok(r.restored.includes('world'));
    assert.equal(fs.readFileSync(path.join(dir, 'world', 'marca.txt'), 'utf8'), 'original');
    assert.ok(!fs.existsSync(path.join(dir, 'world', 'nuevo.txt')), 'la carpeta del mundo queda exactamente como en el respaldo');
    assert.ok(fs.existsSync(path.join(dir, s.launch.jar)), 'el jar del servidor sigue ahí');
  });

  it('descarga y borra respaldos; no deja pedir archivos fuera de la carpeta de respaldos', async () => {
    const res = await c.request('GET', `${B()}/${fullBackup.file}/download`, { raw: true });
    assert.equal(res.status, 200);
    assert.ok(zipNames(Buffer.from(await res.arrayBuffer())).length > 0);
    assert.equal((await c.get(`${B()}/..%2F..%2Fdb.json/download`)).status, 400);
    assert.equal((await c.get(`${B()}/no-existe.zip/download`)).status, 404);
    await c.ok('DELETE', `${B()}/${fullBackup.file}`);
    assert.ok(!(await c.ok('GET', B())).backups.some((b) => b.file === fullBackup.file));
  });

  it('guarda la programación de respaldos automáticos con valores seguros', async () => {
    const r = await c.ok('PATCH', `/api/servers/${s.id}`, { backupSchedule: { enabled: true, intervalHours: 0, keep: -3, mode: 'raro' } });
    assert.deepEqual(r.backupSchedule, { enabled: true, intervalHours: 24, keep: 1, mode: 'mundo' }, 'al menos 1 respaldo y cada 24 h si no se indica');
    const list = await c.ok('GET', B());
    assert.equal(list.schedule.enabled, true);
  });

  it('la actividad registra los respaldos', async () => {
    const a = await c.ok('GET', `/api/servers/${s.id}/activity?filter=server`);
    assert.ok(a.events.filter((e) => e.type === 'backup').length >= 3);
  });

  it('eliminar el servidor puede conservar sus respaldos', async () => {
    await c.ok('POST', B(), { mode: 'mundo' });
    await c.ok('DELETE', `/api/servers/${s.id}?keepBackups=true`);
    await waitFor(() => !fs.existsSync(dir), { message: 'que se borre la carpeta' });
    assert.ok(fs.readdirSync(path.join(panel.dataDir, 'backups', s.id)).some((f) => f.endsWith('.zip')));
  });
});
