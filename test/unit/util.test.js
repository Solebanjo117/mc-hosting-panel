import '../helpers/unit-env.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { compareVersions, safeJoin, sanitizeFileName, offlineUuid } from '../../server/lib/util.js';
import { isPrivateIp } from '../../server/services/floodGuard.js';
import { neoforgeToMc } from '../../server/services/versions.js';

describe('Utilidades', () => {
  it('compara versiones de Minecraft y loaders', () => {
    assert.ok(compareVersions('1.21.4', '1.21') > 0);
    assert.ok(compareVersions('1.9', '1.10') < 0);
    assert.ok(compareVersions('26.1', '1.21.11') > 0);
    assert.ok(compareVersions('21.1.77-beta', '21.1.77') < 0, 'la beta es menor que la versión final');
    assert.equal(compareVersions('1.20.1', '1.20.1'), 0);
  });

  it('no deja salir de la carpeta del servidor con ../', () => {
    const base = path.resolve('/tmp/servidor');
    assert.equal(safeJoin(base, 'world/level.dat'), path.join(base, 'world', 'level.dat'));
    for (const bad of ['../otro', 'world/../../x', '../servidor-vecino/x']) {
      assert.throws(() => safeJoin(base, bad), /Ruta no permitida/, bad);
    }
    // Una ruta absoluta se toma como relativa a la carpeta del servidor. "..\\" es una salida en Windows
    // (se rechaza) y un nombre raro en Linux (queda dentro). En ningún caso sale.
    for (const odd of ['/etc/passwd', '..\\..\\x', './a/../b']) {
      let r;
      try {
        r = safeJoin(base, odd);
      } catch (err) {
        assert.match(err.message, /Ruta no permitida/);
        continue;
      }
      assert.ok(r === base || r.startsWith(base + path.sep), `${odd} → ${r}`);
    }
  });

  it('limpia nombres de archivo', () => {
    assert.equal(sanitizeFileName('a<b>:c"d/e\\f|g?h*i.jar'), 'a_b__c_d_e_f_g_h_i.jar');
  });

  it('calcula el UUID offline como Minecraft', () => {
    assert.equal(offlineUuid('Notch'), 'b50ad385-829d-3141-a216-7e7d7539ba7f');
  });

  it('reconoce IP privadas (nunca se bloquean)', () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '192.168.1.11', '172.20.1.1', '100.100.1.1']) assert.ok(isPrivateIp(ip), ip);
    for (const ip of ['8.8.8.8', '187.189.163.239', '172.32.0.1']) assert.ok(!isPrivateIp(ip), ip);
  });

  it('traduce versiones de NeoForge a Minecraft', () => {
    assert.equal(neoforgeToMc('21.1.77'), '1.21.1');
    assert.equal(neoforgeToMc('21.0.10-beta'), '1.21');
    assert.equal(neoforgeToMc('26.1.0.5'), '26.1');
  });
});
