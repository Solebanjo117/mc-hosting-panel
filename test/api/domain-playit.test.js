import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import dgram from 'node:dgram';
import crypto from 'node:crypto';
import { startMocks } from '../helpers/mocks.js';
import { startPanel, hasJava, waitFor } from '../helpers/panel.js';

function freeUdpPort() {
  return new Promise((resolve) => {
    const s = dgram.createSocket('udp4');
    s.bind(0, '0.0.0.0', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/**
 * Casos de uso:
 *  - "No puedo abrir puertos en mi router: quiero un túnel de playit.gg para que mis amigos entren."
 *  - "Ya creé el túnel a mano en playit.gg: quiero usarlo en el panel."
 *  - "Quiero un dominio gratis (DuckDNS, deSEC o mi dominio en Cloudflare) que apunte a mi casa o al túnel,
 *     para Java y Bedrock; y poder desvincularlo."
 */
describe('playit.gg y dominios', { skip: !hasJava() && 'Se necesita Java' }, () => {
  let mocks;
  let panel;
  let c;
  let s;
  let s2;
  const pl = () => mocks.state.playit;
  const localPort = (t) => Number(t.agent_config.fields.find((f) => f.name === 'local_port').value);
  before(async () => {
    mocks = await startMocks();
    panel = await startPanel({ mocks });
    c = panel.client;
    s = await panel.createServer({ name: 'Túnel Ñandú', type: 'paper', mcVersion: '1.21.4' });
    s2 = await panel.createServer({ name: 'Segundo', type: 'paper', mcVersion: '1.21.4' });
  });
  after(async () => {
    await panel?.close();
    await mocks?.close();
  });

  describe('playit.gg', () => {
    it('sin vincular, pide vincular primero', async () => {
      const st = await c.ok('GET', '/api/integrations/playit');
      assert.equal(st.claimed, false);
      const r = await c.post(`/api/servers/${s.id}/playit`, {});
      assert.equal(r.status, 409);
      assert.match(r.body.error, /vincula playit/);
    });

    it('vincula la cuenta: muestra el enlace, espera a que aceptes y arranca el agente', async () => {
      const st = await c.ok('POST', '/api/integrations/playit/claim');
      assert.match(st.claim.url, /^https:\/\/playit\.gg\/claim\/[0-9a-f]{10}$/);
      await waitFor(async () => (await c.ok('GET', '/api/integrations/playit')).claim.state === 'visited', { message: 'esperando al usuario' });
      pl().claim.accepted = true;
      const done = await waitFor(async () => {
        const x = await c.ok('GET', '/api/integrations/playit');
        return x.claim?.state === 'done' && x.claimed ? x : null;
      }, { timeout: 20000, message: 'la vinculación' });
      assert.equal(done.enabled, true);
      assert.equal(done.installed, true, 'descargó el agente');
      assert.match(fs.readFileSync(path.join(panel.dataDir, 'playit', 'playit.toml'), 'utf8'), /secret_key = "abcdef/);
    });

    it('crea el túnel Java del servidor apuntando a su puerto', async () => {
      const r = await c.ok('POST', `/api/servers/${s.id}/playit`, {});
      assert.equal(pl().tunnels.length, 1);
      const t = pl().tunnels[0];
      assert.equal(t.tunnel_type, 'minecraft-java');
      assert.equal(t.name, 'Tunel Nandu Java', 'sin acentos (playit no los acepta)');
      assert.equal(localPort(t), s.port);
      assert.equal(r.java.address, t.display_address);
      // En Windows el agente de prueba no es un .exe real: el panel avisa pero crea el túnel igual.
      assert.deepEqual(r.warnings.filter((w) => !/agente de playit/.test(w)), []);
      const req = mocks.requests('/playit/v1/tunnels/create').at(-1);
      assert.match(req.headers.authorization, /^Agent-Key abcdef/);
    });

    it('si cambias el puerto del servidor, el túnel se ajusta solo', async () => {
      const port = Math.max(s.port, s2.port) + 11;
      await c.ok('PATCH', `/api/servers/${s.id}`, { port });
      s = await c.ok('GET', `/api/servers/${s.id}`);
      await waitFor(() => localPort(pl().tunnels[0]) === port, { message: 'el puerto nuevo en playit' });
    });

    it('explica en español los errores de playit; si falla el de Bedrock, el de Java sigue', async () => {
      pl().createError = { status: 'error', data: { type: 'auth', message: 'SelfManagedAgentCanOnlyAffectSelf' } };
      const r = await c.post(`/api/servers/${s2.id}/playit`, {});
      assert.equal(r.status, 409);
      assert.match(r.body.error, /No se pudo crear el túnel Java: playit no dejó que el panel cambie ese túnel/);

      pl().createError = null;
      await c.ok('POST', `/api/servers/${s.id}/bedrock/enable`, { port: await freeUdpPort() });
      pl().createError = { status: 'error', data: { type: 'validation', message: 'PortAllocationFailed' } };
      const b = await c.ok('POST', `/api/servers/${s.id}/playit`, {});
      assert.match(b.warnings[0], /No se pudo crear el túnel Bedrock: playit.gg no aceptó la petición: PortAllocationFailed/);
      assert.ok(b.java && !b.bedrock);
      pl().createError = null;
      const ok = await c.ok('POST', `/api/servers/${s.id}/playit`, {});
      assert.equal(ok.bedrock.type, 'minecraft-bedrock');
    });

    it('usa un túnel que creaste a mano (lo vincula, ajusta el puerto y nunca lo borra)', async () => {
      const id = crypto.randomUUID();
      pl().tunnels.push({ id, name: 'Mi tunel', display_address: mocks.state.addPlayitAddress('java'), tunnel_type: 'minecraft-java', port_type: 'tcp', agent_config: { fields: [{ name: 'local_ip', value: '127.0.0.1' }, { name: 'local_port', value: '25565' }] } });
      const list = await c.ok('GET', '/api/integrations/playit/tunnels');
      assert.equal(list.tunnels.find((t) => t.id === id).usedBy, null);
      assert.equal(list.tunnels.find((t) => t.id === pl().tunnels[0].id).usedBy, 'Túnel Ñandú');

      const used = await c.post(`/api/servers/${s2.id}/playit/link`, { java: pl().tunnels[0].id });
      assert.equal(used.status, 409, 'un túnel no puede ser de dos servidores');
      const udp = crypto.randomUUID();
      pl().tunnels.push({ id: udp, name: 'Libre UDP', display_address: mocks.state.addPlayitAddress('bedrock'), tunnel_type: 'minecraft-bedrock', port_type: 'udp', agent_config: { fields: [] } });
      const wrongKind = await c.post(`/api/servers/${s2.id}/playit/link`, { java: udp });
      assert.equal(wrongKind.status, 400);
      assert.equal((await c.post(`/api/servers/${s2.id}/playit/link`, { java: 'otro-agente' })).status, 404);

      const r = await c.ok('POST', `/api/servers/${s2.id}/playit/link`, { java: id });
      assert.equal(r.java.id, id);
      assert.equal(localPort(pl().tunnels.find((t) => t.id === id)), s2.port, 'apunta el túnel al puerto del servidor');
      await c.ok('POST', `/api/servers/${s2.id}/playit`, { enabled: false });
      assert.ok(pl().tunnels.some((t) => t.id === id), 'desvincular no borra un túnel que no creó el panel');
    });

    it('al activar, reutiliza un túnel libre que ya apunta al puerto del servidor', async () => {
      const before = pl().tunnels.length;
      const r = await c.ok('POST', `/api/servers/${s2.id}/playit`, {});
      assert.equal(pl().tunnels.length, before, 'no creó otro');
      assert.equal(r.java.name, 'Mi tunel');
    });

    it('si el agente está dañado lo explica, no se queda "iniciando" y se arregla reinstalándolo', async () => {
      await c.ok('POST', '/api/integrations/playit/enabled', { enabled: false });
      const bin = path.join(panel.dataDir, 'playit', process.platform === 'win32' ? 'playitd.exe' : 'playitd');
      fs.rmSync(bin, { force: true });
      fs.writeFileSync(bin, 'archivo dañado', { mode: 0o644 });
      const r = await c.post('/api/integrations/playit/enabled', { enabled: true });
      if (r.status === 502) assert.match(r.body.error, /dañado o bloqueado por el antivirus/);
      else assert.equal(r.status, 200);
      const st = await waitFor(async () => {
        const x = await c.ok('GET', '/api/integrations/playit');
        return x.status === 'error' ? x : null;
      }, { message: 'estado de error' });
      assert.ok(st.logs.some((l) => /No se pudo iniciar el agente/.test(l)));
      // Crear o reparar túneles sigue funcionando (es la API de playit, no el agente).
      const t = await c.ok('POST', `/api/servers/${s2.id}/playit`, {});
      assert.ok(t.java);
      await c.ok('POST', '/api/integrations/playit/reinstall');
      assert.notEqual(fs.readFileSync(bin, 'utf8'), 'archivo dañado');
    });
  });

  describe('Dominios', () => {
    const desecRecords = () => Object.fromEntries(mocks.state.desec.records);

    it('valida el proveedor y el token antes de guardarlo', async () => {
      assert.equal((await c.put(`/api/servers/${s.id}/dns`, { enabled: true, name: 'mc' })).status, 409, 'primero elegir servicio');
      assert.match((await c.put('/api/integrations/dns', { provider: 'duckdns', token: 'abc' })).body.error, /formato/);
      assert.match((await c.put('/api/integrations/dns', { provider: 'desec', domain: 'prueba.dedyn.io', token: 'mala' })).body.error, /deSEC no aceptó el token/);
      assert.match((await c.put('/api/integrations/dns', { provider: 'desec', domain: 'otro.dedyn.io', token: 'desec-token' })).body.error, /no está en tu cuenta/);
      assert.match((await c.put('/api/integrations/dns', { provider: 'cloudflare', zone: 'ajeno.com', token: 'cf-token' })).body.error, /no ve el dominio ajeno\.com/);
      assert.equal((await c.put('/api/integrations/dns', { provider: 'otro' })).status, 400);
      const ok = await c.ok('PUT', '/api/integrations/dns', { provider: 'desec', domain: 'https://Prueba.dedyn.io/', token: 'desec-token' });
      assert.equal(ok.provider, 'desec');
      assert.equal(ok.zone, 'prueba.dedyn.io');
      assert.equal(ok.srv, true);
      assert.equal(ok.desec.tokenHint, '…oken', 'nunca devuelve el token completo');
    });

    it('deSEC + túnel de playit: crea un SRV al nombre de playit (Java) y un A para Bedrock', async () => {
      const st = await c.ok('PUT', `/api/servers/${s.id}/dns`, { enabled: true, name: 'MC.prueba.dedyn.io' });
      assert.equal(st.name, 'mc', 'acepta el nombre completo');
      assert.equal(st.effectiveTarget, 'playit');
      assert.equal(st.applied.ok, true, st.applied.error);
      const java = pl().tunnels.find((t) => t.id === (panel.readDb().servers.find((x) => x.id === s.id).playit.javaTunnelId));
      const slug = java.display_address.split('.')[0];
      const n = Number(slug.split('-')[1]);
      const recs = desecRecords();
      assert.deepEqual(recs['SRV _minecraft._tcp.mc'], [`0 5 ${41000 + n} ${slug}.gl.at.ply.gg.`]);
      assert.equal(recs['A mc'].length, 1, 'Bedrock');
      assert.ok(recs['A mc'][0].startsWith('147.185.221.1'));
      assert.deepEqual(st.applied.java, { address: 'mc.prueba.dedyn.io', withPort: false });
      assert.equal(st.applied.bedrock.host, 'mc.prueba.dedyn.io');
    });

    it('IP de la casa en otro puerto: A + SRV; y quita los registros que ya no se usan', async () => {
      const st = await c.ok('PUT', `/api/servers/${s.id}/dns`, { target: 'home' });
      assert.equal(st.applied.ok, true, st.applied.error);
      const recs = desecRecords();
      assert.deepEqual(recs['A mc'], ['203.0.113.7']);
      assert.deepEqual(recs['SRV _minecraft._tcp.mc'], [`0 5 ${s.port} mc.prueba.dedyn.io.`]);
    });

    it('no deja que dos servidores usen el mismo nombre', async () => {
      const r = await c.put(`/api/servers/${s2.id}/dns`, { enabled: true, name: 'mc', target: 'home' });
      assert.equal(r.status, 409);
      assert.match(r.body.error, /mc\.prueba\.dedyn\.io ya lo usa el servidor Túnel Ñandú/);
      assert.equal((await c.put(`/api/servers/${s2.id}/dns`, { enabled: true, name: 'mal_nombre!' })).status, 400);
    });

    it('al cambiar a Cloudflare borra los registros de deSEC y crea los nuevos (sin proxy)', async () => {
      await c.ok('PUT', '/api/integrations/dns', { provider: 'cloudflare', zone: 'midominio.com', token: 'cf-token' });
      assert.equal(mocks.state.desec.records.size, 0, 'limpió deSEC');
      const st = await c.ok('POST', `/api/servers/${s.id}/dns/update`);
      assert.equal(st.applied.ok, true, st.applied.error);
      const cf = mocks.state.cloudflare.records;
      const a = cf.find((r) => r.type === 'A');
      assert.deepEqual([a.name, a.content, a.proxied], ['mc.midominio.com', '203.0.113.7', false]);
      const srv = cf.find((r) => r.type === 'SRV');
      assert.deepEqual(srv.data, { priority: 0, weight: 5, port: s.port, target: 'mc.midominio.com' });
      await c.ok('POST', `/api/servers/${s.id}/dns/update`);
      assert.equal(cf.filter((r) => r.type === 'A').length, 1, 'actualiza en vez de duplicar');
    });

    it('DuckDNS: con playit solo sirve para Bedrock (Java usa la dirección de playit)', async () => {
      await c.ok('PUT', '/api/integrations/dns', { provider: 'duckdns', token: mocks.state.duckdns.token });
      assert.equal(mocks.state.cloudflare.records.length, 0, 'limpió Cloudflare');
      const st = await c.ok('PUT', `/api/servers/${s.id}/dns`, { target: 'playit', name: 'miserver' });
      assert.equal(st.applied.ok, true, st.applied.error);
      assert.equal(st.applied.java.unsupported, true);
      assert.match(st.applied.java.playitAddress, /\.gl\.joinmc\.link$/);
      const up = mocks.state.duckdns.updates.at(-1);
      assert.equal(up.domains, 'miserver');
      assert.ok(up.ip.startsWith('147.185.221.1'), 'la IP del túnel de Bedrock');
      assert.match((await c.put(`/api/servers/${s.id}/dns`, { name: 'a.b' })).body.error, /una sola palabra/);
    });

    it('DuckDNS: distingue un token rechazado', async () => {
      const real = mocks.state.duckdns.token;
      mocks.state.duckdns.token = '99999999-2222-3333-4444-555555555555';
      const st = await c.ok('POST', `/api/servers/${s.id}/dns/update`);
      assert.equal(st.applied.ok, false);
      assert.match(st.applied.error, /DuckDNS rechazó el token para "miserver".*termina en 5555/);
      mocks.state.duckdns.token = real;
    });

    it('desvincular el dominio apaga el dominio en todos los servidores y olvida el token', async () => {
      await c.ok('PUT', '/api/integrations/dns', { provider: 'desec', domain: 'prueba.dedyn.io', token: 'desec-token' });
      await c.ok('PUT', `/api/servers/${s.id}/dns`, { enabled: true, name: 'mc', target: 'home' });
      assert.ok(mocks.state.desec.records.size > 0);
      const r = await c.ok('POST', '/api/integrations/dns/unlink');
      assert.equal(r.provider, null);
      assert.equal(mocks.state.desec.records.size, 0, 'borró los registros');
      assert.equal(panel.readDb().settings.dns.desec.token, undefined);
      assert.equal((await c.ok('GET', `/api/servers/${s.id}/dns`)).enabled, false);
    });
  });

  it('borrar un servidor borra sus túneles de playit (los que creó el panel)', async () => {
    const ids = Object.values(panel.readDb().servers.find((x) => x.id === s.id).playit).filter((v) => typeof v === 'string');
    await c.ok('DELETE', `/api/servers/${s.id}`);
    for (const id of ids) assert.ok(!pl().tunnels.some((t) => t.id === id));
  });

  it('desvincular playit apaga los túneles en todos los servidores', async () => {
    const st = await c.ok('POST', '/api/integrations/playit/unlink');
    assert.equal(st.claimed, false);
    assert.equal(panel.readDb().servers.find((x) => x.id === s2.id).playit.enabled, false);
  });
});
