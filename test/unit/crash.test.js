import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../../server/services/crashAnalyzer.js';

/** Caso de uso: "mi servidor se cayó, ¿por qué?" — explicaciones en español. */
const cases = [
  ['java.lang.OutOfMemoryError: Java heap space', /memoria/i],
  ['java.lang.UnsupportedClassVersionError: x has been compiled by a more recent version of the Java Runtime (class file version 65.0)', /Java 21/],
  ['**** FAILED TO BIND TO PORT!', /puerto/i],
  ['You need to agree to the EULA in order to run the server.', /EULA/],
];

describe('Diagnóstico de caídas', () => {
  for (const [log, expected] of cases) {
    it(`reconoce: ${log.slice(0, 50)}…`, () => {
      const f = analyze(`[12:00:00 INFO]: Starting\n${log}\n`);
      assert.ok(f.length >= 1, 'encontró una causa');
      assert.match(`${f[0].title} ${f[0].detail}`, expected);
      assert.ok(f[0].fix, 'propone cómo arreglarlo');
    });
  }

  it('detecta mods que faltan en Fabric', () => {
    const f = analyze("Mod 'Geyser' (geyser-fabric) 2.4.0 requires any version of fabric-api, which is missing!");
    assert.ok(f.some((x) => /Fabric API/.test(`${x.title} ${x.detail} ${x.fix}`)));
  });

  it('no inventa causas en un log normal', () => {
    assert.deepEqual(analyze('[12:00:00 INFO]: Done (1.2s)! For help, type "help"'), []);
  });

  it('no repite la misma causa', () => {
    const f = analyze('java.lang.OutOfMemoryError\njava.lang.OutOfMemoryError\n');
    assert.equal(f.length, 1);
  });
});
