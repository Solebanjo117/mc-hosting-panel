import '../helpers/unit-env.js';
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rawZip } from '../helpers/zip.js';
import { isClientOnlyJar, planFromPack, readPack } from '../../server/services/modpack.js';
import { detectForgeLaunch } from '../../server/services/installer.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-modpack-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const write = (name, buf) => {
  const f = path.join(tmp, name);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, buf);
  return f;
};

/** Caso de uso: que el servidor no se caiga por mods que solo sirven en el juego. */
describe('Mods solo de cliente', () => {
  it('Fabric y Quilt: lo dice su archivo (aunque traiga saltos de línea dentro del texto)', () => {
    assert.equal(isClientOnlyJar(write('a.jar', rawZip({ 'fabric.mod.json': '{"id":"a","environment":"client","description":"línea\nnueva"}' }))), true);
    assert.equal(isClientOnlyJar(write('b.jar', rawZip({ 'fabric.mod.json': '{"id":"b","environment":"*"}' }))), false);
    assert.equal(isClientOnlyJar(write('c.jar', rawZip({ 'fabric.mod.json': '{"id":"c"}' }))), false);
    assert.equal(isClientOnlyJar(write('q.jar', rawZip({ 'quilt.mod.json': '{"minecraft":{"environment":"client"}}' }))), true);
  });

  it('Forge/NeoForge: clientSideOnly o mods conocidos que no lo declaran', () => {
    assert.equal(isClientOnlyJar(write('d.jar', rawZip({ 'META-INF/neoforge.mods.toml': 'clientSideOnly=true\n[[mods]]\nmodId="x"' }))), true);
    assert.equal(isClientOnlyJar(write('e.jar', rawZip({ 'META-INF/mods.toml': '[[mods]]\nmodId="oculus"' }))), true);
    assert.equal(isClientOnlyJar(write('f.jar', rawZip({ 'META-INF/mods.toml': '[[mods]]\nmodId="create"' }))), false);
    assert.equal(isClientOnlyJar(write('g.jar', rawZip({ 'META-INF/mods.toml': '[[mods]]\nmodId="oculus"\n[[mods]]\nmodId="otro"' }))), false, 'si trae otro mod, se queda');
  });

  it('un archivo que no es zip no se toca', () => {
    assert.equal(isClientOnlyJar(write('h.jar', 'no soy un jar')), false);
  });
});

describe('Formatos de modpack', () => {
  it('reconoce un modpack de CurseForge y su loader', () => {
    const f = write(
      'cf.zip',
      rawZip({ 'manifest.json': '﻿' + JSON.stringify({ minecraft: { version: '1.20.1', modLoaders: [{ id: 'forge-47.3.0', primary: true }] }, name: 'ATM', version: '2.1', author: 'x', files: [{ projectID: 1, fileID: 2 }, { projectID: 3, fileID: 4, required: false }] }) })
    );
    assert.deepEqual(planFromPack(readPack(f)), {
      format: 'curseforge',
      name: 'ATM',
      packVersion: '2.1',
      summary: 'de x',
      mcVersion: '1.20.1',
      type: 'forge',
      loaderVersion: '47.3.0',
      serverFiles: 1,
      skippedClientFiles: null,
    });
    const neo = write('neo.zip', rawZip({ 'manifest.json': JSON.stringify({ minecraft: { version: '1.21.1', modLoaders: [{ id: 'neoforge-21.1.77' }] }, files: [] }) }));
    assert.deepEqual([planFromPack(readPack(neo)).type, planFromPack(readPack(neo)).loaderVersion], ['neoforge', '21.1.77']);
    const quilt = write('quilt.zip', rawZip({ 'manifest.json': JSON.stringify({ minecraft: { version: '1.20.1', modLoaders: [{ id: 'quilt-0.20' }] } }) }));
    assert.throws(() => planFromPack(readPack(quilt)), /Quilt/);
  });

  it('explica cuando suben un "server pack" u otra cosa', () => {
    assert.throws(() => readPack(write('sp.zip', rawZip({ 'mods/a.jar': 'x' }))), /server pack/);
    assert.throws(() => readPack(write('foto.zip', rawZip({ 'foto.png': 'x' }))), /ni de CurseForge/);
    assert.throws(() => readPack(write('roto.zip', 'nada')), /no se pudo abrir/);
    assert.throws(() => readPack(write('mal.mrpack', rawZip({ 'modrinth.index.json': '{roto' }))), /dañado/);
  });
});

describe('Arranque de Forge después de actualizar', () => {
  it('usa la versión instalada aunque queden carpetas de la anterior', () => {
    const dir = path.join(tmp, 'forge');
    for (const v of ['1.20.1-47.3.0', '1.20.1-47.3.1', '1.20.1-47.3.10']) write(`forge/libraries/net/minecraftforge/forge/${v}/unix_args.txt`, '-cp x');
    assert.equal(detectForgeLaunch(dir, '47.3.10').argsDir, 'libraries/net/minecraftforge/forge/1.20.1-47.3.10');
    assert.equal(detectForgeLaunch(dir, '47.3.0').argsDir, 'libraries/net/minecraftforge/forge/1.20.1-47.3.0');
    assert.equal(detectForgeLaunch(dir, '47.3.1').argsDir, 'libraries/net/minecraftforge/forge/1.20.1-47.3.1', '47.3.1 no es 47.3.10');
  });
});
