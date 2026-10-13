import '../helpers/unit-env.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { plan, resolveEndpoint } from '../../server/services/dns.js';

/** Caso de uso: "Quiero que mis amigos entren con mi dominio en vez de la IP o la dirección de playit". */

const desec = { provider: 'desec', desec: { domain: 'prueba.dedyn.io' }, duckdns: {}, cloudflare: {} };
const cloudflare = { provider: 'cloudflare', cloudflare: { zone: 'midominio.com' }, duckdns: {}, desec: {} };
const duckdns = { provider: 'duckdns', duckdns: {}, desec: {}, cloudflare: {} };

const srv = (dns, extra = {}) => ({ id: 'x', port: 25565, dns: { enabled: true, name: 'mc', bedrockName: '', target: 'auto', ...dns }, ...extra });

describe('DNS: qué registros se crean', () => {
  it('IP de la casa en el puerto normal: solo un registro A', () => {
    const p = plan(srv({}), { target: 'home', java: { ip: '1.2.3.4', port: 25565 }, bedrock: null }, desec);
    assert.deepEqual(p.records, [{ type: 'A', host: 'mc.prueba.dedyn.io', ip: '1.2.3.4' }]);
    assert.deepEqual(p.java, { address: 'mc.prueba.dedyn.io', withPort: false });
  });

  it('IP de la casa en otro puerto: A + SRV para no escribir el puerto', () => {
    const p = plan(srv({}), { target: 'home', java: { ip: '1.2.3.4', port: 25570 }, bedrock: null }, cloudflare);
    assert.equal(p.records.length, 2);
    assert.deepEqual(p.records[1], { type: 'SRV', host: '_minecraft._tcp.mc.midominio.com', port: 25570, target: 'mc.midominio.com' });
    assert.equal(p.java.withPort, false);
  });

  it('DuckDNS en otro puerto: no tiene SRV, así que hay que escribir el puerto', () => {
    const p = plan(srv({}), { target: 'home', java: { ip: '1.2.3.4', port: 25570 }, bedrock: null }, duckdns);
    assert.deepEqual(p.records, [{ type: 'A', host: 'mc.duckdns.org', ip: '1.2.3.4' }]);
    assert.equal(p.java.address, 'mc.duckdns.org:25570');
  });

  it('playit + deSEC/Cloudflare: SRV hacia el nombre de playit (playit revisa el nombre del handshake)', () => {
    const ep = {
      target: 'playit',
      java: { ip: '147.185.221.215', port: 4321, target: 'cairo-flap.gl.at.ply.gg' },
      bedrock: { ip: '147.185.221.16', port: 5555 },
      playitJava: 'cairo-flap.tun.ply.gg',
    };
    const p = plan(srv({}), ep, desec);
    assert.deepEqual(p.records[0], { type: 'SRV', host: '_minecraft._tcp.mc.prueba.dedyn.io', port: 4321, target: 'cairo-flap.gl.at.ply.gg' });
    assert.ok(!p.records.some((r) => r.type === 'A' && r.ip === '147.185.221.215'), 'nunca un A hacia la IP de playit para Java');
    assert.deepEqual(p.bedrock, { host: 'mc.prueba.dedyn.io', port: 5555 });
    assert.ok(p.records.some((r) => r.type === 'A' && r.ip === '147.185.221.16'), 'Bedrock sí usa registro A');
  });

  it('playit + DuckDNS: Java no se puede (solo Bedrock) y lo explica', () => {
    const ep = { target: 'playit', java: { ip: '147.185.221.215', port: 4321, target: 'x.ply.gg' }, bedrock: { ip: '9.9.9.9', port: 5555 }, playitJava: 'x.tun.ply.gg' };
    const p = plan(srv({}), ep, duckdns);
    assert.equal(p.java.unsupported, true);
    assert.equal(p.java.playitAddress, 'x.tun.ply.gg');
    assert.deepEqual(p.records, [{ type: 'A', host: 'mc.duckdns.org', ip: '9.9.9.9' }]);
    assert.throws(() => plan(srv({}), { ...ep, bedrock: null }, duckdns), /DuckDNS/);
  });

  it('IP de la casa con Bedrock en otra IP y DuckDNS: avisa que hace falta otro subdominio', () => {
    const ep = { target: 'home', java: { ip: '1.1.1.1', port: 25565 }, bedrock: { ip: '2.2.2.2', port: 19132 } };
    const p = plan(srv({}), ep, duckdns);
    assert.equal(p.bedrock, null);
    assert.match(p.warnings[0], /segundo subdominio/);
    const p2 = plan(srv({ bedrockName: 'mcbe' }), ep, duckdns);
    assert.deepEqual(p2.bedrock, { host: 'mcbe.duckdns.org', port: 19132 });
  });

  it('el nombre vacío usa el dominio principal', () => {
    const p = plan(srv({ name: '' }), { target: 'home', java: { ip: '1.2.3.4', port: 25565 }, bedrock: null }, desec);
    assert.equal(p.records[0].host, 'prueba.dedyn.io');
  });
});

describe('DNS: leer la dirección de playit', () => {
  const resolver = {
    async resolveSrv(name) {
      if (name === '_minecraft._tcp.cairo-flap.tun.ply.gg') return [{ name: 'cairo-flap.gl.at.ply.gg.', port: 4321 }];
      throw Object.assign(new Error('nada'), { code: 'ENOTFOUND' });
    },
    async resolve4(host) {
      if (host === 'cairo-flap.gl.at.ply.gg') return ['147.185.221.215'];
      if (host === 'bed.ply.gg') return ['147.185.221.16'];
      throw Object.assign(new Error('nada'), { code: 'ENOTFOUND' });
    },
  };

  it('Java sin puerto: sigue el SRV de playit', async () => {
    assert.deepEqual(await resolveEndpoint('cairo-flap.tun.ply.gg', 'java', resolver), { ip: '147.185.221.215', port: 4321, target: 'cairo-flap.gl.at.ply.gg' });
  });
  it('Bedrock con host:puerto', async () => {
    assert.deepEqual(await resolveEndpoint('bed.ply.gg:5555', 'bedrock', resolver), { ip: '147.185.221.16', port: 5555, target: 'bed.ply.gg' });
  });
  it('IP directa', async () => {
    assert.deepEqual(await resolveEndpoint('1.2.3.4:7000', 'bedrock', resolver), { ip: '1.2.3.4', port: 7000, target: null });
  });
  it('errores claros si no hay dirección o no resuelve', async () => {
    await assert.rejects(resolveEndpoint('', 'java', resolver), /todavía no tiene dirección/);
    await assert.rejects(resolveEndpoint('no-existe.ply.gg', 'java', resolver), /No se pudo averiguar la IP de no-existe.ply.gg/);
  });
});
