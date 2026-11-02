import '../helpers/unit-env.js';
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rawZip } from '../helpers/zip.js';
import { openZip, extractZip } from '../../server/lib/zip.js';

/**
 * Los .zip que abre el panel vienen de fuera (modpacks, mundos, archivos subidos): aquí se comprueba
 * que ninguno pueda escribir fuera de su carpeta, colar enlaces simbólicos ni llenar el disco.
 */
describe('Extracción segura de .zip', () => {
  let dir;
  beforeEach(() => (dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-zip-'))));
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('extrae un zip normal, con subcarpetas, y devuelve lo que escribió', () => {
    const zip = rawZip({ 'leeme.txt': 'hola', 'config/paper.yml': 'a: 1', 'config/': '' });
    const written = extractZip(zip, path.join(dir, 'out'));
    assert.deepEqual(written.sort(), ['config/paper.yml', 'leeme.txt']);
    assert.equal(fs.readFileSync(path.join(dir, 'out', 'config', 'paper.yml'), 'utf8'), 'a: 1');
  });

  it('una ruta "../" rechaza todo el zip antes de escribir nada', () => {
    const zip = rawZip({ 'bien.txt': 'ok', '../../malo.txt': 'mal' });
    const dest = path.join(dir, 'a', 'b');
    assert.throws(() => extractZip(zip, dest), /ruta no permitida/);
    assert.ok(!fs.existsSync(path.join(dir, 'malo.txt')));
    assert.ok(!fs.existsSync(path.join(dest, 'bien.txt')), 'no escribe a medias');
    // Con onBadPath: 'skip' (modpacks) se ignora esa entrada y el resto se instala.
    assert.deepEqual(extractZip(zip, dest, { onBadPath: 'skip' }), ['bien.txt']);
    assert.ok(!fs.existsSync(path.join(dir, 'malo.txt')));
  });

  it('rechaza enlaces simbólicos dentro del zip', () => {
    const zip = rawZip({ 'normal.txt': 'ok', enlace: { data: '/etc/passwd', mode: 0o120777 } });
    assert.equal(openZip(zip).entry('enlace').isSymlink, true);
    assert.equal(openZip(zip).entry('normal.txt').isSymlink, false);
    assert.throws(() => extractZip(zip, dir), /enlace simbólico/);
    assert.ok(!fs.existsSync(path.join(dir, 'normal.txt')));
  });

  it('respeta los límites de cantidad y tamaño por archivo', () => {
    const zip = rawZip({ 'a.txt': 'aaa', 'b.txt': 'bbb' });
    assert.throws(() => openZip(zip, { limits: { entries: 1, entryBytes: 1024 } }), /demasiados archivos/);
    assert.throws(() => openZip(zip, { limits: { entries: 10, entryBytes: 2 } }), /demasiado grande/);
    assert.equal(openZip(zip).totalBytes, 6);
  });

  it('no empieza si el total declarado no cabe en el disco', () => {
    const zip = rawZip({ 'a.txt': 'x'.repeat(1000) });
    assert.throws(
      () => extractZip(zip, dir, { minFree: () => 1500, freeSpace: 1000 }),
      (err) => err.status === 507 && /espacio/.test(err.message)
    );
    assert.deepEqual(extractZip(zip, dir, { minFree: () => 3000, freeSpace: 1000 }), ['a.txt']);
  });

  it('select() elige y renombra qué entradas salen (como al importar un mundo)', () => {
    const zip = rawZip({ 'Descargas/Mapa/level.dat': 'lvl', 'Descargas/Mapa/region/r.0.0.mca': 'r', 'Descargas/otro.txt': 'no' });
    const prefix = 'Descargas/Mapa/';
    const written = extractZip(zip, dir, { select: (e) => (e.name.startsWith(prefix) ? e.name.slice(prefix.length) : null) });
    assert.deepEqual(written.sort(), ['level.dat', 'region/r.0.0.mca']);
    assert.ok(!fs.existsSync(path.join(dir, 'Descargas')));
  });

  it('lee entradas sueltas y rechaza lo que no es un zip', () => {
    const zip = openZip(rawZip({ 'manifest.json': '{"a":1}' }));
    assert.equal(zip.read('manifest.json').toString(), '{"a":1}');
    assert.equal(zip.read('no-existe'), null);
    assert.deepEqual(zip.names(), ['manifest.json']);
    assert.throws(
      () => openZip(Buffer.from('esto no es un zip')),
      (err) => err.status === 400
    );
  });
});
