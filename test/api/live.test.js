import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { startMocks } from '../helpers/mocks.js';
import { startPanel, hasJava, waitFor } from '../helpers/panel.js';

/** Abre el WebSocket del panel y junta los mensajes que llegan. */
function connect(panel, { cookie = panel.client.cookie, origin } = {}) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (cookie) headers.cookie = cookie;
    if (origin) headers.origin = origin;
    const ws = new WebSocket(`${panel.base.replace('http', 'ws')}/ws`, { headers });
    ws.messages = [];
    ws.on('message', (d) => ws.messages.push(JSON.parse(d)));
    ws.once('open', () => resolve(ws));
    ws.once('unexpected-response', (_req, res) => reject(Object.assign(new Error(`HTTP ${res.statusCode}`), { status: res.statusCode })));
    ws.once('error', reject);
  });
}

/** Caso de uso: "Quiero ver la consola y el estado en vivo, sin recargar la página". */
describe('Consola y estado en vivo (WebSocket)', { skip: !hasJava() && 'Se necesita Java' }, () => {
  let mocks;
  let panel;
  let s;
  before(async () => {
    mocks = await startMocks();
    panel = await startPanel({ mocks });
    s = await panel.createServer({ name: 'En vivo', type: 'vanilla', mcVersion: '1.21.4' });
  });
  after(async () => {
    await panel?.close();
    await mocks?.close();
  });

  it('sin sesión o desde otra página no se puede conectar', async () => {
    await assert.rejects(connect(panel, { cookie: '' }), (err) => err.status === 401);
    await assert.rejects(connect(panel, { origin: 'https://pagina-mala.com' }));
  });

  it('manda el historial de la consola al suscribirse y cada línea nueva en vivo', async () => {
    const ws = await connect(panel, { origin: panel.base });
    try {
      await panel.start(s.id);
      ws.send(JSON.stringify({ type: 'subscribe', id: s.id }));
      const history = await waitFor(() => ws.messages.find((m) => m.type === 'console-history'), { message: 'historial' });
      assert.ok(history.lines.some((l) => /Done/.test(l)));
      await panel.command(s.id, 'say en vivo');
      await waitFor(() => ws.messages.some((m) => m.type === 'console' && m.id === s.id && /\[Server\] en vivo/.test(m.line)), { message: 'línea en vivo' });
      await panel.command(s.id, 'join Ana');
      await waitFor(() => ws.messages.some((m) => m.type === 'status' && m.id === s.id && m.players?.includes('Ana')), { message: 'estado con Ana' });

      ws.send(JSON.stringify({ type: 'unsubscribe', id: s.id }));
      await new Promise((r) => setTimeout(r, 200));
      const count = ws.messages.filter((m) => m.type === 'console').length;
      await panel.command(s.id, 'say ya no');
      await panel.waitConsole(s.id, /\[Server\] ya no/);
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(ws.messages.filter((m) => m.type === 'console').length, count, 'sin suscripción no llegan líneas');
      await panel.stop(s.id);
      await waitFor(() => ws.messages.some((m) => m.type === 'status' && m.id === s.id && m.status === 'stopped'), { message: 'estado apagado' });
    } finally {
      ws.close();
    }
  });

  it('una sesión cerrada por cambio de contraseña ya no conecta', async () => {
    const old = panel.client.cookie;
    await panel.client.ok('POST', '/api/auth/password', { current: 'clave-segura-123', password: 'otra-clave-999' });
    await assert.rejects(connect(panel, { cookie: old }), (err) => err.status === 401);
    const ws = await connect(panel);
    ws.close();
  });
});
