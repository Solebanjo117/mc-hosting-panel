import '../helpers/unit-env.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getYamlPath, setYamlPath } from '../../server/services/optimize.js';
import { setYamlValue } from '../../server/services/geyserConfig.js';

/** Caso de uso: el panel ajusta archivos .yml (Paper, Geyser) cambiando solo una línea. */
const paper = `_version: 31
chunks:
  auto-save-interval: default
  max-auto-save-chunks-per-tick: 24
collisions:
  max-entity-collisions: 8
environment:
  optimize-explosions: false
  treasure-maps:
    enabled: true
tick-rates:
  behavior:
    villager:
      validatenearbypoi: -1
  mob-spawner: 1
`;

describe('YAML anidado (configuración de Paper)', () => {
  it('lee valores en cualquier nivel', () => {
    assert.equal(getYamlPath(paper, ['chunks', 'max-auto-save-chunks-per-tick']), '24');
    assert.equal(getYamlPath(paper, ['environment', 'treasure-maps', 'enabled']), 'true');
    assert.equal(getYamlPath(paper, ['tick-rates', 'mob-spawner']), '1', 'no se confunde con claves más adentro');
    assert.equal(getYamlPath(paper, ['tick-rates', 'nada']), undefined);
  });

  it('cambia una sola línea y deja el resto igual', () => {
    const r = setYamlPath(paper, ['tick-rates', 'mob-spawner'], '2');
    assert.ok(r.changed);
    const diff = r.text.split('\n').filter((l, i) => l !== paper.split('\n')[i]);
    assert.deepEqual(diff, ['  mob-spawner: 2']);
  });

  it('respeta finales de línea de Windows', () => {
    const crlf = paper.replace(/\n/g, '\r\n');
    const r = setYamlPath(crlf, ['collisions', 'max-entity-collisions'], '2');
    assert.ok(r.text.includes('  max-entity-collisions: 2\r\n'));
    assert.ok(!/[^\r]\n/.test(r.text));
  });
});

describe('YAML de Geyser', () => {
  const geyser = 'bedrock:\n  # Puerto\n  port: 19132 # comentario\n  address: 0.0.0.0\nremote:\n  auth-type: online\n';
  it('cambia el puerto conservando el comentario', () => {
    const r = setYamlValue(geyser, 'bedrock', 'port', 19133);
    assert.ok(r.changed);
    assert.match(r.text, /port: 19133 # comentario/);
  });
  it('no toca otra sección con la misma clave', () => {
    const r = setYamlValue(geyser, 'remote', 'auth-type', 'floodgate');
    assert.match(r.text, /auth-type: floodgate/);
    assert.match(r.text, /port: 19132/);
  });
  it('avisa si no existe', () => {
    assert.equal(setYamlValue(geyser, 'nada', 'port', 1).found, false);
  });
});
