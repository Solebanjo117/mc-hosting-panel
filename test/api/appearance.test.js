import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startMocks } from '../helpers/mocks.js';
import { startPanel, Client } from '../helpers/panel.js';

const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

/** Caso de uso: "Quiero que el panel se vea a mi gusto, con mi propia foto de fondo, desde cualquier equipo." */
describe('Perfil y apariencia', () => {
  let mocks;
  let panel;
  let c;
  before(async () => {
    mocks = await startMocks();
    panel = await startPanel({ mocks });
    c = panel.client;
  });
  after(async () => {
    await panel?.close();
    await mocks?.close();
  });

  it('empieza con los valores por defecto y guarda cambios parciales', async () => {
    const a = await c.ok('GET', '/api/system/appearance');
    assert.equal(a.theme, 'glass');
    assert.equal(a.background, 'aurora');
    assert.equal(a.imageAt, 0);
    const b = await c.ok('PUT', '/api/system/appearance', { accent: 'oro', glassBlur: 99, custom: { dim: 50 } });
    assert.equal(b.accent, 'oro');
    assert.equal(b.glassBlur, 30, 'se recorta al máximo');
    assert.equal(b.custom.dim, 50);
    assert.equal(b.custom.fit, 'cover', 'lo que no se manda se conserva');
    assert.equal((await c.ok('GET', '/api/system/appearance')).accent, 'oro', 'queda guardado');
  });

  it('rechaza valores inválidos y el fondo personalizado sin foto', async () => {
    assert.equal((await c.put('/api/system/appearance', { theme: 'neon' })).status, 400);
    assert.equal((await c.put('/api/system/appearance', { custom: 'x' })).status, 400);
    const r = await c.put('/api/system/appearance', { background: 'custom' });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /Sube una foto/);
  });

  it('sube una foto, la sirve sin sesión y la quita', async () => {
    const form = new FormData();
    form.append('image', new Blob([GIF], { type: 'image/gif' }), 'fondo.gif');
    const up = await c.ok('PUT', '/api/system/appearance/background', undefined).catch(() => null);
    assert.equal(up, null, 'sin archivo no se acepta');
    const r = await c.request('PUT', '/api/system/appearance/background', { form });
    assert.equal(r.status, 200, r.text);
    assert.ok(r.body.imageAt > 0);

    const chosen = await c.ok('PUT', '/api/system/appearance', { background: 'custom' });
    assert.equal(chosen.background, 'custom');

    const anon = new Client(panel.base);
    assert.equal((await anon.get('/api/appearance')).body.background, 'custom', 'la apariencia se lee sin sesión');
    assert.equal((await anon.get('/api/system/appearance')).status, 401, 'pero no se cambia sin sesión');
    const img = await anon.request('GET', '/api/appearance/background', { raw: true });
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/gif');
    assert.equal(Buffer.from(await img.arrayBuffer()).length, GIF.length);

    const notImage = new FormData();
    notImage.append('image', new Blob([Buffer.from('hola esto no es una foto, es texto plano')]), 'x.png');
    assert.equal((await c.request('PUT', '/api/system/appearance/background', { form: notImage })).status, 400);

    const gone = await c.ok('DELETE', '/api/system/appearance/background');
    assert.equal(gone.imageAt, 0);
    assert.equal(gone.background, 'aurora', 'vuelve al fondo por defecto');
    assert.equal((await anon.request('GET', '/api/appearance/background')).status, 404);
  });
});
