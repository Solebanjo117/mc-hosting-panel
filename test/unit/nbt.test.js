import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { parseNbt, writeNbt } from '../../server/lib/nbt.js';

/** Caso de uso: editar level.dat y datos de jugadores sin dañar los archivos. */
const sample = () => ({
  rootName: '',
  root: {
    type: 'compound',
    value: [
      { name: 'byte', type: 'byte', value: -5 },
      { name: 'short', type: 'short', value: 32000 },
      { name: 'int', type: 'int', value: -2147483648 },
      { name: 'long', type: 'long', value: '9223372036854775807' },
      { name: 'float', type: 'float', value: 1.5 },
      { name: 'double', type: 'double', value: -0.125 },
      { name: 'texto', type: 'string', value: 'Ñandú 🙂 §6oro\u0000fin' },
      { name: 'bytes', type: 'byte_array', value: [1, -2, 3] },
      { name: 'ints', type: 'int_array', value: [1, 2, 3] },
      { name: 'longs', type: 'long_array', value: ['1', '-9223372036854775808'] },
      { name: 'vacía', type: 'list', listType: 'end', value: [] },
      {
        name: 'Inventory',
        type: 'list',
        listType: 'compound',
        value: [{ type: 'compound', value: [{ name: 'Slot', type: 'byte', value: 0 }, { name: 'id', type: 'string', value: 'minecraft:diamond' }] }],
      },
      { name: 'anidada', type: 'list', listType: 'list', value: [{ type: 'list', listType: 'int', value: [{ type: 'int', value: 7 }] }] },
    ],
  },
});

describe('NBT', () => {
  for (const compression of ['gzip', 'zlib', 'none']) {
    it(`lee lo que escribe (${compression}) y deja el archivo idéntico`, () => {
      const buf = writeNbt({ compression, ...sample() });
      const parsed = parseNbt(buf);
      assert.equal(parsed.compression, compression);
      assert.deepEqual(parsed.root, sample().root);
      const again = writeNbt(parsed);
      assert.deepEqual(parseNbt(again).root, parsed.root);
      if (compression === 'none') assert.deepEqual(again, buf);
    });
  }

  it('detecta la compresión', () => {
    const raw = writeNbt({ compression: 'none', ...sample() });
    assert.equal(parseNbt(zlib.gzipSync(raw)).compression, 'gzip');
    assert.equal(parseNbt(zlib.deflateSync(raw)).compression, 'zlib');
  });

  it('conserva números long exactos (no se redondean)', () => {
    const parsed = parseNbt(writeNbt({ compression: 'gzip', ...sample() }));
    assert.equal(parsed.root.value.find((e) => e.name === 'long').value, '9223372036854775807');
  });

  it('rechaza archivos cortados o dañados con un mensaje claro', () => {
    const buf = writeNbt({ compression: 'none', ...sample() });
    assert.throws(() => parseNbt(buf.subarray(0, 20)), /incompleto|dañado/);
  });

  it('rechaza valores fuera de rango al guardar', () => {
    const bad = sample();
    bad.root.value[0].value = 300;
    assert.throws(() => writeNbt({ compression: 'none', ...bad }));
  });
});
