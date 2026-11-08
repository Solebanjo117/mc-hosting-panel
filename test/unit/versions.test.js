import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pickUpdate } from '../../client/src/versions.js';

const v = (id, number, type, date, file = `${id}.jar`) => ({ id, number, type, date, file: file ? { name: file } : null });

/** Caso de uso: "En la ficha de un plugin instalado quiero saber si hay una versión más nueva". */
describe('Versión nueva en la ficha de un plugin', () => {
  const list = [v('v3', '3.0.0-beta', 'beta', '2026-03-01'), v('v2', '2.0.0', 'release', '2026-02-01'), v('v1', '1.0.0', 'release', '2026-01-01')];

  it('ofrece la recomendada (primera estable) cuando es más nueva', () => {
    const r = pickUpdate(list, { versionId: 'v1', versionName: '1.0.0', filename: 'v1.jar' });
    assert.equal(r.reason, 'newer');
    assert.equal(r.version.id, 'v2', 'no la beta: el mismo criterio que al instalar');
  });

  it('nada si ya tienes la recomendada', () => {
    assert.equal(pickUpdate(list, { versionId: 'v2', filename: 'v2.jar' }), null);
  });

  it('no propone bajar de una beta más nueva a la estable', () => {
    assert.equal(pickUpdate(list, { versionId: 'v3', filename: 'v3.jar' }), null);
  });

  it('reconoce la instalada por id, por número o por archivo (registros viejos sin id)', () => {
    assert.equal(pickUpdate(list, { versionName: '1.0.0', filename: 'otro.jar' }).version.id, 'v2');
    assert.equal(pickUpdate(list, { filename: 'v1.jar' }).version.id, 'v2');
  });

  it('si la instalada no está entre las compatibles lo dice aparte', () => {
    const r = pickUpdate(list, { versionId: 'v0', versionName: '0.9', filename: 'viejo.jar' });
    assert.equal(r.reason, 'incompatible');
    assert.equal(r.version.id, 'v2');
  });

  it('sin estables usa la primera; sin archivo descargable o sin lista no ofrece nada', () => {
    const betas = [v('b2', '2-beta', 'beta', '2026-02-01'), v('b1', '1-beta', 'beta', '2026-01-01')];
    assert.equal(pickUpdate(betas, { versionId: 'b1' }).version.id, 'b2');
    assert.equal(pickUpdate([v('x', '2', 'release', '2026-02-01', null)], { versionId: 'y' }), null, 'descarga externa');
    assert.equal(pickUpdate([], { versionId: 'v1' }), null);
    assert.equal(pickUpdate(null, { versionId: 'v1' }), null);
  });
});
