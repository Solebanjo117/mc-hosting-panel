import '../helpers/unit-env.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { aikarFlags, getYamlPath, setYamlPath } from '../../server/services/optimize.js';

/** Caso de uso: "Optimización de un clic" — banderas de Java y ajustes de Paper. */
describe('Optimización', () => {
  it('usa las banderas de Aikar, con valores distintos desde 12 GB', () => {
    const small = aikarFlags(4096);
    assert.ok(small.includes('-XX:+UseG1GC'));
    assert.ok(small.includes('-XX:G1NewSizePercent=30'));
    assert.ok(small.includes('-XX:G1HeapRegionSize=8M'));
    const big = aikarFlags(16384);
    assert.ok(big.includes('-XX:G1NewSizePercent=40'));
    assert.ok(big.includes('-XX:G1HeapRegionSize=16M'));
    assert.ok(!small.some((f) => /^-Xm[sx]/.test(f)), 'la memoria la pone el panel aparte');
  });

  it('cambia un valor anidado de YAML sin tocar el resto', () => {
    const text = 'chunks:\n  max-auto-save-chunks-per-tick: 24\n  delay-chunk-unloads-by: 10s\n# comentario\nentities:\n  spawning:\n    per-player-mob-spawns: true\n';
    assert.equal(getYamlPath(text, ['chunks', 'delay-chunk-unloads-by']), '10s');
    const r = setYamlPath(text, ['chunks', 'max-auto-save-chunks-per-tick'], '8');
    assert.equal(r.changed, true);
    assert.equal(getYamlPath(r.text, ['chunks', 'max-auto-save-chunks-per-tick']), '8');
    assert.equal(getYamlPath(r.text, ['chunks', 'delay-chunk-unloads-by']), '10s');
    assert.match(r.text, /# comentario/);
    assert.equal(setYamlPath(r.text, ['chunks', 'max-auto-save-chunks-per-tick'], '8').changed, false, 'aplicar dos veces no cambia nada');
    // Solo toca claves que Paper ya escribió; si no existen, no inventa nada.
    const missing = setYamlPath(text, ['entities', 'spawning', 'despawn-time'], '600');
    assert.deepEqual(missing, { text, changed: false, found: false });
    assert.equal(getYamlPath('a:\r\n  b: 1\r\n', ['a', 'b']), '1');
    assert.match(setYamlPath('a:\r\n  b: 1\r\n', ['a', 'b'], '2').text, /\r\n  b: 2\r\n/, 'respeta saltos de línea de Windows');
  });
});
