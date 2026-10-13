import '../helpers/unit-env.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { serverDir } from '../../server/config.js';
import { followActiveWorld, forgetWorld } from '../../server/services/worldMap.js';

/** Un servidor Paper con BlueMap ya configurado para el mundo "world" y algo dibujado. */
function setup(id, { level = 'nuevo', extraMaps = {}, mapWorld = 'world' } = {}) {
  const dir = serverDir(id);
  const maps = path.join(dir, 'plugins', 'BlueMap', 'maps');
  fs.mkdirSync(maps, { recursive: true });
  fs.writeFileSync(path.join(dir, 'server.properties'), `level-name=${level}\n`);
  const confs = {
    world: 'world: "world"\ndimension: "minecraft:overworld"\nname: "Mundo"\n',
    world_nether: 'world: "world_nether" # carpeta\ndimension: "minecraft:the_nether"\n',
    world_the_end: 'world: "./world_the_end"\ndimension: "minecraft:the_end"\n',
    ...extraMaps,
  };
  for (const [mapId, text] of Object.entries(confs)) {
    fs.writeFileSync(path.join(maps, `${mapId}.conf`), text);
    fs.mkdirSync(path.join(dir, 'bluemap', 'web', 'maps', mapId, 'tiles'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'bluemap', 'web', 'maps', mapId, 'tiles', '0.png'), 'viejo');
  }
  return { id, type: 'paper', map: { enabled: true, port: 8100, ...(mapWorld ? { world: mapWorld } : {}) } };
}
const conf = (id, mapId) => fs.readFileSync(path.join(serverDir(id), 'plugins', 'BlueMap', 'maps', `${mapId}.conf`), 'utf8');
const drawn = (id, mapId) => fs.existsSync(path.join(serverDir(id), 'bluemap', 'web', 'maps', mapId));

/** Caso de uso: "Regeneré el mundo y el mapa sigue mostrando el anterior". */
describe('El mapa sigue al mundo activo', () => {
  it('apunta los mapas al mundo nuevo (con Nether y End) y borra lo dibujado del anterior', () => {
    const server = setup('srv-a');
    const msg = followActiveWorld(server);
    assert.match(msg, /ahora muestra el mundo "nuevo"/);
    assert.match(conf('srv-a', 'world'), /^world: "nuevo"$/m);
    assert.match(conf('srv-a', 'world_nether'), /^world: "nuevo_nether" # carpeta$/m, 'conserva comentarios');
    assert.match(conf('srv-a', 'world_the_end'), /^world: "nuevo_the_end"$/m);
    assert.match(conf('srv-a', 'world'), /name: "Mundo"/, 'el resto del archivo queda igual');
    for (const m of ['world', 'world_nether', 'world_the_end']) assert.ok(!drawn('srv-a', m), m);
    assert.equal(server.map.world, 'nuevo');
    assert.equal(followActiveWorld(server), null, 'la segunda vez no hay nada que hacer');
  });

  it('instalaciones de antes (sin mundo recordado): lo deduce de la configuración de BlueMap', () => {
    const server = setup('srv-b', { mapWorld: null });
    assert.ok(followActiveWorld(server));
    assert.match(conf('srv-b', 'world'), /^world: "nuevo"$/m);
  });

  it('no toca mapas de otros mundos (Multiverse) ni nada si el mundo no cambió', () => {
    const server = setup('srv-c', { extraMaps: { creativo: 'world: "creativo"\n' } });
    followActiveWorld(server);
    assert.match(conf('srv-c', 'creativo'), /^world: "creativo"$/m);
    assert.ok(drawn('srv-c', 'creativo'));

    const same = setup('srv-d', { level: 'world' });
    assert.equal(followActiveWorld(same), null);
    assert.ok(drawn('srv-d', 'world'), 'si el mundo es el mismo, conserva lo dibujado');
  });

  it('sin BlueMap configurado todavía no hace nada', () => {
    fs.mkdirSync(serverDir('srv-e'), { recursive: true });
    fs.writeFileSync(path.join(serverDir('srv-e'), 'server.properties'), 'level-name=otro\n');
    assert.equal(followActiveWorld({ id: 'srv-e', type: 'paper', map: { enabled: true, port: 8100, world: 'world' } }), null);
    assert.equal(followActiveWorld({ id: 'srv-e', type: 'vanilla', map: { enabled: true } }), null);
  });

  it('al borrar un mundo quita sus mapas y lo dibujado (y deja los demás)', () => {
    const server = setup('srv-f', { level: 'world', extraMaps: { creativo: 'world: "creativo"\n', creativo_nether: 'world: "creativo_nether"\n' } });
    assert.equal(forgetWorld(server, 'creativo'), 2);
    const maps = fs.readdirSync(path.join(serverDir('srv-f'), 'plugins', 'BlueMap', 'maps')).sort();
    assert.deepEqual(maps, ['world.conf', 'world_nether.conf', 'world_the_end.conf']);
    assert.ok(!drawn('srv-f', 'creativo'));
    assert.ok(!drawn('srv-f', 'creativo_nether'));
    assert.ok(drawn('srv-f', 'world'), 'el mapa del mundo activo sigue');
    assert.equal(forgetWorld(server, 'no-existe'), 0);
  });
});
