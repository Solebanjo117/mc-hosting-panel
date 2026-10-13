import '../helpers/unit-env.js';
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../server/db.js';
import { isAllowed } from '../../server/lib/netguard.js';

/** Caso de uso: "Si alguien abre por error el puerto del panel en el router, que no entren desde internet". */
describe('Quién puede abrir el panel', () => {
  after(() => delete db.data.settings.remoteAccess);

  it('por defecto (red de la casa): esta PC, la red local y Tailscale, nadie de internet', () => {
    delete db.data.settings.remoteAccess;
    for (const ip of ['127.0.0.1', '::1', '::ffff:192.168.1.40', '10.1.2.3', '172.16.0.9', '100.101.102.103', 'fd00::1', 'fe80::1']) assert.ok(isAllowed(ip), ip);
    for (const ip of ['8.8.8.8', '::ffff:187.189.1.1', '172.32.0.1', '100.128.0.1', '2001:db8::1']) assert.ok(!isAllowed(ip), ip);
  });

  it('solo esta PC', () => {
    db.data.settings.remoteAccess = 'local';
    assert.ok(isAllowed('127.0.0.1'));
    assert.ok(isAllowed('::1'));
    assert.ok(!isAllowed('192.168.1.40'));
  });

  it('cualquiera', () => {
    db.data.settings.remoteAccess = 'any';
    assert.ok(isAllowed('8.8.8.8'));
  });
});
