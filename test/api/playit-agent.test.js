import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { startMocks } from '../helpers/mocks.js';
import { startPanel, hasJava, waitFor } from '../helpers/panel.js';

const PANEL_KEY = 'abcdef0123456789abcdef0123456789'; // la que entrega la vinculación simulada
const OFFICIAL_KEY = 'fedcba9876543210fedcba9876543210';

/**
 * Caso de uso: "Ya tengo un agente de playit (del programa oficial o de antes): quiero usarlo
 * en el panel sin crear uno nuevo cada vez".
 */
describe('Usar un agente de playit que ya existe', { skip: !hasJava() && 'Se necesita Java' }, () => {
  let mocks;
  let panel;
  let c;
  let tmp;
  const secretFile = () => path.join(panel.dataDir, 'playit', 'playit.toml');
  const pl = () => mocks.state.playit;

  before(async () => {
    mocks = await startMocks();
    pl().keys = { [PANEL_KEY]: 'agente-panel-0001', [OFFICIAL_KEY]: 'agente-oficial-02' };
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-playit-'));
    // playit.toml del programa oficial, como lo deja en %LOCALAPPDATA%\playit_gg
    const official = path.join(tmp, 'playit.toml');
    fs.writeFileSync(official, `api_url = "https://api.playit.gg"\nsecret_key = "${OFFICIAL_KEY}"\n`);
    panel = await startPanel({ mocks, env: { PLAYIT_OFFICIAL_TOML: official } });
    c = panel.client;
  });
  after(async () => {
    await panel?.close();
    await mocks?.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('si rechazas la vinculación, explica que puedes usar tu agente', async () => {
    pl().claim.rejected = true;
    await c.ok('POST', '/api/integrations/playit/claim');
    const st = await waitFor(async () => {
      const x = await c.ok('GET', '/api/integrations/playit');
      return x.claim?.state === 'error' ? x : null;
    }, { message: 'el rechazo' });
    assert.match(st.claim.error, /Rechazaste la vinculación.*úsalo abajo en vez de crear otro/);
    pl().claim.rejected = false;
  });

  it('encuentra el agente del programa oficial en esta PC sin mostrar su clave', async () => {
    const r = await c.get('/api/integrations/playit');
    assert.equal(r.body.claimed, false);
    assert.deepEqual(r.body.detected.map((d) => [d.id, d.hint]), [['official', '…3210']]);
    assert.ok(!r.text.includes(OFFICIAL_KEY), 'la clave no sale del panel');
  });

  it('rechaza textos que no son una clave y claves que playit no acepta', async () => {
    const bad = await c.post('/api/integrations/playit/use-agent', { secret: 'hola' });
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /no parece la clave/);
    const unknown = await c.post('/api/integrations/playit/use-agent', { secret: crypto.randomBytes(16).toString('hex') });
    assert.equal(unknown.status, 400);
    assert.match(unknown.body.error, /no aceptó esa clave/);
    assert.ok(!fs.existsSync(secretFile()), 'no guarda una clave que no sirve');
  });

  it('usa el agente del programa oficial (y avisa que hay que cerrar ese programa)', async () => {
    const r = await c.ok('POST', '/api/integrations/playit/use-agent', { source: 'official' });
    assert.equal(r.claimed, true);
    assert.equal(r.agentId, 'agente-oficial-02');
    assert.match(r.warnings.join(' '), /Cierra el programa oficial de playit/);
    assert.match(fs.readFileSync(secretFile(), 'utf8'), new RegExp(OFFICIAL_KEY));
    // Con ese agente se pueden vincular los túneles que ya tenía.
    const s = await panel.createServer({ name: 'Con agente oficial', type: 'paper', mcVersion: '1.21.4' });
    const id = crypto.randomUUID();
    pl().tunnels.push({ id, name: 'Del programa', display_address: mocks.state.addPlayitAddress('java'), tunnel_type: 'minecraft-java', port_type: 'tcp', agent_config: { fields: [{ name: 'local_port', value: String(s.port) }] } });
    const linked = await c.ok('POST', `/api/servers/${s.id}/playit/link`, { java: id });
    assert.equal(linked.java.id, id);
  });

  it('al desvincular guarda la clave y después se puede volver al mismo agente', async () => {
    await c.ok('POST', '/api/integrations/playit/unlink');
    assert.ok(!fs.existsSync(secretFile()));
    const st = await c.ok('GET', '/api/integrations/playit');
    assert.deepEqual(st.detected.map((d) => d.id), ['previous'], 'el anterior y el oficial son el mismo: aparece una vez');
    const r = await c.ok('POST', '/api/integrations/playit/use-agent', { source: 'previous' });
    assert.equal(r.agentId, 'agente-oficial-02');
    assert.ok(!fs.existsSync(path.join(panel.dataDir, 'playit', 'playit.anterior.toml')));
  });

  it('acepta pegar el playit.toml completo de otro agente (y guarda el que reemplaza)', async () => {
    const r = await c.ok('POST', '/api/integrations/playit/use-agent', { secret: `# playit\nsecret_key = "${PANEL_KEY}"\nlast_update = 1\n` });
    assert.equal(r.agentId, 'agente-panel-0001');
    assert.deepEqual(r.warnings.filter((w) => /Cierra el programa/.test(w)), [], 'no es el del programa oficial');
    await c.ok('POST', '/api/integrations/playit/unlink');
    const st = await c.ok('GET', '/api/integrations/playit');
    assert.deepEqual(st.detected.map((d) => [d.id, d.hint]), [['previous', '…6789'], ['official', '…3210']]);
  });

  it('una clave pegada con el agente ya borrado en playit.gg no rompe nada', async () => {
    delete pl().keys[OFFICIAL_KEY];
    const r = await c.post('/api/integrations/playit/use-agent', { source: 'official' });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /se haya borrado de tu cuenta/);
    assert.equal((await c.ok('GET', '/api/integrations/playit')).claimed, false);
  });
});
