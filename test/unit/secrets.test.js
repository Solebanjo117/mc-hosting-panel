import { DATA_DIR } from '../helpers/unit-env.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { seal, unseal, isSealed, sealPaths, unsealPaths, loadKey, KEY_FILE } from '../../server/lib/secrets.js';
import { JsonStore } from '../../server/lib/store.js';

/** Caso de uso: "Si comparto mi db.json para pedir ayuda, mis tokens no van en claro". */
describe('Tokens cifrados', () => {
  it('crea la clave en data/panel.key (solo para este usuario) y la reutiliza', () => {
    const key = loadKey();
    assert.equal(key.length, 32);
    assert.ok(fs.existsSync(KEY_FILE));
    if (process.platform !== 'win32') assert.equal(fs.statSync(KEY_FILE).mode & 0o777, 0o600);
    assert.equal(fs.readFileSync(KEY_FILE, 'utf8').trim(), key.toString('hex'));
  });

  it('cifra y descifra; cada vez sale distinto y se nota si alguien lo altera', () => {
    const a = seal('cf-token-123');
    const b = seal('cf-token-123');
    assert.ok(isSealed(a) && a.startsWith('enc:v1:'));
    assert.notEqual(a, b, 'IV aleatorio');
    assert.equal(unseal(a), 'cf-token-123');
    assert.equal(unseal(b), 'cf-token-123');
    assert.ok(!a.includes('cf-token'));
    const parts = a.split(':');
    parts[4] = parts[4].slice(0, -2) + (parts[4].endsWith('AA') ? 'BB' : 'AA');
    assert.throws(() => unseal(parts.join(':')));
    assert.throws(() => unseal(a, crypto.randomBytes(32)), 'otra clave no sirve');
  });

  it('cifra solo los campos indicados y deja el resto igual', () => {
    const data = { settings: { dns: { cloudflare: { token: 'cf-1', zone: 'ejemplo.com' }, desec: {} }, curseforge: { apiKey: '' } }, servers: [] };
    const paths = ['settings.dns.cloudflare.token', 'settings.dns.desec.token', 'settings.curseforge.apiKey', 'settings.no.existe'];
    const disk = sealPaths(data, paths);
    assert.ok(isSealed(disk.settings.dns.cloudflare.token));
    assert.equal(disk.settings.dns.cloudflare.zone, 'ejemplo.com');
    assert.equal(disk.settings.curseforge.apiKey, '', 'vacío se queda vacío');
    assert.equal(data.settings.dns.cloudflare.token, 'cf-1', 'el original no cambia');
    assert.ok(!JSON.stringify(disk).includes('cf-1'));
    assert.deepEqual(unsealPaths(structuredClone(disk), paths), data);
    // Un valor que ya está cifrado no se vuelve a cifrar.
    assert.equal(sealPaths(disk, paths).settings.dns.cloudflare.token, disk.settings.dns.cloudflare.token);
  });

  it('si se perdió la clave, el token queda vacío (hay que escribirlo de nuevo) en vez de romper el panel', () => {
    const disk = sealPaths({ s: { token: 'secreto' } }, ['s.token'], crypto.randomBytes(32));
    const back = unsealPaths(disk, ['s.token']);
    assert.equal(back.s.token, '');
  });

  it('el almacén guarda cifrado en disco y lee en claro', () => {
    const file = path.join(DATA_DIR, 'prueba-store.json');
    const paths = ['settings.curseforge.apiKey'];
    const opts = { toDisk: (d) => sealPaths(d, paths), fromDisk: (d) => unsealPaths(d, paths) };
    const a = new JsonStore(file, { settings: {} }, opts);
    a.data.settings.curseforge = { apiKey: 'clave-cf-999' };
    a.flush();
    const raw = fs.readFileSync(file, 'utf8');
    assert.ok(!raw.includes('clave-cf-999'));
    assert.ok(isSealed(JSON.parse(raw).settings.curseforge.apiKey));
    const b = new JsonStore(file, { settings: {} }, opts);
    assert.equal(b.data.settings.curseforge.apiKey, 'clave-cf-999');
    // Un db.json viejo con el token en claro se lee igual y queda cifrado al guardar.
    fs.writeFileSync(file, JSON.stringify({ settings: { curseforge: { apiKey: 'en-claro' } } }));
    const c = new JsonStore(file, { settings: {} }, opts);
    assert.equal(c.data.settings.curseforge.apiKey, 'en-claro');
    assert.ok(!fs.readFileSync(file, 'utf8').includes('en-claro'), 'se cifró al cargar');
  });
});
